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
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

function formatDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function renderHosts(hosts) {
    const tbody = document.getElementById('host-tbody');
    if (!tbody) return;
    if (!hosts.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:#999">登録なし</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const h of hosts) {
        const tr = document.createElement('tr');
        const isDisabled = !!h.disabled;
        tr.innerHTML = `
            <td>${h.email}</td>
            <td>${h.display_name || ''}</td>
            <td>${formatDate(h.added_at)}</td>
            <td class="${isDisabled ? 'badge-disabled' : 'badge-active'}">${isDisabled ? '無効' : '有効'}</td>
            <td>
                <button
                    data-action="toggle"
                    data-email="${h.email}"
                    data-disabled="${isDisabled}"
                >${isDisabled ? '有効化' : '無効化'}</button>
                <button
                    class="danger"
                    data-action="remove"
                    data-email="${h.email}"
                >削除</button>
            </td>`;
        tbody.appendChild(tr);
    }
}

function clearError() {
    const el = document.getElementById('error-output');
    if (el) el.textContent = '';
}

function showError(msg) {
    const el = document.getElementById('error-output');
    if (el) el.textContent = msg;
}

async function reloadHosts() {
    const { hosts } = await api('GET', '/admin/hosts');
    renderHosts(hosts);
}

document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('#host-tbody button');
    if (!btn) return;
    clearError();
    const { action, email, disabled } = btn.dataset;
    try {
        if (action === 'remove') {
            if (!confirm(`${email} をallowlistから削除しますか？`)) return;
            await api('DELETE', `/admin/hosts/${encodeURIComponent(email)}`);
        } else if (action === 'toggle') {
            await api('PATCH', `/admin/hosts/${encodeURIComponent(email)}`, {
                disabled: disabled !== 'true'
            });
        }
        await reloadHosts();
    } catch (e) {
        showError(e.message);
    }
});

document.getElementById('add-host-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearError();
    const fd = new FormData(ev.target);
    try {
        await api('POST', '/admin/hosts', {
            email: fd.get('email'),
            display_name: fd.get('display_name'),
            note: fd.get('note') || ''
        });
        ev.target.reset();
        await reloadHosts();
    } catch (e) {
        showError(e.message);
    }
});

async function init() {
    try {
        const me = await api('GET', '/auth/me');
        if (!me || !me.account) return;
        // オーナーかどうかは /admin/hosts の 403 で判定
        try {
            const { hosts } = await api('GET', '/admin/hosts');
            document.getElementById('login-section').hidden = true;
            document.getElementById('admin-section').hidden = false;
            document.getElementById('current-user-email').textContent = me.account.email;
            renderHosts(hosts);
        } catch (e) {
            document.getElementById('login-section').innerHTML =
                '<h1>権限がありません</h1><p>オーナーアカウントでログインしてください。</p><p><a href="/">← トップへ戻る</a></p>';
        }
    } catch (_e) {
        // 未ログイン → デフォルト画面のまま
    }
}

init();
