const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UserRepository } = require('../src/backend/repo/user-repo');
const { UserAccountRepository } = require('../src/backend/repo/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/session-repo');

/**
 * Covers /auth/signup, /auth/login, /auth/me, /auth/logout and cookie-based
 * session persistence via the supertest agent.
 */
describe('Account auth endpoints', () => {
    let app;
    let db;
    const dbPath = path.resolve(__dirname, './tmp/test_auth_account.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        app = createApp({
            roomRepo: new RoomRepository(db),
            participantRepo: new ParticipantRepository(db),
            userRepo: new UserRepository(db),
            accountRepo: new UserAccountRepository(db),
            sessionRepo: new SessionRepository(db)
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    test('signup returns account + sets session cookie', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'alice@example.test', password: 'correcthorse', display_name: 'Alice' });
        expect(res.status).toBe(201);
        expect(res.body.account.email).toBe('alice@example.test');
        const setCookie = res.headers['set-cookie'];
        expect(setCookie).toBeTruthy();
        expect(setCookie.join(';')).toMatch(/session_token=/);
        expect(setCookie.join(';')).toMatch(/HttpOnly/);
        expect(setCookie.join(';')).toMatch(/SameSite=Lax/);
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

    test('login with wrong password returns generic 401', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'bob@example.test', password: 'correcthorse' });
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

    test('session cookie persists across requests via agent', async () => {
        const agent = request.agent(app);
        await agent
            .post('/auth/signup')
            .send({ email: 'persist@example.test', password: 'correcthorse' });

        const me = await agent.get('/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.account.email).toBe('persist@example.test');
    });

    test('logout clears the session — subsequent /auth/me returns 401', async () => {
        const agent = request.agent(app);
        await agent
            .post('/auth/signup')
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

    test('email is case-insensitive on login', async () => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'MixedCase@Example.TEST', password: 'correcthorse' });
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'mixedcase@example.test', password: 'correcthorse' });
        expect(res.status).toBe(200);
    });
});
