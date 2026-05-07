class ParticipantRepository {
    constructor(db) {
        this.db = db;
    }

    async join(participant) {
        return new Promise((resolve, reject) => {
            const {
                id,
                room_id,
                user_id = null,
                display_name,
                control_token = null,
                location_id,
                user_account_id = null
            } = participant;
            this.db.run(
                'INSERT INTO participants (id, room_id, user_id, display_name, control_token, location_id, user_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, room_id, user_id, display_name, control_token, location_id, user_account_id],
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

    async findByIdAndToken(id, controlToken) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM participants WHERE id = ? AND control_token = ?',
                [id, controlToken],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
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

    /**
     * Link any anonymous participants that share the supplied stable
     * local_user_id (browser-side localStorage) to the now-logged-in account.
     * Only NULL user_account_id rows are touched so we never overwrite an
     * already-linked participant. Returns the number of rows updated.
     */
    async backfillAccountByUserId(localUserId, accountId) {
        if (!localUserId || !accountId) return 0;
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE participants SET user_account_id = ? WHERE user_id = ? AND (user_account_id IS NULL OR user_account_id = "")',
                [accountId, localUserId],
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }

    /**
     * Detach this account from a room without removing the participant row.
     * Used when a non-host user removes a past meeting from their profile —
     * the meeting itself stays for the host & other participants, but it
     * disappears from this user's history list.
     */
    async unlinkAccountFromRoom(roomId, accountId) {
        if (!roomId || !accountId) return 0;
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE participants SET user_account_id = NULL WHERE room_id = ? AND user_account_id = ?',
                [roomId, accountId],
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }
}

module.exports = { ParticipantRepository };
