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

    async function showRecordingConsentIfNeeded() {
        try {
            if (localStorage.getItem('recording_consent') === '1') return true;
        } catch (_) { /* ignore */ }
        return await new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'auth-modal-overlay';
            overlay.innerHTML = `
                <div class="auth-modal-wrapper consent-modal">
                    <h2 class="auth-modal-title">録音とAI処理の同意</h2>
                    <p>この会議は録音され、文字起こし・議事録・要約・ToDoが自動生成されます。</p>
                    <p>処理には Google Cloud / Gemini / Groq / ElevenLabs などの外部 AI サービスが利用される場合があります。</p>
                    <p><a href="/terms" target="_blank" rel="noopener">利用規約</a>・<a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a>をご確認ください。</p>
                    <label class="consent-remember">
                        <input type="checkbox" id="consent-remember-checkbox" checked>
                        <span>次回以降この確認を表示しない</span>
                    </label>
                    <div class="auth-modal-actions">
                        <button type="button" id="consent-cancel" class="ghost-btn">キャンセル</button>
                        <button type="button" id="consent-ok" class="primary">同意して参加する</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const cleanup = () => overlay.remove();
            overlay.querySelector('#consent-cancel').addEventListener('click', () => { cleanup(); resolve(false); });
            overlay.querySelector('#consent-ok').addEventListener('click', () => {
                try {
                    if (overlay.querySelector('#consent-remember-checkbox').checked) {
                        localStorage.setItem('recording_consent', '1');
                    }
                } catch (_) { /* ignore */ }
                cleanup();
                resolve(true);
            });
        });
    }

    async function joinRoom() {
        const displayName = document.getElementById('display-name').value.trim();
        const profileText = document.getElementById('profile-text').value.trim();
        const roomId = document.getElementById('room-id').value.trim().toUpperCase();
        if (!displayName || !roomId) return window.AppToast.warn('表示名とルームIDを入力してください');
        if (!await showRecordingConsentIfNeeded()) return;
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

        if (!await showRecordingConsentIfNeeded()) return;
        if (!await window.AppAudio.prepareAudio()) return;
        try {
            const seriesSelect = document.getElementById('series-id');
            const seriesId = seriesSelect?.value || '';
            const body = {};
            if (seriesId) {
                body.series_id = seriesId;
                // 選択したシリーズの latest_agenda_text を localStorage に一時保存
                try {
                    const serRes = await fetch(`/me/series/${seriesId}`, { credentials: 'same-origin' });
                    if (serRes.ok) {
                        const serData = await serRes.json();
                        if (serData.latest_agenda_text) {
                            localStorage.setItem('series_latest_agenda', serData.latest_agenda_text);
                        }
                    }
                } catch (_) {}
            }
            const res = await fetch('/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body)
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

    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({
            participantId: state.participantId || '',
            controlToken: state.controlToken || '',
            roomId: state.roomId || ''
        });
        const wsUrl = `${protocol}//${window.location.host}?${params.toString()}`;
        state.ws = new WebSocket(wsUrl);
        state.ws.onopen = () => {
            addSystemMessage('サーバーに接続しました。');
            state.ws.send(JSON.stringify({ type: 'hello' }));
            window.AppAudio.sendMicPresetMetadataToServer();
        };
        state.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript_interim') {
                window.AppLogUi.showProvisional(msg);
            } else if (msg.type === 'transcript') {
                // Fix B-4: transcript 受信時刻を記録
                state.lastTranscriptAt = Date.now();
                window.AppLogUi.clearProvisional(msg.participant_id);
                window.AppLogUi.upsertUtterance(msg);
                window.AppLogUi.renderAllLogs();
                window.AppLogUi.scrollLogToLatest(dom.timeline);
            } else if (msg.type === 'ready') {
                // Fix B-4: 受信時刻を初期化して空転監視を開始
                state.lastTranscriptAt = Date.now();
                state.lastAudioSentAt = 0;
                window.AppAudio.startTranscriptStallWatchdog();
                // F4: ホスト指定の STT 設定を state に保存し、mic_preset 送信時に使用する。
                if (msg.room_stt_provider) {
                    state.roomSttProvider = msg.room_stt_provider;
                    try { localStorage.setItem('stt_provider', msg.room_stt_provider); } catch (_) { /* ignore */ }
                }
                if (msg.room_stt_language) {
                    state.roomSttLanguage = msg.room_stt_language;
                }
                (msg.history || []).forEach((entry) => window.AppLogUi.upsertUtterance(entry));
                window.AppLogUi.renderAllLogs();
                window.AppAudio.startRecording({ onAudioChunk: (pcm) => state.ws.send(pcm) });
            } else if (msg.type === 'terminated') {
                addSystemMessage('会議が終了しました。');
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
            addSystemMessage('接続が切れました。再接続を試みます...');
            if (dom.meetingScreen.classList.contains('active')) {
                setTimeout(initWebSocket, 3000);
            }
        };
        state.ws.onerror = () => {
            window.AppMain?.AppDebug?.log('error', 'WebSocket Error occurred');
        };
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
        scrollToPageEdge,
        endRoom
    };
})();
