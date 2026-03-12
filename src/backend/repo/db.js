const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

async function initDB(dbPath) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) return reject(err);
            
            db.serialize(() => {
                // Enable WAL mode
                db.run('PRAGMA journal_mode = WAL');

                // Create tables
                db.run(`CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT,
                    status TEXT DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    ended_at DATETIME
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS participants (
                    id TEXT PRIMARY KEY,
                    room_id TEXT,
                    display_name TEXT,
                    location_id TEXT,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    left_at DATETIME,
                    FOREIGN KEY(room_id) REFERENCES rooms(id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS utterances (
                    id TEXT PRIMARY KEY,
                    room_id TEXT,
                    participant_id TEXT,
                    started_at DATETIME,
                    ended_at DATETIME,
                    transcript TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(room_id) REFERENCES rooms(id),
                    FOREIGN KEY(participant_id) REFERENCES participants(id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS room_analyses (
                    id TEXT PRIMARY KEY,
                    room_id TEXT,
                    type TEXT,
                    input_prompt TEXT,
                    result_text TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(room_id) REFERENCES rooms(id)
                )`, (err) => {
                    if (err) return reject(err);
                    resolve(db);
                });
            });
        });
    });
}

module.exports = { initDB };
