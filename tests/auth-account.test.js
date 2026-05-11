const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const { UserRepository } = require('../src/backend/repo/sqlite/user-repo');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');

/**
 * Covers /auth/signup, /auth/login, /auth/me, /auth/logout and cookie-based
 * session persistence via the supertest agent.
 *
 * 事後承認フロー: signup は status='pending' で作成しセッションを発行しない。
 * テストでは accountRepo を経由して手動で 'approved' に切り替えてからログインする。
 */
describe('Account auth endpoints', () => {
    let app;
    let db;
    let accountRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_auth_account.db');

    /** signup → repo で手動 approve するヘルパ。 */
    async function signupAndApprove(email, password, displayName) {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email, password, display_name: displayName });
        if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
        const account = await accountRepo.findByEmail(email);
        await accountRepo.setStatus(account.id, 'approved');
        return account;
    }

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        accountRepo = new UserAccountRepository(db);
        app = createApp({
            roomRepo: new RoomRepository(db),
            participantRepo: new ParticipantRepository(db),
            userRepo: new UserRepository(db),
            accountRepo,
            sessionRepo: new SessionRepository(db)
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    test('signup returns pending status (no session cookie until approved)', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'alice@example.test', password: 'correcthorse', display_name: 'Alice' });
        expect(res.status).toBe(201);
        expect(res.body.pending).toBe(true);
        expect(res.body.message).toMatch(/承認/);
        // No session cookie should be issued for pending users
        const setCookie = res.headers['set-cookie'] || [];
        expect(setCookie.join(';')).not.toMatch(/session_token=/);
    });

    test('signup rejects short password', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'short@example.test', password: '123', display_name: 'S' });
        expect(res.status).toBe(400);
    });

    test('signup rejects invalid email shape', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'not-an-email', password: 'correcthorse' });
        expect(res.status).toBe(400);
    });

    test('duplicate signup returns 409', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'dup@example.test', password: 'correcthorse' });
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'dup@example.test', password: 'correcthorse' });
        expect(res.status).toBe(409);
    });

    test('login of pending user is blocked with pending_approval', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'pending@example.test', password: 'correcthorse' });
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'pending@example.test', password: 'correcthorse' });
        expect(res.status).toBe(403);
        expect(res.body.error_code).toBe('pending_approval');
    });

    test('login of rejected user is blocked with account_rejected', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'rejected@example.test', password: 'correcthorse' });
        const acc = await accountRepo.findByEmail('rejected@example.test');
        await accountRepo.setStatus(acc.id, 'rejected');
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'rejected@example.test', password: 'correcthorse' });
        expect(res.status).toBe(403);
        expect(res.body.error_code).toBe('account_rejected');
    });

    test('login after approval succeeds with session cookie', async () => {
        await signupAndApprove('approved@example.test', 'correcthorse');
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'approved@example.test', password: 'correcthorse' });
        expect(res.status).toBe(200);
        expect(res.body.account.email).toBe('approved@example.test');
        expect(res.body.account.status).toBe('approved');
        const setCookie = res.headers['set-cookie'];
        expect(setCookie.join(';')).toMatch(/session_token=/);
        expect(setCookie.join(';')).toMatch(/HttpOnly/);
    });

    test('login with wrong password returns generic 401', async () => {
        await signupAndApprove('bob@example.test', 'correcthorse');
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'bob@example.test', password: 'wrong-pass' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Invalid email or password/);
    });

    test('login for unknown email returns the same 401 (no enumeration)', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'ghost@example.test', password: 'anything123' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Invalid email or password/);
    });

    test('session cookie persists across requests via agent (post-approval)', async () => {
        await signupAndApprove('persist@example.test', 'correcthorse');
        const agent = request.agent(app);
        await agent
            .post('/auth/login')
            .send({ email: 'persist@example.test', password: 'correcthorse' });

        const me = await agent.get('/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.account.email).toBe('persist@example.test');
    });

    test('logout clears the session — subsequent /auth/me returns 401', async () => {
        await signupAndApprove('logout@example.test', 'correcthorse');
        const agent = request.agent(app);
        await agent
            .post('/auth/login')
            .send({ email: 'logout@example.test', password: 'correcthorse' });
        const logoutRes = await agent.post('/auth/logout');
        expect(logoutRes.status).toBe(200);
        const me = await agent.get('/auth/me');
        expect(me.status).toBe(401);
    });

    test('/auth/me without cookie returns 401', async () => {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(401);
    });

    test('email is case-insensitive on login (post-approval)', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'MixedCase@Example.TEST', password: 'correcthorse' });
        const acc = await accountRepo.findByEmail('mixedcase@example.test');
        await accountRepo.setStatus(acc.id, 'approved');
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'mixedcase@example.test', password: 'correcthorse' });
        expect(res.status).toBe(200);
    });
});
