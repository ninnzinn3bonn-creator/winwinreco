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
        const participantRepo = new ParticipantRepository(db);
        app = createApp({ roomRepo, participantRepo });
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

        const endResponse = await request(app)
            .post(`/rooms/${roomId}/end`)
            .send({ owner_id: 'owner-1' });

        expect(endResponse.status).toBe(200);
        expect(endResponse.body.status).toBe('ended');
        expect(endResponse.body.ended_at).toBeDefined();
    });
});
