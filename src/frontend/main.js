const { state } = window.AppState;
const {
    setupScreen,
    meetingScreen,
    summaryScreen,
    timeline,
    summaryLog,
    roomInfo,
    summaryInfo,
    selfInfo,
    aiWorkspaceStatus,
    minutesWorkspaceStatus,
    aiOutputTitle,
    customAiInstruction,
    aiOutputEditor,
    minutesOutputEditor,
    meetingAiStatus,
    micCheckStatus,
    micLevelBar,
    micPresetSummary,
    micPresetTips,
    micRequirements,
    setupMicSensitivity,
    meetingMicSensitivity,
    setupMicMinThreshold,
    setupMicMaxThreshold,
    setupMicMinThresholdValue,
    setupMicMaxThresholdValue,
    meetingMicMinThreshold,
    meetingMicMaxThreshold,
    meetingMicMinThresholdValue,
    meetingMicMaxThresholdValue,
    meetingMicPresetSummary,
    micMeterShell,
    mobileMeetingMenu,
    summaryMobileMenu,
    editModalOverlay,
    editModalSpeaker,
    editModalTime,
    editModalOriginal,
    editModalTextarea,
    memoModalOverlay,
    memoModalSpeaker,
    memoModalTime,
    memoModalOriginal,
    memoModalTextarea,
    meetingAiEditors,
    meetingAiButtons,
    filterInputs,
    filterButtons
} = window.AppDom;
const { bindAppEvents } = window.AppBindings;
const {
    generateLocalUserId,
    getJoinUrl,
    isSecureContextForMedia,
    isMobileViewport,
    clampThresholdPair,
    getPreferredAudioConstraints,
    resampleToTargetRate,
    formatTime,
    escapeHtml,
    highlightText,
    shortenText,
    downloadTextFile
} = window.AppUtils;
const {
    presets: MIC_PRESETS = {},
    requirements: MIC_REQUIREMENTS = [],
    defaultMobile: DEFAULT_MOBILE_PRESET = 'smartphone',
    defaultDesktop: DEFAULT_DESKTOP_PRESET = 'pin_mic'
} = window.AppMicPresets || {};

const AppDebug = {
    log(level, message, details) {
        if (window.DebugMonitor?.log) {
            window.DebugMonitor.log(level, message, details);
            return;
        }
        const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logger(message, details ?? '');
    }
};

function updateMicStatus(message) {
    if (micCheckStatus) {
        micCheckStatus.innerText = message;
    }
    if (window.DebugMonitor?.updateMicStatus) {
        window.DebugMonitor.updateMicStatus(message);
    }
}

function getMicPresetConfig(key = state.micPresetKey) {
    return MIC_PRESETS[key] || MIC_PRESETS[DEFAULT_DESKTOP_PRESET] || null;
}

function renderMicPresetUi() {
    const preset = getMicPresetConfig();
    if (micPresetSummary) {
        micPresetSummary.innerText = preset
            ? `${preset.label}向けの設定を使います。${preset.description}`
            : 'マイクの利用シーンを選んでください。';
    }
    if (meetingMicPresetSummary) {
        meetingMicPresetSummary.innerText = preset
            ? `現在のプリセット: ${preset.label}`
            : '現在のプリセット: 未設定';
    }
    if (micPresetTips) {
        micPresetTips.innerHTML = '';
        (preset?.bestPractices || []).forEach((tip) => {
            const li = document.createElement('li');
            li.innerText = tip;
            micPresetTips.appendChild(li);
        });
    }
    if (micRequirements) {
        micRequirements.innerHTML = '';
        MIC_REQUIREMENTS.forEach((item) => {
            const li = document.createElement('li');
            li.innerText = item;
            micRequirements.appendChild(li);
        });
    }
    document.querySelectorAll('[data-mic-preset]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.micPreset === state.micPresetKey);
    });
}

async function loadDictionary() {
    try {
        const res = await fetch('/api/dictionary');
        const data = await readApiResponse(res);
        state.dictionary = Array.isArray(data) ? data : [];
        renderDictionary();
    } catch (error) {
        AppDebug.log('error', 'Failed to load dictionary', error.message);
    }
}

function renderDictionary() {
    const container = window.AppDom.dictionaryList;
    if (!container) return;
    container.innerHTML = '';
    if (state.dictionary.length === 0) {
        container.innerHTML = '<span class="placeholder-text">登録された用語はありません。</span>';
        return;
    }
    state.dictionary.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'dict-item';
        div.innerHTML = `
            <strong>${escapeHtml(item.term)}</strong>
            ${item.reading ? `<span class="muted">(${escapeHtml(item.reading)})</span>` : ''}
            <button class="btn-dict-del" data-id="${item.id}" title="削除">×</button>
        `;
        div.querySelector('.btn-dict-del').onclick = () => deleteDictionaryTerm(item.id);
        container.appendChild(div);
    });
}

async function addDictionaryTerm() {
    const termInput = window.AppDom.dictTerm;
    const readingInput = window.AppDom.dictReading;
    const term = termInput.value.trim();
    const reading = readingInput.value.trim();
    if (!term) return alert('用語を入力してください');

    try {
        const res = await fetch('/api/dictionary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term, reading })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '追加に失敗しました');
        termInput.value = '';
        readingInput.value = '';
        await loadDictionary();
    } catch (error) {
        alert(`追加に失敗しました: ${error.message}`);
    }
}

async function deleteDictionaryTerm(id) {
    if (!confirm('この用語を削除しますか？')) return;
    try {
        const res = await fetch(`/api/dictionary/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('削除に失敗しました');
        await loadDictionary();
    } catch (error) {
        alert(`削除に失敗しました: ${error.message}`);
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`panel-${tab}`).classList.add('active');
    renderSummaryMobileControls();
}

function ensureLocalUserId() {
    const existing = localStorage.getItem('user_id');
    if (existing) {
        state.userId = existing;
        return existing;
    }

    const nextId = generateLocalUserId();
    localStorage.setItem('user_id', nextId);
    state.userId = nextId;
    return nextId;
}

function toggleFilter(key) {
    state.filters[key] = !state.filters[key];
    syncFilterControls();
    renderAllLogs();
}

function clearSearch() {
    state.filters.query = '';
    syncFilterControls();
    renderAllLogs();
}

function syncFilterControls() {
    filterInputs.forEach((input) => {
        input.value = state.filters.query;
    });
    filterButtons.starred.forEach((button) => button.classList.toggle('active', state.filters.starredOnly));
    filterButtons.mine.forEach((button) => button.classList.toggle('active', state.filters.mineOnly));
    filterButtons.noted.forEach((button) => button.classList.toggle('active', state.filters.notedOnly));
}

function updateLogWorkState() {
    state.isWorkingOnLog = !!state.activeModalUtteranceId || !!state.activeMemoUtteranceId;
}

function addMemo() {
    const memo = prompt('\u5168\u4f53\u30e1\u30e2\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044:');
    if (memo) addSystemMessage(`\u5168\u4f53\u30e1\u30e2: ${memo}`);
}


function toggleMobileMeetingMenu() {
    state.mobileMenuOpen = !state.mobileMenuOpen;
    renderMobileMeetingControls();
}

function toggleMobileMemoryPanel() {
    state.mobileMemoryCollapsed = !state.mobileMemoryCollapsed;
    renderMobileMeetingControls();
}

function toggleMobileAiPanel() {
    state.mobileAiCollapsed = !state.mobileAiCollapsed;
    renderMobileMeetingControls();
}

function updateMuteButton() {
    syncMuteUi();
}

function syncMuteUi() {
    const button = document.getElementById('btn-toggle-mute');
    const indicator = document.querySelector('.recording-indicator');
    if (button) {
        button.innerText = state.isMuted ? '\u30df\u30e5\u30fc\u30c8\u89e3\u9664' : '\u30df\u30e5\u30fc\u30c8';
        button.classList.toggle('active', state.isMuted);
    }
    if (indicator) {
        indicator.classList.toggle('paused', state.isMuted);
    }
    selfInfo.innerText = `\u53c2\u52a0\u8005: ${state.displayName || '---'}${state.isMuted ? ' / \u30df\u30e5\u30fc\u30c8\u4e2d' : ''}`;
}

function renderMobileMeetingControls() {
    const mobile = isMobileViewport();
    const menuButton = document.getElementById('btn-mobile-menu');
    const memoryButton = document.getElementById('btn-toggle-memory-panel');
    const aiButton = document.getElementById('btn-toggle-ai-panel');

    if (!mobile) {
        state.mobileMenuOpen = false;
        state.mobileMemoryCollapsed = false;
        state.mobileAiCollapsed = false;
    }

    document.body.classList.toggle('mobile-memory-collapsed', mobile && state.mobileMemoryCollapsed);
    document.body.classList.toggle('mobile-ai-collapsed', mobile && state.mobileAiCollapsed);

    if (mobileMeetingMenu) {
        mobileMeetingMenu.classList.toggle('active', mobile && state.mobileMenuOpen);
        mobileMeetingMenu.classList.toggle('hidden', !(mobile && state.mobileMenuOpen));
        mobileMeetingMenu.setAttribute('aria-hidden', mobile && state.mobileMenuOpen ? 'false' : 'true');
    }
    if (menuButton) {
        menuButton.setAttribute('aria-expanded', mobile && state.mobileMenuOpen ? 'true' : 'false');
        menuButton.innerText = mobile && state.mobileMenuOpen ? '\u2715' : '\u2630';
    }
    if (memoryButton) {
        memoryButton.innerText = state.mobileMemoryCollapsed
            ? '\u4f1a\u8a71\u30e1\u30e2\u30ea\u3092\u8868\u793a'
            : '\u4f1a\u8a71\u30e1\u30e2\u30ea\u3092\u6298\u308a\u305f\u305f\u3080';
    }
    if (aiButton) {
        aiButton.innerText = state.mobileAiCollapsed
            ? '\u4f1a\u8b70\u4e2dAI\u3092\u8868\u793a'
            : '\u4f1a\u8b70\u4e2dAI\u3092\u6298\u308a\u305f\u305f\u3080';
    }
}

function renderSummaryMobileControls() {
    const mobile = isMobileViewport();
    const menuButton = document.getElementById('btn-summary-mobile-menu');
    const statsButton = document.getElementById('btn-toggle-summary-stats');
    const sidebarButton = document.getElementById('btn-toggle-summary-sidebar');
    const aiControlsButton = document.getElementById('btn-toggle-summary-ai-controls');

    if (!mobile) {
        state.summaryMobileMenuOpen = false;
        state.summaryStatsCollapsed = false;
        state.summarySidebarCollapsed = false;
        state.summaryAiControlsCollapsed = false;
    }

    document.body.classList.toggle('summary-stats-collapsed', mobile && state.summaryStatsCollapsed);
    document.body.classList.toggle('summary-sidebar-collapsed', mobile && state.summarySidebarCollapsed);
    document.body.classList.toggle('summary-ai-controls-collapsed', mobile && state.summaryAiControlsCollapsed);

    if (summaryMobileMenu) {
        summaryMobileMenu.classList.toggle('active', mobile && state.summaryMobileMenuOpen);
        summaryMobileMenu.classList.toggle('hidden', !(mobile && state.summaryMobileMenuOpen));
        summaryMobileMenu.setAttribute('aria-hidden', mobile && state.summaryMobileMenuOpen ? 'false' : 'true');
    }
    if (menuButton) {
        menuButton.setAttribute('aria-expanded', mobile && state.summaryMobileMenuOpen ? 'true' : 'false');
        menuButton.innerText = mobile && state.summaryMobileMenuOpen ? '\u2715' : '\u2630';
    }
    if (statsButton) {
        statsButton.innerText = state.summaryStatsCollapsed
            ? '\u96c6\u8a08\u3092\u8868\u793a'
            : '\u96c6\u8a08\u3092\u6298\u308a\u305f\u305f\u3080';
    }
    if (sidebarButton) {
        sidebarButton.innerText = state.summarySidebarCollapsed
            ? '\u7d5e\u308a\u8fbc\u307f\u3068\u91cd\u8981\u30ed\u30b0\u3092\u8868\u793a'
            : '\u7d5e\u308a\u8fbc\u307f\u3068\u91cd\u8981\u30ed\u30b0\u3092\u6298\u308a\u305f\u305f\u3080';
    }
    if (aiControlsButton) {
        aiControlsButton.innerText = state.summaryAiControlsCollapsed
            ? 'AI\u64cd\u4f5c\u3092\u8868\u793a'
            : 'AI\u64cd\u4f5c\u3092\u6298\u308a\u305f\u305f\u3080';
    }
}

function toggleSummaryMobileMenu() {
    state.summaryMobileMenuOpen = !state.summaryMobileMenuOpen;
    renderSummaryMobileControls();
}

function toggleSummaryStats() {
    state.summaryStatsCollapsed = !state.summaryStatsCollapsed;
    renderSummaryMobileControls();
}

function toggleSummarySidebar() {
    state.summarySidebarCollapsed = !state.summarySidebarCollapsed;
    renderSummaryMobileControls();
}

function toggleSummaryAiControls() {
    state.summaryAiControlsCollapsed = !state.summaryAiControlsCollapsed;
    renderSummaryMobileControls();
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
    if (setupMicSensitivity) setupMicSensitivity.value = normalized;
    if (meetingMicSensitivity) meetingMicSensitivity.value = normalized;
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
    updateMicThresholdControls();
    renderMicPresetUi();

    if (state.stream) {
        const [track] = state.stream.getAudioTracks();
        if (track?.applyConstraints) {
            try {
                await track.applyConstraints(getPreferredAudioConstraints(preset).audio);
            } catch (error) {
                AppDebug.log('warn', 'Mic preset applyConstraints failed', error.message);
            }
        }
    }

    if (!options.silent) {
        updateMicStatus(`${preset.label}モードを適用しました。${preset.recommendedFor} に向いています。`);
    }
}

function updateMicThresholdControls() {
    const minPercent = Math.round(state.voiceGate.threshold * 1000);
    const maxPercent = Math.round(state.voiceGate.maxThreshold * 100);

    if (setupMicMinThreshold) setupMicMinThreshold.value = String(minPercent);
    if (setupMicMaxThreshold) setupMicMaxThreshold.value = String(maxPercent);
    if (meetingMicMinThreshold) meetingMicMinThreshold.value = String(minPercent);
    if (meetingMicMaxThreshold) meetingMicMaxThreshold.value = String(maxPercent);

    if (setupMicMinThresholdValue) setupMicMinThresholdValue.innerText = String(minPercent);
    if (setupMicMaxThresholdValue) setupMicMaxThresholdValue.innerText = String(maxPercent);
    if (meetingMicMinThresholdValue) meetingMicMinThresholdValue.innerText = String(minPercent);
    if (meetingMicMaxThresholdValue) meetingMicMaxThresholdValue.innerText = String(maxPercent);

    if (micMeterShell) {
        micMeterShell.style.setProperty('--mic-min-line', `${Math.min(96, Math.max(2, minPercent / 10))}%`);
        micMeterShell.style.setProperty('--mic-max-line', `${Math.min(98, Math.max(8, maxPercent))}%`);
    }
}

function syncMicThresholdsFromUi(source) {
    const minControl = source === 'meeting' ? meetingMicMinThreshold : setupMicMinThreshold;
    const maxControl = source === 'meeting' ? meetingMicMaxThreshold : setupMicMaxThreshold;
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
        AppDebug.log('warn', 'Microphone track ended');
    };
    track.onmute = () => {
        if (!state.isMuted) {
            updateMicStatus('マイク入力が一時的にミュートされました。');
        }
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
    if (micLevelBar) {
        micLevelBar.style.width = '4%';
        micLevelBar.classList.remove('clipped');
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
        micLevelBar.style.width = `${width}%`;
        micLevelBar.classList.toggle('clipped', rms >= state.voiceGate.maxThreshold);
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
    if (!meetingScreen.classList.contains('active') || document.hidden) return;
    if (state.wakeLockSentinel) return;

    try {
        state.wakeLockSentinel = await navigator.wakeLock.request('screen');
        state.wakeLockSentinel.addEventListener('release', () => {
            state.wakeLockSentinel = null;
        });
    } catch (error) {
        AppDebug.log('warn', 'Wake lock unavailable', error.message);
    }
}

async function releaseWakeLock() {
    if (!state.wakeLockSentinel) return;
    try {
        await state.wakeLockSentinel.release();
    } catch (error) {
        AppDebug.log('warn', 'Wake lock release failed', error.message);
    } finally {
        state.wakeLockSentinel = null;
    }
}


async function runMicCheck() {
    const ok = await prepareAudio({ updateStatus: true });
    if (!ok) return;
    updateMicStatus('マイク入力を確認中です。緑の帯が最小線を越え、赤い線を少し超える程度なら適正です。');
}

async function reconnectMic() {
    try {
        stopRecording();
        const ok = await prepareAudio({ updateStatus: true });
        if (!ok) return;
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            await startRecording();
        }
        updateMicStatus('\u30de\u30a4\u30af\u3092\u518d\u63a5\u7d9a\u3057\u307e\u3057\u305f\u3002\u30e1\u30fc\u30bf\u30fc\u3068\u30ed\u30b0\u3067\u5165\u529b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
    } catch (error) {
        alert(`\u30de\u30a4\u30af\u306e\u518d\u63a5\u7d9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
    }
}

async function syncMicrophonePermissionState() {
    if (!navigator.permissions?.query) return;
    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        const apply = () => {
            if (status.state === 'granted') {
                updateMicStatus('\u30de\u30a4\u30af\u8a31\u53ef\u306f\u6709\u52b9\u3067\u3059\u3002\u5fc3\u914d\u306a\u3068\u304d\u306f\u78ba\u8a8d\u30bf\u30f3\u3067\u5165\u529b\u30ec\u30d9\u30eb\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
            } else if (status.state === 'denied') {
                updateMicStatus('\u30de\u30a4\u30af\u8a31\u53ef\u304c\u62d2\u5426\u3055\u308c\u3066\u3044\u307e\u3059\u3002\u30d6\u30e9\u30a6\u30b6\u8a2d\u5b9a\u304b\u3089\u8a31\u53ef\u306b\u5909\u66f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
            }
        };
        apply();
        status.onchange = apply;
    } catch (error) {
        AppDebug.log('info', 'Microphone permission query not available', error.message);
    }
}

function addSystemMessage(text) {
    state.activityItems.push({
        type: 'system',
        id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
        timestamp: new Date().toISOString()
    });
    renderAllLogs();
}

function normalizeUtterance(raw) {
    return {
        id: raw.id,
        participant_id: raw.participant_id,
        display_name: raw.display_name || 'Unknown',
        transcript: raw.transcript || '',
        raw_transcript: raw.raw_transcript || raw.transcript || '',
        timestamp: raw.timestamp || raw.started_at,
        is_starred: !!raw.is_starred,
        memo_text: raw.memo_text || raw.memory_note || '',
        memory_note: raw.memo_text || raw.memory_note || '',
        starred_at: raw.starred_at || null,
        transcript_source: raw.transcript_source || 'stt',
        corrected_at: raw.corrected_at || null
    };
}

function upsertUtterance(raw) {
    const utterance = normalizeUtterance(raw);
    const existing = state.activityItems.find((item) => item.type === 'utterance' && item.data.id === utterance.id);

    if (existing) {
        existing.data = { ...existing.data, ...utterance };
        existing.timestamp = utterance.timestamp;
    } else {
        state.activityItems.push({
            type: 'utterance',
            id: utterance.id,
            timestamp: utterance.timestamp,
            data: utterance
        });
    }

    state.activityItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function getVisibleItems() {
    const query = state.filters.query.trim().toLowerCase();

    return state.activityItems.filter((item) => {
        if (item.type === 'system') {
            if (state.filters.starredOnly || state.filters.mineOnly || state.filters.notedOnly) return false;
            return !query || item.text.toLowerCase().includes(query);
        }

        const utterance = item.data;
        const haystack = [
            utterance.display_name,
            utterance.transcript,
            utterance.raw_transcript,
            utterance.memo_text
        ].join(' ').toLowerCase();

        if (query && !haystack.includes(query)) return false;
        if (state.filters.starredOnly && !utterance.is_starred) return false;
        if (state.filters.mineOnly && utterance.participant_id !== state.participantId) return false;
        if (state.filters.notedOnly && !utterance.memo_text.trim()) return false;
        return true;
    });
}

function getVisibleUtteranceCount() {
    return getVisibleItems().filter((item) => item.type === 'utterance').length;
}

function getAllUtterances() {
    return state.activityItems
        .filter((item) => item.type === 'utterance')
        .map((item) => item.data);
}

function renderAllLogs() {
    updateLogWorkState();
    renderConversationList(timeline, true);
    renderConversationList(summaryLog, false);
    renderStarredLogs(document.getElementById('starred-log-list'));
    renderStarredLogs(document.getElementById('summary-starred-log-list'));
    renderEditModal();
    renderMemoModal();
    renderMeetingInsights();
    renderAiWorkspace();
    renderMinutesWorkspace();
    renderMeetingAnalysis();

    const countText = `${getVisibleUtteranceCount()}\u4ef6`;
    const allUtterances = getAllUtterances();
    const starredCount = getStarredUtterances().length;
    const editedCount = allUtterances.filter((utterance) => utterance.transcript_source !== 'stt').length;

    document.getElementById('log-match-count').innerText = countText;
    document.getElementById('summary-match-count').innerText = countText;
    document.getElementById('starred-count').innerText = String(starredCount);
    document.getElementById('summary-total-count').innerText = String(allUtterances.length);
    document.getElementById('summary-starred-count').innerText = String(starredCount);
    document.getElementById('summary-edited-count').innerText = String(editedCount);
}

function renderMinutesWorkspace() {
    if (!minutesOutputEditor || !minutesWorkspaceStatus) return;
    minutesOutputEditor.value = state.minutesWorkspace.result || 'ここに議事録が表示されます。';

    if (state.minutesWorkspace.loading) {
        minutesWorkspaceStatus.innerText = '議事録を生成中です...';
        return;
    }

    if (state.minutesWorkspace.updatedAt) {
        minutesWorkspaceStatus.innerText = `最終更新: ${new Date(state.minutesWorkspace.updatedAt).toLocaleString('ja-JP')}`;
        return;
    }

    minutesWorkspaceStatus.innerText = '生ログを元に、自動調整した議事録をここで確認できます。';
}

function getUtteranceById(id) {
    const entry = state.activityItems.find((item) => item.type === 'utterance' && item.data.id === id);
    return entry ? entry.data : null;
}

function renderMeetingInsights() {
    const isHost = !!state.isHost;
    const summaryButton = document.getElementById('btn-run-summary');
    const actionButton = document.getElementById('btn-run-actions');
    const minutesButton = document.getElementById('btn-run-minutes');

    if (summaryButton) summaryButton.innerText = isHost ? '要約を生成' : '要約を表示';
    if (actionButton) actionButton.innerText = isHost ? 'TODOを生成' : 'TODOを表示';
    if (minutesButton) minutesButton.innerText = isHost ? '自動調整で議事録を生成' : '議事録を表示';

    if (state.meetingInsights.status === 'processing' || state.meetingInsights.loading) {
        aiWorkspaceStatus.innerText = '共有AI結果を生成中です...';
        return;
    }

    if (state.meetingInsights.status === 'error') {
        aiWorkspaceStatus.innerText = '共有AI結果の生成に失敗しました。';
        return;
    }

    if (state.meetingInsights.updatedAt) {
        aiWorkspaceStatus.innerText = `最終更新: ${new Date(state.meetingInsights.updatedAt).toLocaleString('ja-JP')}`;
        return;
    }

    aiWorkspaceStatus.innerText = isHost
        ? 'ホストが生成すると、共有結果がここに表示されます。'
        : 'ホストが生成した共有結果をここで確認できます。';
}

function scheduleInsightsPoll() {
    clearInsightsPoll();
    state.meetingInsights.pollTimer = setTimeout(() => {
        if (summaryScreen.classList.contains('active')) {
            loadMeetingInsights({ silent: true });
        }
    }, 5000);
}

function syncSharedResultsIntoEditors() {
    if (!state.minutesWorkspace.loading && state.meetingInsights.minutes) {
        state.minutesWorkspace.result = state.meetingInsights.minutes;
    }

    if (state.aiWorkspace.loading) return;

    const currentMode = state.aiWorkspace.mode || '';
    if ((!currentMode || currentMode === 'summary') && state.meetingInsights.summary) {
        setAiWorkspace('summary', '要約', state.meetingInsights.summary, '');
        return;
    }

    if ((!currentMode || currentMode === 'todo') && state.meetingInsights.todo) {
        setAiWorkspace('todo', 'TODO', state.meetingInsights.todo, '');
    }
}

async function loadMeetingInsights(options = {}) {
    if (!state.roomId) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/insights`);
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'AI結果の取得に失敗しました');

        state.meetingInsights.summary = data.summary || '';
        state.meetingInsights.minutes = data.minutes || '';
        state.meetingInsights.todo = data.todo || '';
        state.meetingInsights.speakerSummaries = Array.isArray(data.speaker_summaries) ? data.speaker_summaries : [];
        state.meetingInsights.actions = Array.isArray(data.actions) ? data.actions : [];
        state.meetingInsights.status = data.status || 'idle';
        state.meetingInsights.dirty = !!data.dirty;
        state.meetingInsights.updatedAt = data.minutes_updated_at || data.summary_updated_at || data.todo_updated_at || null;
        state.meetingInsights.loading = data.status === 'processing';
        state.minutesWorkspace.updatedAt = data.minutes_updated_at || state.minutesWorkspace.updatedAt;
        syncSharedResultsIntoEditors();

        scheduleInsightsPoll();
        renderMeetingInsights();
        renderMinutesWorkspace();
    } catch (error) {
        clearInsightsPoll();
        state.meetingInsights.status = 'error';
        state.meetingInsights.loading = false;
        renderMeetingInsights();
        if (!options.silent) {
            aiWorkspaceStatus.innerText = `AI結果の取得に失敗しました: ${error.message}`;
        }
    }
}

async function runDirectAnalysis(type, title, instruction = '') {
    if (!state.roomId) return;

    state.aiWorkspace.loading = true;
    state.aiWorkspace.mode = type;
    state.aiWorkspace.title = title;
    state.aiWorkspace.savedAt = null;
    renderMeetingInsights();
    renderAiWorkspace();

    try {
        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                instruction,
                ai_config: {
                    provider: state.aiProvider || 'groq',
                    model: state.aiModel || (state.aiProvider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
                }
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'AI解析に失敗しました');

        const resultText = String(data.result || '').trim();
        if (!resultText) {
            throw new Error('AIから空の結果が返りました');
        }

        setAiWorkspace(type, title, resultText, instruction);
        aiWorkspaceStatus.innerText = `${title}の解析結果を表示しています。`;
        aiOutputEditor.focus();
        aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
        aiWorkspaceStatus.innerText = `AI解析に失敗しました: ${error.message}`;
        alert(`AI解析に失敗しました: ${error.message}`);
    }
}

function renderMeetingAnalysis() {
    const loadingKey = state.liveMeetingAnalysis.loadingKey;
    const statusText = state.liveMeetingAnalysis.status || '現在のログを使って、必要な解析をここから実行できます。';
    meetingAiStatus.innerText = statusText;

    Object.entries(meetingAiEditors).forEach(([key, editor]) => {
        const fallbackMap = {
            summary: '要約はここに表示されます。',
            todo: 'TODOはここに表示されます。',
            agreements: '合意点と未解決課題はここに表示されます。',
            topics: 'トークテーマ一覧はここに表示されます。'
        };
        editor.value = state.liveMeetingAnalysis.outputs[key] || fallbackMap[key];
    });

    Object.entries(meetingAiButtons).forEach(([key, button]) => {
        const isLoading = loadingKey === key;
        button.disabled = !!loadingKey && !isLoading;
        button.innerText = isLoading ? '解析中...' : (
            key === 'summary'
                ? '要約'
                : key === 'todo'
                    ? 'ToDo'
                    : key === 'agreements'
                        ? '合意点と未解決課題'
                        : 'トークテーマ一覧'
        );
    });
}

async function runMeetingAnalysis(key) {
    if (!state.roomId) return;

    const configMap = {
        summary: {
            type: 'summary',
            title: '要約'
        },
        todo: {
            type: 'todo',
            title: 'ToDo'
        },
        agreements: {
            type: 'custom',
            title: '合意点と未解決課題',
            instruction: '現在の会議ログから、合意した内容と未解決の論点を分けて整理してください。結論と保留事項がすぐ分かるように簡潔にまとめてください。'
        },
        topics: {
            type: 'topic_tree',
            title: 'トークテーマ一覧',
            instruction: '現在の会議で話題に上がっているトピックを一覧化し、近いものはまとめてください。'
        }
    };
    const config = configMap[key];
    if (!config) return;

    state.liveMeetingAnalysis.loadingKey = key;
    state.liveMeetingAnalysis.status = `${config.title}を Gemini で解析しています...`;
    renderMeetingAnalysis();

    try {
        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: config.type,
                instruction: config.instruction || '',
                ai_config: {
                    provider: state.aiProvider || 'groq',
                    model: state.aiModel || (state.aiProvider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
                }
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || `${config.title}の解析に失敗しました`);

        const resultText = String(data.result || '').trim();
        if (!resultText) {
            throw new Error('AIから空の結果が返りました');
        }

        state.liveMeetingAnalysis.outputs[key] = resultText;
        state.liveMeetingAnalysis.status = `${config.title}を更新しました。`;
        renderMeetingAnalysis();
        meetingAiEditors[key].focus();
    } catch (error) {
        state.liveMeetingAnalysis.status = `${config.title}の解析に失敗しました: ${error.message}`;
        renderMeetingAnalysis();
        alert(`${config.title}の解析に失敗しました: ${error.message}`);
    } finally {
        state.liveMeetingAnalysis.loadingKey = '';
        renderMeetingAnalysis();
    }
}

async function runSharedResult(type, title) {
    if (!state.roomId) return;

    const existingMap = {
        summary: state.meetingInsights.summary || '',
        todo: state.meetingInsights.todo || '',
        minutes: state.meetingInsights.minutes || ''
    };

    if (!state.isHost) {
        const existing = String(existingMap[type] || '').trim();
        if (!existing) {
            aiWorkspaceStatus.innerText = 'まだホストが共有結果を生成していません。';
            alert('まだホストが共有結果を生成していません。');
            return;
        }
        setAiWorkspace(type, title, existing, '');
        aiWorkspaceStatus.innerText = `${title}を表示しています。`;
        return;
    }

    state.aiWorkspace.loading = true;
    state.aiWorkspace.mode = type;
    state.aiWorkspace.title = title;
    state.aiWorkspace.savedAt = null;
    renderMeetingInsights();
    renderAiWorkspace();

    try {
        const res = await fetch(`/rooms/${state.roomId}/shared-ai/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: state.participantId,
                control_token: state.controlToken
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '共有AI結果の生成に失敗しました');

        const resultText = String(data.result || '').trim();
        if (!resultText) {
            throw new Error('AIから空の結果が返りました');
        }

        if (type === 'summary') {
            state.meetingInsights.summary = resultText;
        } else if (type === 'todo') {
            state.meetingInsights.todo = resultText;
        } else if (type === 'minutes') {
            state.meetingInsights.minutes = resultText;
            state.minutesWorkspace.result = resultText;
            state.minutesWorkspace.updatedAt = data.updated_at || new Date().toISOString();
            renderMinutesWorkspace();
        }

        state.meetingInsights.updatedAt = data.updated_at || new Date().toISOString();
        await loadMeetingInsights({ silent: true });
        setAiWorkspace(type, title, resultText, '');
        aiWorkspaceStatus.innerText = `${title}を生成しました。`;
        aiOutputEditor.focus();
        aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
        aiWorkspaceStatus.innerText = `共有AI結果の生成に失敗しました: ${error.message}`;
        alert(`共有AI結果の生成に失敗しました: ${error.message}`);
    }
}

async function runSummaryInsights() {
    await runSharedResult('summary', '要約');
}

async function runActionInsights() {
    await runSharedResult('todo', 'TODO');
}

async function runMinutesGeneration() {
    if (!state.roomId) return;

    if (!state.isHost) {
        const existing = String(state.meetingInsights.minutes || state.minutesWorkspace.result || '').trim();
        if (!existing) {
            minutesWorkspaceStatus.innerText = 'まだホストが議事録を生成していません。';
            alert('まだホストが議事録を生成していません。');
            return;
        }
        state.minutesWorkspace.result = existing;
        state.minutesWorkspace.updatedAt = state.meetingInsights.updatedAt;
        renderMinutesWorkspace();
        minutesWorkspaceStatus.innerText = '共有議事録を表示しています。';
        return;
    }

    state.minutesWorkspace.loading = true;
    renderMinutesWorkspace();

    try {
        const res = await fetch(`/rooms/${state.roomId}/shared-ai/minutes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: state.participantId,
                control_token: state.controlToken
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '議事録生成に失敗しました');

        const resultText = String(data.result || '').trim();
        if (!resultText) {
            throw new Error('AIから空の議事録が返りました');
        }

        state.minutesWorkspace.result = resultText;
        state.minutesWorkspace.updatedAt = data.updated_at || new Date().toISOString();
        state.meetingInsights.minutes = resultText;
        minutesOutputEditor.value = resultText;
        minutesWorkspaceStatus.innerText = '議事録を生成しました。必要に応じて内容を整えてください。';
        await loadMeetingInsights({ silent: true });
        minutesOutputEditor.focus();
        minutesOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        minutesWorkspaceStatus.innerText = `議事録生成に失敗しました: ${error.message}`;
        alert(`議事録生成に失敗しました: ${error.message}`);
    } finally {
        state.minutesWorkspace.loading = false;
        renderMinutesWorkspace();
    }
}

async function ensureMeetingInsights() {
    await loadMeetingInsights({ silent: true });
}

async function loadCustomAiResult() {
    if (!state.roomId) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/custom-output`);
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'AI結果の取得に失敗しました');

        state.aiWorkspace.mode = data.mode || state.aiWorkspace.mode || '';
        state.aiWorkspace.title = data.title || state.aiWorkspace.title || '解析結果';
        state.aiWorkspace.instruction = data.instruction || state.aiWorkspace.instruction || '';
        state.aiWorkspace.result = data.result || state.aiWorkspace.result || '';
        state.aiWorkspace.savedAt = data.saved_at || null;
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
    }
}

async function generateCustomAiResult() {
    if (!state.roomId) return;
    const instruction = state.aiWorkspace.instruction.trim();
    if (!instruction) {
        alert('自由解析の指示を入力してください。');
        return;
    }

    try {
        if (!String(state.meetingInsights.minutes || '').trim()) {
            alert('先にホストが議事録を生成してください。');
            return;
        }
        state.aiWorkspace.loading = true;
        state.aiWorkspace.mode = 'custom';
        state.aiWorkspace.title = '自由解析';
        renderAiWorkspace();
        const res = await fetch(`/rooms/${state.roomId}/custom-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instruction,
                participant_id: state.participantId,
                control_token: state.controlToken
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '自由解析に失敗しました');
        const resultText = String(data.result || '').trim();
        if (!resultText) {
            throw new Error('AIから空の結果が返りました');
        }
        setAiWorkspace('custom', '自由解析', resultText, instruction);
        aiWorkspaceStatus.innerText = '議事録ベースの自由解析を表示しています。';
        aiOutputEditor.focus();
        aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
        alert(`自由解析に失敗しました: ${error.message}`);
    }
}
function scrollToPageEdge(direction) {
    const activePanel = document.querySelector('.tab-panel.active');
    const target = activePanel || document.scrollingElement || document.documentElement;
    const top = direction === 'top' ? 0 : target.scrollHeight;
    target.scrollTo({ top, behavior: 'smooth' });
}

function getStarredUtterances() {
    return state.activityItems
        .filter((item) => item.type === 'utterance' && item.data.is_starred)
        .map((item) => item.data)
        .sort((a, b) => new Date(b.starred_at || b.timestamp).getTime() - new Date(a.starred_at || a.timestamp).getTime());
}

function openTranscriptModal(id) {
    const utterance = getUtteranceById(id);
    if (!utterance) return;
    closeMemoModal({ preserveDraft: true });
    state.activeModalUtteranceId = id;
    state.transcriptDrafts[id] = utterance.transcript || '';
    renderEditModal();
    updateLogWorkState();
}

function closeTranscriptModal() {
    if (state.activeModalUtteranceId) {
        delete state.transcriptDrafts[state.activeModalUtteranceId];
    }
    state.activeModalUtteranceId = null;
    renderEditModal();
    updateLogWorkState();
}

function openMemoModal(id) {
    const utterance = getUtteranceById(id);
    if (!utterance) return;
    closeTranscriptModal();
    state.activeMemoUtteranceId = id;
    state.noteDrafts[id] = utterance.memo_text || utterance.memory_note || '';
    renderMemoModal();
    updateLogWorkState();
}

function closeMemoModal(options = {}) {
    if (state.activeMemoUtteranceId && !options.preserveDraft) {
        delete state.noteDrafts[state.activeMemoUtteranceId];
    }
    state.activeMemoUtteranceId = null;
    renderMemoModal();
    updateLogWorkState();
}

function renderEditModal() {
    const utterance = state.activeModalUtteranceId ? getUtteranceById(state.activeModalUtteranceId) : null;
    if (!utterance) {
        editModalOverlay.classList.add('hidden');
        editModalOverlay.setAttribute('aria-hidden', 'true');
        if (!state.activeMemoUtteranceId) document.body.classList.remove('modal-open');
        editModalSpeaker.innerText = '-';
        editModalTime.innerText = '--:--';
        editModalOriginal.innerText = '';
        editModalTextarea.value = '';
        return;
    }

    editModalOverlay.classList.remove('hidden');
    editModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    editModalSpeaker.innerText = utterance.display_name;
    editModalTime.innerText = formatTime(utterance.timestamp);
    editModalOriginal.innerText = utterance.raw_transcript || utterance.transcript || '';
    editModalTextarea.value = state.transcriptDrafts[utterance.id] ?? utterance.transcript ?? '';
}

function renderMemoModal() {
    const utterance = state.activeMemoUtteranceId ? getUtteranceById(state.activeMemoUtteranceId) : null;
    if (!utterance) {
        memoModalOverlay.classList.add('hidden');
        memoModalOverlay.setAttribute('aria-hidden', 'true');
        if (!state.activeModalUtteranceId) document.body.classList.remove('modal-open');
        memoModalSpeaker.innerText = '-';
        memoModalTime.innerText = '--:--';
        memoModalOriginal.innerText = '';
        memoModalTextarea.value = '';
        return;
    }

    memoModalOverlay.classList.remove('hidden');
    memoModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    memoModalSpeaker.innerText = utterance.display_name;
    memoModalTime.innerText = formatTime(utterance.timestamp);
    memoModalOriginal.innerText = utterance.transcript || '';
    memoModalTextarea.value = state.noteDrafts[utterance.id] ?? utterance.memo_text ?? utterance.memory_note ?? '';
}

function createUtteranceElement(utterance) {
    const article = document.createElement('article');
    article.className = `utterance${utterance.participant_id === state.participantId ? ' self' : ''}${utterance.is_starred ? ' starred' : ''}${utterance.id === state.focusedUtteranceId ? ' focused' : ''}`;
    article.dataset.utteranceId = utterance.id;

    const time = formatTime(utterance.timestamp);
    const sourceLabel = utterance.transcript_source === 'user'
        ? '手動編集'
        : utterance.transcript_source === 'ai'
            ? 'AI補正'
            : '生ログ';
    const rawDiffers = utterance.raw_transcript && utterance.raw_transcript !== utterance.transcript;

    article.innerHTML = `
        <div class="utterance-meta">
            <div>
                <div class="speaker-name">${escapeHtml(utterance.display_name)}</div>
                <div class="utterance-time">${time}</div>
            </div>
            <div class="timestamp">${utterance.is_starred ? '★ ' : ''}${sourceLabel}</div>
        </div>
        <div class="text">${highlightText(utterance.transcript, state.filters.query)}</div>
        ${rawDiffers ? `<div class="note-preview">RAW: ${highlightText(utterance.raw_transcript, state.filters.query)}</div>` : ''}
        ${utterance.memo_text ? `<div class="note-preview">メモ: ${highlightText(utterance.memo_text, state.filters.query)}</div>` : ''}
        <div class="utterance-actions">
            <button class="icon-toggle ${utterance.is_starred ? 'active' : ''}" data-action="star">${utterance.is_starred ? '★ 重要' : '☆ 重要'}</button>
            <button class="icon-toggle" data-action="note">メモ</button>
            <button class="icon-toggle" data-action="edit">編集</button>
        </div>
    `;

    article.tabIndex = 0;
    article.addEventListener('click', (event) => {
        if (event.target.closest('button, textarea')) return;
        openTranscriptModal(utterance.id);
    });
    article.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openTranscriptModal(utterance.id);
        }
    });

    article.querySelector('[data-action="star"]').onclick = (event) => {
        event.stopPropagation();
        updateUtteranceMemory(utterance.id, { is_starred: !utterance.is_starred });
    };
    article.querySelector('[data-action="note"]').onclick = (event) => {
        event.stopPropagation();
        openMemoModal(utterance.id);
    };
    article.querySelector('[data-action="edit"]').onclick = (event) => {
        event.stopPropagation();
        openTranscriptModal(utterance.id);
    };

    return article;
}

function renderConversationList(container, includeSystemMessages) {
    if (!container) return;
    const previousScrollTop = container.scrollTop;
    const previousScrollHeight = container.scrollHeight;
    const items = getVisibleItems().filter((item) => includeSystemMessages || item.type === 'utterance');
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<span class="placeholder-text">該当するログはありません。</span>';
        return;
    }

    items.forEach((item) => {
        if (item.type === 'system') {
            const system = document.createElement('div');
            system.className = 'system-message';
            system.innerText = item.text;
            container.appendChild(system);
            return;
        }
        container.appendChild(createUtteranceElement(item.data));
    });

    if (state.isWorkingOnLog) {
        const heightDelta = container.scrollHeight - previousScrollHeight;
        container.scrollTop = previousScrollTop + Math.max(heightDelta, 0);
    }
}

function renderStarredLogs(container) {
    if (!container) return;
    const starred = getStarredUtterances();
    container.innerHTML = '';
    if (starred.length === 0) {
        container.innerHTML = '<span class="placeholder-text">重要ログはまだありません。</span>';
        return;
    }
    starred.forEach((utterance) => {
        const card = document.createElement('button');
        card.className = `memory-card${utterance.id === state.focusedUtteranceId ? ' active' : ''}`;
        card.type = 'button';
        card.innerHTML = `
            <div class="memory-card-header">
                <strong>${escapeHtml(utterance.display_name)}</strong>
                <time>${formatTime(utterance.timestamp)}</time>
            </div>
            <div class="memory-card-text">${highlightText(shortenText(utterance.transcript, 90), state.filters.query)}</div>
            ${utterance.memo_text ? `<div class="note-preview">メモ: ${highlightText(shortenText(utterance.memo_text, 70), state.filters.query)}</div>` : ''}
        `;
        card.onclick = () => focusUtterance(utterance.id);
        container.appendChild(card);
    });
}

function focusUtterance(id) {
    state.focusedUtteranceId = id;
    renderAllLogs();
    requestAnimationFrame(() => {
        const logRoot = summaryScreen.classList.contains('active') && document.getElementById('panel-log').classList.contains('active')
            ? summaryLog
            : timeline;
        const target = logRoot.querySelector(`[data-utterance-id="${id}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function renderAiWorkspace() {
    customAiInstruction.value = state.aiWorkspace.instruction || '';
    aiOutputTitle.innerText = state.aiWorkspace.title || '解析結果';
    aiOutputEditor.value = state.aiWorkspace.result || 'ここに解析結果が表示されます。';
    if (state.aiWorkspace.loading) {
        aiWorkspaceStatus.innerText = 'AIが解析中です...';
        return;
    }
    if (state.aiWorkspace.savedAt) {
        aiWorkspaceStatus.innerText = `保存済み: ${new Date(state.aiWorkspace.savedAt).toLocaleString('ja-JP')}`;
    }
}

function setAiWorkspace(mode, title, result, instruction = '') {
    state.aiWorkspace.mode = mode;
    state.aiWorkspace.title = title;
    state.aiWorkspace.result = result || '';
    state.aiWorkspace.instruction = instruction;
    state.aiWorkspace.loading = false;
    renderAiWorkspace();
}

function clearInsightsPoll() {
    if (state.meetingInsights.pollTimer) {
        clearTimeout(state.meetingInsights.pollTimer);
        state.meetingInsights.pollTimer = null;
    }
}

function getFormattedAiWorkspaceText() {
    const title = state.aiWorkspace.title || '解析結果';
    const instruction = customAiInstruction.value || state.aiWorkspace.instruction || '';
    const result = aiOutputEditor.value || state.aiWorkspace.result || '';
    return [`【${title}】`, result, '', '【指示】', instruction].join('\n');
}

function getFormattedMinutesText() {
    return minutesOutputEditor.value || state.minutesWorkspace.result || '';
}

async function copyAiWorkspaceResult() {
    if (!state.aiWorkspace.result.trim()) {
        alert('コピーできる解析結果がまだありません。');
        return;
    }
    try {
        await navigator.clipboard.writeText(getFormattedAiWorkspaceText());
        aiWorkspaceStatus.innerText = '解析結果をコピーしました。';
    } catch (error) {
        alert(`コピーに失敗しました: ${error.message}`);
    }
}

function downloadAiWorkspaceResult() {
    if (!state.aiWorkspace.result.trim()) {
        alert('ダウンロードできる解析結果がまだありません。');
        return;
    }
    downloadTextFile(`ai-workspace-${state.roomId || 'session'}.txt`, getFormattedAiWorkspaceText());
}

async function copyMinutesResult() {
    const result = getFormattedMinutesText().trim();
    if (!result) {
        alert('コピーできる議事録がまだありません。');
        return;
    }
    try {
        await navigator.clipboard.writeText(result);
        minutesWorkspaceStatus.innerText = '議事録をコピーしました。';
    } catch (error) {
        alert(`コピーに失敗しました: ${error.message}`);
    }
}

function downloadMinutesResult() {
    const result = getFormattedMinutesText().trim();
    if (!result) {
        alert('ダウンロードできる議事録がまだありません。');
        return;
    }
    downloadTextFile(`minutes-${state.roomId || 'session'}.txt`, result);
}

function reqIncludes(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

async function readApiResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return res.json();
    }
    const text = await res.text();
    const isHtml = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');
    const message = isHtml ? 'サーバーが古い状態の可能性があります。サーバーを再起動してください。' : (text || 'サーバー応答の読み取りに失敗しました。');
    throw new Error(message);
}

async function updateUtteranceMemory(id, updates, options = {}) {
    try {
        const res = await fetch(`/rooms/${state.roomId}/logs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const updated = await readApiResponse(res);
        if (!res.ok) throw new Error(updated.error || 'ログ更新に失敗しました');
        upsertUtterance(updated);
        state.noteDrafts[id] = updated.memo_text || updated.memory_note || '';
        state.transcriptDrafts[id] = updated.transcript || '';
        if (options.closeModal) {
            state.activeModalUtteranceId = null;
            delete state.transcriptDrafts[id];
        }
        if (options.closeMemoModal) {
            state.activeMemoUtteranceId = null;
            delete state.noteDrafts[id];
        }
        if (reqIncludes(updates, 'transcript')) {
            state.meetingInsights.dirty = true;
        }
        renderAllLogs();
    } catch (error) {
        AppDebug.log('error', 'Failed to update log', error.message);
        alert(`ログ更新に失敗しました: ${error.message}`);
    }
}

async function saveTranscriptFromModal() {
    const utteranceId = state.activeModalUtteranceId;
    if (!utteranceId) return;
    const transcript = (state.transcriptDrafts[utteranceId] ?? '').trim();
    await updateUtteranceMemory(utteranceId, { transcript, transcript_source: 'user' }, { closeModal: true });
}

async function saveMemoFromModal() {
    const utteranceId = state.activeMemoUtteranceId;
    if (!utteranceId) return;
    const memoText = (state.noteDrafts[utteranceId] ?? '').trim();
    await updateUtteranceMemory(utteranceId, { memo_text: memoText }, { closeMemoModal: true });
}

async function downloadMinutes() {
    if (!state.roomId) return;
    window.location.href = `/rooms/${state.roomId}/download`;
}

function copyRoomId() {
    if (!state.roomId) return;
    const joinUrl = getJoinUrl(state.roomId);
    navigator.clipboard.writeText(joinUrl).then(() => {
        alert('参加URLをコピーしました');
    });
}

async function prepareAudio(options = {}) {
    AppDebug.log('info', 'prepareAudio: Requesting permission on user gesture');
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
                    AppDebug.log('warn', 'Failed to refresh audio constraints', constraintError.message);
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
        AppDebug.log('error', 'prepareAudio failed', error.message);
        if (options.updateStatus) updateMicStatus(`マイク確認に失敗しました: ${error.message}`);
        alert(`マイクの許可に失敗しました: ${error.message}`);
        return false;
    }
}

async function joinRoom() {
    const displayName = document.getElementById('display-name').value.trim();
    const profileText = document.getElementById('profile-text').value.trim();
    const roomId = document.getElementById('room-id').value.trim().toUpperCase();
    if (!displayName || !roomId) return alert('表示名とルームIDを入力してください');
    if (!await prepareAudio()) return;
    await joinRoomProcess(roomId, displayName, profileText);
}

async function createRoom() {
    const displayName = document.getElementById('display-name').value.trim();
    const profileText = document.getElementById('profile-text').value.trim();
    if (!displayName) return alert('表示名を入力してください');
    if (!await prepareAudio()) return;
    try {
        const ownerId = ensureLocalUserId();
        const res = await fetch('/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: ownerId })
        });
        const room = await readApiResponse(res);
        await joinRoomProcess(room.id, displayName, profileText);
    } catch (error) {
        alert('ルーム作成に失敗しました');
    }
}

async function joinRoomProcess(roomId, displayName, profileText = '') {
    try {
        const normalizedRoomId = roomId.trim().toUpperCase();
        const userId = ensureLocalUserId();
        
        // Save current AI settings
        localStorage.setItem('ai_provider', state.aiProvider);
        localStorage.setItem('ai_model', state.aiModel);

        const res = await fetch(`/rooms/${normalizedRoomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user_id: userId, 
                display_name: displayName, 
                location_id: 'web-browser', 
                profile_text: profileText,
                ai_config: {
                    provider: state.aiProvider,
                    model: state.aiModel
                }
            })
        });
        if (!res.ok) throw new Error('Join failed');
        const participant = await readApiResponse(res);
        state.roomId = normalizedRoomId;
        state.participantId = participant.id;
        state.controlToken = participant.control_token;
        state.userId = userId;
        state.displayName = displayName;
        state.isHost = !!participant.is_host;
        localStorage.setItem('display_name', displayName);
        localStorage.setItem('profile_text', profileText);
        showMeetingScreen();
        initWebSocket();
    } catch (error) {
        alert('ルーム参加に失敗しました');
    }
}

function showMeetingScreen() {
    state.activeModalUtteranceId = null;
    state.activeMemoUtteranceId = null;
    document.body.classList.remove('modal-open');
    renderEditModal();
    renderMemoModal();
    document.body.classList.remove('setup-mode');
    document.body.classList.remove('summary-mode');
    document.body.classList.add('meeting-mode');
    setupScreen.classList.remove('active');
    summaryScreen.classList.remove('active');
    meetingScreen.classList.add('active');
    roomInfo.innerText = `ルーム: ${state.roomId}`;
    syncMuteUi();
    state.mobileMenuOpen = false;
    if (isMobileViewport()) {
        state.mobileMemoryCollapsed = true;
        state.mobileAiCollapsed = true;
    } else {
        state.mobileMemoryCollapsed = false;
        state.mobileAiCollapsed = false;
    }
    renderMobileMeetingControls();
    requestWakeLock();
}

function showSummaryScreen() {
    state.activeModalUtteranceId = null;
    state.activeMemoUtteranceId = null;
    document.body.classList.remove('modal-open');
    renderEditModal();
    renderMemoModal();
    document.body.classList.remove('setup-mode');
    document.body.classList.remove('meeting-mode');
    document.body.classList.add('summary-mode');
    state.mobileMenuOpen = false;
    state.mobileMemoryCollapsed = false;
    state.mobileAiCollapsed = false;
    renderMobileMeetingControls();
    state.summaryMobileMenuOpen = false;
    if (isMobileViewport()) {
        state.summaryStatsCollapsed = true;
        state.summarySidebarCollapsed = true;
        state.summaryAiControlsCollapsed = false;
    } else {
        state.summaryStatsCollapsed = false;
        state.summarySidebarCollapsed = false;
        state.summaryAiControlsCollapsed = false;
    }
    renderSummaryMobileControls();
    meetingScreen.classList.remove('active');
    summaryScreen.classList.add('active');
    summaryInfo.innerText = `ルーム: ${state.roomId}`;
    releaseWakeLock();
    switchTab('log');
    loadRoomLogs().then(() => {
        renderAllLogs();
        window.scrollTo({ top: 0, behavior: 'auto' });
        loadMeetingInsights({ silent: true });
    });
}

async function loadRoomLogs() {
    if (!state.roomId) return;
    try {
        const res = await fetch(`/rooms/${state.roomId}/logs`);
        if (!res.ok) throw new Error('ログ取得に失敗しました');
        const logs = await readApiResponse(res);
        state.activityItems = state.activityItems.filter((item) => item.type === 'system');
        logs.forEach((entry) => upsertUtterance(entry));
    } catch (error) {
        AppDebug.log('error', 'Failed to load logs', error.message);
    }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?participantId=${state.participantId}`;
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
        addSystemMessage('サーバーに接続しました。');
        state.ws.send(JSON.stringify({ type: 'hello' }));
    };
    state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
            upsertUtterance(msg);
            renderAllLogs();
            scrollLogToLatest(timeline);
        } else if (msg.type === 'ready') {
            (msg.history || []).forEach((entry) => upsertUtterance(entry));
            renderAllLogs();
            startRecording();
        } else if (msg.type === 'terminated') {
            addSystemMessage('会議が終了しました。');
            stopRecording();
            showSummaryScreen();
        }
    };
    state.ws.onclose = () => {
        addSystemMessage('接続が切れました。再接続を試みます...');
        if (meetingScreen.classList.contains('active')) {
            setTimeout(initWebSocket, 3000);
        }
    };
    state.ws.onerror = () => {
        AppDebug.log('error', 'WebSocket Error occurred');
    };
}

function scrollLogToLatest(container) {
    if (state.isWorkingOnLog || !container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

async function startRecording() {
    if (state.audioContext && state.audioContext.state === 'running' && state.stream && state.processor) return;
    try {
        if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        if (state.audioContext.state === 'suspended') await state.audioContext.resume();
        ensureAudioNodes();
    } catch (error) {
        AppDebug.log('error', 'startRecording failed', error.message);
        addSystemMessage(`マイク接続エラー: ${error.name}`);
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
        processor.onaudioprocess = (event) => {
            if (state.isMuted || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
            const inputData = event.inputBuffer.getChannelData(0);
            const clippedInput = new Float32Array(inputData.length);
            const maxThreshold = Math.max(0.05, state.voiceGate.maxThreshold);
            let energy = 0;
            for (let i = 0; i < inputData.length; i += 1) {
                const sample = Math.max(-maxThreshold, Math.min(maxThreshold, inputData[i]));
                clippedInput[i] = sample / maxThreshold;
                energy += clippedInput[i] * clippedInput[i];
            }
            const rms = Math.sqrt(energy / clippedInput.length);
            const gate = state.voiceGate;
            const isSpeechLike = rms >= gate.threshold;
            if (isSpeechLike) {
                gate.remainingFrames = gate.releaseFrames;
                gate.speaking = true;
            } else if (gate.remainingFrames > 0) {
                gate.remainingFrames -= 1;
            } else {
                gate.speaking = false;
                return;
            }
            const sourceRate = state.audioContext.sampleRate || 16000;
            const mono16k = resampleToTargetRate(clippedInput, sourceRate, 16000);
            const pcm = new Int16Array(mono16k.length);
            for (let i = 0; i < mono16k.length; i += 1) {
                pcm[i] = Math.max(-1, Math.min(1, mono16k[i])) * 0x7fff;
            }
            state.ws.send(pcm.buffer);
        };
        state.processor = processor;
    } catch (error) {
        AppDebug.log('error', 'audio processor failed', error.message);
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
    addSystemMessage(state.isMuted ? 'この端末の文字起こしを停止しました。' : 'この端末の文字起こしを再開しました。');
}

async function endRoom() {
    if (!confirm('会議を終了しますか？')) return;
    try {
        const res = await fetch(`/rooms/${state.roomId}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id: state.participantId, control_token: state.controlToken })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '終了に失敗しました');
        stopRecording();
        showSummaryScreen();
    } catch (error) {
        alert(`終了処理に失敗しました: ${error.message}`);
    }
}

async function checkApiStatus() {
    const container = document.getElementById('api-status-container');
    if (!container) return;
    try {
        const res = await fetch('/api/status');
        const status = await readApiResponse(res);
        const sttText = status.speech_to_text ? `OK (${status.stt_provider || 'unknown'})` : '未設定';
        const aiText = status.gemini_ai ? 'Gemini (自動フォールバックあり)' : '未設定';
        const secureText = isSecureContextForMedia() ? 'OK' : 'HTTPS必須';
        container.innerHTML = `<div class="system-message">音声認識: ${sttText} / AI: ${aiText} / HTTPS: ${secureText}</div>`;
    } catch (error) {
        container.innerHTML = '<p>ステータス確認に失敗しました。</p>';
    }
}

function initializeSetupUi() {
    ensureLocalUserId();
    const savedDisplayName = localStorage.getItem('display_name');
    const savedProfileText = localStorage.getItem('profile_text');
    const savedSensitivity = localStorage.getItem('mic_sensitivity');
    const savedMicPreset = localStorage.getItem('mic_preset');
    const savedAiProvider = localStorage.getItem('ai_provider');
    const savedAiModel = localStorage.getItem('ai_model');
    const savedMinThreshold = Number(localStorage.getItem('mic_threshold_min'));
    const savedMaxThreshold = Number(localStorage.getItem('mic_threshold_max'));
    
    if (savedDisplayName) document.getElementById('display-name').value = savedDisplayName;
    if (savedProfileText) document.getElementById('profile-text').value = savedProfileText;
    
    if (savedAiProvider) {
        state.aiProvider = savedAiProvider;
        if (window.AppDom.aiProvider) window.AppDom.aiProvider.value = savedAiProvider;
    }
    // Always sync model state with current provider
    state.aiModel = state.aiProvider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash';

    const roomIdFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomIdFromUrl) {
        document.getElementById('room-id').value = roomIdFromUrl.toUpperCase();
        updateMicStatus(`共有URLからルーム ${roomIdFromUrl.toUpperCase()} を読み込みました。表示名を入れれば参加できます。`);
    }
    document.body.classList.add('setup-mode');
    setMicSensitivity(savedSensitivity || 'standard');
    const defaultPreset = isMobileViewport() ? DEFAULT_MOBILE_PRESET : DEFAULT_DESKTOP_PRESET;
    state.micPresetKey = savedMicPreset || defaultPreset;
    const initialPreset = getMicPresetConfig();
    if (initialPreset) {
        state.voiceGate.threshold = initialPreset.thresholds.min;
        state.voiceGate.maxThreshold = initialPreset.thresholds.max;
    }
    if (!Number.isNaN(savedMinThreshold)) {
        state.voiceGate.threshold = savedMinThreshold;
    }
    if (!Number.isNaN(savedMaxThreshold)) {
        state.voiceGate.maxThreshold = savedMaxThreshold;
    }
    const normalized = clampThresholdPair(state.voiceGate.threshold, state.voiceGate.maxThreshold);
    state.voiceGate.threshold = normalized.min;
    state.voiceGate.maxThreshold = normalized.max;
    updateMicThresholdControls();
    renderMicPresetUi();
    updateMuteButton();
    syncFilterControls();
    renderAllLogs();
    renderAiWorkspace();
    renderMeetingInsights();
    renderMeetingAnalysis();
    renderMinutesWorkspace();
    renderMobileMeetingControls();
    renderSummaryMobileControls();
}

bindAppEvents({
    createRoom,
    joinRoom,
    endRoom,
    toggleMute,
    reconnectMic,
    toggleMobileMeetingMenu,
    toggleMobileMemoryPanel,
    toggleMobileAiPanel,
    toggleSummaryMobileMenu,
    toggleSummaryStats,
    toggleSummarySidebar,
    toggleSummaryAiControls,
    copyRoomId,
    downloadMinutes,
    addMemo,
    scrollLogToLatest,
    switchTab,
    copyAiWorkspaceResult,
    downloadAiWorkspaceResult,
    runMinutesGeneration,
    copyMinutesResult,
    downloadMinutesResult,
    runSummaryInsights,
    runActionInsights,
    generateCustomAiResult,
    runMicCheck,
    scrollToPageEdge,
    clearSearch,
    closeTranscriptModal,
    saveTranscriptFromModal,
    closeMemoModal,
    saveMemoFromModal,
    setMicSensitivity,
    applyMicPreset,
    syncMicThresholdsFromUi,
    runMeetingAnalysis,
    syncFilterControls,
    renderAllLogs,
    addDictionaryTerm,
    deleteDictionaryTerm
});

function bootstrap() {
    initializeSetupUi();
    checkApiStatus();
    syncMicrophonePermissionState();
    loadDictionary();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}

window.addEventListener('resize', () => {
    renderMobileMeetingControls();
    renderSummaryMobileControls();
});

document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    await requestWakeLock();
    if (state.audioContext?.state === 'suspended') {
        try {
            await state.audioContext.resume();
        } catch (error) {
            AppDebug.log('warn', 'AudioContext resume failed', error.message);
        }
    }
});

window.addEventListener('pageshow', async () => {
    await requestWakeLock();
    if (meetingScreen.classList.contains('active')) {
        syncMicrophonePermissionState();
    }
});

window.addEventListener('online', () => {
    updateMicStatus('オンラインに復帰しました。必要ならマイクONで再接続してください。');
});

window.addEventListener('offline', () => {
    updateMicStatus('オフラインです。接続復帰を待っています。');
});
