(function initBindingsNamespace() {
    function bindAppEvents(handlers) {
        const { state } = window.AppState;
        const dom = window.AppDom;
        const resolveHandler = (name) => {
            const direct = window.AppMain?.[name];
            if (typeof direct === 'function') return direct;
            const alias = `handle${name.charAt(0).toUpperCase()}${name.slice(1)}`;
            const aliased = window.AppMain?.[alias];
            if (typeof aliased === 'function') return aliased;
            const fallback = handlers?.[name];
            return typeof fallback === 'function' ? fallback : null;
        };
        const callHandler = (name, ...args) => {
            const handler = resolveHandler(name);
            if (handler) {
                return handler(...args);
            }
            return undefined;
        };
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
            dictTerm
        } = dom;

        bindClick('btn-create', () => callHandler('createRoom'));
        bindClick('btn-join', () => callHandler('joinRoom'));

        // Unified CTA: create when room id is empty, join when it has a
        // value. Also keep the label/hint in sync as the user types.
        const startBtn = document.getElementById('btn-start-meeting');
        const roomIdInput = document.getElementById('room-id');
        const startHint = document.getElementById('start-meeting-hint');
        const isParticipantMode = () => document.body.classList.contains('participant-mode');
        const refreshStartCta = () => {
            if (!startBtn) return;
            const hasRoomId = !!(roomIdInput && roomIdInput.value.trim());
            const participantMode = isParticipantMode();
            if (participantMode || hasRoomId) {
                startBtn.textContent = '莨夊ｭｰ縺ｫ蜿ょ刈';
                if (startHint) {
                    startHint.textContent = participantMode
                        ? '共有URLから会議に参加します。表示名を入力して開始してください。'
                        : `ルーム ${roomIdInput.value.trim().toUpperCase()} に参加します。`;
                }
            } else {
                startBtn.textContent = '新しい会議を始める';
                if (startHint) {
                    startHint.textContent = '空欄のままなら新しい会議を作成し、IDを入れると既存会議に参加します。';
                }
            }
        };

        if (startBtn) {
            startBtn.addEventListener('click', () => {
                const hasRoomId = !!(roomIdInput && roomIdInput.value.trim());
                if (isParticipantMode() || hasRoomId) {
                    callHandler('joinRoom');
                } else {
                    callHandler('createRoom');
                }
            });
        }
        if (roomIdInput) {
            roomIdInput.addEventListener('input', refreshStartCta);
        }
        refreshStartCta();

        bindClick('btn-end', () => callHandler('endRoom'));
        bindClick('btn-toggle-mute', () => callHandler('toggleMute'));
        bindClick('btn-reconnect-mic', () => callHandler('reconnectMic'));

        // Unified mic state button: choose action based on current state.
        const micStateBtn = document.getElementById('btn-mic-state');
        if (micStateBtn) {
            micStateBtn.addEventListener('click', () => {
                if (!state.stream) {
                    callHandler('reconnectMic');
                } else {
                    callHandler('toggleMute');
                }
            });
        }

        bindClick('btn-mobile-menu', () => callHandler('toggleMobileMeetingMenu'));
        bindClick('btn-meeting-mic-settings', () => callHandler('toggleMobileMeetingMenu'));
        bindClick('btn-toggle-memory-panel', () => callHandler('toggleMobileMemoryPanel'));
        bindClick('btn-toggle-ai-panel', () => callHandler('toggleMobileAiPanel'));
        bindClick('btn-summary-mobile-menu', () => callHandler('toggleSummaryMobileMenu'));
        bindClick('btn-toggle-summary-stats', () => callHandler('toggleSummaryStats'));
        bindClick('btn-toggle-summary-sidebar', () => callHandler('toggleSummarySidebar'));
        bindClick('btn-toggle-summary-ai-controls', () => callHandler('toggleSummaryAiControls'));
        bindClick('btn-copy-room', () => callHandler('copyRoomId'));
        bindClick('btn-download-final', () => callHandler('downloadMinutes'));
        bindClick('btn-home', () => {
            const loggedIn = !!(window.AppAuth && window.AppAuth.state && window.AppAuth.state.account);
            if (!loggedIn && resolveHandler('downloadMinutes')) {
                const wantSave = confirm('ログインしていないため、会議データは端末にのみ残ります。ホームへ戻る前に Markdown をダウンロードしますか？\n\n[OK] ダウンロードしてからホームへ戻る\n[キャンセル] そのままホームへ戻る');
                if (wantSave) {
                    try { callHandler('downloadMinutes'); } catch (_) { /* ignore */ }
                }
            }
            location.reload();
        });
        bindClick('btn-memo', () => callHandler('addMemo'));
        bindClick('btn-dict-add', () => callHandler('addDictionaryTerm'));
        bindClick('btn-dict-extract', () => callHandler('extractTermsFromText'));
        bindClick('btn-dict-add-selected', () => callHandler('addSelectedTerms'));

        if (dictTerm && resolveHandler('guessReadingForInput')) {
            dictTerm.addEventListener('blur', () => callHandler('guessReadingForInput'));
        }

        bindClick('tab-log', () => callHandler('switchTab', 'log'));
        bindClick('tab-ai', () => callHandler('switchTab', 'ai'));
        bindClick('tab-minutes', () => callHandler('switchTab', 'minutes'));
        bindClick('btn-ai-copy', () => callHandler('copyAiWorkspaceResult'));
        bindClick('btn-ai-download', () => callHandler('downloadAiWorkspaceResult'));
        bindClick('btn-run-minutes', () => callHandler('runMinutesGeneration'));
        bindClick('btn-minutes-copy', () => callHandler('copyMinutesResult'));
        bindClick('btn-minutes-download', () => callHandler('downloadMinutesResult'));
        bindClick('btn-run-summary', () => callHandler('runSummaryInsights'));
        bindClick('btn-run-actions', () => callHandler('runActionInsights'));
        bindClick('btn-custom-generate', () => callHandler('generateCustomAiResult'));
        bindClick('btn-mic-check', () => callHandler('runMicCheck'));
        bindClick('btn-jump-latest-floating', () => callHandler('scrollLogToLatest', dom.timeline, { force: true }));

        if (dom.timeline && dom.btnJumpLatestFloating) {
            const updateFabState = () => {
                const container = dom.timeline;
                if (!container) return;
                let distance;
                const containerScrolls = (container.scrollHeight - container.clientHeight) > 8;
                if (containerScrolls) {
                    distance = container.scrollHeight - container.scrollTop - container.clientHeight;
                } else {
                    const rect = container.getBoundingClientRect();
                    distance = rect.bottom - window.innerHeight;
                }
                const atBottom = distance < 80;
                dom.btnJumpLatestFloating.classList.toggle('is-at-bottom', atBottom);
                // F2: 共有フラグを更新。false = ユーザーが上にスクロール中。
                if (state) state.logAtBottom = atBottom;
            };
            dom.timeline.addEventListener('scroll', updateFabState, { passive: true });
            window.addEventListener('scroll', updateFabState, { passive: true });
            window.addEventListener('resize', updateFabState, { passive: true });
            const mo = new MutationObserver(updateFabState);
            mo.observe(dom.timeline, { childList: true, subtree: true });
            updateFabState();
        }

        bindClick('btn-clear-search', () => callHandler('clearSearch'));
        bindClick('summary-clear-search', () => callHandler('clearSearch'));
        bindClick('btn-close-edit-modal', () => callHandler('closeTranscriptModal'));
        bindClick('btn-cancel-edit-modal', () => callHandler('closeTranscriptModal'));
        bindClick('btn-save-edit-modal', () => callHandler('saveTranscriptFromModal'));
        bindClick('btn-close-memo-modal', () => callHandler('closeMemoModal'));
        bindClick('btn-cancel-memo-modal', () => callHandler('closeMemoModal'));
        bindClick('btn-save-memo-modal', () => callHandler('saveMemoFromModal'));

        bindEvent(setupMicSensitivity, 'change', (event) => callHandler('setMicSensitivity', event.target.value));
        bindEvent(meetingMicSensitivity, 'change', (event) => callHandler('setMicSensitivity', event.target.value));
        bindEvent(setupMicMinThreshold, 'input', () => callHandler('syncMicThresholdsFromUi', 'setup'));
        bindEvent(setupMicMaxThreshold, 'input', () => callHandler('syncMicThresholdsFromUi', 'setup'));
        bindEvent(meetingMicMinThreshold, 'input', () => callHandler('syncMicThresholdsFromUi', 'meeting'));
        bindEvent(meetingMicMaxThreshold, 'input', () => callHandler('syncMicThresholdsFromUi', 'meeting'));
        document.querySelectorAll('[data-mic-preset]').forEach((button) => {
            bindEvent(button, 'click', () => callHandler('applyMicPreset', button.dataset.micPreset));
        });

        Object.entries(meetingAiButtons).forEach(([key, button]) => {
            if (button) {
                button.onclick = () => callHandler('runMeetingAnalysis', key);
            }
        });

        bindEvent(editModalOverlay, 'click', (event) => {
            if (event.target === editModalOverlay) callHandler('closeTranscriptModal');
        });
        bindEvent(memoModalOverlay, 'click', (event) => {
            if (event.target === memoModalOverlay) callHandler('closeMemoModal');
        });
        bindEvent(editModalTextarea, 'input', (event) => {
            if (!state.activeModalUtteranceId) return;
            state.transcriptDrafts[state.activeModalUtteranceId] = event.target.value;
        });
        bindEvent(memoModalTextarea, 'input', (event) => {
            if (!state.activeMemoUtteranceId) return;
            state.noteDrafts[state.activeMemoUtteranceId] = event.target.value;
        });

        if (dom.aiProvider) {
            dom.aiProvider.onchange = (event) => {
                const provider = event.target.value;
                state.aiProvider = provider;
                state.aiModel = provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash';
                localStorage.setItem('ai_provider', state.aiProvider);
                localStorage.setItem('ai_model', state.aiModel);
                if (dom.aiModelInput) {
                    dom.aiModelInput.value = state.aiModel;
                }
                if (window.AppProfile?.saveSettings) {
                    try { window.AppProfile.saveSettings({ defaultAiProvider: provider }); }
                    catch (_) { /* ignore */ }
                }
            };
        }
        bindEvent(customAiInstruction, 'input', (event) => {
            state.aiWorkspace.instruction = event.target.value;
            state.editorDirty.aiInstruction = Date.now();
        });
        bindEvent(aiOutputEditor, 'input', (event) => {
            state.aiWorkspace.result = event.target.value;
            state.aiWorkspace.savedAt = null;
            state.editorDirty.aiResult = Date.now();
        });
        bindEvent(minutesOutputEditor, 'input', (event) => {
            state.minutesWorkspace.result = event.target.value;
            state.editorDirty.minutes = Date.now();
        });
        Object.entries(meetingAiEditors).forEach(([key, editor]) => {
            bindEvent(editor, 'input', (event) => {
                state.liveMeetingAnalysis.outputs[key] = event.target.value;
            });
        });

        filterInputs.forEach((input) => {
            bindEvent(input, 'input', () => {
                state.filters.query = input.value;
                callHandler('syncFilterControls');
                callHandler('renderAllLogs');
            });
        });
        filterButtons.starred.forEach((button) => {
            if (button) {
                button.onclick = () => callHandler('toggleFilter', 'starredOnly');
            }
        });
        filterButtons.mine.forEach((button) => {
            if (button) {
                button.onclick = () => callHandler('toggleFilter', 'mineOnly');
            }
        });
        filterButtons.noted.forEach((button) => {
            if (button) {
                button.onclick = () => callHandler('toggleFilter', 'notedOnly');
            }
        });
    }

    window.AppBindings = { bindAppEvents };
})();
