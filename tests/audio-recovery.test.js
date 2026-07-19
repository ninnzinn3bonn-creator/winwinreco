'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createTrack(readyState = 'live') {
    return {
        readyState,
        enabled: true,
        stop: jest.fn(function stop() { this.readyState = 'ended'; }),
        applyConstraints: jest.fn().mockResolvedValue(undefined),
        onended: null,
        onmute: null,
        onunmute: null
    };
}

function createStream(track) {
    return {
        getAudioTracks: () => [track],
        getTracks: () => [track]
    };
}

function createAudioContext() {
    const processor = {
        connect: jest.fn(),
        disconnect: jest.fn(),
        onaudioprocess: null
    };
    const source = { connect: jest.fn() };
    const analyser = {
        fftSize: 0,
        connect: jest.fn(),
        getByteTimeDomainData: jest.fn()
    };
    return {
        state: 'running',
        sampleRate: 48000,
        destination: {},
        onstatechange: null,
        createMediaStreamSource: jest.fn(() => source),
        createAnalyser: jest.fn(() => analyser),
        createScriptProcessor: jest.fn(() => processor),
        resume: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(function close() {
            this.state = 'closed';
            return Promise.resolve();
        })
    };
}

function loadAudioModule(overrides = {}) {
    const state = {
        stream: null,
        audioContext: null,
        audioSource: null,
        micAnalyser: null,
        micMonitorFrame: null,
        processor: null,
        isMuted: false,
        ws: null,
        micPresetKey: 'pin_mic',
        voiceGate: {
            threshold: 0.01,
            maxThreshold: 0.8,
            releaseFrames: 2,
            remainingFrames: 0,
            speaking: false,
            activeFrames: 0,
            attackCounter: 0
        },
        lastAudioSentAt: 0,
        lastTranscriptAt: 0,
        lastSttRestartAt: 0,
        transcriptStallWatchdog: null,
        watchdogInterval: null,
        ...overrides.state
    };
    const replacementTrack = createTrack();
    const replacementStream = createStream(replacementTrack);
    const getUserMedia = jest.fn().mockResolvedValue(replacementStream);
    const document = {
        getElementById: jest.fn(() => null),
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => [])
    };
    const meetingScreen = { classList: { contains: jest.fn(() => true) } };
    const windowObject = {
        AppState: { state },
        AppDom: { meetingScreen },
        AppUtils: {
            isSecureContextForMedia: () => true,
            clampThresholdPair: (min, max) => ({ min, max }),
            getPreferredAudioConstraints: () => ({ audio: true }),
            resampleToTargetRate: (input) => input
        },
        AppMicPresets: {
            defaultDesktop: 'pin_mic',
            presets: {
                pin_mic: {
                    key: 'pin_mic',
                    label: 'Pin mic',
                    thresholds: { min: 0.01, max: 0.8 },
                    vad: {},
                    stt: {}
                }
            }
        },
        AppMain: { AppDebug: { log: jest.fn() } },
        AppMeetingUi: { addSystemMessage: jest.fn() },
        AppToast: { error: jest.fn(), warn: jest.fn() },
        DebugMonitor: null,
        AudioContext: jest.fn(() => createAudioContext())
    };
    const context = {
        window: windowObject,
        document,
        navigator: {
            mediaDevices: { getUserMedia },
            permissions: { query: jest.fn() }
        },
        localStorage: { getItem: jest.fn(), setItem: jest.fn() },
        WebSocket: { OPEN: 1 },
        Float32Array,
        Int16Array,
        Uint8Array,
        Date,
        Math,
        JSON,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: jest.fn(() => 1),
        cancelAnimationFrame: jest.fn()
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../src/frontend/audio.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'audio.js' });
    return { audio: windowObject.AppAudio, state, getUserMedia, replacementTrack };
}

describe('frontend audio recovery', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('does not throw or mark audio sent while the app WebSocket is closed', () => {
        const send = jest.fn();
        const { audio, state } = loadAudioModule({ state: { ws: { readyState: 3, send } } });

        expect(audio.sendAudioChunk(new ArrayBuffer(8))).toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(state.lastAudioSentAt).toBe(0);
    });

    test('gives transcription a fresh grace period when speech resumes after a long pause', () => {
        const now = Date.now();
        const send = jest.fn();
        const { audio, state } = loadAudioModule({
            state: {
                ws: { readyState: 1, send },
                lastAudioSentAt: now - 60000,
                lastTranscriptAt: now - 60000
            }
        });

        expect(audio.sendAudioChunk(new ArrayBuffer(8))).toBe(true);
        expect(state.lastTranscriptAt).toBeGreaterThanOrEqual(now);
        expect(state.lastAudioSentAt).toBeGreaterThanOrEqual(now);
    });

    test('stall watchdog restarts STT without closing the app WebSocket', async () => {
        const send = jest.fn();
        const close = jest.fn();
        const { audio } = loadAudioModule({
            state: {
                ws: { readyState: 1, send, close },
                lastAudioSentAt: Date.now(),
                lastTranscriptAt: Date.now() - 41000
            }
        });

        audio.startTranscriptStallWatchdog();
        await jest.advanceTimersByTimeAsync(30000);

        expect(close).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(JSON.stringify({
            type: 'restart_stt',
            reason: 'client-transcript-stall'
        }));
    });

    test('reacquires an ended microphone track and rebuilds the processor', async () => {
        const endedTrack = createTrack('ended');
        const oldContext = createAudioContext();
        const { audio, state, getUserMedia, replacementTrack } = loadAudioModule({
            state: {
                stream: createStream(endedTrack),
                audioContext: oldContext,
                processor: { disconnect: jest.fn(), onaudioprocess: null }
            }
        });

        expect(audio.isAudioPipelineHealthy()).toBe(false);
        await expect(audio.recoverAudioPipeline({ reason: 'test-ended-track' })).resolves.toBe(true);

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(audio.getLiveAudioTrack()).toBe(replacementTrack);
        expect(state.processor).toBeTruthy();
        expect(audio.isAudioPipelineHealthy()).toBe(true);
    });

    test('track ended event schedules automatic recovery during a meeting', async () => {
        const activeTrack = createTrack('live');
        const stream = createStream(activeTrack);
        const { audio, getUserMedia } = loadAudioModule({
            state: {
                stream,
                audioContext: createAudioContext(),
                processor: { disconnect: jest.fn(), onaudioprocess: null }
            }
        });
        audio.bindStreamState(stream);
        activeTrack.readyState = 'ended';
        activeTrack.onended();

        await jest.advanceTimersByTimeAsync(300);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(audio.isAudioPipelineHealthy()).toBe(true);
    });
});
