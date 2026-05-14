const { newId } = require('../../lib/ids');

class SeriesRepository {
    constructor(db) {
        this.db = db;
    }

    async create({ ownerAccountId, name, frameText }) {
        const id = newId('mss');
        const now = new Date().toISOString();
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO meeting_series
                 (id, owner_account_id, name, frame_text, latest_agenda_text, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, ownerAccountId, name, frameText || '', frameText || '', now, now],
                (err) => {
                    if (err) return reject(err);
                    resolve({ id });
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM meeting_series WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async findByOwner(accountId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM meeting_series WHERE owner_account_id = ? ORDER BY created_at DESC',
                [accountId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });
    }

    async update(id, fields) {
        const allowed = ['name', 'frame_text', 'latest_agenda_text'];
        const setClauses = [];
        const values = [];
        for (const key of allowed) {
            if (typeof fields[key] === 'string') {
                setClauses.push(`${key} = ?`);
                values.push(fields[key]);
            }
        }
        if (!setClauses.length) return;
        setClauses.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE meeting_series SET ${setClauses.join(', ')} WHERE id = ?`,
                values,
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM meeting_series WHERE id = ?', [id], function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            });
        });
    }
}

module.exports = { SeriesRepository };
