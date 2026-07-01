'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../src/backend/app');

describe('Progress dashboard', () => {
    test('progress.html exists', () => {
        const file = path.resolve(__dirname, '../src/frontend/progress.html');
        expect(fs.existsSync(file)).toBe(true);
    });

    test('GET /progress returns dashboard HTML', async () => {
        const app = createApp({});
        const res = await request(app).get('/progress');
        expect(res.status).toBe(200);
        expect(res.text).toContain('進捗ダッシュボード');
    });
});
