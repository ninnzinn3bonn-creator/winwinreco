const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');

describe('ParticipantRepository', () => {
    let db;
    let repo;
    const dbPath = path.resolve(__dirname, './tmp/test_participant.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        const roomRepo = new RoomRepository(db);
        await roomRepo.create({ id: 'room-1', owner_id: 'user-1' });
        repo = new ParticipantRepository(db);
    });

    afterAll((done) => {
        db.close(done);
    });

    test('should join and find a participant', async () => {
        const participant = {
            id: 'p-1',
            room_id: 'room-1',
            user_id: 'user-1',
            display_name: 'Alice',
            control_token: 'token-1',
            location_id: 'loc-1'
        };
        await repo.join(participant);
        
        const found = await repo.findById('p-1');
        expect(found).toBeDefined();
        expect(found.display_name).toBe('Alice');
        expect(found.room_id).toBe('room-1');
        expect(found.user_id).toBe('user-1');
        expect(found.control_token).toBe('token-1');
    });

    test('should find a participant by id and control token', async () => {
        const found = await repo.findByIdAndToken('p-1', 'token-1');
        expect(found).toBeDefined();
        expect(found.id).toBe('p-1');
    });

    test('should find all participants in a room', async () => {
        const list = await repo.findByRoomId('room-1');
        expect(list.length).toBe(1);
    });
});
