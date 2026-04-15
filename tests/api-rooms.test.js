const request = require('supertest');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const path = require('path');
const fs = require('fs');

describe('Room API', () => {
    let app;
    let db;
    let roomRepo;
    const dbPath = path.resolve(__dirname, '../db/test_api.db');

    beforeAll(async () => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        roomRepo = new RoomRepository(db);
        const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
        const { UserRepository } = require('../src/backend/repo/user-repo');
        const { UserContextRepository } = require('../src/backend/repo/user-context-repo');
        const participantRepo = new ParticipantRepository(db);
        const userRepo = new UserRepository(db);
        const userContextRepo = new UserContextRepository(db);
        app = createApp({ roomRepo, participantRepo, userRepo, userContextRepo });
    });

    afterAll(async () => {
        await new Promise(resolve => db.close(resolve));
    });

    test('POST /rooms/:id/end should end a room', async () => {
        // Create a room
        const roomResponse = await request(app)
            .post('/rooms')
            .send({ owner_id: 'owner-1' });
        const roomId = roomResponse.body.id;

        const joinResponse = await request(app)
            .post(`/rooms/${roomId}/join`)
            .send({
                user_id: 'owner-1',
                display_name: 'Host',
                location_id: 'web-browser'
            });

        const endResponse = await request(app)
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
        const roomResponse = await request(app)
            .post('/rooms')
            .send({ owner_id: 'owner-2' });

        expect(roomResponse.status).toBe(201);
        expect(roomResponse.body.id).toMatch(/^[A-Z2-9]{6}$/);
    });

    test('POST /rooms/:id/join should include is_host for the room owner', async () => {
        const roomResponse = await request(app)
            .post('/rooms')
            .send({ owner_id: 'host-user' });

        const joinResponse = await request(app)
            .post(`/rooms/${roomResponse.body.id}/join`)
            .send({
                user_id: 'host-user',
                display_name: 'Host',
                location_id: 'web-browser'
            });

        expect(joinResponse.status).toBe(201);
        expect(joinResponse.body.is_host).toBe(true);
        expect(typeof joinResponse.body.control_token).toBe('string');
        expect(joinResponse.body.control_token.length).toBeGreaterThan(10);
    });

    test('POST /rooms/:id/end should reject invalid control tokens', async () => {
        const roomResponse = await request(app)
            .post('/rooms')
            .send({ owner_id: 'host-user-2' });

        const joinResponse = await request(app)
            .post(`/rooms/${roomResponse.body.id}/join`)
            .send({
                user_id: 'host-user-2',
                display_name: 'Host',
                location_id: 'web-browser'
            });

        const endResponse = await request(app)
            .post(`/rooms/${roomResponse.body.id}/end`)
            .send({
                participant_id: joinResponse.body.id,
                control_token: 'invalid-token'
            });

        expect(endResponse.status).toBe(403);
    });
});
