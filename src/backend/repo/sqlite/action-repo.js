class ActionRepository {
    constructor(db) {
        this.db = db;
    }

    async replaceForRoom(roomId, actions = []) {
        await this.deleteByRoomId(roomId);

        for (const action of actions) {
            await this.add({
                id: action.id,
                room_id: roomId,
                speaker_id: action.speaker_id || null,
                speaker_name: action.speaker_name || '',
                action_text: action.action_text || ''
            });
        }
    }

    async add(action) {
        return new Promise((resolve, reject) => {
            const { id, room_id, speaker_id, speaker_name, action_text } = action;
            this.db.run(
                'INSERT INTO actions (id, room_id, speaker_id, speaker_name, action_text) VALUES (?, ?, ?, ?, ?)',
                [id, room_id, speaker_id, speaker_name, action_text],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async deleteByRoomId(roomId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM actions WHERE room_id = ?', [roomId], (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async findByRoomId(roomId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM actions WHERE room_id = ? ORDER BY speaker_name ASC, created_at ASC',
                [roomId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                }
            );
        });
    }
}

module.exports = { ActionRepository };
