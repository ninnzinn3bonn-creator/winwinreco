const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');

describe('RoomRepository', () => {
    let db;
    let repo;
    const dbPath = path.resolve(__dirname, './tmp/test_repo.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        repo = new RoomRepository(db);
    });

    afterAll((done) => {
        db.close(done);
    });

    test('should create and find a room', async () => {
        const room = { id: 'room-1', owner_id: 'user-1' };
        await repo.create(room);
        
        const found = await repo.findById('room-1');
        expect(found).toBeDefined();
        expect(found.id).toBe('room-1');
        expect(found.owner_id).toBe('user-1');
        expect(found.status).toBe('active');
    });
});
