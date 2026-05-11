/**
 * /admin/users 系ルート (事後承認フロー) のテスト。
 * 旧 /admin/hosts (allowlist) は廃止済み。
 *
 *   - 未ログインで 401
 *   - オーナー以外で 403
 *   - オーナーで pending list / approve / reject が動く
 */

const request = require('supertest');
const path = require('path');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { createApp } = require('../src/backend/app');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { UserRepository } = require('../src/backend/repo/sqlite/user-repo');

const DB_PATH = path.join(__dirname, '../db/test-admin.db');

const OWNER_EMAIL = 'admin-owner@example.com';
const OTHER_EMAIL = 'admin-other@example.com';
const PENDING_EMAIL = 'pending-user@example.com';
const PASSWORD = 'password123';

let db, app, repos;
let ownerCookie, otherCookie;
let pendingUserId;

/** signup → repo で approved → login してセッション cookie を返す。 */
async function signupApproveLogin(email, displayName) {
    await request(app)
        .post('/auth/signup')
        .send({ email, password: PASSWORD, display_name: displayName });
    const acc = await repos.accountRepo.findByEmail(email);
    await repos.accountRepo.setStatus(acc.id, 'approved');
    const loginRes = await request(app)
        .post('/auth/login')
        .send({ email, password: PASSWORD });
    return loginRes.headers['set-cookie'];
}

beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER_EMAIL;

    db = await initDB(DB_PATH);
    repos = {
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db),
        userRepo: new UserRepository(db)
    };
    app = createApp(repos);

    ownerCookie = await signupApproveLogin(OWNER_EMAIL, 'Owner');
    otherCookie = await signupApproveLogin(OTHER_EMAIL, 'Other');

    // pending 状態の被験者を 1 人作っておく (approve 用)
    await request(app)
        .post('/auth/signup')
        .send({ email: PENDING_EMAIL, password: PASSWORD, display_name: 'PendingUser' });
    const pendingAcc = await repos.accountRepo.findByEmail(PENDING_EMAIL);
    pendingUserId = pendingAcc.id;
});

afterAll(async () => {
    await new Promise((res) => db.close(res));
    const fs = require('fs');
    for (const ext of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(DB_PATH + ext); } catch (_) { /* ignore */ }
    }
    delete process.env.OWNER_EMAIL;
});

describe('GET /admin/users/pending', () => {
    test('未ログインで 401', async () => {
        const res = await request(app).get('/admin/users/pending');
        expect(res.status).toBe(401);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get('/admin/users/pending')
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });

    test('オーナーで 200 + 配列', async () => {
        const res = await request(app)
            .get('/admin/users/pending')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
        // 事前に作った pending ユーザーが入っている
        expect(res.body.users.find((u) => u.email === PENDING_EMAIL)).toBeTruthy();
    });
});

describe('GET /admin/users/pending/count', () => {
    test('オーナーで件数が返る', async () => {
        const res = await request(app)
            .get('/admin/users/pending/count')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe('number');
        expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get('/admin/users/pending/count')
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });
});

describe('POST /admin/users/:id/approve', () => {
    test('未ログインで 401', async () => {
        const res = await request(app).post(`/admin/users/${pendingUserId}/approve`);
        expect(res.status).toBe(401);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .post(`/admin/users/${pendingUserId}/approve`)
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });

    test('オーナーで承認 → ログインできるようになる', async () => {
        const res = await request(app)
            .post(`/admin/users/${pendingUserId}/approve`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        // ログインを試す
        const loginRes = await request(app)
            .post('/auth/login')
            .send({ email: PENDING_EMAIL, password: PASSWORD });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.account.status).toBe('approved');
    });

    test('存在しないユーザーで 404', async () => {
        const res = await request(app)
            .post('/admin/users/nonexistent-id/approve')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(404);
    });
});

describe('POST /admin/users/:id/reject', () => {
    let targetId;

    beforeAll(async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'tobereject@example.com', password: PASSWORD, display_name: 'X' });
        const acc = await repos.accountRepo.findByEmail('tobereject@example.com');
        targetId = acc.id;
    });

    test('オーナーで拒否 → ログイン不可 (account_rejected)', async () => {
        const res = await request(app)
            .post(`/admin/users/${targetId}/reject`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        const loginRes = await request(app)
            .post('/auth/login')
            .send({ email: 'tobereject@example.com', password: PASSWORD });
        expect(loginRes.status).toBe(403);
        expect(loginRes.body.error_code).toBe('account_rejected');
    });

    test('オーナー自身を reject しようとすると 400', async () => {
        const ownerAcc = await repos.accountRepo.findByEmail(OWNER_EMAIL);
        const res = await request(app)
            .post(`/admin/users/${ownerAcc.id}/reject`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(400);
    });
});

describe('GET /admin/users', () => {
    test('オーナーで全ユーザー (status 含む) が返る', async () => {
        const res = await request(app)
            .get('/admin/users')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
        const owner = res.body.users.find((u) => u.email === OWNER_EMAIL);
        expect(owner).toBeTruthy();
        expect(owner.status).toBe('approved');
    });
});
