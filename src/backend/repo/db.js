const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

function ensureColumn(db, tableName, columnName, definition) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
            if (err) return reject(err);

            const exists = rows.some((row) => row.name === columnName);
            if (exists) return resolve();

            db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`, (alterErr) => {
                if (alterErr) return reject(alterErr);
                resolve();
            });
        });
    });
}

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
                    user_id TEXT,
                    display_name TEXT,
                    control_token TEXT,
                    location_id TEXT,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    left_at DATETIME,
                    FOREIGN KEY(room_id) REFERENCES rooms(id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    profile_text TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS user_context (
                    user_id TEXT PRIMARY KEY,
                    project_summary TEXT DEFAULT '',
                    current_status TEXT DEFAULT '',
                    next_actions TEXT DEFAULT '[]',
                    active_tasks TEXT DEFAULT '[]',
                    past_decisions TEXT DEFAULT '[]',
                    issues TEXT DEFAULT '[]',
                    last_updated DATETIME,
                    FOREIGN KEY(user_id) REFERENCES users(id)
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

                db.run(`CREATE TABLE IF NOT EXISTS dictionary (
                    id TEXT PRIMARY KEY,
                    label TEXT,
                    term TEXT,
                    reading TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

                    Promise.all([
                        ensureColumn(db, 'users', 'profile_text', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'participants', 'user_id', 'TEXT'),
                        ensureColumn(db, 'participants', 'control_token', 'TEXT'),
                        ensureColumn(db, 'utterances', 'is_starred', 'INTEGER DEFAULT 0'),
                        ensureColumn(db, 'utterances', 'user_id', 'TEXT'),
                        ensureColumn(db, 'utterances', 'starred_at', 'DATETIME'),
                        ensureColumn(db, 'utterances', 'memory_note', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'utterances', 'memo_text', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'utterances', 'memo_updated_at', 'DATETIME'),
                        ensureColumn(db, 'utterances', 'raw_transcript', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'utterances', 'transcript_source', 'TEXT DEFAULT \'stt\''),
                        ensureColumn(db, 'utterances', 'corrected_at', 'DATETIME'),
                        ensureColumn(db, 'rooms', 'summary_text', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'summary_updated_at', 'DATETIME'),
                        ensureColumn(db, 'rooms', 'minutes_text', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'minutes_updated_at', 'DATETIME'),
                        ensureColumn(db, 'rooms', 'todo_text', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'todo_updated_at', 'DATETIME'),
                        ensureColumn(db, 'rooms', 'insights_status', 'TEXT DEFAULT \'idle\''),
                        ensureColumn(db, 'rooms', 'insights_dirty', 'INTEGER DEFAULT 0'),
                        ensureColumn(db, 'rooms', 'ai_provider', 'TEXT'),
                        ensureColumn(db, 'rooms', 'ai_model', 'TEXT')
                    ])
                        .then(() => new Promise((resolveActions, rejectActions) => {
                            db.run(`CREATE TABLE IF NOT EXISTS actions (
                                id TEXT PRIMARY KEY,
                                room_id TEXT,
                                speaker_id TEXT,
                                speaker_name TEXT,
                                action_text TEXT,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY(room_id) REFERENCES rooms(id),
                                FOREIGN KEY(speaker_id) REFERENCES users(id)
                            )`, (actionsErr) => {
                                if (actionsErr) return rejectActions(actionsErr);
                                resolveActions();
                            });
                        }))
                        .then(() => resolve(db))
                        .catch(reject);
                });
            });
        });
    });
}

module.exports = { initDB };
