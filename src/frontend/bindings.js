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
        const isShareRoomMode = () => document.body.classList.contains('participant-share-mode');
        const refreshStartCta = () => {
            if (!startBtn) return;
            const hasRoomId = !!(roomIdInput && roomIdInput.value.trim());
            const participantMode = isParticipantMode();
            const account = window.AppAuth?.state?.account;
            startBtn.disabled = false;
            if (roomIdInput) {
                roomIdInput.readOnly = isShareRoomMode();
            }
            if (participantMode) {
                startBtn.textContent = hasRoomId ? 'この会議に参加する' : 'ルームIDを入力して参加';
                startBtn.disabled = !hasRoomId;
                if (startHint) {
                    startHint.textContent = hasRoomId
                        ? `ルーム ${roomIdInput.value.trim().toUpperCase()} にゲストとして参加します。ログインすると履歴にも保存できます。`
                        : '共有された6桁のルームIDを入力してください。ログインなしでも参加できます。';
                }
                return;
            }
            if (hasRoomId) {
                startBtn.textContent = 'この会議に参加する';
                if (startHint) {
                    startHint.textContent = `ルーム ${roomIdInput.value.trim().toUpperCase()} に参加します。`;
                }
                return;
            }
            startBtn.textContent = account ? '会議ルームを作成して開始' : 'ログインして会議を作成';
            if (startHint) {
                startHint.textContent = account
                    ? 'ホストとして新しい会議を作成します。'
                    : '会議作成にはログインが必要です。参加だけならルームIDで入れます。';
            }
            return;
        };

        if (startBtn) {
            startBtn.addEventListener('click', () => {
                // Easter egg: red テーマ + ログイン中なら会議の代わりにミニゲーム起動
                if (window.AppEasterGame && window.AppEasterGame.shouldIntercept && window.AppEasterGame.shouldIntercept()) {
                    window.AppEasterGame.startGame();
                    return;
                }
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
        window.addEventListener('app:setup-mode-changed', refreshStartCta);
        if (window.AppAuth?.onChange) {
            window.AppAuth.onChange(refreshStartCta);
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
            const unreadBadge = document.getElementById('btn-jump-latest-unread');
            const mobileScrollbar = dom.mobileLogScrollbar || document.getElementById('mobile-log-scrollbar');
            const mobileScrollThumb = dom.mobileLogScrollThumb || document.getElementById('mobile-log-scroll-thumb');
            const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);
            // FAB の at-bottom 閾値。FAB 自体が 50-70px、下端の余裕も含めて 120px 以内を
            // 「実質的に最下部」と見なす。これより上にいる時に新着が来たら未読バッジを増やす。
            const AT_BOTTOM_THRESHOLD_PX = 120;
            const updateFabState = () => {
                const container = dom.timeline;
                if (!container) return;
                let distance;
                const containerScrolls = (container.scrollHeight - container.clientHeight) > 8;
                if (containerScrolls) {
                    // 内部スクロールあり (PC)
                    distance = container.scrollHeight - container.scrollTop - container.clientHeight;
                } else {
                    // 内部スクロールなし (モバイル) → ページ全体スクロールを見る
                    const pageScrollable = document.documentElement.scrollHeight - window.innerHeight > 8;
                    if (pageScrollable) {
                        distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
                    } else {
                        distance = 0;
                    }
                }
                const atBottom = distance < AT_BOTTOM_THRESHOLD_PX;
                dom.btnJumpLatestFloating.classList.toggle('is-at-bottom', atBottom);
                // F2: 共有フラグを更新。false = ユーザーが上にスクロール中。
                if (state) {
                    state.logAtBottom = atBottom;
                    // 最下部に戻ったら未読カウントをリセット
                    if (atBottom && state.unreadUtterances) {
                        state.unreadUtterances = 0;
                        dom.btnJumpLatestFloating.classList.remove('has-unread');
                        if (unreadBadge) unreadBadge.textContent = '0';
                    }
                }
            };
            const syncMobileLogScrollbar = () => {
                if (!mobileScrollbar || !mobileScrollThumb) return;

                const container = dom.timeline;
                const isMeetingMobile = document.body.classList.contains('meeting-mode')
                    && window.matchMedia('(max-width: 1023px)').matches;
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (!isMeetingMobile || maxScroll <= 8 || mobileScrollbar.clientHeight <= 0) {
                    mobileScrollbar.classList.add('is-hidden');
                    mobileScrollbar.setAttribute('aria-hidden', 'true');
                    mobileScrollbar.setAttribute('aria-valuenow', '100');
                    mobileScrollbar.tabIndex = -1;
                    return;
                }

                // Custom rail mirrors the hidden native scrollbar on mobile.
                // It stays large enough for thumb operation and updates from
                // scroll, DOM mutation, resize, drag, and keyboard input.
                mobileScrollbar.classList.remove('is-hidden');
                mobileScrollbar.setAttribute('aria-hidden', 'false');
                mobileScrollbar.tabIndex = 0;
                const trackHeight = mobileScrollbar.clientHeight;
                const rawThumbHeight = Math.round(trackHeight * (container.clientHeight / container.scrollHeight));
                const thumbHeight = clampNumber(rawThumbHeight, 54, Math.max(54, trackHeight));
                const travel = Math.max(trackHeight - thumbHeight, 1);
                const top = Math.round((container.scrollTop / maxScroll) * travel);
                const percent = Math.round((container.scrollTop / maxScroll) * 100);

                mobileScrollThumb.style.height = `${thumbHeight}px`;
                mobileScrollThumb.style.transform = `translateY(${top}px)`;
                mobileScrollbar.setAttribute('aria-valuenow', String(clampNumber(percent, 0, 100)));
            };
            const scrollMobileLogByRatio = (clientY, dragOffset = 0) => {
                if (!mobileScrollbar || !mobileScrollThumb) return;
                const container = dom.timeline;
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (maxScroll <= 0) return;

                const railRect = mobileScrollbar.getBoundingClientRect();
                const thumbHeight = mobileScrollThumb.offsetHeight || 54;
                const travel = Math.max(railRect.height - thumbHeight, 1);
                const nextTop = clampNumber(clientY - railRect.top - dragOffset, 0, travel);
                container.scrollTop = Math.round((nextTop / travel) * maxScroll);
                syncMobileLogScrollbar();
            };
            if (mobileScrollbar && mobileScrollThumb) {
                let draggingPointerId = null;
                let dragOffset = 0;

                mobileScrollbar.addEventListener('pointerdown', (event) => {
                    if (mobileScrollbar.classList.contains('is-hidden')) return;
                    const thumbRect = mobileScrollThumb.getBoundingClientRect();
                    const pressedThumb = event.target === mobileScrollThumb || mobileScrollThumb.contains(event.target);
                    dragOffset = pressedThumb ? event.clientY - thumbRect.top : thumbRect.height / 2;
                    draggingPointerId = event.pointerId;
                    mobileScrollbar.setPointerCapture(event.pointerId);
                    scrollMobileLogByRatio(event.clientY, dragOffset);
                    event.preventDefault();
                });

                mobileScrollbar.addEventListener('pointermove', (event) => {
                    if (draggingPointerId !== event.pointerId) return;
                    scrollMobileLogByRatio(event.clientY, dragOffset);
                    event.preventDefault();
                });

                const stopDrag = (event) => {
                    if (draggingPointerId !== event.pointerId) return;
                    draggingPointerId = null;
                    dragOffset = 0;
                    try { mobileScrollbar.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
                };
                mobileScrollbar.addEventListener('pointerup', stopDrag);
                mobileScrollbar.addEventListener('pointercancel', stopDrag);
                mobileScrollbar.addEventListener('keydown', (event) => {
                    const container = dom.timeline;
                    const pageStep = Math.max(container.clientHeight - 60, 120);
                    const smallStep = 72;
                    if (event.key === 'ArrowDown') {
                        container.scrollTop += smallStep;
                    } else if (event.key === 'ArrowUp') {
                        container.scrollTop -= smallStep;
                    } else if (event.key === 'PageDown') {
                        container.scrollTop += pageStep;
                    } else if (event.key === 'PageUp') {
                        container.scrollTop -= pageStep;
                    } else if (event.key === 'Home') {
                        container.scrollTop = 0;
                    } else if (event.key === 'End') {
                        container.scrollTop = container.scrollHeight;
                    } else {
                        return;
                    }
                    syncMobileLogScrollbar();
                    event.preventDefault();
                });
            }
            // 未読バッジ反映用 (state.unreadUtterances が他所で更新された時に呼ばれる)
            window.AppLogUiUnreadSync = () => {
                if (!state) return;
                const n = state.unreadUtterances || 0;
                if (n > 0 && !state.logAtBottom) {
                    dom.btnJumpLatestFloating.classList.add('has-unread');
                    if (unreadBadge) unreadBadge.textContent = '+' + n;
                } else {
                    dom.btnJumpLatestFloating.classList.remove('has-unread');
                    if (unreadBadge) unreadBadge.textContent = '0';
                }
            };
            const updateScrollAffordances = () => {
                updateFabState();
                syncMobileLogScrollbar();
            };
            dom.timeline.addEventListener('scroll', updateScrollAffordances, { passive: true });
            window.addEventListener('scroll', updateScrollAffordances, { passive: true });
            window.addEventListener('resize', updateScrollAffordances, { passive: true });
            const mo = new MutationObserver(updateScrollAffordances);
            mo.observe(dom.timeline, { childList: true, subtree: true });
            updateScrollAffordances();
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
                // The provider select is now disabled and contains a single
                // Groq option, but this handler remains for older DOM states
                // and tests. Always normalize to the fixed provider pair.
                const provider = state.fixedAiProvider || 'groq';
                event.target.value = provider;
                state.aiProvider = provider;
                state.aiModel = state.fixedAiModel || 'openai/gpt-oss-120b';
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
