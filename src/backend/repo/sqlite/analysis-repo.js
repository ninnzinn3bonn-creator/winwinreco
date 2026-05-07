class AnalysisRepository {
    constructor(db) {
        this.db = db;
    }

    async add(analysis) {
        return new Promise((resolve, reject) => {
            const { id, room_id, type, input_prompt, result_text } = analysis;
            this.db.run(
                'INSERT INTO room_analyses (id, room_id, type, input_prompt, result_text) VALUES (?, ?, ?, ?, ?)',
                [id, room_id, type, input_prompt, result_text],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async findByRoomId(roomId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM room_analyses WHERE room_id = ? ORDER BY created_at DESC',
                [roomId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                }
            );
        });
    }

    async findLatestByTypes(roomId, types = []) {
        if (!types.length) return null;

        return new Promise((resolve, reject) => {
            const placeholders = types.map(() => '?').join(', ');
            this.db.get(
                `SELECT * FROM room_analyses WHERE room_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
                [roomId, ...types],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }
}

module.exports = { AnalysisRepository };
