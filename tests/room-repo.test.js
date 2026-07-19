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

    test('should preserve multiple meeting memos in creation order', async () => {
        await repo.create({ id: 'room-memos', owner_id: 'user-1' });
        await repo.addMeetingMemo('room-memos', {
            id: 'memo-1',
            participant_id: 'participant-1',
            user_id: 'user-1',
            display_name: '田中',
            memo_text: '次回までに見積もりを更新する',
            created_at: '2026-07-19T10:00:00.000Z'
        });
        await repo.addMeetingMemo('room-memos', {
            id: 'memo-2',
            participant_id: 'participant-2',
            user_id: 'user-2',
            display_name: '佐藤',
            memo_text: '予算承認は金曜日',
            created_at: '2026-07-19T10:05:00.000Z'
        });

        const memos = await repo.findMeetingMemosByRoomId('room-memos');
        expect(memos.map((memo) => memo.id)).toEqual(['memo-1', 'memo-2']);
        expect(memos[0]).toMatchObject({ display_name: '田中', memo_text: '次回までに見積もりを更新する' });
    });
});
