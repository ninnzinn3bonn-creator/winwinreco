/*
 * Host-login auth module.
 *
 * Exposes window.AppAuth with:
 *   state                { account | null }
 *   init()               fetches /auth/me, renders badge
 *   requireLogin()       Promise<account|null>
 *   signup(email, password, displayName)
 *   login(email, password)
 *   logout()
 *   listMyRooms()
 *   getMyRoom(id)
 *   onChange(fn)
 */
(function initAuthModule() {
    const state = { account: null };
    const listeners = new Set();

    function notify() {
        for (const fn of listeners) {
            try {
                fn(state.account);
            } catch (err) {
                console.error('[auth listener]', err);
            }
        }
    }

    async function request(url, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        
        console.debug(`[auth:request] ${opts.method || 'GET'} ${url}`);
        const res = await fetch(url, {
            ...opts,
            headers,
            credentials: 'same-origin'
        });
        
        if (!res.ok) {
            console.error(`[auth:request] failed: ${res.status} ${url}`);
        }

        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('json') ? await res.json().catch(() => ({})) : null;
        if (!res.ok) {
            const err = new Error((data && data.error) || `Request failed: ${res.status}`);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    async function backfillAnonymousHistory() {
        if (!state.account) return;
        try {
            const localUserId = (typeof localStorage !== 'undefined' && localStorage.getItem('user_id')) || '';
            if (!localUserId) return;
            const result = await request('/me/backfill', {
                method: 'POST',
                body: JSON.stringify({ user_id: localUserId })
            });
            if (result && typeof result.linked === 'number' && result.linked > 0) {
                console.info(`[auth] linked ${result.linked} past participation(s) to account`);
            }
        } catch (err) {
            console.warn('[auth] backfill failed (non-fatal):', err.message);
        }
    }

    async function refreshSession() {
        try {
            const data = await request('/auth/me');
            state.account = data.account || null;
        } catch (_err) {
            state.account = null;
        }
        notify();
        if (state.account) backfillAnonymousHistory();
        return state.account;
    }

    /**
     * 新規登録。事後承認フローのため、戻り値は次の 2 通り:
     *   - { pending: true, message }  承認待ち。state.account は null のまま。
     *   - account オブジェクト        オーナー (OWNER_EMAIL) の場合のみ即時ログイン。
     */
    async function signup(email, password, displayName) {
        const data = await request('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password, display_name: displayName })
        });
        if (data && data.pending) {
            // 承認待ち: セッション無し。state は触らない。
            return { pending: true, message: data.message || 'ご登録ありがとうございます。承認をお待ちください。' };
        }
        state.account = data.account || null;
        notify();
        if (state.account) await backfillAnonymousHistory();
        return state.account;
    }

    async function login(email, password) {
        const data = await request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        state.account = data.account || null;
        notify();
        if (state.account) await backfillAnonymousHistory();
        return state.account;
    }

    async function logout() {
        try {
            await request('/auth/logout', { method: 'POST' });
        } finally {
            state.account = null;
            notify();
        }
    }

    async function listMyRooms() {
        return request('/me/rooms');
    }

    async function getMyRoom(id) {
        return request(`/me/rooms/${encodeURIComponent(id)}`);
    }

    async function deleteMyRoom(id) {
        return request(`/me/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    async function patchMyRoom(id, payload) {
        return request(`/me/rooms/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
        });
    }

    async function patchMyProfile(payload) {
        const data = await request('/me/profile', {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
        });
        if (data && data.account) {
            state.account = data.account;
            notify();
        }
        return data;
    }

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') node.className = v;
            else if (k === 'onClick') node.addEventListener('click', v);
            else if (k === 'onSubmit') node.addEventListener('submit', v);
            else if (k === 'text') node.textContent = v;
            else node.setAttribute(k, v);
        }
        (Array.isArray(children) ? children : [children]).forEach((child) => {
            if (child == null) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function renderAccountBadge() {
        const host = document.getElementById('auth-badge');
        if (!host) return;
        host.innerHTML = '';
        if (state.account) {
            const name = state.account.display_name || state.account.email || '';
            const initial = (name || '?').trim().slice(0, 1).toUpperCase();
            // Single avatar+name chip — clicking it opens the Profile modal
            // (history + settings + logout). The standalone "プロフィール" /
            // "ログアウト" buttons are intentionally folded into Profile.
            const chip = el('button', {
                className: 'auth-badge-chip',
                type: 'button',
                title: 'プロフィールを開く',
                'aria-label': `プロフィール: ${name}`,
                onClick: () => {
                    if (window.AppProfile?.showProfileModal) {
                        window.AppProfile.showProfileModal();
                    }
                }
            }, [
                el('span', { className: 'auth-badge-avatar', 'aria-hidden': 'true' }, initial),
                el('span', { className: 'auth-badge-name-text' }, name)
            ]);
            host.appendChild(chip);
        } else {
            host.appendChild(el('button', {
                className: 'primary auth-badge-btn',
                onClick: () => showLoginModal('login')
            }, 'ログイン'));
            host.appendChild(el('button', {
                className: 'secondary auth-badge-btn',
                onClick: () => showLoginModal('signup')
            }, '新規登録'));
        }
    }

    let modalOverlay = null;
    let modalResolve = null;

    function closeLoginModal(result) {
        if (!modalOverlay) return;
        modalOverlay.remove();
        modalOverlay = null;
        if (modalResolve) {
            const done = modalResolve;
            modalResolve = null;
            done(result || null);
        }
    }

    /**
     * 新規登録成功 (承認待ち) のときに、フォームを置き換えてメッセージを表示する。
     * モーダル自体はそのまま開いた状態を保つ (ユーザーが「閉じる」を押すまで)。
     */
    function showSignupPendingScreen(message) {
        if (!modalOverlay) return;
        const form = modalOverlay.querySelector('.auth-modal-form');
        if (!form) return;
        form.innerHTML = '';
        form.appendChild(el('h2', { className: 'auth-modal-title' }, '登録完了'));
        form.appendChild(el('p', { className: 'auth-modal-pending-msg' }, message || 'ご登録ありがとうございます。管理者の承認をお待ちください。'));
        form.appendChild(el('p', { className: 'auth-modal-pending-sub' }, '承認されると、メールアドレスとパスワードでログインできるようになります。'));
        form.appendChild(el('div', { className: 'auth-modal-actions' }, [
            el('button', {
                type: 'button',
                className: 'primary',
                onClick: () => closeLoginModal(null)
            }, '閉じる')
        ]));
    }

    /**
     * 「パスワードを忘れた方」モードを表示する。
     * フォームを forgot モードに差し替えて POST /auth/forgot-password を呼ぶ。
     */
    function showForgotPasswordForm() {
        if (!modalOverlay) return;
        const form = modalOverlay.querySelector('.auth-modal-form');
        if (!form) return;
        form.innerHTML = '';

        const title = el('h2', { className: 'auth-modal-title' }, 'パスワードをお忘れの方');
        const desc = el('p', { className: 'auth-modal-desc' }, '登録済みのメールアドレスを入力してください。リセットリンクをお送りします。');
        const emailInput = el('input', {
            type: 'email',
            placeholder: 'メールアドレス',
            required: 'required',
            autocomplete: 'email'
        });
        const errorBox = el('div', { className: 'auth-modal-error', role: 'alert' });
        const submitBtn = el('button', { type: 'submit', className: 'primary' }, '送信する');
        const backBtn = el('button', {
            type: 'button',
            className: 'auth-modal-toggle',
            onClick: () => {
                closeLoginModal(null);
                showLoginModal('login');
            }
        }, 'ログイン画面に戻る');
        const cancelBtn = el('button', {
            type: 'button',
            className: 'secondary',
            onClick: () => closeLoginModal(null)
        }, 'キャンセル');

        const innerForm = el('form', {
            onSubmit: async (ev) => {
                ev.preventDefault();
                errorBox.textContent = '';
                submitBtn.disabled = true;
                try {
                    const email = emailInput.value.trim();
                    await request('/auth/forgot-password', {
                        method: 'POST',
                        body: JSON.stringify({ email })
                    });
                    // Always show success regardless of whether account exists.
                    form.innerHTML = '';
                    form.appendChild(el('h2', { className: 'auth-modal-title' }, '送信完了'));
                    form.appendChild(el('p', { className: 'auth-modal-pending-msg' }, 'メールを送信しました。受信箱を確認してください。'));
                    form.appendChild(el('p', { className: 'auth-modal-pending-sub' }, '届かない場合は迷惑メールフォルダをご確認ください。'));
                    form.appendChild(el('div', { className: 'auth-modal-actions' }, [
                        el('button', {
                            type: 'button',
                            className: 'primary',
                            onClick: () => closeLoginModal(null)
                        }, '閉じる')
                    ]));
                } catch (_err) {
                    // Even on error, show success to prevent enumeration.
                    form.innerHTML = '';
                    form.appendChild(el('h2', { className: 'auth-modal-title' }, '送信完了'));
                    form.appendChild(el('p', { className: 'auth-modal-pending-msg' }, 'メールを送信しました。受信箱を確認してください。'));
                    form.appendChild(el('div', { className: 'auth-modal-actions' }, [
                        el('button', {
                            type: 'button',
                            className: 'primary',
                            onClick: () => closeLoginModal(null)
                        }, '閉じる')
                    ]));
                }
            }
        });
        innerForm.appendChild(emailInput);

        form.appendChild(title);
        form.appendChild(desc);
        form.appendChild(el('label', {}, ['メールアドレス', emailInput]));
        form.appendChild(errorBox);
        form.appendChild(el('div', { className: 'auth-modal-actions' }, [submitBtn, cancelBtn]));
        form.appendChild(backBtn);
        emailInput.focus();
    }

    function showLoginModal(mode = 'login') {
        closeLoginModal(null);

        const title = el('h2', { className: 'auth-modal-title' }, mode === 'signup' ? '新規アカウント登録' : 'ログイン');
        const emailInput = el('input', {
            type: 'email',
            placeholder: 'メールアドレス',
            required: 'required',
            autocomplete: 'email'
        });
        const pwInput = el('input', {
            type: 'password',
            placeholder: 'パスワード (8文字以上)',
            required: 'required',
            minlength: '8',
            autocomplete: mode === 'signup' ? 'new-password' : 'current-password'
        });
        const nameInput = el('input', {
            type: 'text',
            placeholder: '表示名 (任意)',
            autocomplete: 'name'
        });
        if (mode !== 'signup') nameInput.style.display = 'none';

        const errorBox = el('div', { className: 'auth-modal-error', role: 'alert' });
        const submitBtn = el('button', { type: 'submit', className: 'primary' }, mode === 'signup' ? '登録する' : 'ログイン');
        const toggleBtn = el('button', {
            type: 'button',
            className: 'auth-modal-toggle',
            onClick: () => {
                closeLoginModal(null);
                showLoginModal(mode === 'signup' ? 'login' : 'signup');
            }
        }, mode === 'signup' ? 'ログイン画面に戻る' : '新規登録はこちら');
        const cancelBtn = el('button', {
            type: 'button',
            className: 'secondary',
            onClick: () => closeLoginModal(null)
        }, 'キャンセル');

        // ログインモードのみ「パスワードを忘れた方」リンクを表示
        const forgotLink = mode === 'login'
            ? el('a', {
                className: 'auth-modal-link',
                id: 'forgot-password-link',
                href: '#',
                onClick: (ev) => { ev.preventDefault(); showForgotPasswordForm(); }
            }, 'パスワードを忘れた方')
            : null;

        const form = el('form', {
            className: 'auth-modal-form',
            onSubmit: async (ev) => {
                ev.preventDefault();
                errorBox.textContent = '';
                submitBtn.disabled = true;
                try {
                    const email = emailInput.value.trim();
                    const password = pwInput.value;
                    const displayName = nameInput.value.trim();
                    if (mode === 'signup') {
                        const result = await signup(email, password, displayName);
                        if (result && result.pending) {
                            // 承認待ち: フォームを置き換えて完了メッセージ表示
                            showSignupPendingScreen(result.message);
                            return;
                        }
                        closeLoginModal(result);
                    } else {
                        const account = await login(email, password);
                        closeLoginModal(account);
                    }
                } catch (err) {
                    // login 時の各エラーコードを専用メッセージで表示
                    const code = err.data?.error_code;
                    if (code === 'email_not_verified') {
                        if (window.AppToast) {
                            AppToast.warn('メールアドレスの確認が完了していません。受信箱を確認してください。');
                        }
                        errorBox.textContent = 'メールアドレスの確認が完了していません。受信箱を確認してください。';
                    } else if (code === 'pending_approval') {
                        errorBox.textContent = err.message || 'アカウントは管理者の承認待ちです。';
                    } else if (code === 'account_rejected') {
                        errorBox.textContent = err.message || 'このアカウントは承認されませんでした。';
                    } else {
                        errorBox.textContent = err.message || '処理に失敗しました';
                    }
                } finally {
                    submitBtn.disabled = false;
                }
            }
        }, [
            title,
            el('label', {}, ['メールアドレス', emailInput]),
            mode === 'signup' ? el('label', {}, ['表示名', nameInput]) : null,
            el('label', {}, ['パスワード', pwInput]),
            forgotLink,
            errorBox,
            el('div', { className: 'auth-modal-actions' }, [submitBtn, cancelBtn]),
            toggleBtn
        ]);

        modalOverlay = el('div', {
            className: 'auth-modal-overlay',
            role: 'dialog',
            'aria-modal': 'true',
            onClick: (ev) => { if (ev.target === modalOverlay) closeLoginModal(null); }
        }, [form]);
        document.body.appendChild(modalOverlay);
        emailInput.focus();

        return new Promise((resolve) => { modalResolve = resolve; });
    }

    async function requireLogin() {
        if (state.account) return state.account;
        return showLoginModal('login');
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    async function init() {
        onChange(renderAccountBadge);
        await refreshSession();
    }

    window.AppAuth = {
        state,
        init,
        refreshSession,
        signup,
        login,
        logout,
        requireLogin,
        showLoginModal,
        showRoomArchiveModal: () => window.AppProfile?.showProfileModal?.(),
        listMyRooms,
        getMyRoom,
        deleteMyRoom,
        patchMyRoom,
        patchMyProfile,
        onChange
    };
})();
