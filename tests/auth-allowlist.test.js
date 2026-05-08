/**
 * Phase 3a — host_allowlist によるサインアップゲートのテスト。
 * SIGNUP_ALLOWLIST_DISABLED=false を明示的に設定して allowlist を有効化する。
 */

const request = require('supertest');
const path = require('path');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { createApp } = require('../src/backend/app');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { UserRepository } = require('../src/backend/repo/sqlite/user-repo');
const { HostAllowlistRepository } = require('../src/backend/repo/sqlite/host-allowlist-repo');

const DB_PATH = path.join(__dirname, '../db/test-allowlist.db');

let db, app, repos;

const OWNER_EMAIL = 'owner@example.com';
const ALLOWED_EMAIL = 'allowed@example.com';
const BLOCKED_EMAIL = 'blocked@example.com';

beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER_EMAIL;
    process.env.SIGNUP_ALLOWLIST_DISABLED = 'false';

    db = await initDB(DB_PATH);
    repos = {
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db),
        userRepo: new UserRepository(db),
        hostAllowlistRepo: new HostAllowlistRepository(db)
    };
    app = createApp(repos);
});

afterAll(async () => {
    await new Promise((res) => db.close(res));
    // テスト DB を削除
    const fs = require('fs');
    try { fs.unlinkSync(DB_PATH); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch (_) { /* ignore */ }
    delete process.env.SIGNUP_ALLOWLIST_DISABLED;
    delete process.env.OWNER_EMAIL;
});

describe('allowlist gate (SIGNUP_ALLOWLIST_DISABLED=false)', () => {
    test('オーナーメールは allowlist 不要でサインアップできる', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: OWNER_EMAIL, password: 'password123', display_name: 'Owner' });
        expect(res.status).toBe(201);
        expect(res.body.account.email).toBe(OWNER_EMAIL);
    });

    test('allowlist 未登録メールは 403', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: BLOCKED_EMAIL, password: 'password123', display_name: 'Blocked' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/not allowed/);
    });

    test('allowlist に追加されたメールはサインアップできる', async () => {
        await repos.hostAllowlistRepo.add({
            email: ALLOWED_EMAIL,
            display_name: 'Allowed User',
            added_by: OWNER_EMAIL
        });

        const res = await request(app)
            .post('/auth/signup')
            .send({ email: ALLOWED_EMAIL, password: 'password123', display_name: 'Allowed' });
        expect(res.status).toBe(201);
        expect(res.body.account.email).toBe(ALLOWED_EMAIL);
    });

    test('disabled=true のエントリは 403', async () => {
        const DISABLED_EMAIL = 'disabled@example.com';
        await repos.hostAllowlistRepo.add({
            email: DISABLED_EMAIL,
            display_name: 'Disabled User',
            added_by: OWNER_EMAIL
        });
        await repos.hostAllowlistRepo.setDisabled(DISABLED_EMAIL, true);

        const res = await request(app)
            .post('/auth/signup')
            .send({ email: DISABLED_EMAIL, password: 'password123', display_name: 'Disabled' });
        expect(res.status).toBe(403);
    });
});
