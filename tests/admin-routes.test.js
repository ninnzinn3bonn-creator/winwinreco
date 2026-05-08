/**
 * Phase 3b — /admin/hosts ルートのテスト。
 * - 未ログインで 401
 * - オーナー以外で 403
 * - オーナーで CRUD が動く
 */

const request = require('supertest');
const path = require('path');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { createApp } = require('../src/backend/app');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { UserRepository } = require('../src/backend/repo/sqlite/user-repo');
const { HostAllowlistRepository } = require('../src/backend/repo/sqlite/host-allowlist-repo');

const DB_PATH = path.join(__dirname, '../db/test-admin.db');

const OWNER_EMAIL = 'admin-owner@example.com';
const OTHER_EMAIL = 'admin-other@example.com';

let db, app, repos;
let ownerCookie, otherCookie;

async function signup(email, displayName) {
    const res = await request(app)
        .post('/auth/signup')
        .send({ email, password: 'password123', display_name: displayName });
    return res.headers['set-cookie'];
}

beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER_EMAIL;

    db = await initDB(DB_PATH);
    repos = {
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db),
        userRepo: new UserRepository(db),
        hostAllowlistRepo: new HostAllowlistRepository(db)
    };
    app = createApp(repos);

    // NODE_ENV=test なので allowlist チェックは無効 → 両方サインアップできる
    ownerCookie = await signup(OWNER_EMAIL, 'Owner');
    otherCookie = await signup(OTHER_EMAIL, 'Other');
});

afterAll(async () => {
    await new Promise((res) => db.close(res));
    const fs = require('fs');
    for (const ext of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(DB_PATH + ext); } catch (_) { /* ignore */ }
    }
    delete process.env.OWNER_EMAIL;
});

describe('GET /admin/hosts', () => {
    test('未ログインで 401', async () => {
        const res = await request(app).get('/admin/hosts');
        expect(res.status).toBe(401);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get('/admin/hosts')
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });

    test('オーナーで 200 + 配列', async () => {
        const res = await request(app)
            .get('/admin/hosts')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.hosts)).toBe(true);
    });
});

describe('POST /admin/hosts', () => {
    test('未ログインで 401', async () => {
        const res = await request(app)
            .post('/admin/hosts')
            .send({ email: 'new@example.com', display_name: 'New' });
        expect(res.status).toBe(401);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .post('/admin/hosts')
            .set('Cookie', otherCookie)
            .send({ email: 'new@example.com', display_name: 'New' });
        expect(res.status).toBe(403);
    });

    test('オーナーで追加できる', async () => {
        const res = await request(app)
            .post('/admin/hosts')
            .set('Cookie', ownerCookie)
            .send({ email: 'host1@example.com', display_name: 'Host One', note: 'test' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        const list = await request(app)
            .get('/admin/hosts')
            .set('Cookie', ownerCookie);
        expect(list.body.hosts.some((h) => h.email === 'host1@example.com')).toBe(true);
    });

    test('email / display_name が空で 400', async () => {
        const res = await request(app)
            .post('/admin/hosts')
            .set('Cookie', ownerCookie)
            .send({ email: '', display_name: '' });
        expect(res.status).toBe(400);
    });

    test('OWNER_EMAIL 自身を追加しようとすると 400', async () => {
        const res = await request(app)
            .post('/admin/hosts')
            .set('Cookie', ownerCookie)
            .send({ email: OWNER_EMAIL, display_name: 'Owner again' });
        expect(res.status).toBe(400);
    });
});

describe('PATCH /admin/hosts/:email', () => {
    test('disabled=true で無効化できる', async () => {
        const res = await request(app)
            .patch('/admin/hosts/host1@example.com')
            .set('Cookie', ownerCookie)
            .send({ disabled: true });
        expect(res.status).toBe(200);

        const list = await request(app)
            .get('/admin/hosts')
            .set('Cookie', ownerCookie);
        const h = list.body.hosts.find((x) => x.email === 'host1@example.com');
        expect(!!h.disabled).toBe(true);
    });

    test('boolean 以外で 400', async () => {
        const res = await request(app)
            .patch('/admin/hosts/host1@example.com')
            .set('Cookie', ownerCookie)
            .send({ disabled: 'yes' });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /admin/hosts/:email', () => {
    test('オーナーで削除できる', async () => {
        const res = await request(app)
            .delete('/admin/hosts/host1@example.com')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);

        const list = await request(app)
            .get('/admin/hosts')
            .set('Cookie', ownerCookie);
        expect(list.body.hosts.some((h) => h.email === 'host1@example.com')).toBe(false);
    });

    test('OWNER_EMAIL を削除しようとすると 400', async () => {
        const res = await request(app)
            .delete(`/admin/hosts/${OWNER_EMAIL}`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(400);
    });
});
