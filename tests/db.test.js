const fs = require('fs');
const path = require('path');
const { initDB } = require('../src/backend/repo/db');

describe('Database Setup', () => {
    const dbPath = path.resolve(__dirname, '../db/test_meeting.db');

    beforeAll(async () => {
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    });

    afterAll(async () => {
        // DBを閉じる処理が実装されたらここに追加
    });

    test('initDB should create rooms, participants, and utterances tables', async () => {
        const db = await initDB(dbPath);
        
        const tables = ['rooms', 'participants', 'utterances'];
        for (const table of tables) {
            await new Promise((resolve, reject) => {
                db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table], (err, row) => {
                    if (err) reject(err);
                    expect(row).toBeDefined();
                    expect(row.name).toBe(table);
                    resolve();
                });
            });
        }
        db.close();
    });
});
