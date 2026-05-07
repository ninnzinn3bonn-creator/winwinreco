const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/backend/repo/db');
const { UserRepository } = require('../src/backend/repo/user-repo');
const { UserContextRepository } = require('../src/backend/repo/user-context-repo');

describe('UserContextRepository', () => {
    let db;
    let userRepo;
    let contextRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_user_context.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        userRepo = new UserRepository(db);
        contextRepo = new UserContextRepository(db);
        await userRepo.create({ id: 'user-1', name: 'Alice' });
    });

    afterAll((done) => {
        db.close(done);
    });

    test('should upsert and read lightweight user context', async () => {
        await contextRepo.upsert({
            user_id: 'user-1',
            project_summary: '研究テーマA',
            current_status: '設計中',
            active_tasks: ['要件整理を完了する']
        });

        const found = await contextRepo.findByUserId('user-1');
        expect(found.project_summary).toBe('研究テーマA');
        expect(found.current_status).toBe('設計中');
        expect(found.active_tasks).toEqual(['要件整理を完了する']);
    });
});
