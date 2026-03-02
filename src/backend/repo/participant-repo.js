class ParticipantRepository {
    constructor(db) {
        this.db = db;
    }

    async join(participant) {
        return new Promise((resolve, reject) => {
            const { id, room_id, display_name, location_id } = participant;
            this.db.run(
                'INSERT INTO participants (id, room_id, display_name, location_id) VALUES (?, ?, ?, ?)',
                [id, room_id, display_name, location_id],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM participants WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    async findByRoomId(room_id) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM participants WHERE room_id = ?', [room_id], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }
}

module.exports = { ParticipantRepository };
