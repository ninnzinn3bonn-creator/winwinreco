(function initBindingsNamespace() {
    function bindAppEvents(handlers) {
        const { state } = window.AppState;
        const dom = window.AppDom;
        const {
            customAiInstruction,
            aiOutputEditor,
            minutesOutputEditor,
            setupMicSensitivity,
            meetingMicSensitivity,
            setupMicMinThreshold,
            setupMicMaxThreshold,
            meetingMicMinThreshold,
            meetingMicMaxThreshold,
            meetingAiEditors,
            meetingAiButtons,
            filterInputs,
            filterButtons,
            editModalOverlay,
            memoModalOverlay,
            editModalTextarea,
            memoModalTextarea,
            aiProviderSelect,
            aiModelInput
        } = dom;

        document.getElementById('btn-create').onclick = handlers.createRoom;
        document.getElementById('btn-join').onclick = handlers.joinRoom;
        document.getElementById('btn-end').onclick = handlers.endRoom;
        document.getElementById('btn-toggle-mute').onclick = handlers.toggleMute;
        document.getElementById('btn-reconnect-mic').onclick = handlers.reconnectMic;
        document.getElementById('btn-mobile-menu').onclick = handlers.toggleMobileMeetingMenu;
        document.getElementById('btn-toggle-memory-panel').onclick = handlers.toggleMobileMemoryPanel;
        document.getElementById('btn-toggle-ai-panel').onclick = handlers.toggleMobileAiPanel;
        document.getElementById('btn-summary-mobile-menu').onclick = handlers.toggleSummaryMobileMenu;
        document.getElementById('btn-toggle-summary-stats').onclick = handlers.toggleSummaryStats;
        document.getElementById('btn-toggle-summary-sidebar').onclick = handlers.toggleSummarySidebar;
        document.getElementById('btn-toggle-summary-ai-controls').onclick = handlers.toggleSummaryAiControls;
        document.getElementById('btn-copy-room').onclick = handlers.copyRoomId;
        document.getElementById('btn-download-final').onclick = handlers.downloadMinutes;
        document.getElementById('btn-home').onclick = () => location.reload();
        document.getElementById('btn-memo').onclick = handlers.addMemo;
        document.getElementById('btn-save').onclick = handlers.downloadMinutes;
        document.getElementById('btn-jump-latest').onclick = () => handlers.scrollLogToLatest(dom.timeline);
        document.getElementById('tab-log').onclick = () => handlers.switchTab('log');
        document.getElementById('tab-ai').onclick = () => handlers.switchTab('ai');
        document.getElementById('tab-minutes').onclick = () => handlers.switchTab('minutes');
        document.getElementById('btn-ai-copy').onclick = handlers.copyAiWorkspaceResult;
        document.getElementById('btn-ai-download').onclick = handlers.downloadAiWorkspaceResult;
        document.getElementById('btn-run-minutes').onclick = handlers.runMinutesGeneration;
        document.getElementById('btn-minutes-copy').onclick = handlers.copyMinutesResult;
        document.getElementById('btn-minutes-download').onclick = handlers.downloadMinutesResult;
        document.getElementById('btn-run-summary').onclick = handlers.runSummaryInsights;
        document.getElementById('btn-run-actions').onclick = handlers.runActionInsights;
        document.getElementById('btn-custom-generate').onclick = handlers.generateCustomAiResult;
        document.getElementById('btn-mic-check').onclick = handlers.runMicCheck;
        document.getElementById('btn-scroll-top').onclick = () => handlers.scrollToPageEdge('top');
        document.getElementById('btn-scroll-bottom').onclick = () => handlers.scrollToPageEdge('bottom');
        document.getElementById('btn-clear-search').onclick = handlers.clearSearch;
        document.getElementById('summary-clear-search').onclick = handlers.clearSearch;
        document.getElementById('btn-close-edit-modal').onclick = () => handlers.closeTranscriptModal();
        document.getElementById('btn-cancel-edit-modal').onclick = () => handlers.closeTranscriptModal();
        document.getElementById('btn-save-edit-modal').onclick = handlers.saveTranscriptFromModal;
        document.getElementById('btn-close-memo-modal').onclick = () => handlers.closeMemoModal();
        document.getElementById('btn-cancel-memo-modal').onclick = () => handlers.closeMemoModal();
        document.getElementById('btn-save-memo-modal').onclick = handlers.saveMemoFromModal;

        setupMicSensitivity.addEventListener('change', (event) => handlers.setMicSensitivity(event.target.value));
        meetingMicSensitivity.addEventListener('change', (event) => handlers.setMicSensitivity(event.target.value));
        setupMicMinThreshold?.addEventListener('input', () => handlers.syncMicThresholdsFromUi('setup'));
        setupMicMaxThreshold?.addEventListener('input', () => handlers.syncMicThresholdsFromUi('setup'));
        meetingMicMinThreshold?.addEventListener('input', () => handlers.syncMicThresholdsFromUi('meeting'));
        meetingMicMaxThreshold?.addEventListener('input', () => handlers.syncMicThresholdsFromUi('meeting'));

        Object.entries(meetingAiButtons).forEach(([key, button]) => {
            button.onclick = () => handlers.runMeetingAnalysis(key);
        });

        editModalOverlay.addEventListener('click', (event) => {
            if (event.target === editModalOverlay) handlers.closeTranscriptModal();
        });
        memoModalOverlay.addEventListener('click', (event) => {
            if (event.target === memoModalOverlay) handlers.closeMemoModal();
        });
        editModalTextarea.addEventListener('input', (event) => {
            if (!state.activeModalUtteranceId) return;
            state.transcriptDrafts[state.activeModalUtteranceId] = event.target.value;
        });
        memoModalTextarea.addEventListener('input', (event) => {
            if (!state.activeMemoUtteranceId) return;
            state.noteDrafts[state.activeMemoUtteranceId] = event.target.value;
        });

        aiProviderSelect.onchange = (event) => {
            state.aiProvider = event.target.value;
            aiModelInput.value = 'gemini-2.5-pro';
            state.aiModel = aiModelInput.value;
        };
        aiModelInput.oninput = (event) => {
            state.aiModel = event.target.value;
        };
        customAiInstruction.addEventListener('input', (event) => {
            state.aiWorkspace.instruction = event.target.value;
        });
        aiOutputEditor.addEventListener('input', (event) => {
            state.aiWorkspace.result = event.target.value;
            state.aiWorkspace.savedAt = null;
        });
        minutesOutputEditor.addEventListener('input', (event) => {
            state.minutesWorkspace.result = event.target.value;
        });
        Object.entries(meetingAiEditors).forEach(([key, editor]) => {
            editor.addEventListener('input', (event) => {
                state.liveMeetingAnalysis.outputs[key] = event.target.value;
            });
        });

        filterInputs.forEach((input) => {
            input.addEventListener('input', () => {
                state.filters.query = input.value;
                handlers.syncFilterControls();
                handlers.renderAllLogs();
            });
        });
        filterButtons.starred.forEach((button) => {
            button.onclick = () => handlers.toggleFilter('starredOnly');
        });
        filterButtons.mine.forEach((button) => {
            button.onclick = () => handlers.toggleFilter('mineOnly');
        });
        filterButtons.noted.forEach((button) => {
            button.onclick = () => handlers.toggleFilter('notedOnly');
        });
    }

    window.AppBindings = { bindAppEvents };
})();
