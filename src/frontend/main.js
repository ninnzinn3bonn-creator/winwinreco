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
    aiOutputCard,
    aiOutputLoading,
    customAiInstruction,
    aiOutputEditor,
    minutesOutputCard,
    minutesOutputLoading,
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

// Product decision (2026-06-29): provider selection is locked. main.js still
// contains legacy orchestration paths, so fixed constants here prevent stale
// localStorage values from re-enabling the old Gemini / Google choices.
const FIXED_AI_PROVIDER = 'groq';
const FIXED_AI_MODEL = 'openai/gpt-oss-120b';
const FIXED_STT_PROVIDER = 'elevenlabs';
const AI_LOADING_TEXT = 'GroqでAI解析中です...';
const MINUTES_LOADING_TEXT = 'Groqで議事録を生成中です...';

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

function sendMicPresetMetadataToServer(preset) {
    const target = preset || getMicPresetConfig();
    if (!target || !target.stt) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    try {
        // Provider selection is fixed at the product level. This legacy helper
        // remains in main.js for backward compatibility with older module
        // wiring, so it must also ignore stale localStorage provider choices.
        const sttProvider = state.fixedSttProvider || FIXED_STT_PROVIDER;
        state.ws.send(JSON.stringify({
            type: 'mic_preset',
            stt_provider: sttProvider,
            mic: {
                microphoneDistance: target.stt.microphoneDistance || null,
                recordingDeviceType: target.stt.recordingDeviceType || null
            }
        }));
    } catch (err) {
        AppDebug.log('warn', 'mic_preset send failed', err && err.message);
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
    document.querySelectorAll('[data-mic-preset]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.micPreset === state.micPresetKey);
    });
}

// --- Auth helpers -----------------------------------------------------------
// After a successful /join we receive a control_token that the backend now
// requires on every per-room route (both REST and the WebSocket upgrade).
// These helpers centralise the credential plumbing so each call site stays
// tidy and we can't accidentally ship a request without creds.
function authCredParams() {
    const params = new URLSearchParams();
    if (state.participantId) params.set('participant_id', state.participantId);
    if (state.controlToken) params.set('control_token', state.controlToken);
    return params;
}

function withAuthQuery(url) {
    const params = authCredParams().toString();
    if (!params) return url;
    return url + (url.includes('?') ? '&' : '?') + params;
}

function authedBody(extra = {}) {
    return {
        participant_id: state.participantId,
        control_token: state.controlToken,
        ...extra
    };
}

async function loadDictionary() {
    // The pre-meeting dictionary card is intentionally absent while STT is
    // fixed to ElevenLabs Scribe. Keep this legacy helper dormant when the DOM
    // target is missing so setup boot does not make unnecessary API calls.
    if (!window.AppDom?.dictionaryList) return;
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
    if (!term) return window.AppToast.warn('用語を入力してください');

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
        window.AppToast.error('追加に失敗しました', { detail: error.message });
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
        window.AppToast.error('削除に失敗しました', { detail: error.message });
    }
}

async function extractTermsFromText() {
    const text = window.AppDom.dictBulkText.value.trim();
    if (!text) return window.AppToast.warn('解析するテキストを入力してください');

    const btn = window.AppDom.btnDictExtract;
    const resultsArea = window.AppDom.extractResultsArea;
    const originalText = btn.innerText;
    
    btn.disabled = true;
    btn.innerText = AI_LOADING_TEXT;
    resultsArea.classList.add('hidden');

    try {
        const res = await fetch('/api/dictionary/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                ai_config: { provider: 'groq', model: 'openai/gpt-oss-120b' }
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '抽出に失敗しました');

        // Deduplicate against existing dictionary
        const existingTerms = (state.dictionary || []).map(d => d.term);
        state.extractedTerms = (data.terms || []).filter(t => !existingTerms.includes(t.term));

        if (state.extractedTerms.length === 0) {
            window.AppToast.info('新しい専門用語は見つかりませんでした（すべて登録済みか、適切な単語が検出されませんでした）。');
        } else {
            renderExtractResults();
        }
    } catch (error) {
        AppDebug.log('error', 'Extraction failed', error.message);
        window.AppToast.error('解析に失敗しました', { detail: error.message });
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

function renderExtractResults() {
    const area = window.AppDom.extractResultsArea;
    const list = window.AppDom.extractList;
    if (!area || !list) return;

    list.innerHTML = '';
    state.extractedTerms.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'extract-item';
        // Use unique IDs for checkboxes for better accessibility/clicking
        const checkboxId = `extract-cb-${index}`;
        div.innerHTML = `
            <label for="${checkboxId}">
                <input type="checkbox" id="${checkboxId}" checked data-index="${index}">
                <span class="term">${escapeHtml(item.term)}</span>
                <span class="reading">(${escapeHtml(item.reading)})</span>
            </label>
        `;
        list.appendChild(div);
    });
    area.classList.remove('hidden');
}

async function addSelectedTerms() {
    const checkboxes = window.AppDom.extractList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length === 0) return window.AppToast.warn('追加する用語を選択してください');

    const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
    const toAdd = selectedIndices.map(i => state.extractedTerms[i]);

    let successCount = 0;
    for (const item of toAdd) {
        try {
            const res = await fetch('/api/dictionary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (res.ok) successCount++;
        } catch (e) {
            console.error(`Failed to add: ${item.term}`, e);
        }
    }

    window.AppToast.success(`${successCount}件の用語を辞書に追加しました。`);
    window.AppDom.extractResultsArea.classList.add('hidden');
    window.AppDom.dictBulkText.value = '';
    await loadDictionary();
}

async function guessReadingForInput() {
    const term = window.AppDom.dictTerm.value.trim();
    if (!term || term.length < 2) return;
    if (window.AppDom.dictReading.value.trim()) return; // すでに読みがあれば何もしない

    try {
        const res = await fetch('/api/dictionary/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: term,
                ai_config: { provider: 'groq', model: 'openai/gpt-oss-120b' }
            })
        });
        const data = await readApiResponse(res);
        if (res.ok && data.terms && data.terms.length > 0) {
            const found = data.terms.find(t => t.term === term) || data.terms[0];
            if (found && found.reading) {
                window.AppDom.dictReading.value = found.reading;
            }
        }
    } catch (e) {
        // サイレントに失敗
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    const tabBtn = document.getElementById(`tab-${tab}`);
    const panelEl = document.getElementById(`panel-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (panelEl) panelEl.classList.add('active');
    renderSummaryMobileControls();
    // Persist the user's last-viewed tab so future visits restore it.
    try { localStorage.setItem('summary_last_tab', tab); } catch (_) { /* ignore */ }
}

/**
 * Pick the initial summary tab based on context:
 *  - First arrival from the meeting (just ended) → 議事録 (auto-generation
 *    is in flight, so this is what the user is most likely waiting for).
 *  - Returning visit → restore the last-viewed tab from localStorage.
 *  - Otherwise → ログレビュー (the safe default).
 */
function pickInitialSummaryTab(justEnded) {
    if (justEnded) return 'minutes';
    try {
        const last = localStorage.getItem('summary_last_tab');
        if (last === 'log' || last === 'minutes' || last === 'ai') return last;
    } catch (_) { /* ignore */ }
    return 'log';
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
    const unifiedBtn = document.getElementById('btn-mic-state');
    const indicator = document.querySelector('.recording-indicator');
    if (unifiedBtn) {
        const hasStream = !!state.stream;
        unifiedBtn.classList.remove('mic-state-off', 'mic-state-on', 'mic-state-muted');
        if (!hasStream) {
            unifiedBtn.textContent = '\ud83c\udf99 \u30de\u30a4\u30af ON';
            unifiedBtn.classList.add('mic-state-off');
            unifiedBtn.title = '\u30bf\u30c3\u30d7\u3067\u30de\u30a4\u30af\u3092\u63a5\u7d9a';
        } else if (state.isMuted) {
            unifiedBtn.textContent = '\ud83d\udd07 \u30df\u30e5\u30fc\u30c8\u4e2d (\u30bf\u30c3\u30d7\u3067\u89e3\u9664)';
            unifiedBtn.classList.add('mic-state-muted');
            unifiedBtn.title = '\u30bf\u30c3\u30d7\u3067\u30df\u30e5\u30fc\u30c8\u3092\u89e3\u9664';
        } else {
            unifiedBtn.textContent = '\ud83d\udd34 \u9332\u97f3\u4e2d (\u30bf\u30c3\u30d7\u3067\u30df\u30e5\u30fc\u30c8)';
            unifiedBtn.classList.add('mic-state-on');
            unifiedBtn.title = '\u30bf\u30c3\u30d7\u3067\u30df\u30e5\u30fc\u30c8';
        }
    }
    if (indicator) {
        indicator.classList.toggle('paused', state.isMuted);
    }
    selfInfo.innerText = `\u53c2\u52a0\u8005: ${state.displayName || '---'}${state.isMuted ? ' / \u30df\u30e5\u30fc\u30c8\u4e2d' : ''}`;
}

function renderMobileMeetingControls() {
    const mobile = isMobileViewport();
    const menuButton = document.getElementById('btn-mobile-menu');
    const settingsButton = document.getElementById('btn-meeting-mic-settings');
    const memoryButton = document.getElementById('btn-toggle-memory-panel');
    const aiButton = document.getElementById('btn-toggle-ai-panel');

    if (!mobile) {
        // PC keeps the menu drawer / collapsibles available, but the
        // memory/AI panels are not collapsed by default on a wide layout.
        state.mobileMemoryCollapsed = false;
        state.mobileAiCollapsed = false;
    }

    document.body.classList.toggle('mobile-memory-collapsed', mobile && state.mobileMemoryCollapsed);
    document.body.classList.toggle('mobile-ai-collapsed', mobile && state.mobileAiCollapsed);

    // The settings drawer (mobile-meeting-menu) opens the same way on PC and
    // mobile \u2014 use state.mobileMenuOpen as the single source of truth.
    const drawerOpen = !!state.mobileMenuOpen;
    if (mobileMeetingMenu) {
        mobileMeetingMenu.classList.toggle('active', drawerOpen);
        mobileMeetingMenu.classList.toggle('hidden', !drawerOpen);
        mobileMeetingMenu.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
    }
    if (menuButton) {
        menuButton.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
        menuButton.innerText = drawerOpen ? '\u2715' : '\u2630';
    }
    if (settingsButton) {
        settingsButton.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
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
    // Keep Profile → 設定 in sync so users see the same value either place.
    if (window.AppProfile?.saveSettings) {
        try { window.AppProfile.saveSettings({ defaultMicPreset: preset.key }); }
        catch (_) { /* ignore */ }
    }
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

    // Tell the server to rebuild its STT config with the new microphone
    // distance / device type. The next utterance picks up the change.
    sendMicPresetMetadataToServer(preset);

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
        syncMuteUi();
    } catch (error) {
        window.AppToast.error('\u30de\u30a4\u30af\u306e\u518d\u63a5\u7d9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f', { detail: error.message });
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
    // B2: focus 中は DOM を触らない。B3: 同値でも代入しない。
    const nextMinutes = state.minutesWorkspace.result || 'ここに議事録が表示されます。';
    if (document.activeElement !== minutesOutputEditor && minutesOutputEditor.value !== nextMinutes) {
        minutesOutputEditor.value = nextMinutes;
    }
    const isLoading = !!state.minutesWorkspace.loading || state.meetingInsights.status === 'processing';
    if (minutesOutputCard) minutesOutputCard.classList.toggle('is-loading', isLoading);
    if (minutesOutputLoading) minutesOutputLoading.classList.toggle('hidden', !isLoading);
    minutesOutputEditor.classList.toggle('is-busy', isLoading);

    // [L7] 進捗バー更新
    const minutesProgressWrap = document.getElementById('minutes-progress-wrap');
    const minutesProgressBar = document.getElementById('minutes-progress-bar');
    const minutesLoadingText = document.getElementById('minutes-loading-text');
    const prog = state.minutesWorkspace.progress;
    if (minutesProgressWrap && minutesProgressBar) {
        if (isLoading && prog && prog.total > 1) {
            minutesProgressWrap.classList.remove('hidden');
            const pct = Math.round(prog.completed / prog.total * 100);
            minutesProgressBar.style.width = `${pct}%`;
            if (minutesLoadingText) minutesLoadingText.textContent = `${MINUTES_LOADING_TEXT} (${prog.completed}/${prog.total} チャンク)`;
        } else {
            minutesProgressWrap.classList.add('hidden');
            if (minutesLoadingText) minutesLoadingText.textContent = MINUTES_LOADING_TEXT;
        }
    }

    if (isLoading) {
        minutesWorkspaceStatus.innerHTML = `<span class="spinner inline-spinner"></span> ${MINUTES_LOADING_TEXT}`;
        return;
    }

    // progress をリセット（生成完了時）
    if (!isLoading && state.minutesWorkspace.progress) {
        state.minutesWorkspace.progress = null;
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
        aiWorkspaceStatus.innerHTML = `<span class="spinner inline-spinner"></span> ${AI_LOADING_TEXT}`;
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
    // B6: processing 中だけポーリングを継続する。ready / error / idle になったら自動停止。
    if (state.meetingInsights.status !== 'processing') return;
    state.meetingInsights.pollTimer = setTimeout(() => {
        if (summaryScreen.classList.contains('active')) {
            loadMeetingInsights({ silent: true });
        }
    }, 5000);
}

function syncSharedResultsIntoEditors() {
    // B4: minutes — dirty なら上書きしない。30 秒以上経過で再同期。
    if (!state.minutesWorkspace.loading && state.meetingInsights.minutes) {
        if (!isEditorDirty('minutes')) {
            if (state.minutesWorkspace.result !== state.meetingInsights.minutes) {
                state.minutesWorkspace.result = state.meetingInsights.minutes;
                state.editorDirty.minutes = 0;
            }
        } else {
            AppDebug.log('info', 'syncShared: minutes をスキップ (dirty)');
        }
    }

    if (state.aiWorkspace.loading) return;

    const currentMode = state.aiWorkspace.mode || '';
    // B4: aiResult — dirty なら上書きしない。
    if ((!currentMode || currentMode === 'summary') && state.meetingInsights.summary) {
        if (!isEditorDirty('aiResult')) {
            if (state.aiWorkspace.result !== state.meetingInsights.summary) {
                setAiWorkspace('summary', '要約', state.meetingInsights.summary);
            }
        } else {
            AppDebug.log('info', 'syncShared: aiResult (summary) をスキップ (dirty)');
        }
        return;
    }

    if ((!currentMode || currentMode === 'todo') && state.meetingInsights.todo) {
        if (!isEditorDirty('aiResult')) {
            if (state.aiWorkspace.result !== state.meetingInsights.todo) {
                setAiWorkspace('todo', 'TODO', state.meetingInsights.todo);
            }
        } else {
            AppDebug.log('info', 'syncShared: aiResult (todo) をスキップ (dirty)');
        }
    }
}

async function loadMeetingInsights(options = {}) {
    if (!state.roomId) return;

    try {
        const res = await fetch(withAuthQuery(`/rooms/${state.roomId}/insights`));
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
            body: JSON.stringify(authedBody({
                type,
                instruction,
                ai_config: {
                    provider: state.fixedAiProvider || FIXED_AI_PROVIDER,
                    model: state.fixedAiModel || FIXED_AI_MODEL
                }
            }))
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
        window.AppToast.error('AI解析に失敗しました', { detail: error.message });
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
        button.innerText = isLoading ? AI_LOADING_TEXT : (
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
    state.liveMeetingAnalysis.status = AI_LOADING_TEXT;
    renderMeetingAnalysis();

    try {
        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(authedBody({
                type: config.type,
                instruction: config.instruction || '',
                ai_config: {
                    provider: state.fixedAiProvider || FIXED_AI_PROVIDER,
                    model: state.fixedAiModel || FIXED_AI_MODEL
                }
            }))
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
        window.AppToast.error(`${config.title}の解析に失敗しました`, { detail: error.message });
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
            window.AppToast.info('まだホストが共有結果を生成していません。');
            return;
        }
        setAiWorkspace(type, title, existing); // B5: instruction は維持
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
        // Past-meeting context is opt-in PER analysis. The checkbox lives in
        // the AI 解析 panel (#use-past-meetings); we always read it fresh so
        // the user can flip it between consecutive analyses. 議事録 is forced
        // OFF on the server (verbatim minutes never inherit prior meetings).
        const ctxBox = document.getElementById('use-past-meetings');
        const usePast = ctxBox ? !!ctxBox.checked : true;
        const res = await fetch(`/rooms/${state.roomId}/shared-ai/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: state.participantId,
                control_token: state.controlToken,
                use_past_context: usePast
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
            state.editorDirty.minutes = 0; // B1: サーバー由来なのでリセット
            renderMinutesWorkspace();
        }

        state.meetingInsights.updatedAt = data.updated_at || new Date().toISOString();
        await loadMeetingInsights({ silent: true });
        setAiWorkspace(type, title, resultText); // B5: instruction は維持
        aiWorkspaceStatus.innerText = `${title}を生成しました。`;
        aiOutputEditor.focus();
        aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
        aiWorkspaceStatus.innerText = `共有AI結果の生成に失敗しました: ${error.message}`;
        window.AppToast.error('共有AI結果の生成に失敗しました', { detail: error.message });
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
            window.AppToast.info('まだホストが議事録を生成していません。');
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
                control_token: state.controlToken,
                // Minutes always omits past-meeting context (server enforces
                // this too); we send false explicitly for transparency.
                use_past_context: false
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
        state.editorDirty.minutes = 0; // B1: サーバー由来の新規生成なのでリセット
        minutesOutputEditor.value = resultText;
        minutesWorkspaceStatus.innerText = '議事録を生成しました。必要に応じて内容を整えてください。';
        await loadMeetingInsights({ silent: true });
        minutesOutputEditor.focus();
        minutesOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        minutesWorkspaceStatus.innerText = `議事録生成に失敗しました: ${error.message}`;
        window.AppToast.error('議事録生成に失敗しました', { detail: error.message });
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
        const res = await fetch(withAuthQuery(`/rooms/${state.roomId}/custom-output`));
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
        window.AppToast.warn('自由解析の指示を入力してください。');
        return;
    }

    try {
        if (!String(state.meetingInsights.minutes || '').trim()) {
            window.AppToast.warn('先にホストが議事録を生成してください。');
            return;
        }
        state.aiWorkspace.loading = true;
        state.aiWorkspace.mode = 'custom';
        state.aiWorkspace.title = '自由解析';
        renderAiWorkspace();
        const ctxBox = document.getElementById('use-past-meetings');
        const usePast = ctxBox ? !!ctxBox.checked : true;
        const res = await fetch(`/rooms/${state.roomId}/custom-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instruction,
                participant_id: state.participantId,
                control_token: state.controlToken,
                use_past_context: usePast
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
        window.AppToast.error('自由解析に失敗しました', { detail: error.message });
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
        // The text node itself opens inline edit when clicked. Clicks on the
        // surrounding meta area don't do anything (used to open the modal,
        // but inline edit replaces that flow).
        const textEl = article.querySelector('.text');
        if (textEl && textEl.contains(event.target)) {
            startInlineUtteranceEdit(article, utterance);
        }
    });
    article.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            startInlineUtteranceEdit(article, utterance);
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
        startInlineUtteranceEdit(article, utterance);
    };

    return article;
}

/**
 * Inline edit: turn the .text node of an utterance into a contenteditable
 * region. Save on blur or Enter (Shift+Enter inserts a newline). Esc reverts.
 * Modal-based editing is still available for fallback (right-click / icon).
 */
function startInlineUtteranceEdit(article, utterance) {
    const textEl = article.querySelector('.text');
    if (!textEl || textEl.classList.contains('is-editing')) return;
    const original = utterance.transcript || '';
    textEl.classList.add('is-editing');
    textEl.setAttribute('contenteditable', 'true');
    textEl.setAttribute('spellcheck', 'true');
    textEl.textContent = original;
    textEl.focus();
    // Place caret at end of content.
    try {
        const range = document.createRange();
        range.selectNodeContents(textEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (_) { /* ignore */ }

    let finished = false;
    const cleanup = () => {
        finished = true;
        textEl.classList.remove('is-editing');
        textEl.removeAttribute('contenteditable');
    };

    const commit = async () => {
        if (finished) return;
        const next = (textEl.textContent || '').trim();
        cleanup();
        if (next === original.trim()) {
            // No change → just re-render to restore highlights.
            renderAllLogs();
            return;
        }
        try {
            await updateUtteranceMemory(utterance.id, { transcript: next, transcript_source: 'user' });
        } catch (err) {
            window.AppToast.error('保存に失敗しました', { detail: err && err.message });
        }
    };

    const cancel = () => {
        if (finished) return;
        cleanup();
        textEl.textContent = original;
        renderAllLogs();
    };

    textEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            commit();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
        }
    });
    textEl.addEventListener('blur', () => commit(), { once: true });
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
    // B2: focus 中は DOM を触らない。B3: 同値でも代入しない。
    const nextInstruction = state.aiWorkspace.instruction || '';
    if (document.activeElement !== customAiInstruction && customAiInstruction.value !== nextInstruction) {
        customAiInstruction.value = nextInstruction;
    }
    aiOutputTitle.innerText = state.aiWorkspace.title || '解析結果';
    const nextResult = state.aiWorkspace.result || 'ここに解析結果が表示されます。';
    if (document.activeElement !== aiOutputEditor && aiOutputEditor.value !== nextResult) {
        aiOutputEditor.value = nextResult;
    }
    const isLoading = !!state.aiWorkspace.loading || state.meetingInsights.status === 'processing';
    if (aiOutputCard) aiOutputCard.classList.toggle('is-loading', isLoading);
    if (aiOutputLoading) aiOutputLoading.classList.toggle('hidden', !isLoading);
    aiOutputEditor.classList.toggle('is-busy', isLoading);

    // [L7] 進捗バー更新
    const aiProgressWrap = document.getElementById('ai-progress-wrap');
    const aiProgressBar = document.getElementById('ai-progress-bar');
    const aiLoadingText = document.getElementById('ai-loading-text');
    const aiProg = state.aiWorkspace.progress;
    if (aiProgressWrap && aiProgressBar) {
        if (isLoading && aiProg && aiProg.total > 1) {
            aiProgressWrap.classList.remove('hidden');
            const pct = Math.round(aiProg.completed / aiProg.total * 100);
            aiProgressBar.style.width = `${pct}%`;
            if (aiLoadingText) aiLoadingText.textContent = `${AI_LOADING_TEXT} (${aiProg.completed}/${aiProg.total} チャンク)`;
        } else {
            aiProgressWrap.classList.add('hidden');
            if (aiLoadingText) aiLoadingText.textContent = AI_LOADING_TEXT;
        }
    }

    if (isLoading) {
        aiWorkspaceStatus.innerHTML = `<span class="spinner inline-spinner"></span> ${AI_LOADING_TEXT}`;
        return;
    }

    // progress をリセット（生成完了時）
    if (!isLoading && state.aiWorkspace.progress) {
        state.aiWorkspace.progress = null;
    }
    if (state.aiWorkspace.savedAt) {
        aiWorkspaceStatus.innerText = `保存済み: ${new Date(state.aiWorkspace.savedAt).toLocaleString('ja-JP')}`;
        return;
    }
    renderMeetingInsights();
}

// B5: instruction を省略した場合は既存値を維持。明示的に '' を渡した場合のみクリア。
function setAiWorkspace(mode, title, result, instruction) {
    state.aiWorkspace.mode = mode;
    state.aiWorkspace.title = title;
    state.aiWorkspace.result = result || '';
    if (instruction !== undefined) {
        state.aiWorkspace.instruction = instruction;
        state.editorDirty.aiInstruction = 0; // B1: サーバー由来なのでリセット
    }
    state.aiWorkspace.loading = false;
    state.editorDirty.aiResult = 0; // B1: サーバー由来の結果でリセット
    renderAiWorkspace();
    // Persist to DB so the result survives reload and shows up in
    // /me/rooms/:id history. Best-effort, debounced.
    scheduleAiWorkspacePersist();
}

let aiWorkspacePersistTimer = null;
function scheduleAiWorkspacePersist() {
    if (!state.roomId || !state.controlToken) return;
    if (aiWorkspacePersistTimer) clearTimeout(aiWorkspacePersistTimer);
    aiWorkspacePersistTimer = setTimeout(persistAiWorkspaceNow, 800);
}

async function persistAiWorkspaceNow() {
    if (!state.roomId || !state.controlToken) return;
    if (!state.aiWorkspace.result || !state.aiWorkspace.result.trim()) return;
    try {
        const payload = {
            mode: state.aiWorkspace.mode,
            title: state.aiWorkspace.title,
            instruction: state.aiWorkspace.instruction || '',
            result: state.aiWorkspace.result || '',
            saved_at: new Date().toISOString()
        };
        await fetch(`/rooms/${state.roomId}/ai-workspace`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: state.participantId,
                control_token: state.controlToken,
                payload
            })
        });
    } catch (err) {
        AppDebug.log('warn', 'AI workspace persist failed', err.message);
    }
}

// ----- Meeting title (host editable) -----
let titleSaveTimer = null;
let titleSaveAbort = null;

function getMeetingTitleInputs() {
    const primary = (window.AppDom && window.AppDom.meetingTitleInput) || document.getElementById('meeting-title-input');
    const mobile = (window.AppDom && window.AppDom.mobileMeetingTitleInput) || document.getElementById('mobile-meeting-title-input');
    return [primary, mobile].filter(Boolean);
}

function syncMeetingTitleInputs(value, sourceEl) {
    getMeetingTitleInputs().forEach(el => {
        if (el !== sourceEl && el !== document.activeElement && el.value !== value) {
            el.value = value;
        }
    });
}

function setupMeetingTitle() {
    getMeetingTitleInputs().forEach(input => {
        const flush = () => {
            syncMeetingTitleInputs(input.value, input);
            if (titleSaveTimer) clearTimeout(titleSaveTimer);
            titleSaveTimer = setTimeout(saveMeetingTitle, 600);
        };
        input.addEventListener('input', flush);
        input.addEventListener('blur', () => {
            syncMeetingTitleInputs(input.value, input);
            if (titleSaveTimer) clearTimeout(titleSaveTimer);
            saveMeetingTitle();
        });
    });
}

async function saveMeetingTitle() {
    const inputs = getMeetingTitleInputs();
    const input = inputs[0];
    if (!input || !state.roomId || !state.controlToken) return;
    const title = (input.value || '').trim().slice(0, 200);
    inputs.forEach(el => { el.classList.add('is-saving'); el.classList.remove('is-saved'); });
    try {
        if (titleSaveAbort) titleSaveAbort.abort();
        titleSaveAbort = new AbortController();
        const res = await fetch(`/rooms/${state.roomId}/title`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            signal: titleSaveAbort.signal,
            body: JSON.stringify({
                title,
                participant_id: state.participantId,
                control_token: state.controlToken
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        inputs.forEach(el => { el.classList.remove('is-saving'); el.classList.add('is-saved'); });
        setTimeout(() => inputs.forEach(el => el.classList.remove('is-saved')), 1500);
    } catch (err) {
        if (err.name === 'AbortError') return;
        inputs.forEach(el => el.classList.remove('is-saving'));
        AppDebug.log('warn', 'Title save failed', err.message);
    }
}

function clearInsightsPoll() {
    if (state.meetingInsights.pollTimer) {
        clearTimeout(state.meetingInsights.pollTimer);
        state.meetingInsights.pollTimer = null;
    }
}

/**
 * B1: dirty フラグのヘルパー。
 * key: 'aiResult' | 'aiInstruction' | 'minutes'
 * withinMs: この時間内に編集があれば dirty とみなす (既定 30 秒)
 */
function isEditorDirty(key, withinMs = 30_000) {
    const ts = state.editorDirty[key];
    return ts > 0 && (Date.now() - ts) < withinMs;
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
        window.AppToast.info('コピーできる解析結果がまだありません。');
        return;
    }
    try {
        await navigator.clipboard.writeText(getFormattedAiWorkspaceText());
        aiWorkspaceStatus.innerText = '解析結果をコピーしました。';
    } catch (error) {
        window.AppToast.error('コピーに失敗しました', { detail: error.message });
    }
}

function downloadAiWorkspaceResult() {
    if (!state.aiWorkspace.result.trim()) {
        window.AppToast.info('ダウンロードできる解析結果がまだありません。');
        return;
    }
    downloadTextFile(`ai-workspace-${state.roomId || 'session'}.txt`, getFormattedAiWorkspaceText());
}

async function copyMinutesResult() {
    const result = getFormattedMinutesText().trim();
    if (!result) {
        window.AppToast.info('コピーできる議事録がまだありません。');
        return;
    }
    try {
        await navigator.clipboard.writeText(result);
        minutesWorkspaceStatus.innerText = '議事録をコピーしました。';
    } catch (error) {
        window.AppToast.error('コピーに失敗しました', { detail: error.message });
    }
}

function downloadMinutesResult() {
    const result = getFormattedMinutesText().trim();
    if (!result) {
        window.AppToast.info('ダウンロードできる議事録がまだありません。');
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
            body: JSON.stringify(authedBody(updates))
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
        window.AppToast.error('ログ更新に失敗しました', { detail: error.message });
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
    window.location.href = withAuthQuery(`/rooms/${state.roomId}/download`);
}

function copyRoomId() {
    if (!state.roomId) return;
    const joinUrl = getJoinUrl(state.roomId);
    navigator.clipboard.writeText(joinUrl).then(() => {
        window.AppToast.success('参加URLをコピーしました');
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
        window.AppToast.error('マイクの許可に失敗しました', { detail: error.message });
        return false;
    }
}

async function joinRoom() {
    const displayName = document.getElementById('display-name').value.trim();
    const profileText = document.getElementById('profile-text').value.trim();
    const roomId = document.getElementById('room-id').value.trim().toUpperCase();
    if (!displayName || !roomId) return window.AppToast.warn('表示名とルームIDを入力してください');
    if (!await prepareAudio()) return;
    await joinRoomProcess(roomId, displayName, profileText);
}

async function createRoom() {
    const profileText = document.getElementById('profile-text').value.trim();

    // Host must be logged in. If not, show the login modal first and abort on
    // cancel. After login we fall through with the account's display_name
    // auto-filled so the host doesn't have to re-type their own name.
    let account = window.AppAuth ? window.AppAuth.state.account : null;
    if (!account && window.AppAuth) {
        if (window.AppToast) {
            window.AppToast.info('会議作成にはログインが必要です', { detail: '参加だけならルームIDでゲスト参加できます。' });
        }
        account = await window.AppAuth.requireLogin();
    }
    if (!account) return;

    const displayNameInput = document.getElementById('display-name');
    let displayName = (displayNameInput?.value || '').trim();
    if (!displayName) {
        displayName = account.display_name || (account.email ? account.email.split('@')[0] : 'ホスト');
        if (displayNameInput) displayNameInput.value = displayName;
    }

    if (!await prepareAudio()) return;
    try {
        const res = await fetch('/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({})
        });
        const room = await readApiResponse(res);
        await joinRoomProcess(room.id, displayName, profileText);
    } catch (error) {
        window.AppToast.error('ルーム作成に失敗しました', { detail: error?.message || '' });
    }
}

async function joinRoomProcess(roomId, displayName, profileText = '') {
    try {
        const normalizedRoomId = roomId.trim().toUpperCase();
        const userId = ensureLocalUserId();
        const usePastMeetings = !!document.getElementById('use-past-meetings')?.checked;
        
        // Providers are fixed; overwrite stale browser choices before the
        // room join call so the backend never receives legacy Gemini values.
        state.aiProvider = state.fixedAiProvider || FIXED_AI_PROVIDER;
        state.aiModel = state.fixedAiModel || FIXED_AI_MODEL;
        localStorage.setItem('ai_provider', state.aiProvider);
        localStorage.setItem('ai_model', state.aiModel);
        localStorage.setItem('stt_provider', state.fixedSttProvider || FIXED_STT_PROVIDER);
        localStorage.setItem('use_past_meetings', usePastMeetings ? '1' : '0');
        state.usePastMeetings = usePastMeetings;

        const res = await fetch(`/rooms/${normalizedRoomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send the session cookie if the user is logged in so the server
            // can link participants.user_account_id; anonymous joins still
            // work because attachSessionIfPresent is non-failing.
            credentials: 'same-origin',
            body: JSON.stringify({
                user_id: userId,
                display_name: displayName,
                location_id: 'web-browser',
                profile_text: profileText,
                ai_config: {
                    provider: state.fixedAiProvider || FIXED_AI_PROVIDER,
                    model: state.fixedAiModel || FIXED_AI_MODEL,
                    use_past_meetings: usePastMeetings
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
        window.AppToast.error('ルーム参加に失敗しました');
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
    setFlowProgressStep('meeting');
    roomInfo.innerText = `ルーム: ${state.roomId}`;
    syncMuteUi();
    state.mobileMenuOpen = false;
    // P5-3: PC / モバイル共通で両パネルを初期状態で畳む。
    // 視線をログに集中させ、必要時にトグルで開く運用に統一する。
    state.mobileMemoryCollapsed = true;
    state.mobileAiCollapsed = true;
    renderMobileMeetingControls();
    requestWakeLock();
    // Auto-connect the mic when the user already granted permission. Saves a
    // tap for returning users; new users still see the explicit "マイクON"
    // button and aren't surprised by a permission prompt mid-meeting.
    autoConnectMicIfPermitted().catch((err) => {
        AppDebug.log('info', 'Auto mic connect skipped', err && err.message);
    });
}

async function autoConnectMicIfPermitted() {
    if (!navigator.permissions?.query) return;
    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state !== 'granted') return;
        // Wait briefly for the WebSocket to come up before triggering.
        const tryStart = async (attempt = 0) => {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                await reconnectMic();
                return;
            }
            if (attempt >= 8) return; // ~4s ceiling
            setTimeout(() => tryStart(attempt + 1), 500);
        };
        await tryStart();
    } catch (error) {
        AppDebug.log('info', 'Permission query unavailable for auto-connect', error.message);
    }
}

function showSummaryScreen({ justEnded = false } = {}) {
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
    setFlowProgressStep('summary');
    summaryInfo.innerText = `ルーム: ${state.roomId}`;
    releaseWakeLock();
    switchTab(pickInitialSummaryTab(justEnded));
    loadRoomLogs().then(() => {
        renderAllLogs();
        window.scrollTo({ top: 0, behavior: 'auto' });
        loadMeetingInsights({ silent: true });
    });
    // Build the past-meeting selector UI (host only; idempotent after first call)
    if (state.isHost) {
        window.AppSharedAi?.buildPastMeetingSelector?.();
    }
}

async function loadRoomLogs() {
    if (!state.roomId) return;
    try {
        const res = await fetch(withAuthQuery(`/rooms/${state.roomId}/logs`));
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
    // Backend rejects the upgrade without a matching control_token, so the
    // credential must live in the URL (cookies aren't sent across WS in all
    // browsers consistently).
    const params = new URLSearchParams({
        participantId: state.participantId || '',
        controlToken: state.controlToken || ''
    });
    const wsUrl = `${protocol}//${window.location.host}?${params.toString()}`;
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
        addSystemMessage('サーバーに接続しました。');
        state.ws.send(JSON.stringify({ type: 'hello' }));
        // Send the current mic preset metadata so the server can build the
        // right STT metadata (microphone distance, recording device).
        sendMicPresetMetadataToServer();
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
        } else if (msg.type === 'chunk_progress') {
            // [L6] チャンク進捗イベント
            const { analysis_type, completed, total } = msg;
            if (analysis_type === 'minutes') {
                state.minutesWorkspace.progress = total > 1 ? { completed, total } : null;
                renderMinutesWorkspace();
            } else {
                // summary / todo / custom はすべて AI ワークスペース側
                state.aiWorkspace.progress = total > 1 ? { completed, total } : null;
                renderAiWorkspace();
            }
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

function scrollLogToLatest(container, options = {}) {
    if (!options.force && (state.isWorkingOnLog || state.logAtBottom === false)) return;
    // PC は .conversation-list が overflow:auto で内部スクロール、モバイルは overflow:visible
    // でページ全体がスクロール。後者では viewport 下端の FAB に最新発話が隠れないよう、
    // FAB クリアランス分のオフセットを取って scrollTo する。
    const containerScrolls = container && (container.scrollHeight - container.clientHeight) > 8;
    if (containerScrolls) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        if (state.unreadUtterances) state.unreadUtterances = 0;
        return;
    }
    const FAB_CLEARANCE_PX = 96;
    const lastEl = container && container.lastElementChild;
    if (lastEl && typeof lastEl.getBoundingClientRect === 'function') {
        const rect = lastEl.getBoundingClientRect();
        const targetY = window.scrollY + rect.bottom - window.innerHeight + FAB_CLEARANCE_PX;
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        if (state.unreadUtterances) state.unreadUtterances = 0;
        return;
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    if (state.unreadUtterances) state.unreadUtterances = 0;
}

// ----- Jump Palette (long-press FAB radial menu) -----
// Long-press the "↓ 最新へ移動" FAB to reveal a radial menu with five
// shortcuts so a single thumb can navigate long meeting logs:
//   ★ prev / ★ next / 先頭 / -10min / +10min
// Tap (short press) keeps the original "scroll to latest" behavior.
const JUMP_PALETTE_LONG_PRESS_MS = 320; // P5-6: 500ms → 320ms (「長押し感」が出る最短値)
const JUMP_PALETTE_OFFSET_MS = 10 * 60 * 1000;

const jumpPaletteState = {
    initialized: false,
    isOpen: false,
    pressTimer: null,
    pressedAt: 0,
    longPressFired: false,
    pointerId: null,
    fab: null,
    palette: null,
    scrim: null,
    items: [],
    suppressNextClick: false
};

function vibrateSafe(ms) {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(ms);
        }
    } catch (_) {
        /* haptics are best-effort */
    }
}

function getTimelineContainer() {
    return (window.AppDom && window.AppDom.timeline) || document.getElementById('timeline');
}

// Find the utterance closest to the top of the visible viewport in the
// timeline. Returns the activity item (with .data.timestamp) or null.
function getCurrentVisibleUtterance() {
    const container = getTimelineContainer();
    if (!container) return null;
    const items = container.querySelectorAll('[data-utterance-id]');
    if (!items.length) return null;
    const containerTop = container.getBoundingClientRect().top;
    let best = null;
    let bestDist = Infinity;
    for (const el of items) {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerTop);
        // Prefer first element below the top edge if any are visible
        if (rect.bottom >= containerTop && dist < bestDist) {
            bestDist = dist;
            best = el;
        }
    }
    if (!best) {
        // fallback: nearest by absolute distance from top
        for (const el of items) {
            const rect = el.getBoundingClientRect();
            const dist = Math.abs(rect.top - containerTop);
            if (dist < bestDist) {
                bestDist = dist;
                best = el;
            }
        }
    }
    if (!best) return null;
    const id = best.getAttribute('data-utterance-id');
    return state.activityItems.find((item) => item.type === 'utterance' && item.data.id === id) || null;
}

function jumpToUtteranceId(id) {
    const container = getTimelineContainer();
    if (!container) return false;
    const target = container.querySelector(`[data-utterance-id="${id}"]`);
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
}

function jumpToTimestampOffset(deltaMs) {
    const current = getCurrentVisibleUtterance();
    const utterances = state.activityItems
        .filter((item) => item.type === 'utterance')
        .map((item) => item.data);
    if (!utterances.length) return false;
    const baseTs = current ? new Date(current.timestamp).getTime() : new Date(utterances[0].timestamp).getTime();
    const targetTs = baseTs + deltaMs;
    let best = null;
    let bestDiff = Infinity;
    for (const u of utterances) {
        const ts = new Date(u.timestamp).getTime();
        const diff = Math.abs(ts - targetTs);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = u;
        }
    }
    if (!best) return false;
    return jumpToUtteranceId(best.id);
}

function jumpToStarRelative(direction) {
    const utterances = state.activityItems
        .filter((item) => item.type === 'utterance')
        .map((item) => item.data);
    const stars = utterances.filter((u) => u.is_starred);
    if (!stars.length) return false;
    const current = getCurrentVisibleUtterance();
    const baseTs = current ? new Date(current.timestamp).getTime() : Date.now();
    if (direction === 'prev') {
        const before = stars
            .filter((u) => new Date(u.timestamp).getTime() < baseTs - 1)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const target = before[0] || stars[stars.length - 1];
        return target ? jumpToUtteranceId(target.id) : false;
    }
    const after = stars
        .filter((u) => new Date(u.timestamp).getTime() > baseTs + 1)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const target = after[0] || stars[0];
    return target ? jumpToUtteranceId(target.id) : false;
}

function dispatchJumpAction(action) {
    const container = getTimelineContainer();
    switch (action) {
        case 'top':
            if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
        case 'star-prev':
            return jumpToStarRelative('prev');
        case 'star-next':
            return jumpToStarRelative('next');
        case 'minus-10':
            return jumpToTimestampOffset(-JUMP_PALETTE_OFFSET_MS);
        case 'plus-10':
            return jumpToTimestampOffset(JUMP_PALETTE_OFFSET_MS);
        default:
            return false;
    }
}

function openJumpPalette() {
    if (jumpPaletteState.isOpen || !jumpPaletteState.palette) return;
    jumpPaletteState.isOpen = true;
    jumpPaletteState.palette.classList.add('is-open');
    jumpPaletteState.palette.setAttribute('aria-hidden', 'false');
    if (jumpPaletteState.scrim) jumpPaletteState.scrim.classList.add('is-visible');
    if (jumpPaletteState.fab) jumpPaletteState.fab.setAttribute('aria-expanded', 'true');
    if (jumpPaletteState.wrap) jumpPaletteState.wrap.classList.add('palette-open');
    vibrateSafe(10);
}

function closeJumpPalette() {
    if (!jumpPaletteState.isOpen || !jumpPaletteState.palette) return;
    jumpPaletteState.isOpen = false;
    jumpPaletteState.palette.classList.remove('is-open');
    jumpPaletteState.palette.setAttribute('aria-hidden', 'true');
    if (jumpPaletteState.scrim) jumpPaletteState.scrim.classList.remove('is-visible');
    if (jumpPaletteState.fab) jumpPaletteState.fab.setAttribute('aria-expanded', 'false');
    if (jumpPaletteState.wrap) jumpPaletteState.wrap.classList.remove('palette-open');
}

function clearLongPressTimer() {
    if (jumpPaletteState.pressTimer) {
        clearTimeout(jumpPaletteState.pressTimer);
        jumpPaletteState.pressTimer = null;
    }
}

function setupJumpPalette() {
    if (jumpPaletteState.initialized) return;
    const fab = (window.AppDom && window.AppDom.btnJumpLatestFloating)
        || document.getElementById('btn-jump-latest-floating');
    const palette = document.getElementById('jump-palette');
    if (!fab || !palette) return;

    // Insert a full-screen scrim that captures taps to close the palette.
    // IMPORTANT: append inside #app, not body. #app has backdrop-filter which
    // creates a stacking context (z-index: auto). Appending the scrim to body
    // would place it at z-index 999 in the ROOT context, above #app's entire
    // stacking context and swallowing all taps on palette items inside #app.
    let scrim = document.querySelector('.jump-palette-scrim');
    if (!scrim) {
        scrim = document.createElement('div');
        scrim.className = 'jump-palette-scrim';
        scrim.setAttribute('aria-hidden', 'true');
        (document.getElementById('app') || document.body).appendChild(scrim);
    }

    const wrap = fab.closest('.jump-fab-wrap');

    jumpPaletteState.fab = fab;
    jumpPaletteState.wrap = wrap;
    jumpPaletteState.palette = palette;
    jumpPaletteState.scrim = scrim;
    jumpPaletteState.items = Array.from(palette.querySelectorAll('.jump-palette-item'));
    jumpPaletteState.initialized = true;

    fab.setAttribute('aria-expanded', 'false');

    const startPress = (event) => {
        if (jumpPaletteState.isOpen) return;
        // Only react to primary pointer (left click / first touch)
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        jumpPaletteState.pointerId = event.pointerId;
        jumpPaletteState.pressedAt = Date.now();
        jumpPaletteState.longPressFired = false;
        fab.classList.add('is-pressing');
        clearLongPressTimer();
        jumpPaletteState.pressTimer = setTimeout(() => {
            jumpPaletteState.longPressFired = true;
            jumpPaletteState.suppressNextClick = true;
            fab.classList.remove('is-pressing');
            openJumpPalette();
        }, JUMP_PALETTE_LONG_PRESS_MS);
    };

    const endPress = () => {
        clearLongPressTimer();
        fab.classList.remove('is-pressing');
        jumpPaletteState.pointerId = null;
    };

    const cancelPress = () => {
        clearLongPressTimer();
        fab.classList.remove('is-pressing');
        jumpPaletteState.pointerId = null;
    };

    fab.addEventListener('pointerdown', startPress);
    fab.addEventListener('pointerup', endPress);
    fab.addEventListener('pointerleave', cancelPress);
    fab.addEventListener('pointercancel', cancelPress);
    fab.addEventListener('pointermove', (event) => {
        if (jumpPaletteState.pointerId !== event.pointerId) return;
        // Generous slop - cancel if the finger drifts more than ~12px
        const target = fab.getBoundingClientRect();
        const cx = target.left + target.width / 2;
        const cy = target.top + target.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        if (Math.hypot(dx, dy) > Math.max(target.width, target.height) * 0.9) {
            cancelPress();
        }
    });

    // Suppress the synthetic click that fires when long-press opened the palette.
    fab.addEventListener('click', (event) => {
        if (jumpPaletteState.suppressNextClick || jumpPaletteState.longPressFired) {
            event.preventDefault();
            event.stopImmediatePropagation();
            jumpPaletteState.suppressNextClick = false;
            jumpPaletteState.longPressFired = false;
        }
    }, true);

    // Keyboard accessibility: Enter/Space short-tap = scroll latest (handled
    // by existing click binding); Alt+Down opens palette.
    fab.addEventListener('keydown', (event) => {
        if ((event.altKey && event.key === 'ArrowDown') || event.key === 'ContextMenu') {
            event.preventDefault();
            openJumpPalette();
            // Move focus to first item for keyboard users
            const first = jumpPaletteState.items[0];
            if (first) first.focus();
        }
    });

    // Wire palette item taps
    jumpPaletteState.items.forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = item.dataset.jump;
            vibrateSafe(6);
            const ok = dispatchJumpAction(action);
            if (!ok) {
                item.classList.add('is-disabled');
                setTimeout(() => item.classList.remove('is-disabled'), 600);
            }
            closeJumpPalette();
        });
    });

    // Scrim closes the palette
    scrim.addEventListener('click', () => closeJumpPalette());
    scrim.addEventListener('pointerdown', (event) => {
        // Prevent scroll start on touch when scrim is up
        event.preventDefault();
    });

    // Esc closes the palette
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && jumpPaletteState.isOpen) {
            closeJumpPalette();
            fab.focus();
        }
    });

    // Hide palette when FAB itself becomes hidden (e.g., user scrolled to bottom)
    const observer = new MutationObserver(() => {
        if (fab.classList.contains('hidden') && jumpPaletteState.isOpen) {
            closeJumpPalette();
        }
    });
    observer.observe(fab, { attributes: true, attributeFilter: ['class'] });
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
        // VAD parameters now come from the active mic preset (mic-presets.js)
        // so far-field tabletop mode loosens to catch faint distant voices,
        // while close-mic modes stay strict to filter coughs/keystrokes.
        // Each ScriptProcessor frame is 4096 samples (~85 ms at 48 kHz).
        const presetCfg = (typeof getMicPresetConfig === 'function' ? getMicPresetConfig() : null) || {};
        const presetVad = presetCfg.vad || {};
        const ATTACK_FRAMES     = Number.isFinite(presetVad.attackFrames)    ? presetVad.attackFrames    : 1;
        const MIN_ACTIVE_FRAMES = Number.isFinite(presetVad.minActiveFrames) ? presetVad.minActiveFrames : 1;
        const CREST_MIN         = Number.isFinite(presetVad.crestMin)        ? presetVad.crestMin        : 1.0;
        const CREST_MAX         = Number.isFinite(presetVad.crestMax)        ? presetVad.crestMax        : 30;
        if (typeof state.voiceGate.activeFrames !== 'number') state.voiceGate.activeFrames = 0;
        if (typeof state.voiceGate.attackCounter !== 'number') state.voiceGate.attackCounter = 0;

        processor.onaudioprocess = (event) => {
            if (state.isMuted || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
            const inputData = event.inputBuffer.getChannelData(0);
            const clippedInput = new Float32Array(inputData.length);
            const maxThreshold = Math.max(0.05, state.voiceGate.maxThreshold);
            let energy = 0;
            let peak = 0;
            for (let i = 0; i < inputData.length; i += 1) {
                const sample = Math.max(-maxThreshold, Math.min(maxThreshold, inputData[i]));
                clippedInput[i] = sample / maxThreshold;
                const a = Math.abs(clippedInput[i]);
                if (a > peak) peak = a;
                energy += clippedInput[i] * clippedInput[i];
            }
            const rms = Math.sqrt(energy / clippedInput.length);
            const gate = state.voiceGate;

            // Crest = peak / RMS. Speech sits roughly 1.5–8; pure white
            // noise hugs ~1.0; transient clicks are >15. Distant tabletop
            // audio compresses crest (CREST_MIN ~1.05 in large_group).
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

            // Drop the first frames of an utterance only when MIN_ACTIVE_FRAMES > 1
            // (close-mic modes that want to suppress short transients).
            if (MIN_ACTIVE_FRAMES > 1 && gate.activeFrames < MIN_ACTIVE_FRAMES) return;

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
        // Just-ended path: jump to 議事録 tab so the auto-generated minutes
        // are front-and-center while the user wraps up.
        showSummaryScreen({ justEnded: true });
    } catch (error) {
        window.AppToast.error('終了処理に失敗しました', { detail: error.message });
    }
}

async function checkApiStatus() {
    const container = document.getElementById('api-status-container');
    if (!container) return;
    try {
        const res = await fetch('/api/status');
        const status = await readApiResponse(res);

        // Provider selection is fixed. The status card should confirm the
        // locked operational choice, not imply the user can override it from
        // profile settings or localStorage.
        const sttModelDisplay = state.fixedSttRealtimeModel || 'scribe_v2_realtime';
        const sttLangDisplay = status.stt_language || 'ja';
        const sttProviderLabel = 'ELEVENLABS SCRIBE (固定)';
        const sttOk = !!status.speech_to_text;

        const dictWords = Number.isFinite(status.stt_dictionary_words) ? status.stt_dictionary_words : 0;
        const boostCap = Number.isFinite(status.stt_boost_cap) ? status.stt_boost_cap : 100;
        const boostSummary = dictWords <= boostCap
            ? `辞書 ${dictWords}語 (全件をブーストに送信)`
            : `辞書 ${dictWords}語 (会議ごとに上位 ${boostCap}語をブーストに送信)`;
        const aiProvider = 'GROQ (固定)';
        const secureOk = isSecureContextForMedia();
        const lines = [
            `<strong>音声認識:</strong> ${sttOk ? '✅' : '⚠️'} ${sttProviderLabel} / モデル ${sttModelDisplay} / 言語 ${sttLangDisplay}`,
            `<strong>ブースト単語:</strong> ${boostSummary}`,
            `<strong>AI:</strong> ${aiProvider} / モデル ${state.fixedAiModel || FIXED_AI_MODEL}`,
            `<strong>HTTPS:</strong> ${secureOk ? 'OK' : '⚠️ HTTPS が必要です'}`
        ];
        container.innerHTML = `<div class="system-message api-status-block">${lines.join('<br>')}</div>`;
    } catch (error) {
        container.innerHTML = '<p>ステータス確認に失敗しました。</p>';
    }
}
// profile.js の applySettings から呼び出せるよう公開する
window._refreshApiStatus = () => checkApiStatus();

function initializeSetupUi() {
    ensureLocalUserId();
    const savedDisplayName = localStorage.getItem('display_name');
    const savedProfileText = localStorage.getItem('profile_text');
    const savedSensitivity = localStorage.getItem('mic_sensitivity');
    const savedMicPreset = localStorage.getItem('mic_preset');
    const savedUsePastMeetings = localStorage.getItem('use_past_meetings');
    const savedMinThreshold = Number(localStorage.getItem('mic_threshold_min'));
    const savedMaxThreshold = Number(localStorage.getItem('mic_threshold_max'));
    
    if (savedDisplayName) document.getElementById('display-name').value = savedDisplayName;
    if (savedProfileText) document.getElementById('profile-text').value = savedProfileText;
    if (savedUsePastMeetings != null) {
        state.usePastMeetings = savedUsePastMeetings !== '0';
    }
    const usePastCheckbox = document.getElementById('use-past-meetings');
    if (usePastCheckbox) {
        usePastCheckbox.checked = state.usePastMeetings;
    }
    
    // Ignore stale provider choices saved before provider locking. The setup
    // screen still contains a disabled select for visibility, so keep that
    // DOM control synchronized with the fixed Groq model.
    state.aiProvider = state.fixedAiProvider || FIXED_AI_PROVIDER;
    state.aiModel = state.fixedAiModel || FIXED_AI_MODEL;
    try {
        localStorage.setItem('ai_provider', state.aiProvider);
        localStorage.setItem('ai_model', state.aiModel);
        localStorage.setItem('stt_provider', state.fixedSttProvider || FIXED_STT_PROVIDER);
    } catch (_) { /* ignore */ }
    if (window.AppDom.aiProvider) window.AppDom.aiProvider.value = state.aiProvider;
    if (window.AppDom.aiModelInput) {
        window.AppDom.aiModelInput.value = state.aiModel;
    }

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
    window.AppAudio.renderMicPresetUi();
    window.AppAudio.updateMuteButton();
    window.AppLogUi.syncFilterControls();
    window.AppLogUi.renderAllLogs();
    window.AppSharedAi.renderAiWorkspace();
    window.AppSharedAi.renderMeetingInsights();
    window.AppSharedAi.renderMeetingAnalysis();
    window.AppSharedAi.renderMinutesWorkspace();
    window.AppMeetingUi.renderMobileMeetingControls();
    window.AppMeetingUi.renderSummaryMobileControls();
}

window.AppMain = {
    AppDebug,
    withAuthQuery,
    authedBody,
    ensureLocalUserId,
    setFlowProgressStep,
    createRoom: (...args) => window.AppMeetingUi.createRoom(...args),
    joinRoom: (...args) => window.AppMeetingUi.joinRoom(...args),
    endRoom: (...args) => window.AppMeetingUi.endRoom(...args),
    toggleMute: (...args) => window.AppAudio.toggleMute(...args),
    reconnectMic: (...args) => window.AppAudio.reconnectMic(...args),
    toggleMobileMeetingMenu: (...args) => window.AppMeetingUi.toggleMobileMeetingMenu(...args),
    toggleMobileMemoryPanel: (...args) => window.AppMeetingUi.toggleMobileMemoryPanel(...args),
    toggleMobileAiPanel: (...args) => window.AppMeetingUi.toggleMobileAiPanel(...args),
    toggleLiveFocus: (...args) => window.AppMeetingUi.toggleLiveFocus(...args),
    switchMeetingView: (...args) => window.AppMeetingUi.switchMeetingView(...args),
    toggleSummaryMobileMenu: (...args) => window.AppMeetingUi.toggleSummaryMobileMenu(...args),
    toggleSummaryStats: (...args) => window.AppMeetingUi.toggleSummaryStats(...args),
    toggleSummarySidebar: (...args) => window.AppMeetingUi.toggleSummarySidebar(...args),
    toggleSummaryAiControls: (...args) => window.AppMeetingUi.toggleSummaryAiControls(...args),
    copyRoomId: (...args) => window.AppMeetingUi.copyRoomId(...args),
    downloadMinutes: (...args) => window.AppMeetingUi.downloadMinutes(...args),
    addMemo: (...args) => window.AppMeetingUi.addMemo(...args),
    scrollLogToLatest: (...args) => window.AppLogUi.scrollLogToLatest(...args),
    switchTab: (...args) => window.AppMeetingUi.switchTab(...args),
    copyAiWorkspaceResult: (...args) => window.AppSharedAi.copyAiWorkspaceResult(...args),
    downloadAiWorkspaceResult: (...args) => window.AppSharedAi.downloadAiWorkspaceResult(...args),
    runMinutesGeneration: (...args) => window.AppSharedAi.runMinutesGeneration(...args),
    copyMinutesResult: (...args) => window.AppSharedAi.copyMinutesResult(...args),
    downloadMinutesResult: (...args) => window.AppSharedAi.downloadMinutesResult(...args),
    runSummaryInsights: (...args) => window.AppSharedAi.runSummaryInsights(...args),
    runActionInsights: (...args) => window.AppSharedAi.runActionInsights(...args),
    generateCustomAiResult: (...args) => window.AppSharedAi.generateCustomAiResult(...args),
    runMicCheck: (...args) => window.AppAudio.runMicCheck(...args),
    scrollToPageEdge: (...args) => window.AppMeetingUi.scrollToPageEdge(...args),
    clearSearch: (...args) => window.AppLogUi.clearSearch(...args),
    closeTranscriptModal: (...args) => window.AppLogUi.closeTranscriptModal(...args),
    saveTranscriptFromModal: (...args) => window.AppLogUi.saveTranscriptFromModal(...args),
    closeMemoModal: (...args) => window.AppLogUi.closeMemoModal(...args),
    saveMemoFromModal: (...args) => window.AppLogUi.saveMemoFromModal(...args),
    setMicSensitivity: (...args) => window.AppAudio.setMicSensitivity(...args),
    applyMicPreset: (...args) => window.AppAudio.applyMicPreset(...args),
    syncMicThresholdsFromUi: (...args) => window.AppAudio.syncMicThresholdsFromUi(...args),
    runMeetingAnalysis: (...args) => window.AppSharedAi.runMeetingAnalysis(...args),
    syncFilterControls: (...args) => window.AppLogUi.syncFilterControls(...args),
    renderAllLogs: (...args) => window.AppLogUi.renderAllLogs(...args),
    addDictionaryTerm: (...args) => window.AppDictionary.addDictionaryTerm(...args),
    deleteDictionaryTerm: (...args) => window.AppDictionary.deleteDictionaryTerm(...args),
    extractTermsFromText: (...args) => window.AppDictionary.extractTermsFromText(...args),
    addSelectedTerms: (...args) => window.AppDictionary.addSelectedTerms(...args),
    guessReadingForInput: (...args) => window.AppDictionary.guessReadingForInput(...args),
    handleCreateRoom: (...args) => window.AppMeetingUi.createRoom(...args),
    handleJoinRoom: (...args) => window.AppMeetingUi.joinRoom(...args),
    handleEndRoom: (...args) => window.AppMeetingUi.endRoom(...args),
    handleToggleMute: (...args) => window.AppAudio.toggleMute(...args),
    handleReconnectMic: (...args) => window.AppAudio.reconnectMic(...args),
    handleRunMinutesGeneration: (...args) => window.AppSharedAi.runMinutesGeneration(...args),
    handleGenerateCustomAiResult: (...args) => window.AppSharedAi.generateCustomAiResult(...args),
    handleRunMicCheck: (...args) => window.AppAudio.runMicCheck(...args),
    handleAddDictionaryTerm: (...args) => window.AppDictionary.addDictionaryTerm(...args),
    handleExtractTermsFromText: (...args) => window.AppDictionary.extractTermsFromText(...args),
    handleAddSelectedTerms: (...args) => window.AppDictionary.addSelectedTerms(...args),
    handleGuessReadingForInput: (...args) => window.AppDictionary.guessReadingForInput(...args)
};

bindAppEvents(window.AppMain);

// ----- Welcome screen routing ------------------------------------------
// Onboarding flow (post-merge of welcome+login):
//   welcome [3 buttons + inline form] → setup → meeting → summary
// Share-URL visitors (?room=XXX) bypass welcome entirely.
function getScreenSection(id) {
    return document.getElementById(id);
}

function setFlowProgressStep(step) {
    const flow = document.getElementById('flow-progress');
    if (flow) flow.setAttribute('data-step', step);
}

function notifySetupModeChanged() {
    window.dispatchEvent(new Event('app:setup-mode-changed'));
}

function setSetupMode(mode = 'host', options = {}) {
    const isJoinMode = mode === 'join';
    const roomId = String(options.roomId || '').trim().toUpperCase();
    document.body.classList.toggle('participant-mode', isJoinMode);
    document.body.classList.toggle('participant-share-mode', isJoinMode && !!options.fromShare && !!roomId);

    const roomIdInput = document.getElementById('room-id');
    if (roomIdInput && roomId) roomIdInput.value = roomId;
    if (roomIdInput && !isJoinMode) roomIdInput.readOnly = false;

    const titleEl = document.getElementById('setup-screen-title');
    if (titleEl) titleEl.textContent = isJoinMode ? '会議に参加する' : '会議を作成する';

    const banner = document.getElementById('participant-mode-banner');
    const roomLabel = document.getElementById('participant-mode-room-label');
    if (banner) banner.classList.toggle('visible', isJoinMode);
    if (roomLabel) {
        roomLabel.textContent = roomId
            ? `招待ルーム ${roomId} に参加します。任意ログインで履歴にも保存できます。`
            : '共有されたルームIDを入力して参加します。ログインなしでも入れます。';
    }

    notifySetupModeChanged();
}

function activateOnlySection(idToActivate) {
    const ids = ['welcome-screen', 'setup-screen', 'meeting-screen', 'summary-screen'];
    ids.forEach((id) => {
        const el = getScreenSection(id);
        if (!el) return;
        if (id === idToActivate) el.classList.add('active');
        else el.classList.remove('active');
    });
    // Sync the topbar progress dots.
    const stepMap = {
        'welcome-screen': 'welcome',
        'setup-screen': 'setup',
        'meeting-screen': 'meeting',
        'summary-screen': 'summary'
    };
    setFlowProgressStep(stepMap[idToActivate] || 'welcome');
}

function showWelcomeScreen() {
    document.body.classList.remove('meeting-mode', 'summary-mode');
    document.body.classList.add('setup-mode');
    setSetupMode('host');
    activateOnlySection('welcome-screen');
    // Always reset to the 3-button view when re-entering welcome.
    setWelcomeFormVisible(false);
}

function showSetupScreenActive() {
    document.body.classList.remove('meeting-mode', 'summary-mode');
    document.body.classList.add('setup-mode');
    activateOnlySection('setup-screen');
    // Kick the silent auto mic-check. We only act if permission is already
    // granted; otherwise we leave the (hidden) "再確認" button alone and
    // wait for the user to interact via the existing presets.
    autoStartMicCheckOnSetup().catch((err) => {
        AppDebug.log('info', 'Auto mic check skipped', err && err.message);
    });
    // Re-hydrate display name from account every time setup is shown so that
    // (a) returning after a meeting picks up the latest account name, and
    // (b) profile-page edits are reflected immediately on next visit.
    if (window.AppProfile?.hydrateSetupProfile) {
        window.AppProfile.hydrateSetupProfile().catch(() => { /* ignore */ });
    }
}

let autoMicCheckRan = false;
async function autoStartMicCheckOnSetup() {
    if (autoMicCheckRan) return;
    if (!navigator.permissions?.query) return;
    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state !== 'granted') return;
        autoMicCheckRan = true;
        const ok = await prepareAudio({ updateStatus: false });
        if (!ok) {
            // Show the fallback "再確認" button so the user can retry.
            const retryBtn = document.getElementById('btn-mic-check');
            if (retryBtn) retryBtn.removeAttribute('hidden');
        } else {
            updateMicStatus('マイクを自動で確認中です。緑の帯が動けば入力できています。');
        }
    } catch (error) {
        AppDebug.log('info', 'autoStartMicCheckOnSetup failed', error && error.message);
        const retryBtn = document.getElementById('btn-mic-check');
        if (retryBtn) retryBtn.removeAttribute('hidden');
    }
}

let welcomeFormMode = 'login';
let welcomeAuthIntent = 'create';
function setWelcomeFormVisible(visible, mode = welcomeFormMode) {
    const actions = document.getElementById('welcome-actions');
    const form = document.getElementById('welcome-auth-form');
    const pending = document.getElementById('welcome-pending');
    const title = document.getElementById('welcome-form-title');
    const submit = document.getElementById('welcome-form-submit');
    const nameField = document.getElementById('welcome-name-field');
    const pwInput = document.getElementById('welcome-password');
    const errBox = document.getElementById('welcome-error');
    welcomeFormMode = mode === 'signup' ? 'signup' : 'login';
    if (title) {
        title.textContent = welcomeFormMode === 'signup'
            ? '新規登録'
            : (welcomeAuthIntent === 'create' ? 'ログインして会議を作成' : 'ログイン');
    }
    if (submit) submit.textContent = welcomeFormMode === 'signup' ? '登録する' : 'ログイン';
    if (nameField) {
        if (welcomeFormMode === 'signup') nameField.removeAttribute('hidden');
        else nameField.setAttribute('hidden', '');
    }
    const consentRow = document.getElementById('welcome-consent-row');
    if (consentRow) {
        if (welcomeFormMode === 'signup') consentRow.removeAttribute('hidden');
        else consentRow.setAttribute('hidden', '');
    }
    if (pwInput) {
        pwInput.setAttribute('autocomplete', welcomeFormMode === 'signup' ? 'new-password' : 'current-password');
    }
    if (errBox) errBox.textContent = '';
    if (visible) {
        if (actions) actions.setAttribute('hidden', '');
        if (pending) pending.setAttribute('hidden', '');
        if (form) {
            form.removeAttribute('hidden');
            const emailInput = document.getElementById('welcome-email');
            if (emailInput) {
                // P5-7: 前回のメールアドレスを prefill (パスワードは毎回入力)。
                if (!emailInput.value) {
                    const lastEmail = localStorage.getItem('welcome_last_email');
                    if (lastEmail) emailInput.value = lastEmail;
                }
                try { emailInput.focus(); } catch (_) { /* ignore */ }
            }
        }
    } else {
        if (actions) actions.removeAttribute('hidden');
        if (form) form.setAttribute('hidden', '');
        if (pending) pending.setAttribute('hidden', '');
        welcomeAuthIntent = 'create';
    }
}

function showWelcomePending(message, kind) {
    const actions = document.getElementById('welcome-actions');
    const form = document.getElementById('welcome-auth-form');
    const pending = document.getElementById('welcome-pending');
    const titleEl = document.getElementById('welcome-pending-title');
    const messageEl = document.getElementById('welcome-pending-message');
    if (actions) actions.setAttribute('hidden', '');
    if (form) form.setAttribute('hidden', '');
    // kind: 'admin_approval' (既定) or 'email_verification'
    // バックエンドの /auth/signup レスポンスから pending_kind を受け取る。
    const isEmail = kind === 'email_verification';
    if (titleEl) {
        titleEl.textContent = isEmail ? '確認メールを送信しました' : '登録ありがとうございます';
    }
    if (messageEl) {
        messageEl.textContent = message || (isEmail
            ? 'メール内のリンクを開くと登録が進みます。'
            : '管理者の承認待ちです。承認されるとログインできるようになります。');
    }
    if (pending) {
        pending.removeAttribute('hidden');
        const joinBtn = document.getElementById('welcome-pending-join');
        try { (joinBtn || pending).focus(); } catch (_) { /* ignore */ }
    }
}

function setupOnboardingScreens() {
    const createBtn = document.getElementById('welcome-btn-guest');
    const joinBtn = document.getElementById('welcome-btn-login');
    const signupBtn = document.getElementById('welcome-btn-signup');
    const form = document.getElementById('welcome-auth-form');
    const submitBtn = document.getElementById('welcome-form-submit');
    const backBtn = document.getElementById('welcome-form-back');
    const errBox = document.getElementById('welcome-error');
    const pendingJoinBtn = document.getElementById('welcome-pending-join');
    const pendingLoginBtn = document.getElementById('welcome-pending-login');

    if (createBtn) {
        createBtn.addEventListener('click', () => {
            if (window.AppAuth?.state?.account) {
                setSetupMode('host');
                showSetupScreenActive();
                return;
            }
            welcomeAuthIntent = 'create';
            setWelcomeFormVisible(true, 'login');
        });
    }
    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            setSetupMode('join');
            showSetupScreenActive();
            const roomIdInput = document.getElementById('room-id');
            try { roomIdInput?.focus(); } catch (_) { /* ignore */ }
        });
    }
    if (signupBtn) {
        signupBtn.addEventListener('click', () => {
            welcomeAuthIntent = 'create';
            setWelcomeFormVisible(true, 'signup');
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', () => setWelcomeFormVisible(false));
    }
    if (pendingJoinBtn) {
        pendingJoinBtn.addEventListener('click', () => {
            setSetupMode('join');
            showSetupScreenActive();
            const roomIdInput = document.getElementById('room-id');
            try { roomIdInput?.focus(); } catch (_) { /* ignore */ }
        });
    }
    if (pendingLoginBtn) {
        pendingLoginBtn.addEventListener('click', () => {
            welcomeAuthIntent = 'create';
            setWelcomeFormVisible(true, 'login');
        });
    }
    if (form) {
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            if (!window.AppAuth) return;
            if (errBox) errBox.textContent = '';
            const emailInput = document.getElementById('welcome-email');
            const pwInput = document.getElementById('welcome-password');
            const nameInput = document.getElementById('welcome-name');
            const email = (emailInput && emailInput.value || '').trim();
            const password = (pwInput && pwInput.value) || '';
            const displayName = (nameInput && nameInput.value || '').trim();
            if (submitBtn) submitBtn.disabled = true;
            try {
                if (welcomeFormMode === 'signup') {
                    const consentCheckbox = document.getElementById('welcome-consent-checkbox');
                    if (!consentCheckbox || !consentCheckbox.checked) {
                        if (window.AppToast) window.AppToast.warn('利用規約とプライバシーポリシーに同意してください');
                        if (submitBtn) submitBtn.disabled = false;
                        return;
                    }
                    const result = await window.AppAuth.signup(email, password, displayName);
                    if (result && result.pending) {
                        if (email) localStorage.setItem('welcome_last_email', email);
                        // バックエンドが pending_kind ('admin_approval' or 'email_verification')
                        // を返すので、文言を切替える
                        showWelcomePending(result.message, result.pending_kind);
                        return;
                    }
                } else {
                    await window.AppAuth.login(email, password);
                }
                // P5-7: 成功したメールアドレスを次回のために保存。
                if (email) localStorage.setItem('welcome_last_email', email);
                setSetupMode('host');
                showSetupScreenActive();
            } catch (err) {
                if (errBox) errBox.textContent = (err && err.message) || '処理に失敗しました';
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
}

// Decide which screen the user lands on after auth state is known.
function resolveInitialScreen() {
    const params = new URLSearchParams(window.location.search);
    const hasRoomParam = !!(params.get('room') || params.get('roomId'));
    // Share URL: skip onboarding, go straight to participant setup.
    if (hasRoomParam) {
        applyParticipantModeFromUrl();
        showSetupScreenActive();
        return;
    }
    // Already logged in: skip welcome.
    if (window.AppAuth && window.AppAuth.state && window.AppAuth.state.account) {
        setSetupMode('host');
        showSetupScreenActive();
        return;
    }
    showWelcomeScreen();
}

// ----- Participant-join mode (URL ?room=XXX) -----
// When the page is opened via a share link we switch the setup screen to a
// simplified "join meeting" view: host-only controls (AI config, dictionary,
// create-room button) are hidden via the .participant-mode body class, and
// the room id field is pre-filled so the user only has to type a display
// name. Host flow is unaffected.
function applyParticipantModeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = (params.get('room') || params.get('roomId') || '').toUpperCase();
    if (!roomParam) return;

    setSetupMode('join', { roomId: roomParam, fromShare: true });

    // P5-2: display-name を自動補完。
    // 表示名はアカウント名と独立した会議用の名前のため、localStorage のみ参照する。
    const displayNameInput = document.getElementById('display-name');
    if (displayNameInput && !displayNameInput.value) {
        const storedName = localStorage.getItem('display_name') || '';
        if (storedName) displayNameInput.value = storedName;
    }

    notifySetupModeChanged();
}

async function initAuthAndRender() {
    if (!window.AppAuth) return;
    try {
        await window.AppAuth.init();
        if (window.AppProfile?.hydrateSetupProfile) {
            await window.AppProfile.hydrateSetupProfile();
        }
    } catch (err) {
        console.error('[auth init]', err);
    }
}

async function bootstrap() {
    initializeSetupUi();
    // app:profile-updated はプロフィールページの保存後に発火する。
    // アカウント名 (display_name) と会議用表示名は別管理のため、
    // ここでは profile_text (AI プロンプト用) のみを同期する。
    window.addEventListener('app:profile-updated', (event) => {
        const profile = event.detail || {};
        const profileInput = document.getElementById('profile-text');
        if (profileInput && typeof profile.profile_text === 'string') {
            profileInput.value = profile.profile_text;
            localStorage.setItem('profile_text', profile.profile_text);
        }
    });
    setupOnboardingScreens();
    // B2: blur 時に再 render して focus 中にスキップした分を反映する。
    if (aiOutputEditor) aiOutputEditor.addEventListener('blur', renderAiWorkspace);
    if (customAiInstruction) customAiInstruction.addEventListener('blur', renderAiWorkspace);
    if (minutesOutputEditor) minutesOutputEditor.addEventListener('blur', renderMinutesWorkspace);
    // Paint welcome immediately so the page is never blank while /auth/me
    // is in flight. After auth resolves we re-route ONLY if the user is
    // still on the welcome screen (i.e. they haven't tapped through yet).
    resolveInitialScreen();
    await initAuthAndRender();
    notifySetupModeChanged();
    const welcomeEl = document.getElementById('welcome-screen');
    if (welcomeEl && welcomeEl.classList.contains('active')) {
        resolveInitialScreen();
    }
    refreshHomeButtonHint();
    if (window.AppAuth?.onChange) {
        window.AppAuth.onChange(refreshHomeButtonHint);
        // ログイン/アカウント切り替え時に profile_text を #profile-text へ同期。
        // 表示名 (#display-name) はアカウント名と独立しているため触れない。
        window.AppAuth.onChange((account) => {
            notifySetupModeChanged();
            if (account && window.AppProfile?.hydrateSetupProfile) {
                window.AppProfile.hydrateSetupProfile().catch(() => { /* ignore */ });
            }
            populateSeriesPicker(account);
        });
    }
    setupGlobalModalEscape();
    setupTapCounter();
    checkApiStatus();
    syncMicrophonePermissionState();
    loadDictionary();
    setupJumpPalette();
    setupMeetingTitle();
}

async function populateSeriesPicker(account) {
    const picker = document.getElementById('series-picker');
    const select = document.getElementById('series-id');
    if (!picker || !select) return;
    if (!account) {
        picker.style.display = 'none';
        select.innerHTML = '<option value="">なし</option>';
        return;
    }
    picker.style.display = '';
    try {
        const res = await fetch('/me/series', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.series) ? data.series : [];
        const prev = select.value;
        select.innerHTML = '<option value="">なし</option>';
        list.forEach((s) => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            if (s.id === prev) opt.selected = true;
            select.appendChild(opt);
        });
    } catch (_) {}
}

function refreshHomeButtonHint() {
    const hint = document.getElementById('btn-home-hint');
    if (!hint) return;
    const loggedIn = !!(window.AppAuth && window.AppAuth.state && window.AppAuth.state.account);
    if (loggedIn) hint.removeAttribute('hidden');
    else hint.setAttribute('hidden', '');
}

// Lightweight tap counter for UX measurement. Captures every click /
// pointerdown the user makes against the app, tagged with the current
// screen so we can compare tap counts per journey before/after changes.
// Browse via:
//   window.__tap_log              // raw events
//   window.__tap_log_summary()    // counts grouped by step
//   window.__tap_log_reset()      // clear
function setupTapCounter() {
    if (window.__tap_log) return; // idempotent
    window.__tap_log = [];
    function currentStep() {
        const flow = document.getElementById('flow-progress');
        return flow?.getAttribute('data-step') || 'unknown';
    }
    function describe(target) {
        if (!(target instanceof Element)) return '';
        const tag = target.tagName.toLowerCase();
        const id = target.id ? `#${target.id}` : '';
        const cls = (target.className && typeof target.className === 'string')
            ? `.${target.className.split(/\s+/).slice(0, 2).join('.')}`
            : '';
        return `${tag}${id}${cls}`;
    }
    document.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        // Only count interactive surfaces (buttons / inputs / links / role=button).
        const el = event.target.closest('button, a, input[type="button"], input[type="submit"], [role="button"], [data-jump], [data-mic-preset]');
        if (!el) return;
        window.__tap_log.push({
            t: Date.now(),
            step: currentStep(),
            target: describe(el),
            label: (el.textContent || '').trim().slice(0, 40)
        });
    }, true);
    window.__tap_log_summary = () => {
        const out = {};
        for (const ev of window.__tap_log) {
            out[ev.step] = (out[ev.step] || 0) + 1;
        }
        return out;
    };
    window.__tap_log_reset = () => {
        window.__tap_log.length = 0;
    };
}

// Global Escape handler — closes whichever modal/overlay is currently open
// without each one having to register its own listener. Keeps behavior
// consistent across edit-modal / memo-modal / auth-modal / profile.
function setupGlobalModalEscape() {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        // Profile / auth modals (built dynamically) — overlay class.
        const overlay = document.querySelector('.auth-modal-overlay');
        if (overlay && overlay.parentNode) {
            overlay.remove();
            event.preventDefault();
            return;
        }
        // Transcript edit modal.
        const editOverlay = document.getElementById('edit-modal-overlay');
        if (editOverlay && !editOverlay.classList.contains('hidden')) {
            try { closeTranscriptModal(); } catch (_) { /* ignore */ }
            event.preventDefault();
            return;
        }
        // Memo modal.
        const memoOverlay = document.getElementById('memo-modal-overlay');
        if (memoOverlay && !memoOverlay.classList.contains('hidden')) {
            try { closeMemoModal({ preserveDraft: true }); } catch (_) { /* ignore */ }
            event.preventDefault();
        }
    });
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
    await window.AppAudio.requestWakeLock();
    if (meetingScreen.classList.contains('active')) {
        window.AppMeetingUi.ensureMeetingConnection();
        await window.AppAudio.recoverAudioPipeline({ reason: 'visibility-resume' });
    }
});

window.addEventListener('pageshow', async () => {
    await window.AppAudio.requestWakeLock();
    if (meetingScreen.classList.contains('active')) {
        window.AppMeetingUi.ensureMeetingConnection();
        window.AppAudio.syncMicrophonePermissionState();
        await window.AppAudio.recoverAudioPipeline({ reason: 'page-show' });
    }
});

window.addEventListener('online', () => {
    updateMicStatus('オンラインに復帰しました。必要ならマイクONで再接続してください。');
    if (meetingScreen.classList.contains('active')) {
        window.AppMeetingUi.ensureMeetingConnection();
        window.AppAudio.recoverAudioPipeline({ reason: 'network-online' });
    }
});

window.addEventListener('offline', () => {
    updateMicStatus('オフラインです。接続復帰を待っています。');
});
