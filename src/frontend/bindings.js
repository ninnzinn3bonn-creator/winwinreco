(function initBindingsNamespace() {
    function bindAppEvents(handlers) {
        const { state } = window.AppState;
        const dom = window.AppDom;
        const bindClick = (id, handler) => {
            const element = document.getElementById(id);
            if (element && handler) {
                element.onclick = handler;
            }
        };
        const bindEvent = (element, eventName, handler) => {
            if (element && handler) {
                element.addEventListener(eventName, handler);
            }
        };
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
            aiProvider: aiProviderSelect
        } = dom;

        bindClick('btn-create', handlers.createRoom);
        bindClick('btn-join', handlers.joinRoom);
        bindClick('btn-end', handlers.endRoom);
        bindClick('btn-toggle-mute', handlers.toggleMute);
        bindClick('btn-reconnect-mic', handlers.reconnectMic);
        bindClick('btn-mobile-menu', handlers.toggleMobileMeetingMenu);
        bindClick('btn-toggle-memory-panel', handlers.toggleMobileMemoryPanel);
        bindClick('btn-toggle-ai-panel', handlers.toggleMobileAiPanel);
        bindClick('btn-summary-mobile-menu', handlers.toggleSummaryMobileMenu);
        bindClick('btn-toggle-summary-stats', handlers.toggleSummaryStats);
        bindClick('btn-toggle-summary-sidebar', handlers.toggleSummarySidebar);
        bindClick('btn-toggle-summary-ai-controls', handlers.toggleSummaryAiControls);
        bindClick('btn-copy-room', handlers.copyRoomId);
        bindClick('btn-download-final', handlers.downloadMinutes);
        bindClick('btn-home', () => location.reload());
        bindClick('btn-memo', handlers.addMemo);
        bindClick('btn-dict-add', handlers.addDictionaryTerm);
        bindClick('btn-save', handlers.downloadMinutes);
        bindClick('btn-jump-latest', () => handlers.scrollLogToLatest(dom.timeline));
        bindClick('tab-log', () => handlers.switchTab('log'));
        bindClick('tab-ai', () => handlers.switchTab('ai'));
        bindClick('tab-minutes', () => handlers.switchTab('minutes'));
        bindClick('btn-ai-copy', handlers.copyAiWorkspaceResult);
        bindClick('btn-ai-download', handlers.downloadAiWorkspaceResult);
        bindClick('btn-run-minutes', handlers.runMinutesGeneration);
        bindClick('btn-minutes-copy', handlers.copyMinutesResult);
        bindClick('btn-minutes-download', handlers.downloadMinutesResult);
        bindClick('btn-run-summary', handlers.runSummaryInsights);
        bindClick('btn-run-actions', handlers.runActionInsights);
        bindClick('btn-custom-generate', handlers.generateCustomAiResult);
        bindClick('btn-mic-check', handlers.runMicCheck);
        bindClick('btn-scroll-top', () => handlers.scrollToPageEdge('top'));
        bindClick('btn-scroll-bottom', () => handlers.scrollToPageEdge('bottom'));
        bindClick('btn-clear-search', handlers.clearSearch);
        bindClick('summary-clear-search', handlers.clearSearch);
        bindClick('btn-close-edit-modal', () => handlers.closeTranscriptModal());
        bindClick('btn-cancel-edit-modal', () => handlers.closeTranscriptModal());
        bindClick('btn-save-edit-modal', handlers.saveTranscriptFromModal);
        bindClick('btn-close-memo-modal', () => handlers.closeMemoModal());
        bindClick('btn-cancel-memo-modal', () => handlers.closeMemoModal());
        bindClick('btn-save-memo-modal', handlers.saveMemoFromModal);

        bindEvent(setupMicSensitivity, 'change', (event) => handlers.setMicSensitivity(event.target.value));
        bindEvent(meetingMicSensitivity, 'change', (event) => handlers.setMicSensitivity(event.target.value));
        bindEvent(setupMicMinThreshold, 'input', () => handlers.syncMicThresholdsFromUi('setup'));
        bindEvent(setupMicMaxThreshold, 'input', () => handlers.syncMicThresholdsFromUi('setup'));
        bindEvent(meetingMicMinThreshold, 'input', () => handlers.syncMicThresholdsFromUi('meeting'));
        bindEvent(meetingMicMaxThreshold, 'input', () => handlers.syncMicThresholdsFromUi('meeting'));
        document.querySelectorAll('[data-mic-preset]').forEach((button) => {
            bindEvent(button, 'click', () => handlers.applyMicPreset(button.dataset.micPreset));
        });

        Object.entries(meetingAiButtons).forEach(([key, button]) => {
            if (button) {
                button.onclick = () => handlers.runMeetingAnalysis(key);
            }
        });

        bindEvent(editModalOverlay, 'click', (event) => {
            if (event.target === editModalOverlay) handlers.closeTranscriptModal();
        });
        bindEvent(memoModalOverlay, 'click', (event) => {
            if (event.target === memoModalOverlay) handlers.closeMemoModal();
        });
        bindEvent(editModalTextarea, 'input', (event) => {
            if (!state.activeModalUtteranceId) return;
            state.transcriptDrafts[state.activeModalUtteranceId] = event.target.value;
        });
        bindEvent(memoModalTextarea, 'input', (event) => {
            if (!state.activeMemoUtteranceId) return;
            state.noteDrafts[state.activeMemoUtteranceId] = event.target.value;
        });

        if (aiProviderSelect) {
            aiProviderSelect.onchange = (event) => {
                const provider = event.target.value;
                state.aiProvider = provider;
                state.aiModel = provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash';
                localStorage.setItem('ai_provider', state.aiProvider);
                localStorage.setItem('ai_model', state.aiModel);
            };
        }
        bindEvent(customAiInstruction, 'input', (event) => {
            state.aiWorkspace.instruction = event.target.value;
        });
        bindEvent(aiOutputEditor, 'input', (event) => {
            state.aiWorkspace.result = event.target.value;
            state.aiWorkspace.savedAt = null;
        });
        bindEvent(minutesOutputEditor, 'input', (event) => {
            state.minutesWorkspace.result = event.target.value;
        });
        Object.entries(meetingAiEditors).forEach(([key, editor]) => {
            bindEvent(editor, 'input', (event) => {
                state.liveMeetingAnalysis.outputs[key] = event.target.value;
            });
        });

        filterInputs.forEach((input) => {
            bindEvent(input, 'input', () => {
                state.filters.query = input.value;
                handlers.syncFilterControls();
                handlers.renderAllLogs();
            });
        });
        filterButtons.starred.forEach((button) => {
            if (button) {
                button.onclick = () => handlers.toggleFilter('starredOnly');
            }
        });
        filterButtons.mine.forEach((button) => {
            if (button) {
                button.onclick = () => handlers.toggleFilter('mineOnly');
            }
        });
        filterButtons.noted.forEach((button) => {
            if (button) {
                button.onclick = () => handlers.toggleFilter('notedOnly');
            }
        });
    }

    window.AppBindings = { bindAppEvents };
})();
