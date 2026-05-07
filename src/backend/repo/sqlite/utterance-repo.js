class UtteranceRepository {
    constructor(db) {
        this.db = db;
    }

    async add(utterance) {
        return new Promise((resolve, reject) => {
            const {
                id,
                room_id,
                participant_id,
                user_id = null,
                started_at,
                ended_at,
                transcript,
                is_starred = 0,
                starred_at = null,
                memory_note = '',
                raw_transcript = transcript,
                transcript_source = 'stt',
                corrected_at = null
            } = utterance;
            this.db.run(
                'INSERT INTO utterances (id, room_id, participant_id, user_id, started_at, ended_at, transcript, is_starred, starred_at, memory_note, raw_transcript, transcript_source, corrected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, room_id, participant_id, user_id, started_at, ended_at, transcript, is_starred, starred_at, memory_note, raw_transcript, transcript_source, corrected_at],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM utterances WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async findByRoomId(room_id) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM utterances WHERE room_id = ? ORDER BY started_at ASC', [room_id], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    async findByRoomIdWithParticipants(room_id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT u.*, p.display_name, p.user_id,
                       COALESCE(u.memo_text, u.memory_note, '') AS memo_text,
                       COALESCE(u.memo_text, u.memory_note, '') AS memory_note
                FROM utterances u
                JOIN participants p ON u.participant_id = p.id
                WHERE u.room_id = ?
                ORDER BY u.started_at ASC
            `;
            this.db.all(query, [room_id], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    async findNewerThan(room_id, last_timestamp) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT u.*, p.display_name, p.user_id,
                       COALESCE(u.memo_text, u.memory_note, '') AS memo_text,
                       COALESCE(u.memo_text, u.memory_note, '') AS memory_note
                FROM utterances u
                JOIN participants p ON u.participant_id = p.id
                WHERE u.room_id = ? AND u.started_at > ?
                ORDER BY u.started_at ASC
            `;
            this.db.all(query, [room_id, last_timestamp], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    async findLatestByParticipant(room_id, participant_id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT u.*, p.display_name, p.user_id,
                       COALESCE(u.memo_text, u.memory_note, '') AS memo_text,
                       COALESCE(u.memo_text, u.memory_note, '') AS memory_note
                FROM utterances u
                JOIN participants p ON u.participant_id = p.id
                WHERE u.room_id = ? AND u.participant_id = ?
                ORDER BY u.ended_at DESC, u.started_at DESC
                LIMIT 1
            `;
            this.db.get(query, [room_id, participant_id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async findStarredByRoomId(room_id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT u.*, p.display_name, p.user_id,
                       COALESCE(u.memo_text, u.memory_note, '') AS memo_text,
                       COALESCE(u.memo_text, u.memory_note, '') AS memory_note
                FROM utterances u
                JOIN participants p ON u.participant_id = p.id
                WHERE u.room_id = ? AND u.is_starred = 1
                ORDER BY COALESCE(u.starred_at, u.started_at) DESC
            `;
            this.db.all(query, [room_id], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    async updateMemory(id, updates = {}) {
        return new Promise((resolve, reject) => {
            const fields = [];
            const values = [];

            if (typeof updates.is_starred === 'boolean') {
                fields.push('is_starred = ?');
                values.push(updates.is_starred ? 1 : 0);

                fields.push('starred_at = ?');
                values.push(updates.is_starred ? new Date().toISOString() : null);
            }

            if (typeof updates.memory_note === 'string') {
                fields.push('memory_note = ?');
                values.push(updates.memory_note.trim());
            }

            if (typeof updates.memo_text === 'string') {
                const memoText = updates.memo_text.trim();
                fields.push('memo_text = ?');
                values.push(memoText);
                fields.push('memory_note = ?');
                values.push(memoText);
                fields.push('memo_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.transcript === 'string') {
                fields.push('transcript = ?');
                values.push(updates.transcript.trim());
            }

            if (typeof updates.transcript_source === 'string') {
                fields.push('transcript_source = ?');
                values.push(updates.transcript_source);

                fields.push('corrected_at = ?');
                values.push(new Date().toISOString());
            }

            if (fields.length === 0) {
                return this.findById(id).then(resolve).catch(reject);
            }

            values.push(id);
            this.db.run(`UPDATE utterances SET ${fields.join(', ')} WHERE id = ?`, values, async (err) => {
                if (err) return reject(err);
                try {
                    const row = await this.findById(id);
                    resolve(row);
                } catch (findErr) {
                    reject(findErr);
                }
            });
        });
    }

    async mergeTranscript(id, nextTranscript, endedAt = new Date().toISOString()) {
        return new Promise(async (resolve, reject) => {
            try {
                const existing = await this.findById(id);
                if (!existing) {
                    return resolve(null);
                }

                const mergedTranscript = [existing.transcript, nextTranscript].filter(Boolean).join(' ').trim();
                const mergedRaw = [existing.raw_transcript || existing.transcript, nextTranscript].filter(Boolean).join(' ').trim();

                this.db.run(
                    'UPDATE utterances SET transcript = ?, raw_transcript = ?, ended_at = ?, transcript_source = ? WHERE id = ?',
                    [mergedTranscript, mergedRaw, endedAt, 'stt', id],
                    async (err) => {
                        if (err) return reject(err);
                        try {
                            const row = await this.findById(id);
                            resolve(row);
                        } catch (findErr) {
                            reject(findErr);
                        }
                    }
                );
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = { UtteranceRepository };
