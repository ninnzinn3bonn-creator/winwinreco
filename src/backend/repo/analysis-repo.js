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
}

module.exports = { AnalysisRepository };
