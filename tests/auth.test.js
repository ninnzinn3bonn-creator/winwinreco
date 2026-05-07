const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { UtteranceRepository } = require('../src/backend/repo/sqlite/utterance-repo');

/**
 * Regression tests for the participant-auth middleware. Each privileged route
 * should reject requests that are missing credentials or that present the
 * wrong control_token, even when the participant id is valid.
 */
describe('Participant auth middleware', () => {
    let app;
    let db;
    let roomRepo;
    let participantRepo;
    let accountRepo;
    let sessionRepo;
    let utteranceRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_auth.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        roomRepo = new RoomRepository(db);
        participantRepo = new ParticipantRepository(db);
        accountRepo = new UserAccountRepository(db);
        sessionRepo = new SessionRepository(db);
        utteranceRepo = new UtteranceRepository(db);
        app = createApp({
            roomRepo, participantRepo, accountRepo, sessionRepo, utteranceRepo
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    // POST /rooms now requires an account, so every seeded room needs a fresh
    // signup+room-creation handshake. Returns a supertest agent (holds the
    // cookie) plus the ids used by downstream assertions.
    let uniq = 0;
    async function seedRoomAndParticipant() {
        uniq += 1;
        const agent = request.agent(app);
        const email = `auth${uniq}+${Date.now()}@example.test`;
        const signup = await agent.post('/auth/signup').send({
            email, password: 'correcthorse', display_name: `User${uniq}`
        });
        const accountId = signup.body.account.id;
        const roomRes = await agent.post('/rooms').send({});
        const joinRes = await agent
            .post(`/rooms/${roomRes.body.id}/join`)
            .send({
                user_id: accountId,
                display_name: 'Alice',
                location_id: 'web-browser'
            });
        return {
            agent,
            roomId: roomRes.body.id,
            participantId: joinRes.body.id,
            controlToken: joinRes.body.control_token
        };
    }

    test('GET /rooms/:id/logs without credentials should 401', async () => {
        const { roomId } = await seedRoomAndParticipant();
        const res = await request(app).get(`/rooms/${roomId}/logs`);
        expect(res.status).toBe(401);
    });

    test('GET /rooms/:id/logs with wrong token should 403', async () => {
        const { roomId, participantId } = await seedRoomAndParticipant();
        const res = await request(app)
            .get(`/rooms/${roomId}/logs`)
            .query({ participant_id: participantId, control_token: 'wrong' });
        expect(res.status).toBe(403);
    });

    test('GET /rooms/:id/logs with valid credentials should 200', async () => {
        const { roomId, participantId, controlToken } = await seedRoomAndParticipant();
        const res = await request(app)
            .get(`/rooms/${roomId}/logs`)
            .query({ participant_id: participantId, control_token: controlToken });
        expect(res.status).toBe(200);
    });

    test('POST /rooms/:id/end without credentials should 401', async () => {
        const { roomId } = await seedRoomAndParticipant();
        const res = await request(app).post(`/rooms/${roomId}/end`).send({});
        expect(res.status).toBe(401);
    });

    test('POST /rooms/:id/end should reject cross-room tokens', async () => {
        // participant belongs to room A, tries to end room B
        const a = await seedRoomAndParticipant();
        const b = await seedRoomAndParticipant();
        const res = await request(app)
            .post(`/rooms/${b.roomId}/end`)
            .send({ participant_id: a.participantId, control_token: a.controlToken });
        expect(res.status).toBe(403);
    });

    test('GET /rooms/:id/download without credentials should 401', async () => {
        const { roomId } = await seedRoomAndParticipant();
        const res = await request(app).get(`/rooms/${roomId}/download`);
        expect(res.status).toBe(401);
    });
});
