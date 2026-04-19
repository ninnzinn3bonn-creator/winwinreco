class RoomRepository {
    constructor(db) {
        this.db = db;
    }

    async create(room) {
        return new Promise((resolve, reject) => {
            const { id, owner_id, material_summary } = room;
            this.db.run(
                'INSERT INTO rooms (id, owner_id, material_summary) VALUES (?, ?, ?)',
                [id, owner_id, material_summary || ''],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
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

    async updateAiConfig(id, provider, model) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE rooms SET ai_provider = ?, ai_model = ? WHERE id = ?',
                [provider, model, id],
                (err) => {
                    if (err) return reject(err);
                    resolve();
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

            if (typeof updates.insights_status === 'string') {
                fields.push('insights_status = ?');
                values.push(updates.insights_status);
            }

            if (typeof updates.insights_dirty === 'boolean') {
                fields.push('insights_dirty = ?');
                values.push(updates.insights_dirty ? 1 : 0);
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
}

module.exports = { RoomRepository };
