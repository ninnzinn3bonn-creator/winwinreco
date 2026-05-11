/* global fetch, document, confirm */

async function api(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err.error || res.statusText);
        e.status = res.status;
        throw e;
    }
    return res.json();
}

function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function clearError() {
    const el = document.getElementById('error-output');
    if (el) el.textContent = '';
}

function showError(msg) {
    const el = document.getElementById('error-output');
    if (el) el.textContent = msg;
}

function renderPendingBadge(count) {
    const badge = document.getElementById('pending-badge');
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle('zero', count === 0);
}

function renderPending(users) {
    const tbody = document.getElementById('pending-tbody');
    if (!tbody) return;
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">承認待ちのユーザーはいません</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const u of users) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.display_name) || '<span style="color:#999">(未設定)</span>'}</td>
            <td>${formatDateTime(u.created_at)}</td>
            <td>
                <div class="user-actions">
                    <button class="approve" data-action="approve" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">承認</button>
                    <button class="reject" data-action="reject" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">拒否</button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    }
}

function statusLabel(status) {
    if (status === 'approved') return '<span class="status-approved">承認済み</span>';
    if (status === 'pending') return '<span class="status-pending">承認待ち</span>';
    if (status === 'rejected') return '<span class="status-rejected">拒否</span>';
    return escapeHtml(status);
}

function renderAllUsers(users) {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-row">ユーザーがいません</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const u of users) {
        const tr = document.createElement('tr');
        let actions = '';
        if (u.status === 'pending') {
            actions = `
                <div class="user-actions">
                    <button class="approve" data-action="approve" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">承認</button>
                    <button class="reject" data-action="reject" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">拒否</button>
                </div>`;
        } else if (u.status === 'approved') {
            actions = `<button class="reject" data-action="reject" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">拒否に変更</button>`;
        } else if (u.status === 'rejected') {
            actions = `<button class="approve" data-action="approve" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}">承認に戻す</button>`;
        }
        tr.innerHTML = `
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.display_name) || '<span style="color:#999">(未設定)</span>'}</td>
            <td>${statusLabel(u.status)}</td>
            <td>${formatDateTime(u.created_at)}</td>
            <td>${actions}</td>`;
        tbody.appendChild(tr);
    }
}

async function reloadAll() {
    const [pending, all, countResp] = await Promise.all([
        api('GET', '/admin/users/pending'),
        api('GET', '/admin/users'),
        api('GET', '/admin/users/pending/count').catch(() => ({ count: 0 }))
    ]);
    renderPending(pending.users || []);
    renderAllUsers(all.users || []);
    renderPendingBadge(countResp.count || 0);
}

document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    clearError();
    const { action, id, email } = btn.dataset;
    try {
        if (action === 'approve') {
            await api('POST', `/admin/users/${encodeURIComponent(id)}/approve`);
        } else if (action === 'reject') {
            if (!confirm(`${email} を拒否しますか？\nレコードは残るので、後で承認に戻すこともできます。`)) return;
            await api('POST', `/admin/users/${encodeURIComponent(id)}/reject`);
        }
        await reloadAll();
    } catch (e) {
        showError(e.message);
    }
});

/**
 * オーナー初回ブートストラップ画面。誰もオーナーがいない場合に、
 * 現在ログインしているユーザーが自分自身をオーナーに昇格できる。
 */
function renderBootstrapScreen(me) {
    const root = document.getElementById('login-section');
    root.innerHTML = `
        <h1>初回セットアップ</h1>
        <p>このシステムにはまだ管理者 (オーナー) がいません。</p>
        <p>現在ログイン中のアカウント <strong>${escapeHtml(me.account.email)}</strong> をオーナーにしてセットアップを開始できます。</p>
        <p style="color:#666; font-size:0.9rem;">⚠ 一度設定すると、ここから他のユーザーを承認・拒否できる管理権限を持ちます。</p>
        <div style="margin-top:20px; display:flex; gap:12px;">
            <button id="bootstrap-btn" class="approve" style="padding:10px 22px; font-size:1rem;">このアカウントをオーナーにする</button>
            <a href="/" style="align-self:center;">← トップへ戻る</a>
        </div>
        <pre id="error-output" style="color:#c00; margin-top:8px;"></pre>
    `;
    document.getElementById('bootstrap-btn').addEventListener('click', async () => {
        clearError();
        try {
            await api('POST', '/admin/bootstrap-owner');
            // 成功したらリロードで通常 admin UI に入る
            window.location.reload();
        } catch (e) {
            showError(e.message);
        }
    });
}

function renderNoPermissionScreen(me) {
    const root = document.getElementById('login-section');
    root.innerHTML = `
        <h1>権限がありません</h1>
        <p>現在のアカウント <strong>${escapeHtml(me.account.email)}</strong> には管理者権限がありません。</p>
        <p>オーナーアカウントでログインしてください。</p>
        <p><a href="/">← トップへ戻る</a></p>
    `;
}

function renderNotLoggedInScreen() {
    const root = document.getElementById('login-section');
    root.innerHTML = `
        <h1>管理画面</h1>
        <p>ログインしてください。</p>
        <p><a href="/">← トップへ戻り、画面右上から「ログイン」してください。</a></p>
    `;
}

async function init() {
    let me;
    try {
        me = await api('GET', '/auth/me');
    } catch (_e) {
        renderNotLoggedInScreen();
        return;
    }
    if (!me || !me.account) {
        renderNotLoggedInScreen();
        return;
    }

    // オーナー判定はサーバーに聞く (DB の is_owner と OWNER_EMAIL の両方を見ている)
    let status;
    try {
        status = await api('GET', '/admin/owner-status');
    } catch (e) {
        showError(e.message);
        return;
    }

    if (status.is_self_owner) {
        // 通常の admin UI
        try {
            await reloadAll();
            document.getElementById('login-section').hidden = true;
            document.getElementById('admin-section').hidden = false;
            document.getElementById('current-user-email').textContent = me.account.email;
        } catch (e) {
            showError(e.message);
        }
        return;
    }

    if (status.can_bootstrap) {
        // まだ誰もオーナーでない → 初回セットアップ画面
        renderBootstrapScreen(me);
        return;
    }

    // 他にオーナーがいる + 自分はオーナーでない → 権限なし
    renderNoPermissionScreen(me);
}

init();
