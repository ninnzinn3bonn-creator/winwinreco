class RoomRepository {
    constructor(db) {
        this.db = db;
    }

    async create(room) {
        return new Promise((resolve, reject) => {
            const { id, owner_id } = room;
            this.db.run(
                'INSERT INTO rooms (id, owner_id) VALUES (?, ?)',
                [id, owner_id],
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
}

module.exports = { RoomRepository };
