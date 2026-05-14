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

                // Account-based authentication (host login). Participants can
                // still join anonymously; ownership of a room is tracked by
                // owner_account_id (added via ensureColumn below) which points
                // here when the host was logged in at room-creation time.
                db.run(`CREATE TABLE IF NOT EXISTS user_accounts (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                // Sessions hold SHA-256 hashes of opaque 32-byte tokens that
                // live in an httpOnly cookie. Sliding expiry is maintained by
                // SessionRepository.touch().
                db.run(`CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES user_accounts(id)
                )`);

                db.run('CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

                db.run(`CREATE TABLE IF NOT EXISTS participants (
                    id TEXT PRIMARY KEY,
                    room_id TEXT,
                    user_id TEXT,
                    display_name TEXT,
                    control_token TEXT,
                    location_id TEXT,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
                        // Easter egg high score (本仕様には影響しない)
                        ensureColumn(db, 'user_accounts', 'game_high_score', 'INTEGER DEFAULT 0'),
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
                        ensureColumn(db, 'rooms', 'material_summary', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'ai_provider', 'TEXT'),
                        ensureColumn(db, 'rooms', 'ai_model', 'TEXT'),
                        ensureColumn(db, 'rooms', 'use_past_meetings', 'INTEGER DEFAULT 1'),
                        // Host-login additions. Nullable to preserve backwards
                        // compatibility with rooms created before auth shipped.
                        ensureColumn(db, 'rooms', 'owner_account_id', 'TEXT'),
                        ensureColumn(db, 'participants', 'user_account_id', 'TEXT'),
                        ensureColumn(db, 'users', 'account_id', 'TEXT'),
                        // Optional human-friendly room title; defaults to ''
                        // and is shown in the past-meeting list when present.
                        ensureColumn(db, 'rooms', 'title', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'title_updated_at', 'DATETIME'),
                        // JSON blob of arbitrary AI-workspace outputs (custom
                        // analyses, action extraction etc.) so they survive
                        // page reload and can be replayed in /me/rooms/:id.
                        ensureColumn(db, 'rooms', 'ai_workspace_json', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'ai_workspace_updated_at', 'DATETIME'),
                        // F4: ホストが指定した STT プロバイダー・言語を全参加者に適用するために保存。
                        ensureColumn(db, 'rooms', 'stt_provider', 'TEXT DEFAULT \'\''),
                        ensureColumn(db, 'rooms', 'stt_language', 'TEXT DEFAULT \'\''),
                        // 事後承認フロー: 既存ユーザーは 'approved' になる (DEFAULT が適用される)。
                        // 新規 signup は repo の create() で明示的に 'pending' を渡す。
                        // 値: 'pending' | 'approved' | 'rejected'
                        ensureColumn(db, 'user_accounts', 'status', "TEXT DEFAULT 'approved'"),
                        // DB-based ownership. 1 = owner. 旧 OWNER_EMAIL 環境変数を
                        // 置き換える。最初のユーザーが /admin/bootstrap-owner で
                        // 自分自身をオーナーに昇格させてセットアップを始められる。
                        ensureColumn(db, 'user_accounts', 'is_owner', 'INTEGER DEFAULT 0'),
                        // §54 利用状況ダッシュボード: ログイン時刻追跡
                        ensureColumn(db, 'user_accounts', 'last_login_at', 'DATETIME'),
                        // 定例シリーズ: rooms に series_id を追加
                        ensureColumn(db, 'rooms', 'series_id', 'TEXT')
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
                        // [U-1] パスワードリセットトークン。token_hash のみ保存し平文は残さない。
                        .then(() => new Promise((resolvePwr, rejectPwr) => {
                            db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
                                id TEXT PRIMARY KEY,
                                account_id TEXT NOT NULL,
                                token_hash TEXT NOT NULL UNIQUE,
                                expires_at DATETIME NOT NULL,
                                used_at DATETIME,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY(account_id) REFERENCES user_accounts(id)
                            )`, (pwrErr) => {
                                if (pwrErr) return rejectPwr(pwrErr);
                                db.run(
                                    'CREATE INDEX IF NOT EXISTS idx_pwr_account ON password_reset_tokens(account_id)',
                                    (idxErr) => {
                                        if (idxErr) return rejectPwr(idxErr);
                                        resolvePwr();
                                    }
                                );
                            });
                        }))
                        // [U-6] メール認証トークン。token_hash のみ保存し平文は残さない。TTL 24h。
                        .then(() => new Promise((resolveEmv, rejectEmv) => {
                            db.run(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
                                id TEXT PRIMARY KEY,
                                account_id TEXT NOT NULL,
                                token_hash TEXT NOT NULL UNIQUE,
                                expires_at DATETIME NOT NULL,
                                used_at DATETIME,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY(account_id) REFERENCES user_accounts(id)
                            )`, (emvErr) => {
                                if (emvErr) return rejectEmv(emvErr);
                                db.run(
                                    'CREATE INDEX IF NOT EXISTS idx_emv_account ON email_verification_tokens(account_id)',
                                    (idxErr) => {
                                        if (idxErr) return rejectEmv(idxErr);
                                        resolveEmv();
                                    }
                                );
                            });
                        }))
                        // [L9] チャンク単位の中間結果テーブル。部分再生成に使用。
                        .then(() => new Promise((resolveChunks, rejectChunks) => {
                            db.run(`CREATE TABLE IF NOT EXISTS room_chunks (
                                id TEXT PRIMARY KEY,
                                room_id TEXT NOT NULL,
                                chunk_index INTEGER NOT NULL,
                                analysis_type TEXT NOT NULL DEFAULT 'minutes',
                                start_ts TEXT DEFAULT '',
                                end_ts TEXT DEFAULT '',
                                result_text TEXT DEFAULT '',
                                status TEXT DEFAULT 'done',
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                UNIQUE(room_id, chunk_index, analysis_type),
                                FOREIGN KEY(room_id) REFERENCES rooms(id)
                            )`, (chunksErr) => {
                                if (chunksErr) return rejectChunks(chunksErr);
                                db.run(
                                    'CREATE INDEX IF NOT EXISTS idx_room_chunks_room ON room_chunks(room_id, analysis_type)',
                                    (idxErr) => {
                                        if (idxErr) return rejectChunks(idxErr);
                                        resolveChunks();
                                    }
                                );
                            });
                        }))
                        // [Series] 定例会議シリーズ: フレーム + 次回アジェンダ下書き
                        .then(() => new Promise((resolveSeries, rejectSeries) => {
                            db.run(`CREATE TABLE IF NOT EXISTS meeting_series (
                                id TEXT PRIMARY KEY,
                                owner_account_id TEXT NOT NULL,
                                name TEXT NOT NULL DEFAULT '',
                                frame_text TEXT DEFAULT '',
                                latest_agenda_text TEXT DEFAULT '',
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )`, (seriesErr) => {
                                if (seriesErr) return rejectSeries(seriesErr);
                                db.run(
                                    'CREATE INDEX IF NOT EXISTS idx_series_owner ON meeting_series(owner_account_id, created_at)',
                                    (idxErr) => {
                                        if (idxErr) return rejectSeries(idxErr);
                                        resolveSeries();
                                    }
                                );
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
