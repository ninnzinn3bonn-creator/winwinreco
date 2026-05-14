(function initSharedAiModule() {
    const { state } = window.AppState;
    const dom = window.AppDom;
    const { formatTime, downloadTextFile, readApiResponse } = window.AppUtils;

    let aiWorkspacePersistTimer = null;

    // Past-meeting selector state
    // mode: 'auto' | 'off' | 'manual'
    state.pastMeetingMode = state.pastMeetingMode || 'auto';
    state.selectedPastRoomIds = state.selectedPastRoomIds || [];

    // ---------- Past meeting selector UI ----------

    let _pastRoomCache = null; // { rooms: [...], fetchedAt: timestamp }

    async function fetchPastRoomsForSelector() {
        if (_pastRoomCache && (Date.now() - _pastRoomCache.fetchedAt) < 5 * 60 * 1000) {
            return _pastRoomCache.rooms;
        }
        try {
            const res = await fetch('/me/rooms', { credentials: 'same-origin' });
            if (!res.ok) return [];
            const data = await res.json();
            const rooms = (Array.isArray(data?.rooms) ? data.rooms : [])
                .filter((r) => r.ended_at && r.is_owner)
                .slice(0, 30);
            _pastRoomCache = { rooms, fetchedAt: Date.now() };
            return rooms;
        } catch (_) {
            return [];
        }
    }

    function renderPastMeetingSelector() {
        const container = document.getElementById('past-meeting-selector');
        if (!container) return;

        const mode = state.pastMeetingMode || 'auto';
        // Update radio buttons
        container.querySelectorAll('input[name="past-meeting-mode"]').forEach((radio) => {
            radio.checked = radio.value === mode;
        });

        const listEl = container.querySelector('.past-meeting-list');
        if (listEl) {
            listEl.hidden = mode !== 'manual';
        }
    }

    async function buildPastMeetingSelector() {
        const anchor = document.getElementById('past-meeting-selector-anchor');
        if (!anchor || document.getElementById('past-meeting-selector')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'past-meeting-selector';
        wrapper.id = 'past-meeting-selector';

        const modeOptions = [
            { value: 'auto', label: '自動 (直近5件)' },
            { value: 'off', label: '使わない' },
            { value: 'manual', label: '手動で選ぶ' }
        ];

        const radioGroup = document.createElement('div');
        radioGroup.className = 'past-meeting-mode-group';
        modeOptions.forEach(({ value, label }) => {
            const lbl = document.createElement('label');
            lbl.className = 'past-meeting-mode';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'past-meeting-mode';
            radio.value = value;
            radio.checked = (state.pastMeetingMode || 'auto') === value;
            radio.addEventListener('change', () => {
                state.pastMeetingMode = value;
                renderPastMeetingSelector();
                if (value === 'manual') {
                    populatePastMeetingList(wrapper);
                }
            });
            lbl.append(radio, document.createTextNode(' ' + label));
            radioGroup.appendChild(lbl);
        });

        const listEl = document.createElement('div');
        listEl.className = 'past-meeting-list';
        listEl.hidden = (state.pastMeetingMode || 'auto') !== 'manual';

        wrapper.appendChild(radioGroup);
        wrapper.appendChild(listEl);
        anchor.after(wrapper);

        if ((state.pastMeetingMode || 'auto') === 'manual') {
            await populatePastMeetingList(wrapper);
        }
    }

    async function populatePastMeetingList(wrapper) {
        const listEl = wrapper ? wrapper.querySelector('.past-meeting-list') : document.querySelector('#past-meeting-selector .past-meeting-list');
        if (!listEl) return;
        listEl.innerHTML = '<span class="past-meeting-loading">読み込み中...</span>';
        const rooms = await fetchPastRoomsForSelector();
        listEl.innerHTML = '';
        if (!rooms.length) {
            listEl.innerHTML = '<span class="past-meeting-empty">過去の終了済み会議がありません。</span>';
            return;
        }
        rooms.forEach((room) => {
            const lbl = document.createElement('label');
            lbl.className = 'past-meeting-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = room.id;
            cb.checked = state.selectedPastRoomIds.includes(room.id);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!state.selectedPastRoomIds.includes(room.id)) {
                        state.selectedPastRoomIds = [...state.selectedPastRoomIds, room.id];
                    }
                } else {
                    state.selectedPastRoomIds = state.selectedPastRoomIds.filter((id) => id !== room.id);
                }
            });
            const dateStr = room.ended_at
                ? new Date(room.ended_at).toLocaleDateString('ja-JP')
                : (room.created_at ? new Date(room.created_at).toLocaleDateString('ja-JP') : '');
            const titleText = room.title || `会議 (${room.id.slice(0, 8)})`;
            const span = document.createElement('span');
            span.textContent = ` 「${titleText}」 (${dateStr})`;
            lbl.append(cb, span);
            listEl.appendChild(lbl);
        });
    }

    function getPastMeetingApiPayload() {
        const mode = state.pastMeetingMode || 'auto';
        if (mode === 'off') {
            return { use_past_context: false };
        }
        if (mode === 'manual') {
            return {
                use_past_context: state.selectedPastRoomIds.length > 0,
                past_room_ids: [...state.selectedPastRoomIds]
            };
        }
        // auto: use existing checkbox behaviour
        const ctxBox = document.getElementById('use-past-meetings');
        return { use_past_context: ctxBox ? !!ctxBox.checked : true };
    }

    function renderMinutesWorkspace() {
        if (!dom.minutesOutputEditor || !dom.minutesWorkspaceStatus) return;
        const nextMinutes = state.minutesWorkspace.result || 'ここに議事録が表示されます。';
        if (document.activeElement !== dom.minutesOutputEditor && dom.minutesOutputEditor.value !== nextMinutes) {
            dom.minutesOutputEditor.value = nextMinutes;
        }
        const isLoading = !!state.minutesWorkspace.loading || state.meetingInsights.status === 'processing';
        if (dom.minutesOutputCard) dom.minutesOutputCard.classList.toggle('is-loading', isLoading);
        if (dom.minutesOutputLoading) dom.minutesOutputLoading.classList.toggle('hidden', !isLoading);
        dom.minutesOutputEditor.classList.toggle('is-busy', isLoading);

        const progressWrap = document.getElementById('minutes-progress-wrap');
        const progressBar = document.getElementById('minutes-progress-bar');
        const loadingText = document.getElementById('minutes-loading-text');
        const progress = state.minutesWorkspace.progress;
        if (progressWrap && progressBar) {
            if (isLoading && progress && progress.total > 1) {
                progressWrap.classList.remove('hidden');
                progressBar.style.width = `${Math.round(progress.completed / progress.total * 100)}%`;
                if (loadingText) loadingText.textContent = `議事録を生成中です... (${progress.completed}/${progress.total} チャンク)`;
            } else {
                progressWrap.classList.add('hidden');
                if (loadingText) loadingText.textContent = '議事録を生成中です...';
            }
        }

        if (isLoading) {
            dom.minutesWorkspaceStatus.innerHTML = '<span class="spinner inline-spinner"></span> 議事録を生成中です...';
            return;
        }
        if (!isLoading && state.minutesWorkspace.progress) state.minutesWorkspace.progress = null;
        if (state.minutesWorkspace.updatedAt) {
            dom.minutesWorkspaceStatus.innerText = `最終更新: ${new Date(state.minutesWorkspace.updatedAt).toLocaleString('ja-JP')}`;
            return;
        }
        dom.minutesWorkspaceStatus.innerText = '生ログを元に、自動調整した議事録をここで確認できます。';
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
            dom.aiWorkspaceStatus.innerHTML = '<span class="spinner inline-spinner"></span> 共有AI結果を生成中です...';
            return;
        }
        if (state.meetingInsights.status === 'error') {
            dom.aiWorkspaceStatus.innerText = '共有AI結果の生成に失敗しました。';
            return;
        }
        if (state.meetingInsights.updatedAt) {
            dom.aiWorkspaceStatus.innerText = `最終更新: ${new Date(state.meetingInsights.updatedAt).toLocaleString('ja-JP')}`;
            return;
        }
        dom.aiWorkspaceStatus.innerText = isHost
            ? 'ホストが生成すると、共有結果がここに表示されます。'
            : 'ホストが生成した共有結果をここで確認できます。';
    }

    function clearInsightsPoll() {
        if (state.meetingInsights.pollTimer) {
            clearTimeout(state.meetingInsights.pollTimer);
            state.meetingInsights.pollTimer = null;
        }
    }

    function scheduleInsightsPoll() {
        clearInsightsPoll();
        if (state.meetingInsights.status !== 'processing') return;
        state.meetingInsights.pollTimer = setTimeout(() => {
            if (dom.summaryScreen.classList.contains('active')) {
                loadMeetingInsights({ silent: true });
            }
        }, 5000);
    }

    function isEditorDirty(key, withinMs = 30_000) {
        const ts = state.editorDirty[key];
        return ts > 0 && (Date.now() - ts) < withinMs;
    }

    function renderAiWorkspace() {
        const nextInstruction = state.aiWorkspace.instruction || '';
        if (document.activeElement !== dom.customAiInstruction && dom.customAiInstruction.value !== nextInstruction) {
            dom.customAiInstruction.value = nextInstruction;
        }
        dom.aiOutputTitle.innerText = state.aiWorkspace.title || '解析結果';
        const nextResult = state.aiWorkspace.result || 'ここに解析結果が表示されます。';
        if (document.activeElement !== dom.aiOutputEditor && dom.aiOutputEditor.value !== nextResult) {
            dom.aiOutputEditor.value = nextResult;
        }
        const isLoading = !!state.aiWorkspace.loading || state.meetingInsights.status === 'processing';
        if (dom.aiOutputCard) dom.aiOutputCard.classList.toggle('is-loading', isLoading);
        if (dom.aiOutputLoading) dom.aiOutputLoading.classList.toggle('hidden', !isLoading);
        dom.aiOutputEditor.classList.toggle('is-busy', isLoading);

        const progressWrap = document.getElementById('ai-progress-wrap');
        const progressBar = document.getElementById('ai-progress-bar');
        const loadingText = document.getElementById('ai-loading-text');
        const progress = state.aiWorkspace.progress;
        if (progressWrap && progressBar) {
            if (isLoading && progress && progress.total > 1) {
                progressWrap.classList.remove('hidden');
                progressBar.style.width = `${Math.round(progress.completed / progress.total * 100)}%`;
                if (loadingText) loadingText.textContent = `AIが解析中です... (${progress.completed}/${progress.total} チャンク)`;
            } else {
                progressWrap.classList.add('hidden');
                if (loadingText) loadingText.textContent = 'AIが解析中です...';
            }
        }

        if (isLoading) {
            dom.aiWorkspaceStatus.innerHTML = '<span class="spinner inline-spinner"></span> AIが解析中です...';
            return;
        }
        if (!isLoading && state.aiWorkspace.progress) state.aiWorkspace.progress = null;
        if (state.aiWorkspace.savedAt) {
            dom.aiWorkspaceStatus.innerText = `保存済み: ${new Date(state.aiWorkspace.savedAt).toLocaleString('ja-JP')}`;
            return;
        }
        renderMeetingInsights();
    }

    function setAiWorkspace(mode, title, result, instruction) {
        state.aiWorkspace.mode = mode;
        state.aiWorkspace.title = title;
        state.aiWorkspace.result = result || '';
        if (instruction !== undefined) {
            state.aiWorkspace.instruction = instruction;
            state.editorDirty.aiInstruction = 0;
        }
        state.aiWorkspace.loading = false;
        state.editorDirty.aiResult = 0;
        renderAiWorkspace();
        scheduleAiWorkspacePersist();
    }

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
            window.AppMain?.AppDebug?.log('warn', 'AI workspace persist failed', err.message);
        }
    }

    function syncSharedResultsIntoEditors() {
        if (!state.minutesWorkspace.loading && state.meetingInsights.minutes) {
            if (!isEditorDirty('minutes')) {
                if (state.minutesWorkspace.result !== state.meetingInsights.minutes) {
                    state.minutesWorkspace.result = state.meetingInsights.minutes;
                    state.editorDirty.minutes = 0;
                }
            } else {
                window.AppMain?.AppDebug?.log('info', 'syncShared: minutes をスキップ (dirty)');
            }
        }

        if (state.aiWorkspace.loading) return;
        const currentMode = state.aiWorkspace.mode || '';
        if ((!currentMode || currentMode === 'summary') && state.meetingInsights.summary) {
            if (!isEditorDirty('aiResult')) {
                if (state.aiWorkspace.result !== state.meetingInsights.summary) {
                    setAiWorkspace('summary', '要約', state.meetingInsights.summary);
                }
            }
            return;
        }
        if ((!currentMode || currentMode === 'todo') && state.meetingInsights.todo) {
            if (!isEditorDirty('aiResult')) {
                if (state.aiWorkspace.result !== state.meetingInsights.todo) {
                    setAiWorkspace('todo', 'TODO', state.meetingInsights.todo);
                }
            }
        }
    }

    async function loadMeetingInsights(options = {}) {
        if (!state.roomId) return;

        try {
            const res = await fetch(window.AppMain.withAuthQuery(`/rooms/${state.roomId}/insights`));
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
            // [L9] 議事録が存在するならチャンクパネルも同期する (ホスト限定)
            if (state.isHost && data.minutes) loadChunks().catch(() => {});
        } catch (error) {
            clearInsightsPoll();
            state.meetingInsights.status = 'error';
            state.meetingInsights.loading = false;
            renderMeetingInsights();
            if (!options.silent) {
                dom.aiWorkspaceStatus.innerText = `AI結果の取得に失敗しました: ${error.message}`;
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
                body: JSON.stringify(window.AppMain.authedBody({
                    type,
                    instruction,
                    ai_config: {
                        provider: state.aiProvider || 'gemini',
                        model: state.aiModel || (state.aiProvider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
                    }
                }))
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || 'AI解析に失敗しました');

            const resultText = String(data.result || '').trim();
            if (!resultText) throw new Error('AIから空の結果が返りました');

            setAiWorkspace(type, title, resultText, instruction);
            dom.aiWorkspaceStatus.innerText = `${title}の解析結果を表示しています。`;
            dom.aiOutputEditor.focus();
            dom.aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            state.aiWorkspace.loading = false;
            renderAiWorkspace();
            dom.aiWorkspaceStatus.innerText = `AI解析に失敗しました: ${error.message}`;
            window.AppToast.error('AI解析に失敗しました', { detail: error.message });
        }
    }

    function renderMeetingAnalysis() {
        const loadingKey = state.liveMeetingAnalysis.loadingKey;
        const statusText = state.liveMeetingAnalysis.status || '現在のログを使って、必要な解析をここから実行できます。';
        dom.meetingAiStatus.innerText = statusText;

        Object.entries(dom.meetingAiEditors).forEach(([key, editor]) => {
            const fallbackMap = {
                summary: '要約はここに表示されます。',
                todo: 'TODOはここに表示されます。',
                agreements: '合意点と未解決課題はここに表示されます。',
                topics: 'トークテーマ一覧はここに表示されます。'
            };
            editor.value = state.liveMeetingAnalysis.outputs[key] || fallbackMap[key];
        });

        Object.entries(dom.meetingAiButtons).forEach(([key, button]) => {
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
            summary: { type: 'summary', title: '要約' },
            todo: { type: 'todo', title: 'ToDo' },
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
                body: JSON.stringify(window.AppMain.authedBody({
                    type: config.type,
                    instruction: config.instruction || '',
                    ai_config: {
                        provider: state.aiProvider || 'gemini',
                        model: state.aiModel || (state.aiProvider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
                    }
                }))
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || `${config.title}の解析に失敗しました`);
            const resultText = String(data.result || '').trim();
            if (!resultText) throw new Error('AIから空の結果が返りました');

            state.liveMeetingAnalysis.outputs[key] = resultText;
            state.liveMeetingAnalysis.status = `${config.title}を更新しました。`;
            renderMeetingAnalysis();
            dom.meetingAiEditors[key].focus();
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
                dom.aiWorkspaceStatus.innerText = 'まだホストが共有結果を生成していません。';
                window.AppToast.info('まだホストが共有結果を生成していません。');
                return;
            }
            setAiWorkspace(type, title, existing);
            dom.aiWorkspaceStatus.innerText = `${title}を表示しています。`;
            return;
        }

        state.aiWorkspace.loading = true;
        state.aiWorkspace.mode = type;
        state.aiWorkspace.title = title;
        state.aiWorkspace.savedAt = null;
        renderMeetingInsights();
        renderAiWorkspace();

        try {
            const pastPayload = getPastMeetingApiPayload();
            const res = await fetch(`/rooms/${state.roomId}/shared-ai/${type}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participant_id: state.participantId,
                    control_token: state.controlToken,
                    ...pastPayload
                })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '共有AI結果の生成に失敗しました');
            const resultText = String(data.result || '').trim();
            if (!resultText) throw new Error('AIから空の結果が返りました');

            if (type === 'summary') state.meetingInsights.summary = resultText;
            else if (type === 'todo') state.meetingInsights.todo = resultText;
            else if (type === 'minutes') {
                state.meetingInsights.minutes = resultText;
                state.minutesWorkspace.result = resultText;
                state.minutesWorkspace.updatedAt = data.updated_at || new Date().toISOString();
                state.editorDirty.minutes = 0;
                renderMinutesWorkspace();
            }

            state.meetingInsights.updatedAt = data.updated_at || new Date().toISOString();
            await loadMeetingInsights({ silent: true });
            setAiWorkspace(type, title, resultText);
            dom.aiWorkspaceStatus.innerText = `${title}を生成しました。`;
            dom.aiOutputEditor.focus();
            dom.aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            state.aiWorkspace.loading = false;
            renderAiWorkspace();
            dom.aiWorkspaceStatus.innerText = `共有AI結果の生成に失敗しました: ${error.message}`;
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
                dom.minutesWorkspaceStatus.innerText = 'まだホストが議事録を生成していません。';
                window.AppToast.info('まだホストが議事録を生成していません。');
                return;
            }
            state.minutesWorkspace.result = existing;
            state.minutesWorkspace.updatedAt = state.meetingInsights.updatedAt;
            renderMinutesWorkspace();
            dom.minutesWorkspaceStatus.innerText = '共有議事録を表示しています。';
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
                    use_past_context: false
                })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '議事録生成に失敗しました');
            const resultText = String(data.result || '').trim();
            if (!resultText) throw new Error('AIから空の議事録が返りました');

            state.minutesWorkspace.result = resultText;
            state.minutesWorkspace.updatedAt = data.updated_at || new Date().toISOString();
            state.meetingInsights.minutes = resultText;
            state.editorDirty.minutes = 0;
            dom.minutesOutputEditor.value = resultText;
            dom.minutesWorkspaceStatus.innerText = '議事録を生成しました。必要に応じて内容を整えてください。';
            await loadMeetingInsights({ silent: true });
            // [L9] チャンク分割されていればパネルを表示する
            await loadChunks();
            dom.minutesOutputEditor.focus();
            dom.minutesOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            dom.minutesWorkspaceStatus.innerText = `議事録生成に失敗しました: ${error.message}`;
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
            const res = await fetch(window.AppMain.withAuthQuery(`/rooms/${state.roomId}/custom-output`));
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || 'AI結果の取得に失敗しました');

            state.aiWorkspace.mode = data.mode || state.aiWorkspace.mode || '';
            state.aiWorkspace.title = data.title || state.aiWorkspace.title || '解析結果';
            state.aiWorkspace.instruction = data.instruction || state.aiWorkspace.instruction || '';
            state.aiWorkspace.result = data.result || state.aiWorkspace.result || '';
            state.aiWorkspace.savedAt = data.saved_at || null;
            state.aiWorkspace.loading = false;
            renderAiWorkspace();
        } catch (_) {
            state.aiWorkspace.loading = false;
            renderAiWorkspace();
        }
    }

    async function generateCustomAiResult() {
        if (!state.roomId) return;
        const instruction = state.aiWorkspace.instruction.trim();
        if (!instruction) return window.AppToast.warn('自由解析の指示を入力してください。');

        try {
            if (!String(state.meetingInsights.minutes || '').trim()) {
                window.AppToast.warn('先にホストが議事録を生成してください。');
                return;
            }
            state.aiWorkspace.loading = true;
            state.aiWorkspace.mode = 'custom';
            state.aiWorkspace.title = '自由解析';
            renderAiWorkspace();
            const pastPayload = getPastMeetingApiPayload();
            const res = await fetch(`/rooms/${state.roomId}/custom-ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction,
                    participant_id: state.participantId,
                    control_token: state.controlToken,
                    ...pastPayload
                })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '自由解析に失敗しました');
            const resultText = String(data.result || '').trim();
            if (!resultText) throw new Error('AIから空の結果が返りました');
            setAiWorkspace('custom', '自由解析', resultText, instruction);
            dom.aiWorkspaceStatus.innerText = '議事録ベースの自由解析を表示しています。';
            dom.aiOutputEditor.focus();
            dom.aiOutputEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            state.aiWorkspace.loading = false;
            renderAiWorkspace();
            window.AppToast.error('自由解析に失敗しました', { detail: error.message });
        }
    }

    function getFormattedAiWorkspaceText() {
        const title = state.aiWorkspace.title || '解析結果';
        const instruction = dom.customAiInstruction.value || state.aiWorkspace.instruction || '';
        const result = dom.aiOutputEditor.value || state.aiWorkspace.result || '';
        return [`【${title}】`, result, '', '【指示】', instruction].join('\n');
    }

    function getFormattedMinutesText() {
        return dom.minutesOutputEditor.value || state.minutesWorkspace.result || '';
    }

    async function copyAiWorkspaceResult() {
        if (!state.aiWorkspace.result.trim()) return window.AppToast.info('コピーできる解析結果がまだありません。');
        try {
            await navigator.clipboard.writeText(getFormattedAiWorkspaceText());
            dom.aiWorkspaceStatus.innerText = '解析結果をコピーしました。';
        } catch (error) {
            window.AppToast.error('コピーに失敗しました', { detail: error.message });
        }
    }

    function downloadAiWorkspaceResult() {
        if (!state.aiWorkspace.result.trim()) return window.AppToast.info('ダウンロードできる解析結果がまだありません。');
        downloadTextFile(`ai-workspace-${state.roomId || 'session'}.txt`, getFormattedAiWorkspaceText());
    }

    async function copyMinutesResult() {
        const result = getFormattedMinutesText().trim();
        if (!result) return window.AppToast.info('コピーできる議事録がまだありません。');
        try {
            await navigator.clipboard.writeText(result);
            dom.minutesWorkspaceStatus.innerText = '議事録をコピーしました。';
        } catch (error) {
            window.AppToast.error('コピーに失敗しました', { detail: error.message });
        }
    }

    function downloadMinutesResult() {
        const result = getFormattedMinutesText().trim();
        if (!result) return window.AppToast.info('ダウンロードできる議事録がまだありません。');
        downloadTextFile(`minutes-${state.roomId || 'session'}.txt`, result);
    }

    // [L9] チャンク別再生成 --------------------------------------------------------

    /**
     * ホスト限定: チャンク一覧を取得してパネルに描画する。
     * チャンクが 0 件 (= チャンク分割なし) のときはパネルを非表示にする。
     */
    async function loadChunks() {
        const panel = document.getElementById('chunk-regenerate-panel');
        const listEl = document.getElementById('chunk-list');
        if (!panel || !listEl || !state.roomId || !state.isHost) return;

        try {
            const res = await fetch(window.AppMain.withAuthQuery(`/rooms/${state.roomId}/chunks`));
            if (!res.ok) {
                panel.classList.add('hidden');
                return;
            }
            const data = await res.json();
            const chunks = Array.isArray(data.chunks) ? data.chunks : [];
            if (chunks.length === 0) {
                panel.classList.add('hidden');
                return;
            }
            panel.classList.remove('hidden');
            renderChunkList(chunks);
        } catch (_) {
            panel.classList.add('hidden');
        }
    }

    function renderChunkList(chunks) {
        const listEl = document.getElementById('chunk-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        chunks.forEach((chunk) => {
            const row = document.createElement('div');
            row.className = `chunk-row${chunk.status === 'error' ? ' is-error' : ''}`;
            row.dataset.chunkIndex = chunk.chunk_index;

            const start = chunk.start_ts || '';
            const end = chunk.end_ts || '';
            const label = document.createElement('span');
            label.className = 'chunk-row-label';
            label.textContent = `チャンク ${chunk.chunk_index + 1}` + (start ? `  (${start}〜${end})` : '');

            const badge = document.createElement('span');
            badge.className = `chunk-row-status ${chunk.status === 'error' ? 'error' : 'done'}`;
            badge.textContent = chunk.status === 'error' ? '失敗' : '完了';

            const btn = document.createElement('button');
            btn.className = 'chunk-regen-btn';
            btn.textContent = '再生成';
            btn.addEventListener('click', () => regenerateChunk(chunk.chunk_index, btn));

            row.append(label, badge, btn);
            listEl.appendChild(row);
        });
    }

    /**
     * 指定 chunkIndex のチャンクを単独で再生成し、議事録全体を更新する。
     */
    async function regenerateChunk(chunkIndex, triggerBtn) {
        if (!state.roomId || !state.isHost) return;

        // ボタン類を無効化
        const allBtns = document.querySelectorAll('.chunk-regen-btn');
        allBtns.forEach((b) => { b.disabled = true; });
        if (triggerBtn) triggerBtn.textContent = '再生成中...';

        dom.minutesWorkspaceStatus.innerHTML = `<span class="spinner inline-spinner"></span> チャンク ${chunkIndex + 1} を再生成中...`;

        try {
            const res = await fetch(`/rooms/${state.roomId}/regenerate-chunk/${chunkIndex}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participant_id: state.participantId,
                    control_token: state.controlToken
                })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '再生成に失敗しました');

            const resultText = String(data.result || '').trim();
            if (resultText) {
                state.minutesWorkspace.result = resultText;
                state.meetingInsights.minutes = resultText;
                state.minutesWorkspace.updatedAt = data.updated_at || new Date().toISOString();
                state.editorDirty.minutes = 0;
                if (dom.minutesOutputEditor) dom.minutesOutputEditor.value = resultText;
            }
            dom.minutesWorkspaceStatus.innerText = `チャンク ${chunkIndex + 1} を再生成しました。`;

            // チャンク一覧を更新
            await loadChunks();
        } catch (error) {
            dom.minutesWorkspaceStatus.innerText = `再生成に失敗しました: ${error.message}`;
            window.AppToast.error(`チャンク ${chunkIndex + 1} の再生成に失敗しました`, { detail: error.message });
        } finally {
            allBtns.forEach((b) => { b.disabled = false; });
            if (triggerBtn) triggerBtn.textContent = '再生成';
            renderMinutesWorkspace();
        }
    }

    window.AppSharedAi = {
        renderMinutesWorkspace,
        renderMeetingInsights,
        clearInsightsPoll,
        scheduleInsightsPoll,
        isEditorDirty,
        renderAiWorkspace,
        setAiWorkspace,
        syncSharedResultsIntoEditors,
        loadMeetingInsights,
        runDirectAnalysis,
        renderMeetingAnalysis,
        runMeetingAnalysis,
        runSharedResult,
        runSummaryInsights,
        runActionInsights,
        runMinutesGeneration,
        ensureMeetingInsights,
        loadCustomAiResult,
        generateCustomAiResult,
        getFormattedAiWorkspaceText,
        getFormattedMinutesText,
        copyAiWorkspaceResult,
        downloadAiWorkspaceResult,
        copyMinutesResult,
        downloadMinutesResult,
        loadChunks,
        regenerateChunk,
        buildPastMeetingSelector,
        renderPastMeetingSelector,
        getPastMeetingApiPayload
    };
})();
