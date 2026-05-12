(function initAudioModule() {
    const { state } = window.AppState;
    const dom = window.AppDom;
    const {
        isSecureContextForMedia,
        clampThresholdPair,
        getPreferredAudioConstraints,
        resampleToTargetRate
    } = window.AppUtils;
    const {
        presets: MIC_PRESETS = {},
        defaultDesktop: DEFAULT_DESKTOP_PRESET = 'pin_mic'
    } = window.AppMicPresets || {};

    function getMicPresetConfig(key = state.micPresetKey) {
        return MIC_PRESETS[key] || MIC_PRESETS[DEFAULT_DESKTOP_PRESET] || null;
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
                ? `${preset.label}向けの設定を使います。${preset.description}`
                : 'マイクの利用シーンを選んでください。';
        }
        if (dom.meetingMicPresetSummary) {
            dom.meetingMicPresetSummary.innerText = preset
                ? `現在のプリセット: ${preset.label}`
                : '現在のプリセット: 未設定';
        }
        if (dom.micPresetTips) {
            dom.micPresetTips.innerHTML = '';
            (preset?.bestPractices || []).forEach((tip) => {
                const li = document.createElement('li');
                li.innerText = tip;
                dom.micPresetTips.appendChild(li);
            });
        }
        document.querySelectorAll('[data-mic-preset]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.micPreset === state.micPresetKey);
        });
    }

    function sendMicPresetMetadataToServer(preset) {
        const target = preset || getMicPresetConfig();
        if (!target || !target.stt) return;
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        try {
            const sttProvider = (() => {
                try { return localStorage.getItem('stt_provider') || 'google'; } catch (_) { return 'google'; }
            })();
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
        const indicator = document.querySelector('.recording-indicator');
        if (unifiedBtn) {
            const hasStream = !!state.stream;
            unifiedBtn.classList.remove('mic-state-off', 'mic-state-on', 'mic-state-muted');
            if (!hasStream) {
                unifiedBtn.textContent = '🎙 マイク ON';
                unifiedBtn.classList.add('mic-state-off');
                unifiedBtn.title = 'タップでマイクを接続';
            } else if (state.isMuted) {
                unifiedBtn.textContent = '🔇 ミュート中 (タップで解除)';
                unifiedBtn.classList.add('mic-state-muted');
                unifiedBtn.title = 'タップでミュートを解除';
            } else {
                unifiedBtn.textContent = '🔴 録音中 (タップでミュート)';
                unifiedBtn.classList.add('mic-state-on');
                unifiedBtn.title = 'タップでミュート';
            }
        }
        if (indicator) {
            indicator.classList.toggle('paused', state.isMuted);
        }
        if (dom.selfInfo) {
            dom.selfInfo.innerText = `参加者: ${state.displayName || '---'}${state.isMuted ? ' / ミュート中' : ''}`;
        }
    }

    function setMicSensitivity(level) {
        const normalized = ['high', 'standard', 'strict'].includes(level) ? level : 'standard';
        state.micSensitivity = normalized;
        state.voiceGate.threshold = normalized === 'high'
            ? 0.008
            : normalized === 'strict'
                ? 0.018
                : 0.012;
        state.voiceGate.maxThreshold = normalized === 'high'
            ? 0.88
            : normalized === 'strict'
                ? 0.68
                : 0.78;
        localStorage.setItem('mic_sensitivity', normalized);
        if (dom.setupMicSensitivity) dom.setupMicSensitivity.value = normalized;
        if (dom.meetingMicSensitivity) dom.meetingMicSensitivity.value = normalized;
        updateMicThresholdControls();
    }

    async function applyMicPreset(key, options = {}) {
        const preset = getMicPresetConfig(key);
        if (!preset) return;

        state.micPresetKey = preset.key;
        state.voiceGate.threshold = preset.thresholds.min;
        state.voiceGate.maxThreshold = preset.thresholds.max;
        localStorage.setItem('mic_preset', preset.key);
        localStorage.setItem('mic_threshold_min', String(state.voiceGate.threshold));
        localStorage.setItem('mic_threshold_max', String(state.voiceGate.maxThreshold));
        if (window.AppProfile?.saveSettings) {
            try { window.AppProfile.saveSettings({ defaultMicPreset: preset.key }); } catch (_) { /* ignore */ }
        }
        updateMicThresholdControls();
        renderMicPresetUi();

        if (state.stream) {
            const [track] = state.stream.getAudioTracks();
            if (track?.applyConstraints) {
                try {
                    await track.applyConstraints(getPreferredAudioConstraints(preset).audio);
                } catch (error) {
                    window.AppMain?.AppDebug?.log('warn', 'Mic preset applyConstraints failed', error.message);
                }
            }
        }

        sendMicPresetMetadataToServer(preset);

        if (!options.silent) {
            updateMicStatus(`${preset.label}モードを適用しました。${preset.recommendedFor} に向いています。`);
        }
    }

    function updateMicThresholdControls() {
        const minPercent = Math.round(state.voiceGate.threshold * 1000);
        const maxPercent = Math.round(state.voiceGate.maxThreshold * 100);

        if (dom.setupMicMinThreshold) dom.setupMicMinThreshold.value = String(minPercent);
        if (dom.setupMicMaxThreshold) dom.setupMicMaxThreshold.value = String(maxPercent);
        if (dom.meetingMicMinThreshold) dom.meetingMicMinThreshold.value = String(minPercent);
        if (dom.meetingMicMaxThreshold) dom.meetingMicMaxThreshold.value = String(maxPercent);

        if (dom.setupMicMinThresholdValue) dom.setupMicMinThresholdValue.innerText = String(minPercent);
        if (dom.setupMicMaxThresholdValue) dom.setupMicMaxThresholdValue.innerText = String(maxPercent);
        if (dom.meetingMicMinThresholdValue) dom.meetingMicMinThresholdValue.innerText = String(minPercent);
        if (dom.meetingMicMaxThresholdValue) dom.meetingMicMaxThresholdValue.innerText = String(maxPercent);

        if (dom.micMeterShell) {
            dom.micMeterShell.style.setProperty('--mic-min-line', `${Math.min(96, Math.max(2, minPercent / 10))}%`);
            dom.micMeterShell.style.setProperty('--mic-max-line', `${Math.min(98, Math.max(8, maxPercent))}%`);
        }
    }

    function syncMicThresholdsFromUi(source) {
        const minControl = source === 'meeting' ? dom.meetingMicMinThreshold : dom.setupMicMinThreshold;
        const maxControl = source === 'meeting' ? dom.meetingMicMaxThreshold : dom.setupMicMaxThreshold;
        if (!minControl || !maxControl) return;

        const nextMin = Number(minControl.value) / 1000;
        const nextMax = Number(maxControl.value) / 100;
        const normalized = clampThresholdPair(nextMin, nextMax);
        state.voiceGate.threshold = normalized.min;
        state.voiceGate.maxThreshold = normalized.max;
        localStorage.setItem('mic_threshold_min', String(state.voiceGate.threshold));
        localStorage.setItem('mic_threshold_max', String(state.voiceGate.maxThreshold));
        updateMicThresholdControls();
    }

    function bindStreamState(stream) {
        const [track] = stream.getAudioTracks();
        if (!track) return;

        track.onended = () => {
            updateMicStatus('マイク入力が停止しました。端末設定やブラウザ権限を確認してください。');
            window.AppMain?.AppDebug?.log('warn', 'Microphone track ended');
        };
        track.onmute = () => {
            if (!state.isMuted) updateMicStatus('マイク入力が一時的にミュートされました。');
        };
        track.onunmute = () => {
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
            const width = Math.max(4, Math.min(100, Math.round(rms * 320)));
            dom.micLevelBar.style.width = `${width}%`;
            dom.micLevelBar.classList.toggle('clipped', rms >= state.voiceGate.maxThreshold);
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
            if (!state.stream) {
                state.stream = await navigator.mediaDevices.getUserMedia(getPreferredAudioConstraints(preset));
                bindStreamState(state.stream);
            } else {
                const [track] = state.stream.getAudioTracks();
                if (track?.applyConstraints) {
                    try {
                        await track.applyConstraints(getPreferredAudioConstraints(preset).audio);
                    } catch (constraintError) {
                        window.AppMain?.AppDebug?.log('warn', 'Failed to refresh audio constraints', constraintError.message);
                    }
                }
            }
            state.stream.getAudioTracks().forEach((track) => {
                track.enabled = !state.isMuted;
            });
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                state.audioContext.onstatechange = () => {
                    const currentState = state.audioContext ? state.audioContext.state : 'closed';
                    if (currentState === 'interrupted') {
                        updateMicStatus('音声入力が端末側で中断されました。復帰後にマイクONで再接続してください。');
                    }
                };
            }
            if (state.audioContext.state === 'suspended') await state.audioContext.resume();
            ensureAudioNodes();
            if (options.updateStatus) {
                const actualRate = Math.round(state.audioContext?.sampleRate || 0);
                const resampleNote = actualRate && actualRate !== 16000 ? ` 実入力 ${actualRate}Hz を 16000Hz に変換して送ります。` : '';
                const presetLabel = preset?.label ? `現在は ${preset.label} モードです。` : '';
                updateMicStatus(`マイクの許可が取れました。${presetLabel} メーターが動いて、緑の帯が最小線を越えれば入力できています。${resampleNote}`);
            }
            return true;
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'prepareAudio failed', error.message);
            if (options.updateStatus) updateMicStatus(`マイク確認に失敗しました: ${error.message}`);
            window.AppToast.error('マイクの許可に失敗しました', { detail: error.message });
            return false;
        }
    }

    async function runMicCheck() {
        const ok = await prepareAudio({ updateStatus: true });
        if (!ok) return;
        updateMicStatus('マイク入力を確認中です。緑の帯が最小線を越え、赤い線を少し超える程度なら適正です。');
    }

    async function startRecording({ onAudioChunk } = {}) {
        if (state.audioContext && state.audioContext.state === 'running' && state.stream && state.processor) return;
        try {
            if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!state.audioContext) {
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            }
            if (state.audioContext.state === 'suspended') await state.audioContext.resume();
            ensureAudioNodes();
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'startRecording failed', error.message);
            window.AppMeetingUi?.addSystemMessage?.(`マイク接続エラー: ${error.name}`);
            return;
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
            const presetCfg = getMicPresetConfig() || {};
            const presetVad = presetCfg.vad || {};
            const ATTACK_FRAMES = Number.isFinite(presetVad.attackFrames) ? presetVad.attackFrames : 1;
            const MIN_ACTIVE_FRAMES = Number.isFinite(presetVad.minActiveFrames) ? presetVad.minActiveFrames : 1;
            const CREST_MIN = Number.isFinite(presetVad.crestMin) ? presetVad.crestMin : 1.0;
            const CREST_MAX = Number.isFinite(presetVad.crestMax) ? presetVad.crestMax : 30;
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
                const crest = rms > 0.0001 ? peak / rms : 0;
                const isSpeechLike = rms >= gate.threshold && crest >= CREST_MIN && crest <= CREST_MAX;

                if (isSpeechLike) {
                    gate.attackCounter = Math.min(gate.attackCounter + 1, ATTACK_FRAMES + 1);
                } else {
                    gate.attackCounter = 0;
                }

                const gateOpen = gate.attackCounter >= ATTACK_FRAMES;
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

                if (MIN_ACTIVE_FRAMES > 1 && gate.activeFrames < MIN_ACTIVE_FRAMES) return;

                const sourceRate = state.audioContext.sampleRate || 16000;
                const mono16k = resampleToTargetRate(clippedInput, sourceRate, 16000);
                const pcm = new Int16Array(mono16k.length);
                for (let i = 0; i < mono16k.length; i += 1) {
                    pcm[i] = Math.max(-1, Math.min(1, mono16k[i])) * 0x7fff;
                }
                if (typeof onAudioChunk === 'function') {
                    onAudioChunk(pcm.buffer);
                } else if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    state.ws.send(pcm.buffer);
                }
            };
            state.processor = processor;
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'audio processor failed', error.message);
        }
    }

    function stopRecording() {
        if (state.watchdogInterval) {
            clearInterval(state.watchdogInterval);
            state.watchdogInterval = null;
        }
        if (state.processor) {
            state.processor.onaudioprocess = null;
            state.processor.disconnect();
            state.processor = null;
        }
        if (state.audioContext) {
            state.audioContext.close();
            state.audioContext = null;
        }
        state.audioSource = null;
        state.micAnalyser = null;
        stopMicMonitor();
        if (state.stream) {
            state.stream.getTracks().forEach((track) => track.stop());
            state.stream = null;
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
            stopRecording();
            const ok = await prepareAudio({ updateStatus: true });
            if (!ok) return;
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                await startRecording({ onAudioChunk: (pcm) => state.ws.send(pcm) });
            }
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
        setMicSensitivity,
        applyMicPreset,
        updateMicThresholdControls,
        syncMicThresholdsFromUi,
        bindStreamState,
        stopMicMonitor,
        startMicMonitor,
        ensureAudioNodes,
        requestWakeLock,
        releaseWakeLock,
        prepareAudio,
        runMicCheck,
        startRecording,
        stopRecording,
        toggleMute,
        reconnectMic,
        syncMicrophonePermissionState
    };
})();
