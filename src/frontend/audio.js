(function initAudioModule() {
    const { state } = window.AppState;
    const dom = window.AppDom;
    const {
        isSecureContextForMedia,
        getPreferredAudioConstraints,
        resampleToTargetRate
    } = window.AppUtils;
    const {
        presets: MIC_PRESETS = {},
        defaultDesktop: DEFAULT_DESKTOP_PRESET = 'personal',
        normalizePresetKey = (key) => key,
        resolvePreset = (key) => MIC_PRESETS[key] || MIC_PRESETS[DEFAULT_DESKTOP_PRESET] || null
    } = window.AppMicPresets || {};
    let audioRecoveryTimer = null;
    let audioRecoveryPromise = null;
    let intentionalAudioStop = false;

    function getMicPresetConfig(key = state.micPresetKey) {
        return resolvePreset(key, !!state.micReverberant);
    }

    function getBrowserAudioConstraints(preset = getMicPresetConfig()) {
        const preferred = getPreferredAudioConstraints(preset);
        const requested = preferred?.audio;
        if (!requested || typeof requested !== 'object') return preferred;

        const supported = navigator.mediaDevices?.getSupportedConstraints?.();
        if (!supported) return preferred;
        const audio = {};
        Object.entries(requested).forEach(([name, value]) => {
            if (supported[name]) audio[name] = value;
        });
        return { audio: Object.keys(audio).length ? audio : true };
    }

    function applyVoiceGatePreset(preset = getMicPresetConfig()) {
        if (!preset) return;
        const thresholds = preset.thresholds || {};
        const vad = preset.vad || {};
        state.voiceGate.threshold = Number.isFinite(thresholds.min) ? thresholds.min : 0.008;
        state.voiceGate.maxThreshold = Number.isFinite(thresholds.max) ? thresholds.max : 0.9;
        state.voiceGate.attackFrames = Number.isFinite(vad.attackFrames) ? vad.attackFrames : 1;
        state.voiceGate.minActiveFrames = Number.isFinite(vad.minActiveFrames) ? vad.minActiveFrames : 1;
        state.voiceGate.releaseFrames = Number.isFinite(vad.releaseFrames) ? vad.releaseFrames : 6;
        state.voiceGate.crestMin = Number.isFinite(vad.crestMin) ? vad.crestMin : 1;
        state.voiceGate.crestMax = Number.isFinite(vad.crestMax) ? vad.crestMax : 30;
        state.voiceGate.noiseFloor = 0;
        state.voiceGate.remainingFrames = 0;
        state.voiceGate.activeFrames = 0;
        state.voiceGate.attackCounter = 0;
    }

    function adaptVoiceGateToNoise(rms) {
        const preset = getMicPresetConfig();
        const thresholds = preset?.thresholds;
        if (!thresholds || state.voiceGate.speaking || !Number.isFinite(rms)) return;
        if (rms > Math.max(state.voiceGate.threshold * 1.5, thresholds.adaptiveCeiling || 0.02)) return;

        const previous = state.voiceGate.noiseFloor;
        const noiseFloor = previous > 0 ? (previous * 0.92) + (rms * 0.08) : rms;
        const floor = thresholds.adaptiveFloor ?? thresholds.min;
        const ceiling = thresholds.adaptiveCeiling ?? thresholds.min;
        const multiplier = thresholds.noiseMultiplier ?? 2.5;
        state.voiceGate.noiseFloor = noiseFloor;
        state.voiceGate.threshold = Math.max(floor, Math.min(ceiling, noiseFloor * multiplier));
    }

    function getLiveAudioTrack() {
        const track = state.stream?.getAudioTracks?.()[0] || null;
        return track && track.readyState !== 'ended' ? track : null;
    }

    function isMeetingActive() {
        return !!dom.meetingScreen?.classList?.contains('active');
    }

    function isAudioPipelineHealthy() {
        const contextState = state.audioContext?.state;
        return !!(
            getLiveAudioTrack()
            && state.processor
            && contextState
            && contextState !== 'closed'
        );
    }

    function scheduleAudioRecovery(reason, delayMs = 600) {
        if (intentionalAudioStop || !isMeetingActive()) return;
        if (audioRecoveryTimer) clearTimeout(audioRecoveryTimer);
        audioRecoveryTimer = setTimeout(() => {
            audioRecoveryTimer = null;
            recoverAudioPipeline({ reason }).catch((error) => {
                window.AppMain?.AppDebug?.log('warn', 'Audio recovery failed', error?.message || reason);
            });
        }, delayMs);
    }

    function markAudioSent() {
        const now = Date.now();
        if (!state.lastAudioSentAt || now - state.lastAudioSentAt > 30000) {
            state.lastTranscriptAt = now;
        }
        state.lastAudioSentAt = now;
    }

    function sendAudioChunk(chunk) {
        const socket = state.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(chunk);
            markAudioSent();
            return true;
        } catch (error) {
            window.AppMain?.AppDebug?.log('warn', 'Audio chunk send failed', error?.message || 'unknown');
            return false;
        }
    }

    function updateMicStatus(message) {
        if (dom.micCheckStatus) {
            dom.micCheckStatus.innerText = message;
        }
        if (window.DebugMonitor?.updateMicStatus) {
            window.DebugMonitor.updateMicStatus(message);
        }
    }

    function renderMicPresetUi() {
        const preset = getMicPresetConfig();
        if (dom.micPresetSummary) {
            dom.micPresetSummary.innerText = preset
                ? `${preset.label}: ${preset.description}`
                : 'マイクの種類を選んでください。';
        }
        if (dom.meetingMicPresetSummary) {
            dom.meetingMicPresetSummary.innerText = preset
                ? `現在のマイク: ${preset.label}`
                : '現在のマイク: 未設定';
        }
        document.querySelectorAll('[data-mic-preset]').forEach((button) => {
            const selected = button.dataset.micPreset === state.micPresetKey;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-checked', selected ? 'true' : 'false');
        });
        if (dom.setupMicReverberant) dom.setupMicReverberant.checked = !!state.micReverberant;
        if (dom.meetingMicReverberant) dom.meetingMicReverberant.checked = !!state.micReverberant;
    }

    function sendMicPresetMetadataToServer(preset) {
        const target = preset || getMicPresetConfig();
        if (!target || !target.stt) return;
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        try {
            // STT is fixed to ElevenLabs Scribe. Do not read localStorage here:
            // older sessions may still contain "google", and sending that in a
            // mic_preset message would silently create a per-session provider
            // switch on the backend.
            const sttProvider = state.fixedSttProvider || 'elevenlabs';
            state.ws.send(JSON.stringify({
                type: 'mic_preset',
                stt_provider: sttProvider,
                mic: {
                    microphoneDistance: target.stt.microphoneDistance || null,
                    recordingDeviceType: target.stt.recordingDeviceType || null
                }
            }));
        } catch (err) {
            window.AppMain?.AppDebug?.log('warn', 'mic_preset send failed', err && err.message);
        }
    }

    function updateMuteButton() {
        syncMuteUi();
    }

    function syncMuteUi() {
        const unifiedBtn = document.getElementById('btn-mic-state');
        const dockBtn = document.getElementById('btn-dock-mic');
        const indicator = document.querySelector('.recording-indicator');
        const hasStream = !!state.stream;
        const label = !hasStream
            ? 'マイク ON'
            : state.isMuted
                ? 'ミュート中 (タップで解除)'
                : '録音中 (タップでミュート)';
        const title = !hasStream
            ? 'タップでマイクを接続'
            : state.isMuted
                ? 'タップでミュートを解除'
                : 'タップでミュート';
        const iconPath = state.isMuted ? 'assets/icons/mic-off.svg' : 'assets/icons/mic.svg';
        if (unifiedBtn) {
            unifiedBtn.classList.remove('mic-state-off', 'mic-state-on', 'mic-state-muted');
            unifiedBtn.classList.add(!hasStream ? 'mic-state-off' : state.isMuted ? 'mic-state-muted' : 'mic-state-on');
            const icon = unifiedBtn.querySelector('img');
            const text = unifiedBtn.querySelector('.mic-state-label');
            if (icon) icon.src = iconPath;
            if (text) text.textContent = label;
            unifiedBtn.title = title;
            unifiedBtn.setAttribute('aria-label', title);
        }
        if (dockBtn) {
            const icon = dockBtn.querySelector('img');
            if (icon) icon.src = iconPath;
            dockBtn.classList.toggle('is-muted', state.isMuted);
            dockBtn.classList.toggle('is-recording', hasStream && !state.isMuted);
            dockBtn.title = title;
            dockBtn.setAttribute('aria-label', title);
        }
        if (indicator) {
            indicator.classList.toggle('paused', state.isMuted);
        }
        if (dom.selfInfo) {
            dom.selfInfo.innerText = `参加者: ${state.displayName || '---'}${state.isMuted ? ' / ミュート中' : ''}`;
        }
    }

    function persistMicConfiguration() {
        localStorage.setItem('mic_preset', state.micPresetKey);
        localStorage.setItem('mic_reverberant', state.micReverberant ? '1' : '0');
        localStorage.removeItem?.('mic_sensitivity');
        localStorage.removeItem?.('mic_threshold_min');
        localStorage.removeItem?.('mic_threshold_max');

        if (window.AppProfile?.saveSettings) {
            try {
                window.AppProfile.saveSettings({
                    defaultMicPreset: state.micPresetKey,
                    reverberantRoom: !!state.micReverberant
                });
            } catch (_) { /* ignore */ }
        }
    }

    function logAppliedTrackSettings(track, preset) {
        if (!track?.getSettings) return;
        const settings = track.getSettings();
        window.AppMain?.AppDebug?.log('info', 'Microphone settings applied', {
            mode: preset?.key,
            reverberant: !!preset?.reverberant,
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl
        });
    }

    async function applyConstraintsToLiveTrack(preset) {
        const track = getLiveAudioTrack();
        if (!track?.applyConstraints) return false;
        try {
            await track.applyConstraints(getBrowserAudioConstraints(preset).audio);
            logAppliedTrackSettings(track, preset);
            return true;
        } catch (error) {
            window.AppMain?.AppDebug?.log('warn', 'Mic configuration applyConstraints failed', error.message);
            return false;
        }
    }

    async function applyMicPreset(key, options = {}) {
        const normalizedKey = normalizePresetKey(key) || DEFAULT_DESKTOP_PRESET;
        if (key === 'echo_room') state.micReverberant = true;
        state.micPresetKey = normalizedKey;
        const preset = getMicPresetConfig(normalizedKey);
        if (!preset) return;

        applyVoiceGatePreset(preset);
        persistMicConfiguration();
        renderMicPresetUi();
        await applyConstraintsToLiveTrack(preset);
        sendMicPresetMetadataToServer(preset);

        if (!options.silent) {
            updateMicStatus(`${preset.label}に切り替えました。音量は自動調整します。`);
        }
    }

    async function setMicEnvironment(reverberant, options = {}) {
        state.micReverberant = !!reverberant;
        const preset = getMicPresetConfig();
        applyVoiceGatePreset(preset);
        persistMicConfiguration();
        renderMicPresetUi();
        await applyConstraintsToLiveTrack(preset);
        sendMicPresetMetadataToServer(preset);
        if (!options.silent) {
            updateMicStatus(state.micReverberant
                ? '反響を抑える設定にしました。語尾を長めに保持します。'
                : '通常の部屋向けの設定に戻しました。');
        }
    }

    function bindStreamState(stream) {
        const [track] = stream.getAudioTracks();
        if (!track) return;

        track.onended = () => {
            updateMicStatus('マイク入力が停止しました。端末設定やブラウザ権限を確認してください。');
            window.AppMain?.AppDebug?.log('warn', 'Microphone track ended');
            if (state.stream === stream) scheduleAudioRecovery('track-ended', 250);
        };
        track.onmute = () => {
            if (!state.isMuted) updateMicStatus('マイク入力が一時的にミュートされました。');
            if (!state.isMuted && state.stream === stream) scheduleAudioRecovery('track-muted', 1500);
        };
        track.onunmute = () => {
            if (audioRecoveryTimer) {
                clearTimeout(audioRecoveryTimer);
                audioRecoveryTimer = null;
            }
            updateMicStatus(state.isMuted ? 'ミュート中です。' : 'マイク入力を再開しました。');
        };
    }

    function stopMicMonitor() {
        if (state.micMonitorFrame) {
            cancelAnimationFrame(state.micMonitorFrame);
            state.micMonitorFrame = null;
        }
        if (dom.micLevelBar) {
            dom.micLevelBar.style.width = '4%';
            dom.micLevelBar.classList.remove('clipped');
        }
        if (dom.liveFocusLevel) dom.liveFocusLevel.style.width = '4%';
    }

    function startMicMonitor() {
        if (!state.audioContext || !state.micAnalyser) return;

        const buffer = new Uint8Array(state.micAnalyser.fftSize);
        const tick = () => {
            if (!state.micAnalyser) return;
            state.micAnalyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i += 1) {
                const normalized = (buffer[i] - 128) / 128;
                sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / buffer.length);
            adaptVoiceGateToNoise(rms);
            const width = Math.max(4, Math.min(100, Math.round(rms * 320)));
            dom.micLevelBar.style.width = `${width}%`;
            dom.micLevelBar.classList.toggle('clipped', rms >= state.voiceGate.maxThreshold);
            if (dom.micMeterShell) dom.micMeterShell.setAttribute('aria-valuenow', String(width));
            if (dom.liveFocusLevel) dom.liveFocusLevel.style.width = `${width}%`;
            const now = Date.now();
            if (!isMeetingActive() && now - (state.lastMicGuidanceAt || 0) > 1400) {
                state.lastMicGuidanceAt = now;
                if (rms >= state.voiceGate.maxThreshold) {
                    updateMicStatus('声が大きすぎます。マイクを少し離してください。');
                } else if (rms >= state.voiceGate.threshold) {
                    updateMicStatus('声を確認できました。このまま会議を始められます。');
                } else {
                    updateMicStatus('マイクに向かって普段の声で話してください。');
                }
            }
            state.micMonitorFrame = requestAnimationFrame(tick);
        };

        stopMicMonitor();
        state.micMonitorFrame = requestAnimationFrame(tick);
    }

    function ensureAudioNodes() {
        if (!state.stream || !state.audioContext) return;
        if (!state.audioSource) {
            state.audioSource = state.audioContext.createMediaStreamSource(state.stream);
        }
        if (!state.micAnalyser) {
            const analyser = state.audioContext.createAnalyser();
            analyser.fftSize = 2048;
            state.audioSource.connect(analyser);
            state.micAnalyser = analyser;
        }
        startMicMonitor();
    }

    async function requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        if (!dom.meetingScreen.classList.contains('active') || document.hidden) return;
        if (state.wakeLockSentinel) return;

        try {
            state.wakeLockSentinel = await navigator.wakeLock.request('screen');
            state.wakeLockSentinel.addEventListener('release', () => {
                state.wakeLockSentinel = null;
            });
        } catch (error) {
            window.AppMain?.AppDebug?.log('warn', 'Wake lock unavailable', error.message);
        }
    }

    async function releaseWakeLock() {
        if (!state.wakeLockSentinel) return;
        try {
            await state.wakeLockSentinel.release();
        } catch (error) {
            window.AppMain?.AppDebug?.log('warn', 'Wake lock release failed', error.message);
        } finally {
            state.wakeLockSentinel = null;
        }
    }

    async function prepareAudio(options = {}) {
        window.AppMain?.AppDebug?.log('info', 'prepareAudio: Requesting permission on user gesture');
        try {
            if (!isSecureContextForMedia()) {
                throw new Error('マイク利用には HTTPS または localhost が必要です');
            }
            const preset = getMicPresetConfig();
            const liveTrack = getLiveAudioTrack();
            if (options.forceNewStream || !liveTrack) {
                const previousStream = state.stream;
                const nextStream = await navigator.mediaDevices.getUserMedia(getBrowserAudioConstraints(preset));
                state.stream = nextStream;
                bindStreamState(nextStream);
                logAppliedTrackSettings(nextStream.getAudioTracks?.()[0], preset);
                if (previousStream && previousStream !== nextStream) {
                    previousStream.getTracks().forEach((track) => track.stop());
                }
            } else {
                await applyConstraintsToLiveTrack(preset);
            }
            state.stream.getAudioTracks().forEach((track) => {
                track.enabled = !state.isMuted;
            });
            if (!state.audioContext || state.audioContext.state === 'closed') {
                state.audioContext = null;
                state.audioSource = null;
                state.micAnalyser = null;
                state.processor = null;
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                state.audioContext.onstatechange = () => {
                    const currentState = state.audioContext ? state.audioContext.state : 'closed';
                    if (currentState === 'interrupted' || currentState === 'suspended') {
                        updateMicStatus('音声入力が端末側で中断されました。復帰後にマイクONで再接続してください。');
                        scheduleAudioRecovery(`audio-context-${currentState}`, 800);
                    }
                };
            }
            if (state.audioContext.state === 'suspended') await state.audioContext.resume();
            ensureAudioNodes();
            if (options.updateStatus) {
                const actualRate = Math.round(state.audioContext?.sampleRate || 0);
                const resampleNote = actualRate && actualRate !== 16000 ? ` 実入力 ${actualRate}Hz を 16000Hz に変換して送ります。` : '';
                const presetLabel = preset?.label ? `現在は ${preset.label} です。` : '';
                updateMicStatus(`マイクを接続しました。${presetLabel}普段の声で話してください。${resampleNote}`);
            }
            return true;
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'prepareAudio failed', error.message);
            if (options.updateStatus) updateMicStatus(`マイク設定に失敗しました: ${error.message}`);
            window.AppToast.error('マイクの許可に失敗しました', { detail: error.message });
            return false;
        }
    }

    async function runMicCheck() {
        const ok = await prepareAudio({ updateStatus: true });
        if (!ok) return;
        updateMicStatus('マイクに向かって普段の声で話してください。音量は自動調整します。');
    }

    async function startRecording({ onAudioChunk } = {}) {
        if (isAudioPipelineHealthy() && state.audioContext.state === 'running') return true;
        try {
            if (!getLiveAudioTrack() || !state.audioContext || state.audioContext.state === 'closed') {
                const prepared = await prepareAudio({ forceNewStream: !getLiveAudioTrack() });
                if (!prepared) return false;
            }
            if (state.audioContext.state === 'suspended' || state.audioContext.state === 'interrupted') {
                await state.audioContext.resume();
            }
            ensureAudioNodes();
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'startRecording failed', error.message);
            window.AppMeetingUi?.addSystemMessage?.(`マイク接続エラー: ${error.name}`);
            return false;
        }
        try {
            if (state.processor) {
                state.processor.onaudioprocess = null;
                state.processor.disconnect();
            }
            const processor = state.audioContext.createScriptProcessor(4096, 1, 1);
            const source = state.audioSource || state.audioContext.createMediaStreamSource(state.stream);
            state.audioSource = source;
            source.connect(processor);
            processor.connect(state.audioContext.destination);
            if (typeof state.voiceGate.activeFrames !== 'number') state.voiceGate.activeFrames = 0;
            if (typeof state.voiceGate.attackCounter !== 'number') state.voiceGate.attackCounter = 0;

            processor.onaudioprocess = (event) => {
                if (state.isMuted) return;
                const inputData = event.inputBuffer.getChannelData(0);
                const clippedInput = new Float32Array(inputData.length);
                const maxThreshold = Math.max(0.05, state.voiceGate.maxThreshold);
                let energy = 0;
                let peak = 0;
                for (let i = 0; i < inputData.length; i += 1) {
                    const sample = Math.max(-maxThreshold, Math.min(maxThreshold, inputData[i]));
                    clippedInput[i] = sample / maxThreshold;
                    const absSample = Math.abs(clippedInput[i]);
                    if (absSample > peak) peak = absSample;
                    energy += clippedInput[i] * clippedInput[i];
                }
                const rms = Math.sqrt(energy / clippedInput.length);
                const gate = state.voiceGate;
                const attackFrames = Number.isFinite(gate.attackFrames) ? gate.attackFrames : 1;
                const minActiveFrames = Number.isFinite(gate.minActiveFrames) ? gate.minActiveFrames : 1;
                const crestMin = Number.isFinite(gate.crestMin) ? gate.crestMin : 1;
                const crestMax = Number.isFinite(gate.crestMax) ? gate.crestMax : 30;
                const crest = rms > 0.0001 ? peak / rms : 0;
                const isSpeechLike = rms >= gate.threshold && crest >= crestMin && crest <= crestMax;

                if (isSpeechLike) {
                    gate.attackCounter = Math.min(gate.attackCounter + 1, attackFrames + 1);
                } else {
                    gate.attackCounter = 0;
                }

                const gateOpen = gate.attackCounter >= attackFrames;
                if (gateOpen) {
                    gate.remainingFrames = gate.releaseFrames;
                    gate.speaking = true;
                    gate.activeFrames += 1;
                } else if (gate.remainingFrames > 0) {
                    gate.remainingFrames -= 1;
                } else {
                    gate.speaking = false;
                    gate.activeFrames = 0;
                    return;
                }

                if (minActiveFrames > 1 && gate.activeFrames < minActiveFrames) return;

                const sourceRate = state.audioContext.sampleRate || 16000;
                const mono16k = resampleToTargetRate(clippedInput, sourceRate, 16000);
                const pcm = new Int16Array(mono16k.length);
                for (let i = 0; i < mono16k.length; i += 1) {
                    pcm[i] = Math.max(-1, Math.min(1, mono16k[i])) * 0x7fff;
                }
                let sent = false;
                if (typeof onAudioChunk === 'function') {
                    try {
                        sent = onAudioChunk(pcm.buffer) !== false;
                    } catch (error) {
                        window.AppMain?.AppDebug?.log('warn', 'Audio chunk callback failed', error?.message || 'unknown');
                    }
                } else {
                    sent = sendAudioChunk(pcm.buffer);
                }
                if (sent && typeof onAudioChunk === 'function') markAudioSent();
            };
            state.processor = processor;
            return true;
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'audio processor failed', error.message);
            return false;
        }
    }

    // Fix B-4: フロント空転検知 — 音声送信中で 40 秒以上 transcript が来ない場合に WS 再接続
    function startTranscriptStallWatchdog() {
        if (state.transcriptStallWatchdog) {
            clearInterval(state.transcriptStallWatchdog);
        }
        state.transcriptStallWatchdog = setInterval(() => {
            // 音声が直近 30 秒で来ていないなら誤検知なのでスキップ
            const audioAge = Date.now() - (state.lastAudioSentAt || 0);
            if (audioAge > 30000) return;
            // ミュート中もスキップ
            if (state.isMuted) return;
            const transcriptAge = Date.now() - (state.lastTranscriptAt || 0);
            if (transcriptAge > 40000) {
                const restartAge = Date.now() - (state.lastSttRestartAt || 0);
                if (restartAge < 30000) return;
                state.lastSttRestartAt = Date.now();
                state.lastTranscriptAt = Date.now();
                window.AppToast?.warn('文字起こしを自動的に再接続しています。', { sticky: false });
                const socket = state.ws;
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(JSON.stringify({ type: 'restart_stt', reason: 'client-transcript-stall' }));
                    } catch (error) {
                        window.AppMain?.AppDebug?.log('warn', 'STT restart request failed', error?.message || 'unknown');
                    }
                }
            }
        }, 30000);
    }

    function stopTranscriptStallWatchdog() {
        if (state.transcriptStallWatchdog) {
            clearInterval(state.transcriptStallWatchdog);
            state.transcriptStallWatchdog = null;
        }
    }

    async function disposeAudioPipeline({ keepTranscriptWatchdog = false } = {}) {
        intentionalAudioStop = true;
        try {
            if (audioRecoveryTimer) {
                clearTimeout(audioRecoveryTimer);
                audioRecoveryTimer = null;
            }
            if (!keepTranscriptWatchdog) stopTranscriptStallWatchdog();
            if (state.watchdogInterval) {
                clearInterval(state.watchdogInterval);
                state.watchdogInterval = null;
            }
            if (state.processor) {
                state.processor.onaudioprocess = null;
                try { state.processor.disconnect(); } catch (_) { /* already disconnected */ }
                state.processor = null;
            }
            state.audioSource = null;
            state.micAnalyser = null;
            stopMicMonitor();
            const stream = state.stream;
            state.stream = null;
            if (stream) stream.getTracks().forEach((track) => track.stop());
            const context = state.audioContext;
            state.audioContext = null;
            if (context && context.state !== 'closed') {
                try { await context.close(); } catch (_) { /* already closed */ }
            }
        } finally {
            intentionalAudioStop = false;
        }
    }

    function stopRecording() {
        return disposeAudioPipeline();
    }

    async function recoverAudioPipeline({ reason = 'health-check', force = false } = {}) {
        if (!isMeetingActive() || intentionalAudioStop) return false;
        if (!force && !state.stream && !state.audioContext && !state.processor) return false;
        if (audioRecoveryPromise) return audioRecoveryPromise;

        audioRecoveryPromise = (async () => {
            const track = getLiveAudioTrack();
            if (!force && track && state.audioContext && state.audioContext.state !== 'closed') {
                if (state.audioContext.state === 'suspended' || state.audioContext.state === 'interrupted') {
                    try { await state.audioContext.resume(); } catch (_) { /* rebuild below */ }
                }
                if (state.audioContext.state === 'running' && state.processor) return true;
            }

            window.AppMain?.AppDebug?.log('info', 'Recovering audio pipeline', reason);
            await disposeAudioPipeline({ keepTranscriptWatchdog: true });
            const prepared = await prepareAudio({ forceNewStream: true });
            if (!prepared) return false;
            const started = await startRecording();
            if (started) {
                updateMicStatus('マイク入力と文字起こしを再接続しました。');
                syncMuteUi();
            }
            return !!started;
        })();

        try {
            return await audioRecoveryPromise;
        } finally {
            audioRecoveryPromise = null;
        }
    }

    function toggleMute() {
        state.isMuted = !state.isMuted;
        if (state.stream) {
            state.stream.getAudioTracks().forEach((track) => {
                track.enabled = !state.isMuted;
            });
        }
        syncMuteUi();
        window.AppMeetingUi?.addSystemMessage?.(state.isMuted ? 'この端末の文字起こしを停止しました。' : 'この端末の文字起こしを再開しました。');
    }

    async function reconnectMic() {
        try {
            const ok = await recoverAudioPipeline({ reason: 'manual-reconnect', force: true });
            if (!ok) return;
            updateMicStatus('マイクを再接続しました。メーターとログで入力を確認してください。');
            syncMuteUi();
        } catch (error) {
            window.AppToast.error('マイクの再接続に失敗しました', { detail: error.message });
        }
    }

    async function syncMicrophonePermissionState() {
        if (!navigator.permissions?.query) return;
        try {
            const status = await navigator.permissions.query({ name: 'microphone' });
            const apply = () => {
                if (status.state === 'granted') {
                    updateMicStatus('マイク許可は有効です。心配なときは確認ボタンで入力レベルを確認してください。');
                } else if (status.state === 'denied') {
                    updateMicStatus('マイク許可が拒否されています。ブラウザ設定から許可に変更してください。');
                }
            };
            apply();
            status.onchange = apply;
        } catch (error) {
            window.AppMain?.AppDebug?.log('info', 'Microphone permission query not available', error.message);
        }
    }

    window.AppAudio = {
        getMicPresetConfig,
        updateMicStatus,
        renderMicPresetUi,
        sendMicPresetMetadataToServer,
        updateMuteButton,
        syncMuteUi,
        applyMicPreset,
        setMicEnvironment,
        applyVoiceGatePreset,
        getBrowserAudioConstraints,
        bindStreamState,
        stopMicMonitor,
        startMicMonitor,
        ensureAudioNodes,
        requestWakeLock,
        releaseWakeLock,
        getLiveAudioTrack,
        isAudioPipelineHealthy,
        sendAudioChunk,
        recoverAudioPipeline,
        prepareAudio,
        runMicCheck,
        startRecording,
        stopRecording,
        toggleMute,
        reconnectMic,
        syncMicrophonePermissionState,
        startTranscriptStallWatchdog,
        stopTranscriptStallWatchdog
    };
})();
