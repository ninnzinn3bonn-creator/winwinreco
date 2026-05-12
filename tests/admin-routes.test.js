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
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');

const DB_PATH = path.join(__dirname, '../db/test-admin.db');

const OWNER_EMAIL = 'admin-owner@example.com';
const OTHER_EMAIL = 'admin-other@example.com';
const PENDING_EMAIL = 'pending-user@example.com';
const PASSWORD = 'password123';

let db, app, repos;
let ownerCookie, otherCookie;
let pendingUserId;
let ownerAccountId;

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
        userRepo: new UserRepository(db),
        roomRepo: new RoomRepository(db)
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

    const ownerAcc = await repos.accountRepo.findByEmail(OWNER_EMAIL);
    ownerAccountId = ownerAcc.id;
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

/**
 * オーナーブートストラップ (DB-based ownership)。
 * env OWNER_EMAIL を一時的に外して、まっさらな DB で動作を確認する。
 */
describe('/admin/owner-status & /admin/bootstrap-owner', () => {
    let bootDb;
    let bootApp;
    let bootAccountRepo;
    const BOOT_DB = path.join(__dirname, '../db/test-admin-boot.db');
    const BOOT_EMAIL = 'bootuser@example.com';

    beforeAll(async () => {
        delete process.env.OWNER_EMAIL;
        const fs = require('fs');
        for (const ext of ['', '-wal', '-shm']) {
            try { fs.unlinkSync(BOOT_DB + ext); } catch (_) { /* ignore */ }
        }
        bootDb = await initDB(BOOT_DB);
        bootAccountRepo = new UserAccountRepository(bootDb);
        bootApp = createApp({
            accountRepo: bootAccountRepo,
            sessionRepo: new SessionRepository(bootDb),
            userRepo: new UserRepository(bootDb)
        });
    });

    afterAll(async () => {
        await new Promise((res) => bootDb.close(res));
        const fs = require('fs');
        for (const ext of ['', '-wal', '-shm']) {
            try { fs.unlinkSync(BOOT_DB + ext); } catch (_) { /* ignore */ }
        }
        // 元の OWNER_EMAIL を復帰しておく (他テストへの影響回避)
        process.env.OWNER_EMAIL = OWNER_EMAIL;
    });

    test('未ログインで owner-status は 401', async () => {
        const res = await request(bootApp).get('/admin/owner-status');
        expect(res.status).toBe(401);
    });

    test('owner がまだ誰もいない → can_bootstrap=true', async () => {
        // signup → approve → login
        const agent = request.agent(bootApp);
        await agent.post('/auth/signup').send({ email: BOOT_EMAIL, password: PASSWORD });
        const acc = await bootAccountRepo.findByEmail(BOOT_EMAIL);
        await bootAccountRepo.setStatus(acc.id, 'approved');
        await agent.post('/auth/login').send({ email: BOOT_EMAIL, password: PASSWORD });

        const res = await agent.get('/admin/owner-status');
        expect(res.status).toBe(200);
        expect(res.body.has_owner).toBe(false);
        expect(res.body.is_self_owner).toBe(false);
        expect(res.body.can_bootstrap).toBe(true);
    });

    test('bootstrap でオーナー昇格 → 2 回目は 409', async () => {
        const agent = request.agent(bootApp);
        await agent.post('/auth/login').send({ email: BOOT_EMAIL, password: PASSWORD });
        const res = await agent.post('/admin/bootstrap-owner');
        expect(res.status).toBe(200);
        expect(res.body.account.is_owner).toBe(true);

        // 2 回目は他のユーザーがやっても 409
        const otherAgent = request.agent(bootApp);
        const otherEmail = 'late-comer@example.com';
        await otherAgent.post('/auth/signup').send({ email: otherEmail, password: PASSWORD });
        const otherAcc = await bootAccountRepo.findByEmail(otherEmail);
        await bootAccountRepo.setStatus(otherAcc.id, 'approved');
        await otherAgent.post('/auth/login').send({ email: otherEmail, password: PASSWORD });
        const dupRes = await otherAgent.post('/admin/bootstrap-owner');
        expect(dupRes.status).toBe(409);
    });

    test('bootstrap 後の owner は /admin/users にアクセスできる', async () => {
        const agent = request.agent(bootApp);
        await agent.post('/auth/login').send({ email: BOOT_EMAIL, password: PASSWORD });
        const res = await agent.get('/admin/users');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
    });
});

// §54 利用状況ダッシュボード
describe('GET /admin/users (§54 拡張)', () => {
    test('meeting_count / last_login_at / total_duration_minutes を返す', async () => {
        const res = await request(app)
            .get('/admin/users')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        const users = res.body.users;
        expect(Array.isArray(users)).toBe(true);
        const owner = users.find((u) => u.email === OWNER_EMAIL);
        expect(owner).toBeTruthy();
        expect(typeof owner.meeting_count).toBe('number');
        expect(typeof owner.total_duration_minutes).toBe('number');
        expect('last_meeting_at' in owner).toBe(true);
        // last_login_at は login 成功後に設定される (非同期なので存在チェックのみ)
        expect('last_login_at' in owner).toBe(true);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get('/admin/users')
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });
});

describe('GET /admin/users/:id/meetings', () => {
    test('オーナーで会議一覧を返す (空でも配列)', async () => {
        const res = await request(app)
            .get(`/admin/users/${ownerAccountId}/meetings`)
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.meetings)).toBe(true);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get(`/admin/users/${ownerAccountId}/meetings`)
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });

    test('未ログインで 401', async () => {
        const res = await request(app)
            .get(`/admin/users/${ownerAccountId}/meetings`);
        expect(res.status).toBe(401);
    });
});

describe('GET /admin/stats', () => {
    test('users と rooms の各カウントを返す', async () => {
        const res = await request(app)
            .get('/admin/stats')
            .set('Cookie', ownerCookie);
        expect(res.status).toBe(200);
        const { users, rooms } = res.body;
        expect(typeof users.total).toBe('number');
        expect(typeof users.approved).toBe('number');
        expect(typeof users.pending).toBe('number');
        expect(typeof users.active_7d).toBe('number');
        expect(typeof users.active_30d).toBe('number');
        expect(typeof rooms.total).toBe('number');
        expect(typeof rooms.this_week).toBe('number');
        expect(typeof rooms.ongoing).toBe('number');
        // 最低でも owner + other の 2 ユーザーがいる
        expect(users.total).toBeGreaterThanOrEqual(2);
    });

    test('非オーナーで 403', async () => {
        const res = await request(app)
            .get('/admin/stats')
            .set('Cookie', otherCookie);
        expect(res.status).toBe(403);
    });

    test('未ログインで 401', async () => {
        const res = await request(app).get('/admin/stats');
        expect(res.status).toBe(401);
    });
});
