const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { hashPassword } = require('../src/backend/lib/passwords');
const { newId } = require('../src/backend/lib/ids');

function configuredDbPath() {
    const envText = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
    const envDbPath = envText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('DB_PATH='))
        ?.replace(/^DB_PATH=/, '')
        .replace(/^["']|["']$/g, '');
    return path.resolve(process.cwd(), process.env.DB_PATH || envDbPath || './db/meeting.db');
}

function runDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(configuredDbPath());
        db.run(sql, params, function onRun(err) {
            db.close();
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function signupApprovedAccount(_request, suffix = Date.now()) {
    const email = `codex-e2e-${suffix}@example.com`;
    const password = 'Password123!';
    const displayName = `E2E User ${suffix}`;
    const passwordHash = await hashPassword(password);
    await runDb(
        `INSERT INTO user_accounts (id, email, password_hash, display_name, status)
         VALUES (?, ?, ?, ?, ?)`,
        [newId('acc'), email, passwordHash, displayName, 'approved']
    );
    return { email, password, displayName };
}

async function acceptRecordingConsentIfVisible(page) {
    const consentOk = page.locator('#consent-ok');
    try {
        await expect(consentOk).toBeVisible({ timeout: 2000 });
        await consentOk.click();
    } catch (_err) {
        // Consent was already remembered in this browser context.
    }
}

async function loginAndReachHostSetup(page, request, suffix = Date.now()) {
    const account = await signupApprovedAccount(request, suffix);
    await page.goto('/');
    await expect(page.locator('#welcome-screen')).toHaveClass(/active/);

    await page.locator('#welcome-btn-guest').click();
    await expect(page.locator('#welcome-auth-form')).toBeVisible();

    await page.locator('#welcome-email').fill(account.email);
    await page.locator('#welcome-password').fill(account.password);
    await page.locator('#welcome-form-submit').click();

    await expect(page.locator('#setup-screen.active')).toBeVisible();
    await expect(page.locator('#setup-screen-title')).toContainText('会議を作成');

    return account;
}

async function createMeetingFromSetup(page, displayName = `E2E Host ${Date.now()}`) {
    const displayNameInput = page.locator('#display-name');
    if (!(await displayNameInput.inputValue())) {
        await displayNameInput.fill(displayName);
    }
    await page.locator('#btn-start-meeting').click();
    await acceptRecordingConsentIfVisible(page);
    await expect(page.locator('#meeting-screen.active')).toBeVisible();
    await expect(page.locator('#room-info')).toContainText(/[A-Z2-9]{6}/);

    const roomInfoText = await page.locator('#room-info').innerText();
    const roomId = roomInfoText.match(/[A-Z2-9]{6}/)?.[0];
    expect(roomId).toBeTruthy();
    return { roomId };
}

async function endMeeting(page) {
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-end').click();
    await expect(page.locator('#summary-screen.active')).toBeVisible();
    await expect(page.locator('#summary-info')).toContainText(/[A-Z2-9]{6}/);
}

test('approved account can create a room and reach summary flow', async ({ page, request }) => {
    const unique = Date.now();
    const account = await loginAndReachHostSetup(page, request, unique);
    await createMeetingFromSetup(page, account.displayName);
    await expect(page.locator('#btn-copy-room')).toBeVisible();
    await endMeeting(page);
    await expect(page.locator('#tab-minutes')).toHaveClass(/active/);
});

test('guest can join via share url and sees meeting room', async ({ browser, page, request }) => {
    const unique = Date.now();
    const account = await loginAndReachHostSetup(page, request, unique);
    const { roomId } = await createMeetingFromSetup(page, account.displayName);

    const guestContext = await browser.newContext({
        permissions: ['microphone']
    });
    const guestPage = await guestContext.newPage();

    await guestPage.goto(`/?room=${roomId}`);
    await expect(guestPage.locator('#setup-screen.active')).toBeVisible();
    await expect(guestPage.locator('#participant-mode-banner')).toBeVisible();
    await expect(guestPage.locator('#room-id')).toHaveValue(roomId);

    await guestPage.locator('#display-name').fill(`Guest ${unique}`);
    await guestPage.locator('#btn-start-meeting').click();
    await acceptRecordingConsentIfVisible(guestPage);

    await expect(guestPage.locator('#meeting-screen.active')).toBeVisible();
    await expect(guestPage.locator('#room-info')).toContainText(roomId);

    await endMeeting(page);
    await expect(guestPage.locator('#summary-screen.active')).toBeVisible();

    await guestContext.close();
});

test('mobile meeting log exposes compact scroll affordance when overflowing', async ({ page, request }) => {
    const unique = Date.now();
    await page.setViewportSize({ width: 390, height: 844 });
    const account = await loginAndReachHostSetup(page, request, unique);
    await createMeetingFromSetup(page, account.displayName);

    await page.evaluate(() => {
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';
        for (let i = 0; i < 80; i += 1) {
            const item = document.createElement('article');
            item.className = 'utterance';
            item.innerHTML = `
                <div class="utterance-main-line">
                    <span class="speaker-name">User ${i}</span>
                    <span class="utterance-separator" aria-hidden="true">:</span>
                    <span class="text">モバイルログのスクロール確認 ${i}</span>
                </div>
                <div class="utterance-footer">
                    <span class="utterance-time">00:${String(i).padStart(2, '0')}</span>
                    <div class="utterance-actions" aria-label="ログ操作">
                        <button class="icon-toggle utterance-star-toggle" data-action="star" aria-label="重要にする">☆</button>
                    </div>
                </div>
            `;
            timeline.appendChild(item);
        }
        timeline.scrollTop = 0;
    });

    const scrollbar = page.locator('#mobile-log-scrollbar');
    await expect(scrollbar).toBeVisible();
    await expect(scrollbar).not.toHaveClass(/is-hidden/);

    const before = Number(await scrollbar.getAttribute('aria-valuenow'));
    await page.locator('#timeline').evaluate((timeline) => {
        timeline.scrollTop = timeline.scrollHeight;
        timeline.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(async () => Number(await scrollbar.getAttribute('aria-valuenow'))).toBe(100);
    const after = Number(await scrollbar.getAttribute('aria-valuenow'));

    expect(after).toBeGreaterThan(before);
});

test('host setup screen omits legacy dictionary controls', async ({ page, request }) => {
    const unique = Date.now();
    await loginAndReachHostSetup(page, request, unique);

    await expect(page.locator('#setup-screen.active')).toBeVisible();
    await expect(page.locator('#dict-term')).toHaveCount(0);
    await expect(page.locator('#dict-reading')).toHaveCount(0);
    await expect(page.locator('#dictionary-list')).toHaveCount(0);
    await expect(page.locator('#api-status-container')).toHaveCount(0);
    await expect(page.locator('#setup-screen')).toContainText('利用シーン');
    await expect(page.locator('#setup-screen')).toContainText('必要なときだけ微調整');
});

test('summary tabs switch and base panels render', async ({ page, request }) => {
    const unique = Date.now();
    const account = await loginAndReachHostSetup(page, request, unique);
    await createMeetingFromSetup(page, account.displayName);
    await endMeeting(page);

    await expect(page.locator('#panel-minutes')).toHaveClass(/active/);
    await expect(page.locator('#minutes-output-editor')).toBeVisible();

    await page.locator('#tab-log').click();
    await expect(page.locator('#tab-log')).toHaveClass(/active/);
    await expect(page.locator('#panel-log')).toHaveClass(/active/);
    await expect(page.locator('#summary-log')).toBeVisible();

    await page.locator('#tab-ai').click();
    await expect(page.locator('#tab-ai')).toHaveClass(/active/);
    await expect(page.locator('#panel-ai')).toHaveClass(/active/);
    await expect(page.locator('#ai-output-editor')).toBeVisible();

    await page.locator('#tab-minutes').click();
    await expect(page.locator('#tab-minutes')).toHaveClass(/active/);
    await expect(page.locator('#panel-minutes')).toHaveClass(/active/);
    await expect(page.locator('#minutes-output-editor')).toBeVisible();
});

test('normal signup explains email verification before room creation', async ({ page }) => {
    const unique = Date.now();
    await page.goto('/');
    await expect(page.locator('#welcome-screen')).toHaveClass(/active/);

    await page.locator('#welcome-btn-signup').click();
    await expect(page.locator('#welcome-auth-form')).toBeVisible();

    await page.locator('#welcome-email').fill(`codex-pending-${unique}@example.com`);
    await page.locator('#welcome-name').fill(`Pending User ${unique}`);
    await page.locator('#welcome-password').fill('Password123!');
    await page.locator('#welcome-consent-checkbox').check();
    await page.locator('#welcome-form-submit').click();

    await expect(page.locator('#welcome-pending')).toBeVisible();
    await expect(page.locator('#setup-screen.active')).toHaveCount(0);
});
