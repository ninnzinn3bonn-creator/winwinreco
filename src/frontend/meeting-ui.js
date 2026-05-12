(function initMeetingUiModule() {
    const { state } = window.AppState;
    const dom = window.AppDom;
    const { getJoinUrl, isMobileViewport, readApiResponse } = window.AppUtils;

    function switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
        const tabBtn = document.getElementById(`tab-${tab}`);
        const panelEl = document.getElementById(`panel-${tab}`);
        if (tabBtn) tabBtn.classList.add('active');
        if (panelEl) panelEl.classList.add('active');
        renderSummaryMobileControls();
        try { localStorage.setItem('summary_last_tab', tab); } catch (_) { /* ignore */ }
    }

    function pickInitialSummaryTab(justEnded) {
        if (justEnded) return 'minutes';
        try {
            const last = localStorage.getItem('summary_last_tab');
            if (last === 'log' || last === 'minutes' || last === 'ai') return last;
        } catch (_) { /* ignore */ }
        return 'log';
    }

    function updateLogWorkState() {
        state.isWorkingOnLog = !!state.activeModalUtteranceId || !!state.activeMemoUtteranceId;
    }

    function addSystemMessage(text) {
        state.activityItems.push({
            type: 'system',
            id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            text,
            timestamp: new Date().toISOString()
        });
        window.AppLogUi?.renderAllLogs?.();
    }

    function addMemo() {
        const memo = prompt('全体メモを入力してください:');
        if (memo) addSystemMessage(`全体メモ: ${memo}`);
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

    function renderMobileMeetingControls() {
        const mobile = isMobileViewport();
        const menuButton = document.getElementById('btn-mobile-menu');
        const settingsButton = document.getElementById('btn-meeting-mic-settings');
        const memoryButton = document.getElementById('btn-toggle-memory-panel');
        const aiButton = document.getElementById('btn-toggle-ai-panel');

        if (!mobile) {
            state.mobileMemoryCollapsed = false;
            state.mobileAiCollapsed = false;
        }

        document.body.classList.toggle('mobile-memory-collapsed', mobile && state.mobileMemoryCollapsed);
        document.body.classList.toggle('mobile-ai-collapsed', mobile && state.mobileAiCollapsed);

        const drawerOpen = !!state.mobileMenuOpen;
        if (dom.mobileMeetingMenu) {
            dom.mobileMeetingMenu.classList.toggle('active', drawerOpen);
            dom.mobileMeetingMenu.classList.toggle('hidden', !drawerOpen);
            dom.mobileMeetingMenu.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
        }
        if (menuButton) {
            menuButton.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
            menuButton.innerText = drawerOpen ? '✕' : '☰';
        }
        if (settingsButton) settingsButton.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
        if (memoryButton) {
            memoryButton.innerText = state.mobileMemoryCollapsed ? '会話メモリを表示' : '会話メモリを折りたたむ';
        }
        if (aiButton) {
            aiButton.innerText = state.mobileAiCollapsed ? '会議中AIを表示' : '会議中AIを折りたたむ';
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

        if (dom.summaryMobileMenu) {
            dom.summaryMobileMenu.classList.toggle('active', mobile && state.summaryMobileMenuOpen);
            dom.summaryMobileMenu.classList.toggle('hidden', !(mobile && state.summaryMobileMenuOpen));
            dom.summaryMobileMenu.setAttribute('aria-hidden', mobile && state.summaryMobileMenuOpen ? 'false' : 'true');
        }
        if (menuButton) {
            menuButton.setAttribute('aria-expanded', mobile && state.summaryMobileMenuOpen ? 'true' : 'false');
            menuButton.innerText = mobile && state.summaryMobileMenuOpen ? '✕' : '☰';
        }
        if (statsButton) {
            statsButton.innerText = state.summaryStatsCollapsed ? '集計を表示' : '集計を折りたたむ';
        }
        if (sidebarButton) {
            sidebarButton.innerText = state.summarySidebarCollapsed ? '絞り込みと重要ログを表示' : '絞り込みと重要ログを折りたたむ';
        }
        if (aiControlsButton) {
            aiControlsButton.innerText = state.summaryAiControlsCollapsed ? 'AI操作を表示' : 'AI操作を折りたたむ';
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

    async function downloadMinutes() {
        if (!state.roomId) return;
        window.location.href = window.AppMain.withAuthQuery(`/rooms/${state.roomId}/download`);
    }

    function copyRoomId() {
        if (!state.roomId) return;
        const joinUrl = getJoinUrl(state.roomId);
        navigator.clipboard.writeText(joinUrl).then(() => {
            window.AppToast.success('参加URLをコピーしました');
        });
    }

    async function joinRoom() {
        const displayName = document.getElementById('display-name').value.trim();
        const profileText = document.getElementById('profile-text').value.trim();
        const roomId = document.getElementById('room-id').value.trim().toUpperCase();
        if (!displayName || !roomId) return window.AppToast.warn('表示名とルームIDを入力してください');
        if (!await window.AppAudio.prepareAudio()) return;
        await joinRoomProcess(roomId, displayName, profileText);
    }

    async function createRoom() {
        const profileText = document.getElementById('profile-text').value.trim();
        let account = window.AppAuth ? window.AppAuth.state.account : null;
        if (!account && window.AppAuth) {
            account = await window.AppAuth.requireLogin();
        }
        if (!account) return;

        const displayNameInput = document.getElementById('display-name');
        let displayName = (displayNameInput?.value || '').trim();
        if (!displayName) {
            displayName = account.display_name || (account.email ? account.email.split('@')[0] : 'ホスト');
            if (displayNameInput) displayNameInput.value = displayName;
        }

        if (!await window.AppAudio.prepareAudio()) return;
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
            const userId = window.AppMain.ensureLocalUserId();
            const usePastMeetings = !!document.getElementById('use-past-meetings')?.checked;

            localStorage.setItem('ai_provider', state.aiProvider);
            localStorage.setItem('ai_model', state.aiModel);
            localStorage.setItem('use_past_meetings', usePastMeetings ? '1' : '0');
            state.usePastMeetings = usePastMeetings;

            const res = await fetch(`/rooms/${normalizedRoomId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    user_id: userId,
                    display_name: displayName,
                    location_id: 'web-browser',
                    profile_text: profileText,
                    ai_config: {
                        provider: state.aiProvider,
                        model: state.aiModel,
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
        } catch (_) {
            window.AppToast.error('ルーム参加に失敗しました');
        }
    }

    function showMeetingScreen() {
        state.activeModalUtteranceId = null;
        state.activeMemoUtteranceId = null;
        document.body.classList.remove('modal-open');
        window.AppLogUi.renderEditModal();
        window.AppLogUi.renderMemoModal();
        document.body.classList.remove('setup-mode', 'summary-mode');
        document.body.classList.add('meeting-mode');
        dom.setupScreen.classList.remove('active');
        dom.summaryScreen.classList.remove('active');
        dom.meetingScreen.classList.add('active');
        window.AppMain.setFlowProgressStep('meeting');
        dom.roomInfo.innerText = `ルーム: ${state.roomId}`;
        // 終了ボタンはホストのみ表示
        const endBtn = document.getElementById('btn-end');
        if (endBtn) endBtn.hidden = !state.isHost;
        window.AppAudio.syncMuteUi();
        state.mobileMenuOpen = false;
        state.mobileMemoryCollapsed = true;
        state.mobileAiCollapsed = true;
        renderMobileMeetingControls();
        window.AppAudio.requestWakeLock();
        autoConnectMicIfPermitted().catch((err) => {
            window.AppMain?.AppDebug?.log('info', 'Auto mic connect skipped', err && err.message);
        });
    }

    async function autoConnectMicIfPermitted() {
        if (!navigator.permissions?.query) return;
        try {
            const status = await navigator.permissions.query({ name: 'microphone' });
            if (status.state !== 'granted') return;
            const tryStart = async (attempt = 0) => {
                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    await window.AppAudio.reconnectMic();
                    return;
                }
                if (attempt >= 8) return;
                setTimeout(() => tryStart(attempt + 1), 500);
            };
            await tryStart();
        } catch (error) {
            window.AppMain?.AppDebug?.log('info', 'Permission query unavailable for auto-connect', error.message);
        }
    }

    function showSummaryScreen({ justEnded = false } = {}) {
        state.activeModalUtteranceId = null;
        state.activeMemoUtteranceId = null;
        document.body.classList.remove('modal-open');
        window.AppLogUi.renderEditModal();
        window.AppLogUi.renderMemoModal();
        document.body.classList.remove('setup-mode', 'meeting-mode');
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
        dom.meetingScreen.classList.remove('active');
        dom.summaryScreen.classList.add('active');
        window.AppMain.setFlowProgressStep('summary');
        dom.summaryInfo.innerText = `ルーム: ${state.roomId}`;
        window.AppAudio.releaseWakeLock();
        switchTab(pickInitialSummaryTab(justEnded));
        loadRoomLogs().then(() => {
            window.AppLogUi.renderAllLogs();
            window.scrollTo({ top: 0, behavior: 'auto' });
            window.AppSharedAi.loadMeetingInsights({ silent: true });
        });
    }

    async function loadRoomLogs() {
        if (!state.roomId) return;
        try {
            const res = await fetch(window.AppMain.withAuthQuery(`/rooms/${state.roomId}/logs`));
            if (!res.ok) throw new Error('ログ取得に失敗しました');
            const logs = await readApiResponse(res);
            state.activityItems = state.activityItems.filter((item) => item.type === 'system');
            logs.forEach((entry) => window.AppLogUi.upsertUtterance(entry));
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'Failed to load logs', error.message);
        }
    }

    // [U-3] --- WebSocket 再接続堅牢化 ---

    // 試行回数の上限
    const WS_MAX_ATTEMPTS = 10;
    // バックオフ上限 ms
    const WS_MAX_BACKOFF_MS = 30_000;
    // バックオフ列 (ms): 1s,2s,4s,8s,16s,30s,30s...
    function wsNextBackoff(attempt) {
        if (attempt <= 0) return 1_000;
        const raw = Math.pow(2, attempt - 1) * 1_000;
        return Math.min(raw, WS_MAX_BACKOFF_MS);
    }

    function updateWsStatus(status) {
        state.wsReconnect.status = status;
        renderWsBadge();
    }

    function renderWsBadge() {
        const badge = document.getElementById('ws-status-badge');
        if (!badge) return;
        const { status, attempt } = state.wsReconnect;
        if (status === 'idle') {
            badge.hidden = true;
            badge.className = 'ws-status-badge';
            badge.textContent = '';
            return;
        }
        badge.hidden = false;
        badge.className = `ws-status-badge ws-status-${status}`;
        if (status === 'connected') {
            badge.textContent = '';
            badge.title = '接続中';
        } else if (status === 'reconnecting') {
            badge.textContent = `再接続中... ${attempt}回目`;
            badge.title = `再接続試行中 (${attempt}/${WS_MAX_ATTEMPTS})`;
        } else if (status === 'disconnected') {
            badge.textContent = '切断';
            badge.title = '切断。手動再接続してください';
        }
    }

    function scheduleReconnect() {
        const attempt = state.wsReconnect.attempt + 1;
        state.wsReconnect.attempt = attempt;

        if (attempt > WS_MAX_ATTEMPTS) {
            updateWsStatus('disconnected');
            window.AppToast.error('再接続に失敗しました。ページを再読み込みしてください', { sticky: true });
            return;
        }

        const backoffMs = wsNextBackoff(attempt);
        state.wsReconnect.backoffMs = backoffMs;
        updateWsStatus('reconnecting');
        setTimeout(connectWs, backoffMs);
    }

    function connectWs() {
        // 意図的切断なら再接続しない
        if (state.wsIntentional) return;
        // 会議画面にいない場合は再接続しない
        if (!dom.meetingScreen.classList.contains('active')) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({
            participantId: state.participantId || '',
            controlToken: state.controlToken || '',
            roomId: state.roomId || ''
        });
        const wsUrl = `${protocol}//${window.location.host}?${params.toString()}`;
        state.ws = new WebSocket(wsUrl);

        state.ws.onopen = () => {
            const wasReconnecting = state.wsReconnect.status === 'reconnecting';
            // リセット
            state.wsReconnect.attempt = 0;
            state.wsReconnect.backoffMs = 0;
            updateWsStatus('connected');

            if (wasReconnecting) {
                window.AppToast.success('再接続しました');
            }

            // hello + 差分復元用の last_seen_utterance_id を送信
            state.ws.send(JSON.stringify({
                type: 'hello',
                last_seen_utterance_id: state.lastSeenUtteranceId || null
            }));
            window.AppAudio.sendMicPresetMetadataToServer();

            // 切断中に溜まった PCM バッファを flush
            window.AppAudio.flushPendingAudio();
        };

        state.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript_interim') {
                window.AppLogUi.showProvisional(msg);
            } else if (msg.type === 'transcript') {
                window.AppLogUi.clearProvisional(msg.participant_id);
                window.AppLogUi.upsertUtterance(msg);
                window.AppLogUi.renderAllLogs();
                window.AppLogUi.scrollLogToLatest(dom.timeline);
                // 最新 utterance ID を記録
                if (msg.id) state.lastSeenUtteranceId = msg.id;
            } else if (msg.type === 'ready') {
                // F4: ホスト指定の STT 設定を state に保存し、mic_preset 送信時に使用する。
                if (msg.room_stt_provider) {
                    state.roomSttProvider = msg.room_stt_provider;
                    try { localStorage.setItem('stt_provider', msg.room_stt_provider); } catch (_) { /* ignore */ }
                }
                if (msg.room_stt_language) {
                    state.roomSttLanguage = msg.room_stt_language;
                }
                const historyEntries = msg.history || [];
                historyEntries.forEach((entry) => window.AppLogUi.upsertUtterance(entry));
                // 差分履歴の最後の ID を lastSeenUtteranceId として保持
                if (historyEntries.length > 0) {
                    const last = historyEntries[historyEntries.length - 1];
                    if (last.id) state.lastSeenUtteranceId = last.id;
                }
                window.AppLogUi.renderAllLogs();
                window.AppAudio.startRecording({ onAudioChunk: (pcm) => window.AppAudio.sendAudioChunk(pcm) });
            } else if (msg.type === 'terminated') {
                // 会議終了は意図的なサーバー側終了
                state.wsIntentional = true;
                window.AppAudio.stopRecording();
                showSummaryScreen();
            } else if (msg.type === 'chunk_progress') {
                const { analysis_type: analysisType, completed, total } = msg;
                if (analysisType === 'minutes') {
                    state.minutesWorkspace.progress = total > 1 ? { completed, total } : null;
                    window.AppSharedAi.renderMinutesWorkspace();
                } else {
                    state.aiWorkspace.progress = total > 1 ? { completed, total } : null;
                    window.AppSharedAi.renderAiWorkspace();
                }
            }
        };

        state.ws.onclose = () => {
            // 意図的切断なら再接続しない
            if (state.wsIntentional) return;
            // 会議画面にいない場合は再接続しない
            if (!dom.meetingScreen.classList.contains('active')) return;

            // 初回切断のみ warn Toast
            if (state.wsReconnect.status !== 'reconnecting') {
                window.AppToast.warn('接続が切れました。再接続を試みます...');
            }
            scheduleReconnect();
        };

        state.ws.onerror = () => {
            window.AppMain?.AppDebug?.log('error', 'WebSocket Error occurred');
        };
    }

    // 後方互換エイリアス (既存コードが initWebSocket() を呼んでいる箇所用)
    function initWebSocket() {
        state.wsIntentional = false;
        state.wsReconnect.attempt = 0;
        state.wsReconnect.backoffMs = 0;
        updateWsStatus('idle');
        connectWs();
    }

    function scrollToPageEdge(direction) {
        const activePanel = document.querySelector('.tab-panel.active');
        const target = activePanel || document.scrollingElement || document.documentElement;
        const top = direction === 'top' ? 0 : target.scrollHeight;
        target.scrollTo({ top, behavior: 'smooth' });
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
            // [U-3] 意図的切断フラグを立ててから停止 (再接続ループ防止)
            state.wsIntentional = true;
            if (state.ws) state.ws.close();
            updateWsStatus('idle');
            window.AppAudio.stopRecording();
            showSummaryScreen({ justEnded: true });
        } catch (error) {
            window.AppToast.error('終了処理に失敗しました', { detail: error.message });
        }
    }

    window.AppMeetingUi = {
        switchTab,
        pickInitialSummaryTab,
        updateLogWorkState,
        addSystemMessage,
        addMemo,
        toggleMobileMeetingMenu,
        toggleMobileMemoryPanel,
        toggleMobileAiPanel,
        renderMobileMeetingControls,
        renderSummaryMobileControls,
        toggleSummaryMobileMenu,
        toggleSummaryStats,
        toggleSummarySidebar,
        toggleSummaryAiControls,
        downloadMinutes,
        copyRoomId,
        joinRoom,
        createRoom,
        joinRoomProcess,
        showMeetingScreen,
        autoConnectMicIfPermitted,
        showSummaryScreen,
        loadRoomLogs,
        initWebSocket,
        connectWs,
        scheduleReconnect,
        updateWsStatus,
        renderWsBadge,
        scrollToPageEdge,
        endRoom
    };
})();
