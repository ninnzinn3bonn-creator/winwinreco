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
});
