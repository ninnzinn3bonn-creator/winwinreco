class UtteranceRepository {
    constructor(db) {
        this.db = db;
    }

    async add(utterance) {
        return new Promise((resolve, reject) => {
            const { id, room_id, participant_id, started_at, ended_at, transcript } = utterance;
            this.db.run(
                'INSERT INTO utterances (id, room_id, participant_id, started_at, ended_at, transcript) VALUES (?, ?, ?, ?, ?, ?)',
                [id, room_id, participant_id, started_at, ended_at, transcript],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
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
                SELECT u.*, p.display_name 
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
}

module.exports = { UtteranceRepository };
