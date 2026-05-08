class HostAllowlistRepository {
    constructor(db) {
        this.db = db;
    }

    async findByEmail(email) {
        const lower = (email || '').toLowerCase();
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM host_allowlist WHERE email = ?',
                [lower],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }

    async list() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM host_allowlist ORDER BY added_at DESC',
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });
    }

    async add({ email, display_name = '', note = '', added_by = '' }) {
        const lower = email.toLowerCase();
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO host_allowlist (email, display_name, note, added_by)
                 VALUES (?, ?, ?, ?)`,
                [lower, display_name, note, added_by],
                (err) => (err ? reject(err) : resolve())
            );
        });
    }

    async remove(email) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM host_allowlist WHERE email = ?',
                [email.toLowerCase()],
                (err) => (err ? reject(err) : resolve())
            );
        });
    }

    async setDisabled(email, disabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE host_allowlist SET disabled = ? WHERE email = ?',
                [disabled ? 1 : 0, email.toLowerCase()],
                (err) => (err ? reject(err) : resolve())
            );
        });
    }
}

module.exports = { HostAllowlistRepository };
