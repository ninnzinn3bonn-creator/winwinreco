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

    test('initDB should create core tables and required columns', async () => {
        const db = await initDB(dbPath);
        
        const tables = ['rooms', 'participants', 'utterances', 'actions', 'users', 'user_context'];
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

        const columns = await new Promise((resolve, reject) => {
            db.all(`PRAGMA table_info(utterances)`, (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map((row) => row.name));
            });
        });

        expect(columns).toEqual(expect.arrayContaining([
            'is_starred',
            'starred_at',
            'memory_note',
            'memo_text',
            'memo_updated_at',
            'raw_transcript',
            'transcript_source',
            'corrected_at'
        ]));

        const roomColumns = await new Promise((resolve, reject) => {
            db.all(`PRAGMA table_info(rooms)`, (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map((row) => row.name));
            });
        });

        expect(roomColumns).toEqual(expect.arrayContaining([
            'summary_text',
            'summary_updated_at',
            'insights_status',
            'insights_dirty'
        ]));

        const participantColumns = await new Promise((resolve, reject) => {
            db.all(`PRAGMA table_info(participants)`, (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map((row) => row.name));
            });
        });

        expect(participantColumns).toEqual(expect.arrayContaining(['user_id']));
        db.close();
    });
});
