class RoomRepository {
    constructor(db) {
        this.db = db;
    }

    async create(room) {
        return new Promise((resolve, reject) => {
            const { id, owner_id, material_summary, owner_account_id = null, use_past_meetings = true } = room;
            this.db.run(
                'INSERT INTO rooms (id, owner_id, material_summary, owner_account_id, use_past_meetings) VALUES (?, ?, ?, ?, ?)',
                [id, owner_id, material_summary || '', owner_account_id, use_past_meetings ? 1 : 0],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    /**
     * Rooms that this account either hosted (owner_account_id) or joined while
     * logged in (participants.user_account_id). De-duplicated and ordered by
     * created_at desc so the most recent meetings come first.
     */
    async findRoomsForAccount(accountId, { limit = 50 } = {}) {
        if (!accountId) return [];
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT DISTINCT r.*
                 FROM rooms r
                 LEFT JOIN participants p ON p.room_id = r.id
                 WHERE r.owner_account_id = ? OR p.user_account_id = ?
                 ORDER BY r.created_at DESC
                 LIMIT ?`,
                [accountId, accountId, limit],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });
    }

    /**
     * Ended rooms usable as past-meeting context. Excludes the current room
     * to avoid polluting the prompt with its own (partial) summary.
     */
    async findEndedRoomsForAccount(accountId, { limit = 5, excludeRoomId = null } = {}) {
        if (!accountId) return [];
        const params = [accountId, accountId];
        let sql = `SELECT DISTINCT r.*
                   FROM rooms r
                   LEFT JOIN participants p ON p.room_id = r.id
                   WHERE (r.owner_account_id = ? OR p.user_account_id = ?)
                     AND r.status = 'ended'
                     AND (r.summary_text IS NOT NULL AND length(trim(r.summary_text)) > 0)`;
        if (excludeRoomId) {
            sql += ' AND r.id != ?';
            params.push(excludeRoomId);
        }
        sql += ' ORDER BY COALESCE(r.ended_at, r.created_at) DESC LIMIT ?';
        params.push(limit);
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM rooms WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async endRoom(id) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE rooms SET status = "ended", ended_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async updateAiConfig(id, provider, model, usePastMeetings = null) {
        return new Promise((resolve, reject) => {
            const fields = ['ai_provider = ?', 'ai_model = ?'];
            const values = [provider, model];
            if (typeof usePastMeetings === 'boolean') {
                fields.push('use_past_meetings = ?');
                values.push(usePastMeetings ? 1 : 0);
            }
            values.push(id);
            this.db.run(
                `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`,
                values,
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    /**
     * Reset any rooms that were mid-analysis when the server stopped.
     * Called once at startup so clients aren't left polling a status that
     * will never transition on its own.
     */
    async resetStuckProcessing() {
        return new Promise((resolve, reject) => {
            this.db.run(
                "UPDATE rooms SET insights_status = 'error' WHERE insights_status = 'processing'",
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }

    async updateInsights(roomId, updates = {}) {
        return new Promise((resolve, reject) => {
            const fields = [];
            const values = [];

            if (typeof updates.summary_text === 'string') {
                fields.push('summary_text = ?');
                values.push(updates.summary_text);
                fields.push('summary_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.minutes_text === 'string') {
                fields.push('minutes_text = ?');
                values.push(updates.minutes_text);
                fields.push('minutes_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.todo_text === 'string') {
                fields.push('todo_text = ?');
                values.push(updates.todo_text);
                fields.push('todo_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.material_summary === 'string') {
                fields.push('material_summary = ?');
                values.push(updates.material_summary);
            }

            if (typeof updates.title === 'string') {
                fields.push('title = ?');
                values.push(updates.title);
                fields.push('title_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.ai_workspace_json === 'string') {
                fields.push('ai_workspace_json = ?');
                values.push(updates.ai_workspace_json);
                fields.push('ai_workspace_updated_at = ?');
                values.push(new Date().toISOString());
            }

            if (typeof updates.insights_status === 'string') {
                fields.push('insights_status = ?');
                values.push(updates.insights_status);
            }

            if (typeof updates.insights_dirty === 'boolean') {
                fields.push('insights_dirty = ?');
                values.push(updates.insights_dirty ? 1 : 0);
            }

            if (typeof updates.use_past_meetings === 'boolean') {
                fields.push('use_past_meetings = ?');
                values.push(updates.use_past_meetings ? 1 : 0);
            }

            if (!fields.length) {
                return this.findById(roomId).then(resolve).catch(reject);
            }

            values.push(roomId);
            this.db.run(
                `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`,
                values,
                async (err) => {
                    if (err) return reject(err);
                    try {
                        const room = await this.findById(roomId);
                        resolve(room);
                    } catch (findErr) {
                        reject(findErr);
                    }
                }
            );
        });
    }

    /**
     * Delete a room and every dependent record. Used when a host removes a
     * meeting from their profile history. Tables that don't exist in older
     * test DBs are tolerated (errors per-table are swallowed) so this works
     * across schema variants.
     */
    async deleteCascade(roomId) {
        const runIgnore = (sql, params = []) => new Promise((resolve) => {
            this.db.run(sql, params, () => resolve());
        });
        // Order matters when foreign keys exist; otherwise just be exhaustive.
        await runIgnore('DELETE FROM utterances WHERE room_id = ?', [roomId]);
        await runIgnore('DELETE FROM room_analyses WHERE room_id = ?', [roomId]);
        await runIgnore('DELETE FROM actions WHERE room_id = ?', [roomId]);
        await runIgnore('DELETE FROM participants WHERE room_id = ?', [roomId]);
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM rooms WHERE id = ?', [roomId], function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            });
        });
    }
}

module.exports = { RoomRepository };
