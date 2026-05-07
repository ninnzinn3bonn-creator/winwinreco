const request = require('supertest');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UserRepository } = require('../src/backend/repo/user-repo');
const { UserContextRepository } = require('../src/backend/repo/user-context-repo');
const { UserAccountRepository } = require('../src/backend/repo/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/session-repo');
const path = require('path');
const fs = require('fs');

/*
 * Room API tests. POST /rooms now requires a logged-in account, so each test
 * spins up a supertest agent and signs up first — the agent keeps the
 * session_token cookie and transparently attaches it to subsequent calls.
 */
describe('Room API', () => {
    let app;
    let db;
    let roomRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_api.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        roomRepo = new RoomRepository(db);
        const participantRepo = new ParticipantRepository(db);
        const userRepo = new UserRepository(db);
        const userContextRepo = new UserContextRepository(db);
        const accountRepo = new UserAccountRepository(db);
        const sessionRepo = new SessionRepository(db);
        app = createApp({
            roomRepo, participantRepo, userRepo, userContextRepo,
            accountRepo, sessionRepo
        });
    });

    afterAll(async () => {
        await new Promise(resolve => db.close(resolve));
    });

    let emailCounter = 0;
    async function signupAgent() {
        const agent = request.agent(app);
        emailCounter += 1;
        const email = `host${emailCounter}+${Date.now()}@example.test`;
        const signup = await agent
            .post('/auth/signup')
            .send({ email, password: 'correcthorse', display_name: `Host${emailCounter}` });
        return { agent, account: signup.body.account, email };
    }

    test('POST /rooms/:id/end should end a room', async () => {
        const { agent, account } = await signupAgent();
        const roomResponse = await agent.post('/rooms').send({});
        const roomId = roomResponse.body.id;

        const joinResponse = await agent
            .post(`/rooms/${roomId}/join`)
            .send({
                user_id: account.id,
                display_name: 'Host',
                location_id: 'web-browser'
            });

        const endResponse = await agent
            .post(`/rooms/${roomId}/end`)
            .send({
                participant_id: joinResponse.body.id,
                control_token: joinResponse.body.control_token
            });

        expect(endResponse.status).toBe(200);
        expect(endResponse.body.status).toBe('ended');
        expect(endResponse.body.ended_at).toBeDefined();
    });

    test('POST /rooms should create a short shareable room id', async () => {
        const { agent } = await signupAgent();
        const roomResponse = await agent.post('/rooms').send({});

        expect(roomResponse.status).toBe(201);
        expect(roomResponse.body.id).toMatch(/^[A-Z2-9]{6}$/);
    });

    test('POST /rooms without session should 401', async () => {
        const res = await request(app).post('/rooms').send({});
        expect(res.status).toBe(401);
    });

    test('POST /rooms/:id/join should include is_host for the room owner', async () => {
        const { agent, account } = await signupAgent();
        const roomResponse = await agent.post('/rooms').send({});

        const joinResponse = await agent
            .post(`/rooms/${roomResponse.body.id}/join`)
            .send({
                user_id: account.id,
                display_name: 'Host',
                location_id: 'web-browser'
            });

        expect(joinResponse.status).toBe(201);
        expect(joinResponse.body.is_host).toBe(true);
        expect(typeof joinResponse.body.control_token).toBe('string');
        expect(joinResponse.body.control_token.length).toBeGreaterThan(10);
    });

    test('POST /rooms/:id/end should reject invalid control tokens', async () => {
        const { agent, account } = await signupAgent();
        const roomResponse = await agent.post('/rooms').send({});

        const joinResponse = await agent
            .post(`/rooms/${roomResponse.body.id}/join`)
            .send({
                user_id: account.id,
                display_name: 'Host',
                location_id: 'web-browser'
            });

        const endResponse = await agent
            .post(`/rooms/${roomResponse.body.id}/end`)
            .send({
                participant_id: joinResponse.body.id,
                control_token: 'invalid-token'
            });

        expect(endResponse.status).toBe(403);
    });

    test('POST /rooms/:id/join without session still works for anonymous guest', async () => {
        const { agent: hostAgent } = await signupAgent();
        const roomRes = await hostAgent.post('/rooms').send({});

        // Anonymous guest (no session cookie) can still join.
        const guestRes = await request(app)
            .post(`/rooms/${roomRes.body.id}/join`)
            .send({ user_id: 'guest-local-1', display_name: 'Guest', location_id: 'web-browser' });
        expect(guestRes.status).toBe(201);
        expect(guestRes.body.is_host).toBe(false);
    });
});
