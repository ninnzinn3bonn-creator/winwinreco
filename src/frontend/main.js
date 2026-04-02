const state = {
    roomId: null,
    participantId: null,
    userId: null,
    displayName: null,
    ws: null,
    stream: null,
    audioContext: null,
    audioSource: null,
    micAnalyser: null,
    micMonitorFrame: null,
    processor: null,
    watchdogInterval: null,
    lastAudioProcessTime: 0,
    isMuted: false,
    wakeLockSentinel: null,
    voiceGate: {
        threshold: 0.012,
        releaseFrames: 6,
        remainingFrames: 0,
        speaking: false
    },
    activityItems: [],
    aiProvider: 'gemini',
    aiModel: 'gemini-2.5-flash',
    filters: {
        query: '',
        starredOnly: false,
        mineOnly: false,
        notedOnly: false
    },
    meetingInsights: {
        summary: '',
        speakerSummaries: [],
        actions: [],
        status: 'idle',
        dirty: false,
        updatedAt: null,
        loading: false,
        pollTimer: null
    },
    aiWorkspace: {
        mode: '',
        title: '',
        instruction: '',
        result: '',
        savedAt: null,
        loading: false
    },
    liveMeetingAnalysis: {
        loadingKey: '',
        status: '',
        outputs: {
            summary: '',
            todo: '',
            agreements: '',
            topics: ''
        }
    },
    activeModalUtteranceId: null,
    activeMemoUtteranceId: null,
    noteDrafts: {},
    transcriptDrafts: {},
    focusedUtteranceId: null,
    isWorkingOnLog: false
};

const setupScreen = document.getElementById('setup-screen');
const meetingScreen = document.getElementById('meeting-screen');
const summaryScreen = document.getElementById('summary-screen');
const timeline = document.getElementById('timeline');
const summaryLog = document.getElementById('summary-log');
const roomInfo = document.getElementById('room-info');
const summaryInfo = document.getElementById('summary-info');
const selfInfo = document.getElementById('self-info');
const aiWorkspaceStatus = document.getElementById('ai-workspace-status');
const aiOutputTitle = document.getElementById('ai-output-title');
const customAiInstruction = document.getElementById('custom-ai-instruction');
const aiOutputEditor = document.getElementById('ai-output-editor');
const meetingAiStatus = document.getElementById('meeting-ai-status');
const micCheckStatus = document.getElementById('mic-check-status');
const micLevelBar = document.getElementById('mic-level-bar');
const editModalOverlay = document.getElementById('edit-modal-overlay');
const editModalSpeaker = document.getElementById('edit-modal-speaker');
const editModalTime = document.getElementById('edit-modal-time');
const editModalOriginal = document.getElementById('edit-modal-original');
const editModalTextarea = document.getElementById('edit-modal-textarea');
const memoModalOverlay = document.getElementById('memo-modal-overlay');
const memoModalSpeaker = document.getElementById('memo-modal-speaker');
const memoModalTime = document.getElementById('memo-modal-time');
const memoModalOriginal = document.getElementById('memo-modal-original');
const memoModalTextarea = document.getElementById('memo-modal-textarea');
const meetingAiEditors = {
    summary: document.getElementById('meeting-ai-summary'),
    todo: document.getElementById('meeting-ai-todo'),
    agreements: document.getElementById('meeting-ai-agreements'),
    topics: document.getElementById('meeting-ai-topics')
};
const meetingAiButtons = {
    summary: document.getElementById('btn-meeting-summary'),
    todo: document.getElementById('btn-meeting-todo'),
    agreements: document.getElementById('btn-meeting-agreements'),
    topics: document.getElementById('btn-meeting-topics')
};

const filterInputs = [
    document.getElementById('log-search'),
    document.getElementById('summary-search')
];

const filterButtons = {
    starred: [document.getElementById('filter-starred'), document.getElementById('summary-filter-starred')],
    mine: [document.getElementById('filter-mine'), document.getElementById('summary-filter-mine')],
    noted: [document.getElementById('filter-noted'), document.getElementById('summary-filter-noted')]
};

document.getElementById('btn-create').onclick = createRoom;
document.getElementById('btn-join').onclick = joinRoom;
document.getElementById('btn-end').onclick = endRoom;
document.getElementById('btn-toggle-mute').onclick = toggleMute;
document.getElementById('btn-copy-room').onclick = copyRoomId;
document.getElementById('btn-download').onclick = downloadMinutes;
document.getElementById('btn-download-final').onclick = downloadMinutes;
document.getElementById('btn-home').onclick = () => location.reload();
document.getElementById('btn-memo').onclick = addMemo;
document.getElementById('btn-save').onclick = downloadMinutes;
document.getElementById('btn-jump-latest').onclick = () => scrollLogToLatest(timeline);
document.getElementById('tab-log').onclick = () => switchTab('log');
document.getElementById('tab-ai').onclick = () => switchTab('ai');
document.getElementById('btn-ai-copy').onclick = copyAiWorkspaceResult;
document.getElementById('btn-ai-download').onclick = downloadAiWorkspaceResult;
document.getElementById('btn-run-summary').onclick = runSummaryInsights;
document.getElementById('btn-run-actions').onclick = runActionInsights;
document.getElementById('btn-custom-generate').onclick = generateCustomAiResult;
document.getElementById('btn-mic-check').onclick = runMicCheck;
meetingAiButtons.summary.onclick = () => runMeetingAnalysis('summary');
meetingAiButtons.todo.onclick = () => runMeetingAnalysis('todo');
meetingAiButtons.agreements.onclick = () => runMeetingAnalysis('agreements');
meetingAiButtons.topics.onclick = () => runMeetingAnalysis('topics');
document.getElementById('btn-close-edit-modal').onclick = () => closeTranscriptModal();
document.getElementById('btn-cancel-edit-modal').onclick = () => closeTranscriptModal();
document.getElementById('btn-save-edit-modal').onclick = saveTranscriptFromModal;
document.getElementById('btn-close-memo-modal').onclick = () => closeMemoModal();
document.getElementById('btn-cancel-memo-modal').onclick = () => closeMemoModal();
document.getElementById('btn-save-memo-modal').onclick = saveMemoFromModal;
editModalOverlay.addEventListener('click', (event) => {
    if (event.target === editModalOverlay) closeTranscriptModal();
});
memoModalOverlay.addEventListener('click', (event) => {
    if (event.target === memoModalOverlay) closeMemoModal();
});
editModalTextarea.addEventListener('input', (event) => {
    if (!state.activeModalUtteranceId) return;
    state.transcriptDrafts[state.activeModalUtteranceId] = event.target.value;
});
memoModalTextarea.addEventListener('input', (event) => {
    if (!state.activeMemoUtteranceId) return;
    state.noteDrafts[state.activeMemoUtteranceId] = event.target.value;
});

document.getElementById('ai-provider').onchange = (event) => {
    state.aiProvider = event.target.value;
    const modelInput = document.getElementById('ai-model');
    modelInput.value = state.aiProvider === 'ollama' ? 'gpt-oss:20b' : 'gemini-2.5-flash';
    state.aiModel = modelInput.value;
};

document.getElementById('ai-model').oninput = (event) => {
    state.aiModel = event.target.value;
};
customAiInstruction.addEventListener('input', (event) => {
    state.aiWorkspace.instruction = event.target.value;
});
aiOutputEditor.addEventListener('input', (event) => {
    state.aiWorkspace.result = event.target.value;
    state.aiWorkspace.savedAt = null;
});
Object.entries(meetingAiEditors).forEach(([key, editor]) => {
    editor.addEventListener('input', (event) => {
        state.liveMeetingAnalysis.outputs[key] = event.target.value;
    });
});

filterInputs.forEach((input) => {
    input.addEventListener('input', () => {
        state.filters.query = input.value;
        syncFilterControls();
        renderAllLogs();
    });
});

document.getElementById('btn-clear-search').onclick = clearSearch;
document.getElementById('summary-clear-search').onclick = clearSearch;

filterButtons.starred.forEach((button) => {
    button.onclick = () => toggleFilter('starredOnly');
});
filterButtons.mine.forEach((button) => {
    button.onclick = () => toggleFilter('mineOnly');
});
filterButtons.noted.forEach((button) => {
    button.onclick = () => toggleFilter('notedOnly');
});

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`panel-${tab}`).classList.add('active');
}

function generateLocalUserId() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getJoinUrl(roomId) {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', roomId);
    return url.toString();
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

function updateMuteButton() {
    const button = document.getElementById('btn-toggle-mute');
    const indicator = document.querySelector('.recording-indicator');
    button.innerText = state.isMuted ? 'ミュート解除' : 'ミュート';
    button.classList.toggle('active', state.isMuted);
    indicator.classList.toggle('paused', state.isMuted);
    selfInfo.innerText = `参加者: ${state.displayName || '---'}${state.isMuted ? ' / ミュート中' : ''}`;
}

function updateMicStatus(message) {
    if (micCheckStatus) micCheckStatus.innerText = message;
}

function isSecureContextForMedia() {
    return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function getPreferredAudioConstraints() {
    return {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 16000
        }
    };
}

function bindStreamState(stream) {
    const [track] = stream.getAudioTracks();
    if (!track) return;

    track.onended = () => {
        updateMicStatus('マイク入力が終了しました。端末設定やブラウザ権限を確認してください。');
        DebugMonitor.log('warn', 'Microphone track ended');
    };
    track.onmute = () => {
        if (!state.isMuted) {
            updateMicStatus('マイクが一時的に無音または停止状態です。');
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
        DebugMonitor.log('warn', 'Wake lock unavailable', error.message);
    }
}

async function releaseWakeLock() {
    if (!state.wakeLockSentinel) return;
    try {
        await state.wakeLockSentinel.release();
    } catch (error) {
        DebugMonitor.log('warn', 'Wake lock release failed', error.message);
    } finally {
        state.wakeLockSentinel = null;
    }
}

async function runMicCheck() {
    const ok = await prepareAudio({ updateStatus: true });
    if (!ok) return;
    updateMicStatus('マイク入力を確認中です。メーターが動けば入力できています。');
}

async function syncMicrophonePermissionState() {
    if (!navigator.permissions?.query) return;
    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        const apply = () => {
            if (status.state === 'granted') {
                updateMicStatus('マイク権限は許可済みです。必要なら確認ボタンで入力レベルを見てください。');
            } else if (status.state === 'denied') {
                updateMicStatus('マイク権限が拒否されています。ブラウザ設定から許可してください。');
            }
        };
        apply();
        status.onchange = apply;
    } catch (error) {
        DebugMonitor.log('info', 'Microphone permission query not available', error.message);
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

function renderMeetingAnalysis() {
    const loadingKey = state.liveMeetingAnalysis.loadingKey;
    const statusText = state.liveMeetingAnalysis.status || '現時点までのログを使って、必要な解析だけ手動で確認できます。';
    meetingAiStatus.innerText = statusText;

    Object.entries(meetingAiEditors).forEach(([key, editor]) => {
        const fallbackMap = {
            summary: '要約はここに表示されます。',
            todo: 'ToDoはここに表示されます。',
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

function getUtteranceById(id) {
    const entry = state.activityItems.find((item) => item.type === 'utterance' && item.data.id === id);
    return entry ? entry.data : null;
}

function renderMeetingInsights() {
    if (state.meetingInsights.status === 'processing' || state.meetingInsights.loading) {
        aiWorkspaceStatus.innerText = 'AI\u89e3\u6790\u3092\u751f\u6210\u4e2d\u3067\u3059...';
        return;
    }

    if (state.meetingInsights.status === 'error') {
        aiWorkspaceStatus.innerText = '\u89e3\u6790\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u30ed\u30b0\u3092\u78ba\u8a8d\u3057\u3066\u518d\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
        return;
    }

    if (state.meetingInsights.updatedAt) {
        const suffix = state.meetingInsights.dirty
            ? '\u3000\u30ed\u30b0\u304c\u66f4\u65b0\u3055\u308c\u305f\u306e\u3067\u3001\u5fc5\u8981\u306a\u30dc\u30bf\u30f3\u304b\u3089\u518d\u89e3\u6790\u3067\u304d\u307e\u3059\u3002'
            : '';
        aiWorkspaceStatus.innerText = `\u6700\u7d42\u66f4\u65b0: ${new Date(state.meetingInsights.updatedAt).toLocaleString('ja-JP')}${suffix}`;
        return;
    }

    aiWorkspaceStatus.innerText = '\u898b\u305f\u3044\u5185\u5bb9\u306e\u89e3\u6790\u30dc\u30bf\u30f3\u3092\u62bc\u3059\u3068\u3001\u3053\u3053\u306e\u30a8\u30c7\u30a3\u30bf\u30fc\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002';
}

function renderAiWorkspace() {
    customAiInstruction.value = state.aiWorkspace.instruction || '';
    aiOutputTitle.innerText = state.aiWorkspace.title || '\u89e3\u6790\u7d50\u679c';
    aiOutputEditor.value = state.aiWorkspace.result || '\u3053\u3053\u306b\u89e3\u6790\u7d50\u679c\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002';

    if (state.aiWorkspace.loading) {
        aiWorkspaceStatus.innerText = 'AI\u304c\u89e3\u6790\u4e2d\u3067\u3059...';
        return;
    }

    if (state.aiWorkspace.savedAt) {
        aiWorkspaceStatus.innerText = `\u4fdd\u5b58\u6e08\u307f: ${new Date(state.aiWorkspace.savedAt).toLocaleString('ja-JP')}`;
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

function getSummaryOutputText() {
    return state.meetingInsights.summary || '';
}

function getActionOutputText() {
    return formatSpeakerActionsText(state.meetingInsights.actions);
}

function renderSpeakerSummariesMarkup(items = []) {
    if (!items.length) {
        return '\u8a71\u8005\u5225\u8981\u7d04\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002';
    }

    return `<div class="speaker-summary-list">${items.map((item) => `
        <section class="speaker-action-group">
            <strong>${escapeHtml(item.speaker || '\u672a\u8a2d\u5b9a')}</strong>
            <div>${escapeHtml(item.summary || '\u60c5\u5831\u4e0d\u8db3')}</div>
        </section>
    `).join('')}</div>`;
}

function formatSpeakerSummariesText(items = []) {
    if (!items.length) return '';
    return items
        .map((item) => `${item.speaker || '\u672a\u8a2d\u5b9a'}\n${item.summary || '\u60c5\u5831\u4e0d\u8db3'}`)
        .join('\n\n');
}

function renderSpeakerActionsMarkup(actions = []) {
    if (!actions.length) {
        return '\u8a71\u8005\u5225 Next Action \u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002';
    }

    const grouped = actions.reduce((map, action) => {
        const key = action.speaker_name || '\u672a\u8a2d\u5b9a';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(action.action_text || '');
        return map;
    }, new Map());

    return `<div class="speaker-actions">${Array.from(grouped.entries()).map(([speaker, items]) => `
        <section class="speaker-action-group">
            <strong>${escapeHtml(speaker)}</strong>
            <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
    `).join('')}</div>`;
}

function formatSpeakerActionsText(actions = []) {
    if (!actions.length) return '';

    const grouped = actions.reduce((map, action) => {
        const key = action.speaker_name || '\u672a\u8a2d\u5b9a';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(action.action_text || '');
        return map;
    }, new Map());

    return Array.from(grouped.entries())
        .map(([speaker, items]) => `${speaker}\n${items.map((item) => `- ${item}`).join('\n')}`)
        .join('\n\n');
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
        if (!state.activeMemoUtteranceId) {
            document.body.classList.remove('modal-open');
        }
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
        if (!state.activeModalUtteranceId) {
            document.body.classList.remove('modal-open');
        }
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

function renderConversationList(container, includeSystemMessages) {
    const previousScrollTop = container.scrollTop;
    const previousScrollHeight = container.scrollHeight;
    const items = getVisibleItems().filter((item) => includeSystemMessages || item.type === 'utterance');
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<span class="placeholder-text">\u8a72\u5f53\u3059\u308b\u30ed\u30b0\u306f\u3042\u308a\u307e\u305b\u3093\u3002</span>';
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

function createUtteranceElement(utterance) {
    const article = document.createElement('article');
    article.className = `utterance${utterance.participant_id === state.participantId ? ' self' : ''}${utterance.is_starred ? ' starred' : ''}${utterance.id === state.focusedUtteranceId ? ' focused' : ''}`;
    article.dataset.utteranceId = utterance.id;

    const time = formatTime(utterance.timestamp);
    const sourceLabel = utterance.transcript_source === 'user'
        ? '\u624b\u52d5\u7de8\u96c6'
        : utterance.transcript_source === 'ai'
            ? 'AI\u88dc\u6b63'
            : '\u751f\u30ed\u30b0';
    const rawDiffers = utterance.raw_transcript && utterance.raw_transcript !== utterance.transcript;

    article.innerHTML = `
        <div class="utterance-meta">
            <div>
                <div class="speaker-name">${escapeHtml(utterance.display_name)}</div>
                <div class="utterance-time">${time}</div>
            </div>
            <div class="timestamp">${utterance.is_starred ? '\u2605 ' : ''}${sourceLabel}</div>
        </div>
        <div class="text">${highlightText(utterance.transcript, state.filters.query)}</div>
        ${rawDiffers ? `<div class="note-preview">RAW: ${highlightText(utterance.raw_transcript, state.filters.query)}</div>` : ''}
        ${rawDiffers ? `<div class="note-preview">\u5dee\u5206: ${renderDiff(utterance.raw_transcript, utterance.transcript)}</div>` : ''}
        ${utterance.memo_text ? `<div class="note-preview">\u30e1\u30e2: ${highlightText(utterance.memo_text, state.filters.query)}</div>` : ''}
        <div class="utterance-actions">
            <button class="icon-toggle ${utterance.is_starred ? 'active' : ''}" data-action="star">${utterance.is_starred ? '\u2605 \u91cd\u8981' : '\u2606 \u91cd\u8981'}</button>
            <button class="icon-toggle" data-action="note">\u30e1\u30e2</button>
            <button class="icon-toggle" data-action="edit">\u7de8\u96c6</button>
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

function renderDiff(rawText, editedText) {
    const rawWords = (rawText || '').split(/\s+/).filter(Boolean);
    const editedWords = (editedText || '').split(/\s+/).filter(Boolean);

    if (rawWords.join(' ') === editedWords.join(' ')) {
        return escapeHtml(editedText || rawText || '');
    }

    const removed = rawWords
        .filter((word) => !editedWords.includes(word))
        .map((word) => `<del>${escapeHtml(word)}</del>`);
    const added = editedWords
        .filter((word) => !rawWords.includes(word))
        .map((word) => `<ins>${escapeHtml(word)}</ins>`);

    return [...removed, ...added].join(' ');
}

function getStarredUtterances() {
    return state.activityItems
        .filter((item) => item.type === 'utterance' && item.data.is_starred)
        .map((item) => item.data)
        .sort((a, b) => new Date(b.starred_at || b.timestamp).getTime() - new Date(a.starred_at || a.timestamp).getTime());
}

function renderStarredLogs(container) {
    const starred = getStarredUtterances();
    container.innerHTML = '';

    if (starred.length === 0) {
        container.innerHTML = '<span class="placeholder-text">\u91cd\u8981\u30ed\u30b0\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002</span>';
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
            ${utterance.memo_text ? `<div class="note-preview">\u30e1\u30e2: ${highlightText(shortenText(utterance.memo_text, 70), state.filters.query)}</div>` : ''}
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

async function saveTranscriptFromModal() {
    const utteranceId = state.activeModalUtteranceId;
    if (!utteranceId) return;

    const transcript = (state.transcriptDrafts[utteranceId] ?? '').trim();
    await updateUtteranceMemory(
        utteranceId,
        {
            transcript,
            transcript_source: 'user'
        },
        { closeModal: true }
    );
}

function getFormattedAiWorkspaceText() {
    const title = state.aiWorkspace.title || '\u89e3\u6790\u7d50\u679c';
    const instruction = customAiInstruction.value || state.aiWorkspace.instruction || '';
    const result = aiOutputEditor.value || state.aiWorkspace.result || '';
    return [
        `\u3010${title}\u3011`,
        result,
        '',
        '\u3010\u6307\u793a\u3011',
        instruction
    ].join('\n');
}

async function saveMemoFromModal() {
    const utteranceId = state.activeMemoUtteranceId;
    if (!utteranceId) return;

    const memoText = (state.noteDrafts[utteranceId] ?? '').trim();
    await updateUtteranceMemory(
        utteranceId,
        { memo_text: memoText },
        { closeMemoModal: true }
    );
}

function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

async function saveAiWorkspaceResult() {
    if (!state.roomId) return;
    if (!state.aiWorkspace.result.trim()) {
        alert('保存できる解析結果がまだありません。');
        return;
    }

    try {
        const res = await fetch(`/rooms/${state.roomId}/custom-output`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: state.aiWorkspace.mode || 'custom',
                title: state.aiWorkspace.title || '解析結果',
                instruction: customAiInstruction.value || state.aiWorkspace.instruction || '',
                result: aiOutputEditor.value || state.aiWorkspace.result || ''
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '解析結果の保存に失敗しました');

        state.aiWorkspace.savedAt = data.saved_at || null;
        renderAiWorkspace();
        aiWorkspaceStatus.innerText = `保存済み: ${new Date(data.saved_at).toLocaleString('ja-JP')}`;
    } catch (error) {
        alert(`解析結果の保存に失敗しました: ${error.message}`);
    }
}

function clearInsightsPoll() {
    if (state.meetingInsights.pollTimer) {
        clearTimeout(state.meetingInsights.pollTimer);
        state.meetingInsights.pollTimer = null;
    }
}

function scheduleInsightsPoll() {
    clearInsightsPoll();
    state.meetingInsights.pollTimer = setTimeout(() => {
        loadMeetingInsights({ silent: true });
    }, 2500);
}

async function loadMeetingInsights(options = {}) {
    if (!state.roomId) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/insights`);
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'AI \u7d50\u679c\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f');

        state.meetingInsights.summary = data.summary || '';
        state.meetingInsights.speakerSummaries = Array.isArray(data.speaker_summaries) ? data.speaker_summaries : [];
        state.meetingInsights.actions = Array.isArray(data.actions) ? data.actions : [];
        state.meetingInsights.status = data.status || 'idle';
        state.meetingInsights.dirty = !!data.dirty;
        state.meetingInsights.updatedAt = data.summary_updated_at || null;
        state.meetingInsights.loading = data.status === 'processing';

        if (data.status === 'processing') {
            scheduleInsightsPoll();
        } else {
            clearInsightsPoll();
        }

        renderMeetingInsights();
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
                    provider: 'gemini',
                    model: state.aiProvider === 'gemini' && state.aiModel ? state.aiModel : 'gemini-2.5-flash'
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
            instruction: '現時点の会議ログから、合意した内容と未解決の課題を分けて整理してください。見出しを付け、箇条書きで簡潔にまとめてください。推測しすぎず、不明な点は不明と書いてください。'
        },
        topics: {
            type: 'topic_tree',
            title: 'トークテーマ一覧',
            instruction: '現時点で話題に上がっているトピックを一覧で見やすく整理してください。'
        }
    };
    const config = configMap[key];
    if (!config) return;

    state.liveMeetingAnalysis.loadingKey = key;
    state.liveMeetingAnalysis.status = `${config.title}をGeminiで解析しています...`;
    renderMeetingAnalysis();

    try {
        const res = await fetch(`/rooms/${state.roomId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: config.type,
                instruction: config.instruction || '',
                ai_config: {
                    provider: 'gemini',
                    model: state.aiProvider === 'gemini' && state.aiModel ? state.aiModel : 'gemini-2.5-flash'
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

async function runSummaryInsights() {
    await runDirectAnalysis('summary', '要約');
}

async function runActionInsights() {
    await runDirectAnalysis('todo', '話者別ネクストアクション');
}

async function ensureMeetingInsights() {
    await loadMeetingInsights({ silent: true });
}

async function loadCustomAiResult() {
    if (!state.roomId) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/custom-output`);
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'AI \u7d50\u679c\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f');

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
        alert('\u81ea\u7531\u6307\u793a\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
        return;
    }

    try {
        await runDirectAnalysis('custom', '自由解析', instruction);
    } catch (error) {
        state.aiWorkspace.loading = false;
        renderAiWorkspace();
        alert(`AI \u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
    }
}

function shortenText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
}

function formatTime(value) {
    return new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, query) {
    const safeText = escapeHtml(text);
    if (!query.trim()) return safeText;
    const pattern = new RegExp(`(${escapeRegExp(query.trim())})`, 'ig');
    return safeText.replace(pattern, '<mark class="highlight">$1</mark>');
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
    const message = isHtml
        ? '\u30b5\u30fc\u30d0\u30fc\u304c\u53e4\u3044\u307e\u307e\u3067\u3001\u4e00\u62ec\u88dc\u6b63API\u3092\u307e\u3060\u6301\u3063\u3066\u3044\u306a\u3044\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002\u30b5\u30fc\u30d0\u30fc\u3092\u518d\u8d77\u52d5\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
        : text || '\u30b5\u30fc\u30d0\u30fc\u5fdc\u7b54\u306e\u8aad\u307f\u53d6\u308a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002';

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
        if (!res.ok) throw new Error(updated.error || '\u30ed\u30b0\u66f4\u65b0\u306b\u5931\u6557\u3057\u307e\u3057\u305f');

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
        DebugMonitor.log('error', 'Failed to update log', error.message);
        alert(`\u30ed\u30b0\u66f4\u65b0\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
    }
}

async function bulkCorrectLogs() {
    try {
        const res = await fetch(`/rooms/${state.roomId}/correct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ai_config: {
                    provider: state.aiProvider,
                    model: state.aiModel
                }
            })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '\u4e00\u62ec\u88dc\u6b63\u306b\u5931\u6557\u3057\u307e\u3057\u305f');

        state.activityItems = state.activityItems.filter((item) => item.type === 'system');
        (data.logs || []).forEach((entry) => {
            upsertUtterance(entry);
            state.transcriptDrafts[entry.id] = entry.transcript || '';
        });
        state.meetingInsights.dirty = true;
        renderAllLogs();
    } catch (error) {
        alert(`\u4e00\u62ec\u88dc\u6b63\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
    }
}

async function downloadMinutes() {
    if (!state.roomId) return;
    window.location.href = `/rooms/${state.roomId}/download`;
}

function copyRoomId() {
    if (!state.roomId) return;
    const joinUrl = getJoinUrl(state.roomId);
    navigator.clipboard.writeText(joinUrl).then(() => {
        alert('\u53c2\u52a0URL\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f');
    });
}

async function prepareAudio(options = {}) {
    DebugMonitor.log('info', 'prepareAudio: Requesting permission on user gesture');
    try {
        if (!isSecureContextForMedia()) {
            throw new Error('マイク利用には HTTPS または localhost が必要です');
        }
        if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia(getPreferredAudioConstraints());
            bindStreamState(state.stream);
        }
        state.stream.getAudioTracks().forEach((track) => {
            track.enabled = !state.isMuted;
        });
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            state.audioContext.onstatechange = () => {
                const currentState = state.audioContext ? state.audioContext.state : 'closed';
                if (currentState === 'interrupted') {
                    updateMicStatus('音声処理が端末側で中断されました。画面復帰後に再開を試みます。');
                }
            };
        }
        if (state.audioContext.state === 'suspended') await state.audioContext.resume();
        ensureAudioNodes();
        if (options.updateStatus) {
            updateMicStatus('マイクの許可が取れました。口元マイク前提でブラウザ側の加工を弱めています。メーターが動けば準備完了です。');
        }
        return true;
    } catch (error) {
        DebugMonitor.log('error', 'prepareAudio failed', error.message);
        if (options.updateStatus) {
            updateMicStatus(`マイク確認に失敗しました: ${error.message}`);
        }
        alert(`\u30de\u30a4\u30af\u306e\u8a31\u53ef\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
        return false;
    }
}

async function createRoom() {
    const displayName = document.getElementById('display-name').value.trim();
    const profileText = document.getElementById('profile-text').value.trim();
    if (!displayName) return alert('\u8868\u793a\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044');
    if (!await prepareAudio()) return;

    try {
        const res = await fetch('/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: 'browser-user' })
        });
        const room = await readApiResponse(res);
        await joinRoomProcess(room.id, displayName, profileText);
    } catch (error) {
        alert('\u30eb\u30fc\u30e0\u4f5c\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f');
    }
}

async function joinRoom() {
    const displayName = document.getElementById('display-name').value.trim();
    const profileText = document.getElementById('profile-text').value.trim();
    const roomId = document.getElementById('room-id').value.trim().toUpperCase();
    if (!displayName || !roomId) return alert('\u8868\u793a\u540d\u3068\u30eb\u30fc\u30e0ID\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044');
    if (!await prepareAudio()) return;
    await joinRoomProcess(roomId, displayName, profileText);
}

async function joinRoomProcess(roomId, displayName, profileText = '') {
    try {
        const normalizedRoomId = roomId.trim().toUpperCase();
        const userId = ensureLocalUserId();
        const res = await fetch(`/rooms/${normalizedRoomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, display_name: displayName, location_id: 'web-browser', profile_text: profileText })
        });
        if (!res.ok) throw new Error('Join failed');

        const participant = await readApiResponse(res);
        state.roomId = normalizedRoomId;
        state.participantId = participant.id;
        state.userId = userId;
        state.displayName = displayName;
        localStorage.setItem('display_name', displayName);
        localStorage.setItem('profile_text', profileText);
        showMeetingScreen();
        initWebSocket();
    } catch (error) {
        alert('\u30eb\u30fc\u30e0\u53c2\u52a0\u306b\u5931\u6557\u3057\u307e\u3057\u305f');
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
    roomInfo.innerText = `\u30eb\u30fc\u30e0: ${state.roomId}`;
    updateMuteButton();
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
    meetingScreen.classList.remove('active');
    summaryScreen.classList.add('active');
    summaryInfo.innerText = `\u30eb\u30fc\u30e0: ${state.roomId}`;
    releaseWakeLock();
    switchTab('log');
    loadRoomLogs().then(() => {
        renderAllLogs();
        window.scrollTo({ top: 0, behavior: 'auto' });
        loadMeetingInsights({ silent: true });
        loadCustomAiResult();
    });
}

async function loadRoomLogs() {
    if (!state.roomId) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/logs`);
        if (!res.ok) throw new Error('\u30ed\u30b0\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f');
        const logs = await readApiResponse(res);

        state.activityItems = state.activityItems.filter((item) => item.type === 'system');
        logs.forEach((entry) => upsertUtterance(entry));
    } catch (error) {
        DebugMonitor.log('error', 'Failed to load logs', error.message);
    }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?participantId=${state.participantId}`;
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
        addSystemMessage('\u30b5\u30fc\u30d0\u30fc\u306b\u63a5\u7d9a\u3057\u307e\u3057\u305f\u3002');
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
            addSystemMessage('\u4f1a\u8b70\u304c\u7d42\u4e86\u3057\u307e\u3057\u305f\u3002');
            stopRecording();
            showSummaryScreen();
        }
    };

    state.ws.onclose = () => {
        addSystemMessage('\u63a5\u7d9a\u304c\u5207\u308c\u307e\u3057\u305f\u3002\u518d\u63a5\u7d9a\u3092\u8a66\u307f\u307e\u3059...');
        if (meetingScreen.classList.contains('active')) {
            setTimeout(initWebSocket, 3000);
        }
    };

    state.ws.onerror = () => {
        DebugMonitor.log('error', 'WebSocket Error occurred');
    };
}

function scrollLogToLatest(container) {
    if (state.isWorkingOnLog) return;
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
        DebugMonitor.log('error', 'startRecording failed', error.message);
        addSystemMessage(`\u30de\u30a4\u30af\u63a5\u7d9a\u30a8\u30e9\u30fc: ${error.name}`);
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
            if (state.isMuted) return;
            const inputData = event.inputBuffer.getChannelData(0);
            let energy = 0;
            for (let i = 0; i < inputData.length; i += 1) {
                energy += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(energy / inputData.length);
            const gate = state.voiceGate;
            const isSpeechLike = rms >= gate.threshold;
            if (isSpeechLike) {
                gate.remainingFrames = gate.releaseFrames;
                gate.speaking = true;
            } else if (gate.remainingFrames > 0) {
                gate.remainingFrames -= 1;
            } else {
                gate.speaking = false;
            }
            if (!gate.speaking && !isSpeechLike) {
                return;
            }

            state.lastAudioProcessTime = Date.now();
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i += 1) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
            }
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(pcmData.buffer);
            }
        };

        state.processor = processor;
        if (!state.watchdogInterval) {
            state.watchdogInterval = setInterval(() => {
                if (!state.roomId || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
                if (state.isMuted) return;
                const silenceTime = Date.now() - (state.lastAudioProcessTime || 0);
                if (silenceTime > 2000) startRecording();
            }, 1000);
        }
    } catch (error) {
        DebugMonitor.log('error', 'audio processor failed', error.message);
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
    updateMuteButton();
    addSystemMessage(state.isMuted ? 'この端末の文字起こしを停止しました。' : 'この端末の文字起こしを再開しました。');
}

async function endRoom() {
    if (!confirm('\u4f1a\u8b70\u3092\u7d42\u4e86\u3057\u307e\u3059\u304b\uff1f')) return;

    try {
        const res = await fetch(`/rooms/${state.roomId}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner_id: 'browser-user' })
        });
        const data = await readApiResponse(res);
        if (!res.ok) throw new Error(data.error || '\u7d42\u4e86\u306b\u5931\u6557\u3057\u307e\u3057\u305f');
        stopRecording();
        showSummaryScreen();
    } catch (error) {
        alert(`\u7d42\u4e86\u51e6\u7406\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
    }
}

async function checkApiStatus() {
    const container = document.getElementById('api-status-container');
    if (!container) return;

    try {
        const res = await fetch('/api/status');
        const status = await readApiResponse(res);
        const sttText = status.google_stt ? 'OK' : '\u672a\u8a2d\u5b9a';
        const aiText = status.gemini_ai ? 'OK' : '\u672a\u8a2d\u5b9a';
        const secureText = isSecureContextForMedia() ? 'OK' : 'HTTPS必須';
        container.innerHTML = `<div class="system-message">\u97f3\u58f0\u8a8d\u8b58: ${sttText} / AI: ${aiText} / HTTPS: ${secureText}</div>`;
    } catch (error) {
        container.innerHTML = '<p>\u30b9\u30c6\u30fc\u30bf\u30b9\u78ba\u8a8d\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ensureLocalUserId();
    const savedDisplayName = localStorage.getItem('display_name');
    const savedProfileText = localStorage.getItem('profile_text');
    const roomIdFromUrl = new URLSearchParams(window.location.search).get('room');
    if (savedDisplayName) {
        document.getElementById('display-name').value = savedDisplayName;
    }
    if (savedProfileText) {
        document.getElementById('profile-text').value = savedProfileText;
    }
    if (roomIdFromUrl) {
        document.getElementById('room-id').value = roomIdFromUrl.toUpperCase();
        updateMicStatus(`共有URLからルーム ${roomIdFromUrl.toUpperCase()} を読み込みました。表示名を入れれば参加できます。`);
    }
    document.body.classList.add('setup-mode');
    syncFilterControls();
    renderAllLogs();
    updateMuteButton();
    updateMicStatus('参加前にマイクを確認できます。特にスマホでは先に許可と入力レベルを確認してください。');
    checkApiStatus();
    syncMicrophonePermissionState();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeModalUtteranceId) {
        closeTranscriptModal();
    } else if (event.key === 'Escape' && state.activeMemoUtteranceId) {
        closeMemoModal();
    }
});

document.addEventListener('visibilitychange', async () => {
    if (!meetingScreen.classList.contains('active')) return;

    if (document.hidden) {
        updateMicStatus('画面が非表示です。モバイルブラウザではバックグラウンド中の録音継続を保証できません。復帰後に自動で再接続を試みます。');
        return;
    }

    if (state.audioContext && state.audioContext.state === 'suspended') {
        try {
            await state.audioContext.resume();
        } catch (error) {
            DebugMonitor.log('warn', 'AudioContext resume failed', error.message);
        }
    }
    if (state.stream && !state.processor) {
        startRecording();
    }
    requestWakeLock();
    updateMicStatus('画面に復帰しました。マイク入力を再確認しています。');
});

window.addEventListener('pageshow', async () => {
    if (!meetingScreen.classList.contains('active')) return;
    if (state.audioContext && state.audioContext.state === 'suspended') {
        try {
            await state.audioContext.resume();
        } catch (error) {
            DebugMonitor.log('warn', 'AudioContext resume failed on pageshow', error.message);
        }
    }
    requestWakeLock();
});

window.addEventListener('online', () => {
    updateMicStatus('ネットワークに再接続しました。必要に応じてマイク状態も再確認します。');
});

window.addEventListener('offline', () => {
    updateMicStatus('オフラインになりました。通信復帰まで文字起こしは不安定になる可能性があります。');
});
