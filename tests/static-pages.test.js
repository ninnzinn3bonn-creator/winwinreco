/**
 * tests/static-pages.test.js
 *
 * Integration tests for U-5: legal static pages.
 *
 * Coverage (2 cases):
 *   1. GET /terms  returns 200 HTML containing "利用規約"
 *   2. GET /privacy returns 200 HTML containing "プライバシーポリシー"
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');

const DB_PATH = path.resolve(__dirname, './tmp/test_static_pages.db');

describe('Static legal pages', () => {
    let app;
    let db;

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

        db = await initDB(DB_PATH);
        app = createApp({});
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    test('GET /terms returns 200 HTML with 利用規約', async () => {
        const res = await request(app).get('/terms');
        expect(res.status).toBe(200);
        expect(res.text).toContain('利用規約');
    });

    test('GET /privacy returns 200 HTML with プライバシーポリシー', async () => {
        const res = await request(app).get('/privacy');
        expect(res.status).toBe(200);
        expect(res.text).toContain('プライバシーポリシー');
    });

    test('setup screen omits fixed-provider AI settings and dictionary cards', async () => {
        const res = await request(app).get('/');

        expect(res.status).toBe(200);
        expect(res.text).not.toContain('AI設定');
        expect(res.text).not.toContain('専門用語辞書');
        expect(res.text).not.toContain('api-status-container');
        expect(res.text).not.toContain('mic-check-steps');
        expect(res.text).toContain('どのマイクで録りますか');
        expect(res.text).toContain('音が響く部屋');
        expect(res.text).toContain('data-mic-preset="tabletop"');
        expect(res.text).toContain('会議の詳細');
        expect(res.text).not.toContain('必要なときだけ微調整');
        expect(res.text).not.toContain('最小音量閾値');
        expect(res.text).not.toContain('id="profile-text"');
        expect(res.text).not.toContain('data-mic-preset="echo_room"');
    });

    test('minutes workspace exposes copy and download only', async () => {
        const res = await request(app).get('/');

        expect(res.status).toBe(200);
        expect(res.text).toContain('btn-minutes-copy');
        expect(res.text).toContain('btn-minutes-download');
        expect(res.text).not.toContain('btn-download-final');
        expect(res.text).not.toContain('Markdown 保存');
    });

    test('mobile meeting controls have one clear owner per action', async () => {
        const res = await request(app).get('/');

        expect(res.status).toBe(200);
        expect(res.text).toContain('id="btn-dock-share"');
        expect(res.text).toContain('id="btn-toggle-live-focus"');
        expect(res.text).toContain('id="btn-close-meeting-settings"');
        expect(res.text).toContain('id="meeting-memo-modal-overlay"');
        expect(res.text).toContain('id="meeting-end-modal-overlay"');
        expect(res.text).toContain('data-analysis-result="summary"');
        expect(res.text).not.toContain('id="btn-dock-participants"');
        expect(res.text).not.toContain('id="btn-open-ai-suggestion"');
        expect(res.text).not.toContain('id="btn-mobile-menu"');
        expect(res.text).not.toContain('id="mobile-meeting-title-input"');
    });

    test('meeting actions use in-app dialogs instead of browser prompts', () => {
        const source = fs.readFileSync(path.join(__dirname, '../src/frontend/meeting-ui.js'), 'utf8');

        expect(source).not.toMatch(/\bprompt\s*\(/);
        expect(source).not.toMatch(/\bconfirm\s*\(/);
    });

    test('mobile meeting header avoids the iOS Safari browser toolbar', () => {
        const mainSource = fs.readFileSync(path.join(__dirname, '../src/frontend/main.js'), 'utf8');
        const screenStyles = fs.readFileSync(path.join(__dirname, '../src/frontend/styles/apple-screens.css'), 'utf8');

        expect(mainSource).toContain("classList.toggle('ios-safari-browser'");
        expect(mainSource).toContain("'(display-mode: standalone)'");
        expect(screenStyles).toContain('html.ios-safari-browser body.meeting-mode');
        expect(screenStyles).toContain('--meeting-browser-toolbar-offset: 48px');
        expect(screenStyles).toContain('padding: var(--meeting-browser-toolbar-offset) 0 var(--meeting-dock-height)');
    });
});
