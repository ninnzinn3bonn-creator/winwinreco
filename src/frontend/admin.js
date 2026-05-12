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
    if (status === 'pending_email') return '<span class="status-pending-email">メール確認待ち</span>';
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

// --- 承認管理タブ専用リロード ---
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

// --- タブ制御 ---
function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.admin-tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });
    if (tabName === 'usage') {
        loadStats().catch((e) => showError(e.message));
        loadUsageList().catch((e) => showError(e.message));
    }
}

// --- 利用状況タブ ---
async function loadStats() {
    let stats;
    try {
        stats = await api('GET', '/admin/stats');
    } catch (e) {
        return;
    }
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val != null ? String(val) : '-';
    };
    set('stat-users-total', stats.users?.total);
    set('stat-users-approved', stats.users?.approved);
    set('stat-users-pending', stats.users?.pending);
    set('stat-users-active7d', stats.users?.active_7d);
    set('stat-users-active30d', stats.users?.active_30d);
    set('stat-rooms-total', stats.rooms?.total);
    set('stat-rooms-week', stats.rooms?.this_week);
    set('stat-rooms-ongoing', stats.rooms?.ongoing);
}

async function loadUsageList() {
    const tbody = document.getElementById('usage-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">読み込み中...</td></tr>';
    let data;
    try {
        data = await api('GET', '/admin/users');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">取得失敗: ${escapeHtml(e.message)}</td></tr>`;
        return;
    }
    const users = data.users || [];
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">ユーザーがいません</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const u of users) {
        const tr = document.createElement('tr');
        tr.dataset.userId = u.id;
        tr.dataset.userEmail = u.email;
        const duration = typeof u.total_duration_minutes === 'number'
            ? Math.round(u.total_duration_minutes)
            : '-';
        tr.innerHTML = `
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.display_name) || '<span style="color:#999">(未設定)</span>'}</td>
            <td>${statusLabel(u.status)}</td>
            <td>${typeof u.meeting_count === 'number' ? u.meeting_count : '-'}</td>
            <td>${duration}</td>
            <td>${formatDateTime(u.last_meeting_at)}</td>
            <td>${formatDateTime(u.last_login_at)}</td>`;
        tbody.appendChild(tr);
    }
}

async function openUserDetail(userId, userEmail) {
    const modal = document.getElementById('meeting-modal');
    const title = document.getElementById('modal-title');
    const tbody = document.getElementById('modal-meetings-tbody');
    if (!modal || !tbody) return;
    title.textContent = `会議履歴: ${userEmail}`;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">読み込み中...</td></tr>';
    modal.classList.add('open');

    try {
        const data = await api('GET', `/admin/users/${encodeURIComponent(userId)}/meetings`);
        const meetings = data.meetings || [];
        if (!meetings.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">会議がありません</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        for (const m of meetings) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(m.title || '(無題)')}</td>
                <td>${escapeHtml(m.status || '')}</td>
                <td>${formatDateTime(m.created_at)}</td>
                <td>${m.duration_minutes != null ? m.duration_minutes : '-'}</td>
                <td>${m.has_minutes ? '✓' : '-'}</td>
                <td>${m.has_summary ? '✓' : '-'}</td>
                <td>${m.has_todo ? '✓' : '-'}</td>`;
            tbody.appendChild(tr);
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">取得失敗: ${escapeHtml(e.message)}</td></tr>`;
    }
}

document.addEventListener('click', async (ev) => {
    // タブ切替
    const tabBtn = ev.target.closest('.admin-tab-btn');
    if (tabBtn && tabBtn.dataset.tab) {
        clearError();
        switchAdminTab(tabBtn.dataset.tab);
        return;
    }

    // モーダル閉じる
    if (ev.target.id === 'modal-close-btn' || ev.target.id === 'meeting-modal') {
        const modal = document.getElementById('meeting-modal');
        if (modal) modal.classList.remove('open');
        return;
    }

    // 利用状況テーブルの行クリック → 会議履歴モーダル
    const usageRow = ev.target.closest('#usage-tbody tr[data-user-id]');
    if (usageRow) {
        clearError();
        await openUserDetail(usageRow.dataset.userId, usageRow.dataset.userEmail);
        return;
    }

    // 承認 / 拒否ボタン
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
