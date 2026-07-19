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

test('short mobile viewport keeps transcript and AI views usable', async ({ page, request }) => {
    const unique = Date.now();
    await page.setViewportSize({ width: 390, height: 650 });
    const account = await loginAndReachHostSetup(page, request, unique);
    await createMeetingFromSetup(page, account.displayName);

    await page.evaluate(() => {
        const state = window.AppState.state;
        state.activityItems = Array.from({ length: 36 }, (_, index) => ({
            type: 'utterance',
            id: `short-mobile-${index}`,
            timestamp: new Date(Date.now() + index * 1000).toISOString(),
            data: {
                id: `short-mobile-${index}`,
                participant_id: index % 2 ? 'mobile-guest' : 'mobile-host',
                display_name: index % 2 ? '佐藤' : '田中',
                transcript: `短い縦画面でも過去の文字起こしを読み返せることを確認します ${index}`,
                raw_transcript: `短い縦画面でも過去の文字起こしを読み返せることを確認します ${index}`,
                timestamp: new Date(Date.now() + index * 1000).toISOString(),
                is_starred: index === 2,
                memo_text: '',
                transcript_source: 'stt'
            }
        }));
        window.AppLogUi.renderAllLogs();
    });

    const initialMetrics = await page.evaluate(() => {
        const timeline = document.getElementById('timeline');
        const screen = document.getElementById('meeting-screen');
        const dock = document.querySelector('.meeting-mobile-dock');
        return {
            viewportHeight: window.innerHeight,
            screenBottom: Math.round(screen.getBoundingClientRect().bottom),
            dockTop: Math.round(dock.getBoundingClientRect().top),
            timelineBottom: Math.round(timeline.getBoundingClientRect().bottom),
            timelineHeight: Math.round(timeline.getBoundingClientRect().height),
            timelineScrollable: timeline.scrollHeight > timeline.clientHeight,
            topbarHidden: getComputedStyle(document.querySelector('.app-topbar')).display === 'none'
        };
    });

    expect(initialMetrics.viewportHeight).toBe(650);
    expect(initialMetrics.screenBottom).toBeLessThanOrEqual(650);
    expect(initialMetrics.timelineBottom).toBeLessThanOrEqual(initialMetrics.dockTop + 1);
    expect(initialMetrics.timelineHeight).toBeGreaterThanOrEqual(180);
    expect(initialMetrics.timelineScrollable).toBe(true);
    expect(initialMetrics.topbarHidden).toBe(true);
    await expect(page).toHaveScreenshot('meeting-short-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02
    });

    const expandedHeight = initialMetrics.timelineHeight;
    await page.locator('#btn-toggle-live-focus').click();
    await expect(page.locator('.live-transcript-focus')).toHaveClass(/is-collapsed/);
    const collapsedHeight = await page.locator('#timeline').evaluate((timeline) => Math.round(timeline.getBoundingClientRect().height));
    expect(collapsedHeight).toBeGreaterThan(expandedHeight);

    await page.locator('#meeting-view-important').click();
    await expect(page.locator('.meeting-layout')).toHaveAttribute('data-mobile-view', 'important');
    await expect(page.locator('#starred-log-list')).toContainText('短い縦画面でも過去の文字起こし');
    await page.locator('#meeting-view-live').click();
    await expect(page.locator('#timeline')).toContainText('短い縦画面でも過去の文字起こし');

    await page.locator('#meeting-view-ai').click();
    await expect(page).toHaveScreenshot('meeting-ai-short-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02
    });
    const aiMetrics = await page.locator('.meeting-ai-panel').evaluate((panel) => {
        const dock = document.querySelector('.meeting-mobile-dock');
        return {
            panelBottom: Math.round(panel.getBoundingClientRect().bottom),
            dockTop: Math.round(dock.getBoundingClientRect().top),
            scrollable: panel.scrollHeight > panel.clientHeight
        };
    });
    expect(aiMetrics.panelBottom).toBeLessThanOrEqual(aiMetrics.dockTop + 1);
    expect(aiMetrics.scrollable).toBe(true);
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

test('mobile-first core screens match visual baselines', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#welcome-screen')).toHaveClass(/active/);
    await expect(page).toHaveScreenshot('welcome-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.015
    });

    await page.locator('#welcome-btn-login').click();
    await expect(page.locator('#setup-screen.active')).toBeVisible();
    await expect(page).toHaveScreenshot('setup-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.015
    });

    const unique = Date.now();
    const account = await loginAndReachHostSetup(page, request, unique);
    await createMeetingFromSetup(page, account.displayName);

    await page.evaluate(() => {
        const state = window.AppState.state;
        state.activityItems = [
            {
                type: 'utterance',
                id: 'visual-1',
                timestamp: '2026-07-19T09:00:00+09:00',
                data: {
                    id: 'visual-1',
                    participant_id: 'visual-host',
                    display_name: '田中',
                    transcript: '本日のリリース範囲と、残っている確認事項を整理します。',
                    raw_transcript: '本日のリリース範囲と、残っている確認事項を整理します。',
                    timestamp: '2026-07-19T09:00:00+09:00',
                    is_starred: true,
                    memo_text: '',
                    transcript_source: 'stt'
                }
            },
            {
                type: 'utterance',
                id: 'visual-2',
                timestamp: '2026-07-19T09:01:00+09:00',
                data: {
                    id: 'visual-2',
                    participant_id: 'visual-guest',
                    display_name: '佐藤',
                    transcript: 'モバイル表示の最終確認は今日中に完了できます。',
                    raw_transcript: 'モバイル表示の最終確認は今日中に完了できます。',
                    timestamp: '2026-07-19T09:01:00+09:00',
                    is_starred: false,
                    memo_text: '確認担当を決める',
                    transcript_source: 'user'
                }
            }
        ];
        state.provisionalCards = {
            'visual-live': {
                participant_id: 'visual-live',
                display_name: '鈴木',
                text: 'アクセシビリティと操作導線も合わせて確認しています。'
            }
        };
        const title = document.getElementById('meeting-title-input');
        if (title) title.value = '週次プロダクト会議';
        const roomInfo = document.getElementById('room-info');
        if (roomInfo) roomInfo.textContent = 'ルーム: ABC123';
        const authBadge = document.getElementById('auth-badge');
        if (authBadge) authBadge.textContent = '田中';
        if (state.micMonitorFrame) cancelAnimationFrame(state.micMonitorFrame);
        state.micMonitorFrame = null;
        if (state.meetingElapsedTimer) clearInterval(state.meetingElapsedTimer);
        state.meetingElapsedTimer = null;
        const elapsed = document.getElementById('meeting-elapsed');
        if (elapsed) elapsed.textContent = '12:47';
        window.AppLogUi.renderAllLogs();
        const level = document.getElementById('live-focus-level');
        if (level) level.style.width = '38%';
    });

    await expect(page).toHaveScreenshot('meeting-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02
    });

    const undersizedMeetingTargets = await page.evaluate(() => (
        [...document.querySelectorAll('button, a[href]')]
            .filter((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0
                    && (rect.width < 44 || rect.height < 44);
            })
            .map((element) => ({
                id: element.id || null,
                text: (element.textContent || '').trim().slice(0, 30),
                width: Math.round(element.getBoundingClientRect().width),
                height: Math.round(element.getBoundingClientRect().height)
            }))
    ));
    expect(undersizedMeetingTargets).toEqual([]);

    await page.locator('#meeting-view-live').press('ArrowRight');
    await expect(page.locator('#meeting-view-important')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.meeting-layout')).toHaveAttribute('data-mobile-view', 'important');
    await page.locator('#meeting-view-live').click();
    await expect(page.locator('.meeting-layout')).toHaveAttribute('data-mobile-view', 'live');

    for (const viewport of [
        { width: 768, height: 1024 },
        { width: 1280, height: 800 }
    ]) {
        await page.setViewportSize(viewport);
        const metrics = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            liveFocusVisible: document.querySelector('.live-transcript-focus')?.getBoundingClientRect().height > 0
        }));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
        expect(metrics.liveFocusVisible).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => {
        window.AppState.state.provisionalCards = {};
        window.AppLogUi.renderAllLogs();
    });
    const summaryLogsLoaded = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && /\/rooms\/[^/]+\/logs(?:\?|$)/.test(response.url())
    ));
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-dock-end').click();
    await expect(page.locator('#summary-screen.active')).toBeVisible();
    await summaryLogsLoaded;
    await page.waitForTimeout(500);
    await page.locator('#tab-log').click();
    await expect(page.locator('#panel-log.active')).toBeVisible();
    await page.evaluate(() => {
        const state = window.AppState.state;
        if (state.ws && state.ws.readyState < WebSocket.CLOSING) state.ws.close();
        state.activityItems = [
            {
                type: 'utterance',
                id: 'summary-1',
                timestamp: '2026-07-19T09:00:00+09:00',
                data: {
                    id: 'summary-1',
                    participant_id: 'summary-host',
                    display_name: '田中',
                    transcript: '本日のリリース範囲と、残っている確認事項を整理します。',
                    raw_transcript: '本日のリリース範囲と、残っている確認事項を整理します。',
                    timestamp: '2026-07-19T09:00:00+09:00',
                    is_starred: true,
                    memo_text: '',
                    transcript_source: 'stt'
                }
            },
            {
                type: 'utterance',
                id: 'summary-2',
                timestamp: '2026-07-19T09:01:00+09:00',
                data: {
                    id: 'summary-2',
                    participant_id: 'summary-guest',
                    display_name: '佐藤',
                    transcript: 'モバイル表示の最終確認は今日中に完了できます。',
                    raw_transcript: 'モバイル表示の最終確認は今日中に完了できます。',
                    timestamp: '2026-07-19T09:01:00+09:00',
                    is_starred: false,
                    memo_text: '確認担当を決める',
                    transcript_source: 'user'
                }
            }
        ];
        window.AppLogUi.renderAllLogs();
        const summaryInfo = document.getElementById('summary-info');
        if (summaryInfo) summaryInfo.textContent = 'ルーム: ABC123';
        const authBadge = document.getElementById('auth-badge');
        if (authBadge) authBadge.textContent = '田中';
    });
    await expect(page.locator('#summary-log')).toContainText('本日のリリース範囲');
    await expect(page).toHaveScreenshot('summary-mobile.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
    });

    for (const viewport of [
        { width: 768, height: 1024 },
        { width: 1280, height: 800 }
    ]) {
        await page.setViewportSize(viewport);
        const metrics = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    }
});
