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

async function init() {
    try {
        const me = await api('GET', '/auth/me');
        if (!me || !me.account) return;
        // オーナーかどうかは /admin/users で 403 が返るかで判定。
        try {
            await reloadAll();
            document.getElementById('login-section').hidden = true;
            document.getElementById('admin-section').hidden = false;
            document.getElementById('current-user-email').textContent = me.account.email;
        } catch (e) {
            if (e.status === 403) {
                document.getElementById('login-section').innerHTML =
                    '<h1>権限がありません</h1><p>オーナーアカウントでログインしてください。</p><p><a href="/">← トップへ戻る</a></p>';
            } else {
                showError(e.message);
            }
        }
    } catch (_e) {
        // 未ログイン → デフォルト画面のまま
    }
}

init();
