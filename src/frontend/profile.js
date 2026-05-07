/*
 * Profile module — opened via the avatar/name chip in the topbar.
 *
 * Tabs:
 *   1. プロフィール — edit display name / profile_text
 *   2. 過去の会議 — list, view, edit (host only), delete (or unlink) each entry
 *   3. 設定 — basic app settings persisted to localStorage
 *
 * Past meetings:
 *   - GET  /me/rooms              — list
 *   - GET  /me/rooms/:id          — detail
 *   - PATCH /me/rooms/:id         — edit (title/summary/minutes/todo) — host only
 *   - DELETE /me/rooms/:id        — host: hard delete; guest: unlink only
 */
(function initProfileModule() {
    const state = {
        profile: null,
        rooms: [],
        overlay: null,
        listPane: null,
        detailPane: null,
        currentRoomId: null,
        currentTab: 'profile',
        // input refs
        displayNameInput: null,
        profileTextarea: null,
        saveProfileBtn: null,
        // edit-mode refs (rebuilt each detail render)
        detailEdit: null
    };

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'onClick') node.addEventListener('click', v);
            else if (k === 'onInput') node.addEventListener('input', v);
            else if (v === false || v == null) continue;
            else node.setAttribute(k, v === true ? '' : v);
        }
        (Array.isArray(children) ? children : [children]).forEach((child) => {
            if (child == null) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    async function fetchJson(url, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
        if (!res.ok) {
            throw new Error((data && data.error) || `Request failed: ${res.status}`);
        }
        return data;
    }

    async function loadProfile() {
        state.profile = await fetchJson('/me/profile');
        return state.profile;
    }

    async function loadRooms() {
        const data = window.AppAuth?.listMyRooms ? await window.AppAuth.listMyRooms() : await fetchJson('/me/rooms');
        state.rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        return state.rooms;
    }

    // -------- Settings (client-only, localStorage) --------------------------
    const SETTINGS_KEY = 'gijiro:settings';
    const SETTINGS_DEFAULTS = {
        theme: 'system',           // system | light | dark
        defaultAiProvider: 'gemini', // gemini | groq
        defaultMicPreset: '',       // empty → fall back to device default
        autoBackfill: true,         // automatically link anonymous joins on login
        sttProvider: 'google'       // google | elevenlabs
    };
    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            return Object.assign({}, SETTINGS_DEFAULTS, raw ? JSON.parse(raw) : {});
        } catch (_) {
            return { ...SETTINGS_DEFAULTS };
        }
    }
    function saveSettings(next) {
        const merged = Object.assign({}, loadSettings(), next);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch (_) { /* ignore */ }
        applySettings(merged);
        return merged;
    }
    function applySettings(s) {
        // テーマを <html data-theme="..."> にセット。
        // CSS の [data-theme="dark"] / @media prefers-color-scheme がここを参照する。
        //   "system"  → OS の prefers-color-scheme に従う (@media 側が有効)
        //   "light"   → 常にライト (@media を :not([data-theme="light"]) で排除)
        //   "dark"    → 常にダーク ([data-theme="dark"] セレクタが有効)
        try {
            const theme = s.theme || 'system';
            document.documentElement.setAttribute('data-theme', theme);
            // ネイティブ UI (スクロールバー・フォーム) もテーマに追従させる。
            if (theme === 'dark') {
                document.documentElement.style.colorScheme = 'dark';
            } else if (theme === 'light') {
                document.documentElement.style.colorScheme = 'light';
            } else {
                document.documentElement.style.colorScheme = 'light dark';
            }
        } catch (_) { /* ignore */ }
        // Default AI provider — used by main.js next time it boots.
        try { localStorage.setItem('ai_provider', s.defaultAiProvider); } catch (_) { /* ignore */ }
        // STT provider — read by main.js when sending mic_preset to the server.
        try { localStorage.setItem('stt_provider', s.sttProvider || 'google'); } catch (_) { /* ignore */ }
        if (s.defaultMicPreset) {
            try { localStorage.setItem('mic_preset', s.defaultMicPreset); } catch (_) { /* ignore */ }
        }
        // セットアップ画面の状態カードを再描画して選択を即座に反映する。
        try { if (typeof window._refreshApiStatus === 'function') window._refreshApiStatus(); } catch (_) { /* ignore */ }
    }
    // Apply settings on module load so a new tab inherits them right away.
    applySettings(loadSettings());

    // -------- Modal lifecycle ----------------------------------------------
    function closeProfileModal() {
        if (!state.overlay) return;
        state.overlay.remove();
        state.overlay = null;
        state.detailPane = null;
        state.listPane = null;
        state.currentRoomId = null;
    }

    async function showProfileModal() {
        if (!window.AppAuth?.state?.account) return;
        closeProfileModal();
        state.profile = { account: window.AppAuth.state.account, profile_text: '' };
        state.rooms = [];

        const tabsHost = el('div', { className: 'profile-tabs' });
        const body = el('div', { className: 'profile-body' });
        const wrapper = el('div', { className: 'auth-archive-modal profile-modal' }, [
            el('div', { className: 'profile-header' }, [
                el('h2', { className: 'auth-modal-title' }, 'プロフィール'),
                el('button', {
                    className: 'profile-close-btn',
                    type: 'button',
                    'aria-label': '閉じる',
                    onClick: closeProfileModal
                }, '×')
            ]),
            tabsHost,
            body
        ]);

        const tabDefs = [
            { id: 'profile', label: 'プロフィール' },
            { id: 'history', label: '会議履歴' },
            { id: 'settings', label: '設定' }
        ];
        const tabButtons = {};
        tabDefs.forEach((tab) => {
            tabButtons[tab.id] = el('button', {
                type: 'button',
                className: 'profile-tab',
                onClick: () => switchTab(tab.id)
            }, tab.label);
            tabsHost.appendChild(tabButtons[tab.id]);
        });
        // Bottom bar — logout button always available.
        wrapper.appendChild(el('div', { className: 'profile-footer' }, [
            el('button', {
                type: 'button',
                className: 'secondary',
                onClick: () => {
                    if (!window.AppAuth?.logout) return;
                    window.AppAuth.logout()
                        .then(() => { closeProfileModal(); })
                        .catch((err) => console.error(err));
                }
            }, 'ログアウト')
        ]));

        state.overlay = el('div', {
            className: 'auth-modal-overlay',
            onClick: (event) => { if (event.target === state.overlay) closeProfileModal(); }
        }, [wrapper]);
        document.body.appendChild(state.overlay);

        function switchTab(tabId) {
            state.currentTab = tabId;
            Object.entries(tabButtons).forEach(([id, btn]) => {
                btn.classList.toggle('active', id === tabId);
            });
            body.innerHTML = '';
            if (tabId === 'profile') body.appendChild(renderProfileTab());
            else if (tabId === 'history') body.appendChild(renderHistoryTab());
            else if (tabId === 'settings') body.appendChild(renderSettingsTab());
        }

        // Initial paint: profile tab + kick off async data loads.
        switchTab('profile');
        try {
            await Promise.allSettled([loadProfile(), loadRooms()]);
        } catch (err) {
            console.error('[profile] load error', err);
        }
        // Refresh whichever tab we're on after data arrives.
        switchTab(state.currentTab);
    }

    // -------- Profile tab ---------------------------------------------------
    function renderProfileTab() {
        const account = state.profile?.account || window.AppAuth?.state?.account || {};
        state.displayNameInput = el('input', {
            type: 'text',
            value: account.display_name || '',
            placeholder: 'アカウント名 (本名推奨)',
            maxlength: 80
        });
        state.profileTextarea = el('textarea', {
            placeholder: '得意なこと・スキル・担当プロジェクトを自由に追記できます。要約や TODO の精度向上に使われます。'
        });
        state.profileTextarea.value = state.profile?.profile_text || '';

        // Auto-save on blur and after a typing pause — no save button needed.
        const status = el('span', { className: 'profile-settings-status' });
        let pendingTimer = null;
        let lastDisplayName = state.displayNameInput.value;
        let lastProfileText = state.profileTextarea.value;
        async function persist() {
            const display_name = state.displayNameInput.value.trim();
            const profile_text = state.profileTextarea.value.trim();
            if (display_name === lastDisplayName.trim() && profile_text === lastProfileText.trim()) return;
            try {
                await window.AppAuth.patchMyProfile({ display_name, profile_text });
                lastDisplayName = display_name;
                lastProfileText = profile_text;
                status.textContent = '保存しました';
                setTimeout(() => { if (status) status.textContent = ''; }, 1400);
                // Notify the setup-screen input so it stays in sync with the
                // profile page without requiring a page reload.
                window.dispatchEvent(new CustomEvent('app:profile-updated', {
                    detail: { display_name, profile_text }
                }));
            } catch (err) {
                status.textContent = `保存失敗: ${err.message}`;
            }
        }
        function scheduleSave() {
            if (pendingTimer) clearTimeout(pendingTimer);
            pendingTimer = setTimeout(persist, 700);
        }
        state.displayNameInput.addEventListener('input', scheduleSave);
        state.displayNameInput.addEventListener('blur', persist);
        state.profileTextarea.addEventListener('input', scheduleSave);
        state.profileTextarea.addEventListener('blur', persist);

        return el('div', { className: 'profile-tab-pane profile-pane-edit' }, [
            el('p', { className: 'profile-pane-lead' }, 'アカウント名は本名推奨です。自己紹介はホストとしての要約・TODO の精度向上に使われます。入力を終えるか、フォーカスが外れた時点で自動保存されます。'),
            el('div', { className: 'profile-form-row' }, [
                el('label', {}, ['メールアドレス',
                    el('input', { type: 'email', value: account.email || '', readonly: 'readonly', disabled: 'disabled' })
                ])
            ]),
            el('div', { className: 'profile-form-row' }, [
                el('label', {}, ['アカウント名', state.displayNameInput])
            ]),
            el('div', { className: 'profile-form-row' }, [
                el('label', {}, ['自己紹介・スキル', state.profileTextarea])
            ]),
            el('div', { className: 'profile-settings-row' }, [status])
        ]);
    }

    // -------- History tab ---------------------------------------------------
    function renderHistoryTab() {
        state.listPane = el('div', { className: 'auth-archive-list profile-history-list' });
        state.detailPane = el('div', { className: 'auth-archive-detail profile-history-detail' }, '会議を選ぶと詳細を表示します。');
        renderHistoryList();
        return el('div', { className: 'profile-tab-pane profile-pane-history' }, [
            el('p', { className: 'profile-pane-lead' }, '過去の会議を確認・編集・削除できます。ホストでない会議は「自分の履歴から外す」のみ可能です。'),
            el('div', { className: 'profile-history-grid' }, [state.listPane, state.detailPane])
        ]);
    }

    function renderHistoryList() {
        if (!state.listPane) return;
        state.listPane.innerHTML = '';
        if (!state.rooms.length) {
            state.listPane.appendChild(el('p', { className: 'placeholder-text' }, 'まだ会議履歴がありません。'));
            return;
        }
        state.rooms.forEach((room) => {
            const when = (room.ended_at || room.created_at || '').replace('T', ' ').slice(0, 16);
            const title = (room.title && room.title.trim()) || `ルーム ${room.id}`;
            const row = el('div', { className: 'profile-history-row' + (state.currentRoomId === room.id ? ' is-active' : '') }, [
                el('button', {
                    type: 'button',
                    className: 'profile-history-row-main',
                    onClick: () => showRoomDetail(room.id)
                }, [
                    el('strong', {}, title + (room.is_owner ? ' 〔ホスト〕' : '')),
                    el('span', { className: 'auth-archive-when' }, when),
                    el('span', { className: 'auth-archive-excerpt' }, room.summary_excerpt || '(要約なし)')
                ]),
                el('button', {
                    type: 'button',
                    className: 'profile-history-row-delete',
                    title: room.is_owner ? '会議を完全に削除' : '自分の履歴から外す',
                    'aria-label': room.is_owner ? '会議を完全に削除' : '自分の履歴から外す',
                    onClick: (ev) => {
                        ev.stopPropagation();
                        confirmAndDelete(room);
                    }
                }, '🗑')
            ]);
            state.listPane.appendChild(row);
        });
    }

    async function confirmAndDelete(room) {
        // Host owns the data and a real DELETE wipes the record for everyone
        // → keep the explicit confirm() for that case (no undo from server).
        // Non-host unlink is non-destructive → skip confirm and offer Undo
        // via toast. We re-link by issuing a backfill against the user's
        // local_user_id (their participants row gets re-attached).
        if (room.is_owner) {
            const msg = `「${(room.title && room.title.trim()) || room.id}」を完全に削除します。発言ログ・要約・TODO を含む全データが失われ、他の参加者からも見えなくなります。よろしいですか？`;
            if (!confirm(msg)) return;
            try {
                await window.AppAuth.deleteMyRoom(room.id);
                state.rooms = state.rooms.filter((r) => r.id !== room.id);
                if (state.currentRoomId === room.id) {
                    state.currentRoomId = null;
                    if (state.detailPane) state.detailPane.textContent = '会議を選ぶと詳細を表示します。';
                }
                renderHistoryList();
            } catch (err) {
                alert(`削除に失敗しました: ${err.message}`);
            }
            return;
        }
        // Non-host: optimistic remove + Undo toast.
        const removed = room;
        state.rooms = state.rooms.filter((r) => r.id !== room.id);
        if (state.currentRoomId === room.id) {
            state.currentRoomId = null;
            if (state.detailPane) state.detailPane.textContent = '会議を選ぶと詳細を表示します。';
        }
        renderHistoryList();
        let restored = false;
        showUndoToast(`「${(removed.title && removed.title.trim()) || removed.id}」を履歴から外しました`, async () => {
            // Undo before the server call has run? Just put the row back.
            restored = true;
            state.rooms = [removed, ...state.rooms];
            renderHistoryList();
        });
        // Defer the actual server delete by 5 seconds so Undo can pre-empt.
        setTimeout(async () => {
            if (restored) return;
            try {
                await window.AppAuth.deleteMyRoom(removed.id);
            } catch (err) {
                // Server-side failure → put it back and tell the user.
                state.rooms = [removed, ...state.rooms];
                renderHistoryList();
                alert(`削除に失敗しました: ${err.message}`);
            }
        }, 5000);
    }

    let activeToast = null;
    function showUndoToast(message, onUndo) {
        if (activeToast) {
            activeToast.remove();
            activeToast = null;
        }
        const toast = document.createElement('div');
        toast.className = 'undo-toast';
        const text = document.createElement('span');
        text.textContent = message;
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.textContent = '元に戻す';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.className = 'undo-toast-dismiss';
        toast.appendChild(text);
        toast.appendChild(undoBtn);
        toast.appendChild(closeBtn);
        document.body.appendChild(toast);
        activeToast = toast;
        const dismiss = () => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            if (activeToast === toast) activeToast = null;
        };
        undoBtn.addEventListener('click', () => {
            try { onUndo && onUndo(); } catch (_) { /* ignore */ }
            dismiss();
        });
        closeBtn.addEventListener('click', dismiss);
        // Auto-dismiss after 5s — same window during which the server
        // delete is held back.
        setTimeout(dismiss, 5000);
    }

    async function showRoomDetail(roomId) {
        if (!state.detailPane) return;
        state.currentRoomId = roomId;
        renderHistoryList();
        state.detailPane.textContent = '読み込み中...';
        try {
            const full = await window.AppAuth.getMyRoom(roomId);
            renderRoomDetailRead(full);
        } catch (err) {
            state.detailPane.textContent = `読み込みに失敗しました: ${err.message}`;
        }
    }

    function renderRoomDetailRead(full) {
        if (!state.detailPane) return;
        state.detailPane.innerHTML = '';
        const title = (full.title && full.title.trim()) || `ルーム ${full.id}`;
        const headerActions = [];
        if (full.is_owner) {
            headerActions.push(el('button', {
                type: 'button', className: 'secondary compact',
                onClick: () => renderRoomDetailEdit(full)
            }, '編集'));
        }
        state.detailPane.appendChild(el('div', { className: 'profile-history-detail-header' }, [
            el('h3', {}, `${title}${full.is_owner ? ' (ホスト)' : ''}`),
            el('div', { className: 'profile-history-detail-actions' }, headerActions)
        ]));
        const meta = `${(full.created_at || '').replace('T', ' ').slice(0, 16)} 〜 ${(full.ended_at || '').replace('T', ' ').slice(0, 16) || '進行中'}`;
        state.detailPane.appendChild(el('div', { className: 'auth-archive-meta' }, meta));

        const sections = [
            { key: 'summary', label: '要約' },
            { key: 'minutes', label: '議事録' },
            { key: 'todo', label: 'TODO' }
        ];
        let any = false;
        sections.forEach(({ key, label }) => {
            if (full[key]) {
                any = true;
                state.detailPane.appendChild(el('h4', {}, label));
                state.detailPane.appendChild(el('pre', { className: 'auth-archive-body' }, full[key]));
            }
        });
        if (full.ai_workspace && (full.ai_workspace.result || full.ai_workspace.raw)) {
            any = true;
            const awTitle = full.ai_workspace.title || 'AI 解析';
            state.detailPane.appendChild(el('h4', {}, `AI 解析: ${awTitle}`));
            state.detailPane.appendChild(el('pre', { className: 'auth-archive-body' }, full.ai_workspace.result || full.ai_workspace.raw || ''));
        }
        if (!any) {
            state.detailPane.appendChild(el('p', { className: 'placeholder-text' }, '保存された要約・議事録・TODO はまだありません。'));
        }
    }

    function renderRoomDetailEdit(full) {
        if (!state.detailPane) return;
        state.detailPane.innerHTML = '';
        const titleInput = el('input', { type: 'text', value: full.title || '', maxlength: 200, placeholder: '会議のタイトル' });
        const summaryArea = el('textarea', { rows: 4, placeholder: '要約' });
        summaryArea.value = full.summary || '';
        const minutesArea = el('textarea', { rows: 6, placeholder: '議事録' });
        minutesArea.value = full.minutes || '';
        const todoArea = el('textarea', { rows: 4, placeholder: 'TODO' });
        todoArea.value = full.todo || '';

        const saveBtn = el('button', { type: 'button', className: 'primary', onClick: async () => {
            saveBtn.disabled = true;
            try {
                await window.AppAuth.patchMyRoom(full.id, {
                    title: titleInput.value,
                    summary: summaryArea.value,
                    minutes: minutesArea.value,
                    todo: todoArea.value
                });
                // Refresh list (title may have changed) and re-fetch detail.
                await loadRooms();
                renderHistoryList();
                showRoomDetail(full.id);
            } catch (err) {
                alert(`保存に失敗しました: ${err.message}`);
            } finally {
                saveBtn.disabled = false;
            }
        } }, '保存');
        const cancelBtn = el('button', { type: 'button', className: 'secondary', onClick: () => renderRoomDetailRead(full) }, 'キャンセル');

        state.detailPane.appendChild(el('h3', {}, '会議を編集'));
        state.detailPane.appendChild(el('label', {}, ['タイトル', titleInput]));
        state.detailPane.appendChild(el('label', {}, ['要約', summaryArea]));
        state.detailPane.appendChild(el('label', {}, ['議事録', minutesArea]));
        state.detailPane.appendChild(el('label', {}, ['TODO', todoArea]));
        state.detailPane.appendChild(el('div', { className: 'auth-modal-actions' }, [cancelBtn, saveBtn]));
    }

    // -------- Settings tab --------------------------------------------------
    function renderSettingsTab() {
        const settings = loadSettings();

        const themeSelect = el('select', {}, [
            el('option', { value: 'system' }, 'システム設定に合わせる'),
            el('option', { value: 'light' }, 'ライト'),
            el('option', { value: 'dark' }, 'ダーク')
        ]);
        themeSelect.value = settings.theme;

        const aiSelect = el('select', {}, [
            el('option', { value: 'gemini' }, 'Gemini (gemini-2.5-flash)'),
            el('option', { value: 'groq' }, 'Groq (gpt-oss-120b)')
        ]);
        aiSelect.value = settings.defaultAiProvider;

        const sttSelect = el('select', {}, [
            el('option', { value: 'google' }, 'Google (デフォルト)'),
            el('option', { value: 'elevenlabs' }, 'ElevenLabs Scribe')
        ]);
        sttSelect.value = settings.sttProvider || 'google';

        const micSelect = el('select', {}, [
            el('option', { value: '' }, '自動 (デバイス推奨)'),
            el('option', { value: 'smartphone' }, 'スマホ本体'),
            el('option', { value: 'pin_mic' }, 'ピンマイク'),
            el('option', { value: 'echo_room' }, '反響のある部屋'),
            el('option', { value: 'large_group' }, '大人数'),
            el('option', { value: 'wired_headset' }, '有線ヘッドセット')
        ]);
        micSelect.value = settings.defaultMicPreset;

        const backfillCheckbox = el('input', { type: 'checkbox' });
        if (settings.autoBackfill) backfillCheckbox.checked = true;

        const status = el('span', { className: 'profile-settings-status' });
        function persist() {
            saveSettings({
                theme: themeSelect.value,
                defaultAiProvider: aiSelect.value,
                defaultMicPreset: micSelect.value,
                autoBackfill: !!backfillCheckbox.checked,
                sttProvider: sttSelect.value
            });
            status.textContent = '保存しました';
            setTimeout(() => { status.textContent = ''; }, 1400);
        }
        themeSelect.addEventListener('change', persist);
        aiSelect.addEventListener('change', persist);
        micSelect.addEventListener('change', persist);
        sttSelect.addEventListener('change', persist);
        backfillCheckbox.addEventListener('change', persist);

        const localUserId = (() => {
            try { return localStorage.getItem('user_id') || ''; } catch (_) { return ''; }
        })();

        return el('div', { className: 'profile-tab-pane profile-pane-settings' }, [
            el('p', { className: 'profile-pane-lead' }, '基本的なアプリ設定です。設定はこの端末に保存され、会議準備画面の AI / マイク選択とも同期します。'),
            el('div', { className: 'profile-settings-grid' }, [
                el('label', {}, ['表示テーマ', themeSelect]),
                el('label', {}, ['既定の AI プロバイダ', aiSelect]),
                el('label', {}, ['音声認識エンジン', sttSelect]),
                el('label', {}, ['既定のマイクプリセット', micSelect]),
                el('label', { className: 'profile-settings-checkbox' }, [
                    backfillCheckbox,
                    el('span', {}, 'ログイン時に過去の匿名参加を自動でアカウントに紐付ける')
                ])
            ]),
            el('div', { className: 'profile-settings-row' }, [status]),
            el('details', { className: 'profile-settings-advanced' }, [
                el('summary', {}, '詳細情報'),
                el('div', { className: 'profile-settings-meta' }, [
                    el('div', {}, `アカウント ID: ${window.AppAuth?.state?.account?.id || '-'}`),
                    el('div', {}, `ローカルユーザー ID: ${localUserId || '(未設定)'}`)
                ])
            ])
        ]);
    }

    // -------- Public API ---------------------------------------------------
    /**
     * Mirror the logged-in account's profile_text into the setup-screen input.
     * アカウント名 (accounts.display_name) と会議用の表示名 (#display-name) は
     * 別フィールドのため、ここでは profile_text のみを同期する。
     */
    async function hydrateSetupProfile({ force = false } = {}) {
        if (!window.AppAuth?.state?.account) return;
        try {
            const data = await loadProfile();
            const accountProfile = data.profile_text || '';
            const profileInput = document.getElementById('profile-text');
            if (profileInput && accountProfile) {
                const empty = !profileInput.value.trim();
                if (force || empty) {
                    profileInput.value = accountProfile;
                    try { localStorage.setItem('profile_text', accountProfile); } catch (_) { /* ignore */ }
                }
            }
        } catch (_err) {
            // ignore
        }
    }

    window.AppProfile = {
        showProfileModal,
        hydrateSetupProfile,
        loadSettings,
        saveSettings
    };
})();
