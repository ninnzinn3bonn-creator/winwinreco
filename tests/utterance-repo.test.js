const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UtteranceRepository } = require('../src/backend/repo/utterance-repo');

describe('UtteranceRepository', () => {
    let db;
    let repo;
    const dbPath = path.resolve(__dirname, '../db/test_utterance.db');

    beforeAll(async () => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        const roomRepo = new RoomRepository(db);
        await roomRepo.create({ id: 'room-1', owner_id: 'user-1' });
        const participantRepo = new ParticipantRepository(db);
        await participantRepo.join({ id: 'p-1', room_id: 'room-1', display_name: 'Alice', location_id: 'loc-1' });
        repo = new UtteranceRepository(db);
    });

    afterAll((done) => {
        db.close(done);
    });

    test('should add and find utterances', async () => {
        const utterance = { id: 'u-1', room_id: 'room-1', participant_id: 'p-1', started_at: '2026-02-24T20:00:00Z', ended_at: '2026-02-24T20:00:10Z', transcript: 'Hello, world!' };
        await repo.add(utterance);
        
        const list = await repo.findByRoomId('room-1');
        expect(list.length).toBe(1);
        expect(list[0].transcript).toBe('Hello, world!');
    });
});
