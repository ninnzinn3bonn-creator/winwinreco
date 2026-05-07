const { newId } = require('../../lib/ids');

/**
 * Stores host-login accounts. Email is normalized to lowercase on every
 * write/lookup so case-insensitive duplicates cannot bypass the UNIQUE
 * constraint. Password hashes are opaque strings produced by lib/passwords.
 */
class UserAccountRepository {
    constructor(db) {
        this.db = db;
    }

    static normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
    }

    async create({ email, passwordHash, displayName = '' }) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) throw new Error('email is required');
        if (!passwordHash) throw new Error('passwordHash is required');

        const id = newId('acc');
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_accounts (id, email, password_hash, display_name)
                 VALUES (?, ?, ?, ?)`,
                [id, normalized, passwordHash, displayName],
                (err) => {
                    if (err) return reject(err);
                    resolve({
                        id,
                        email: normalized,
                        password_hash: passwordHash,
                        display_name: displayName
                    });
                }
            );
        });
    }

    async findByEmail(email) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) return null;
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM user_accounts WHERE email = ?',
                [normalized],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }

    async findById(id) {
        if (!id) return null;
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM user_accounts WHERE id = ?',
                [id],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }

    async updateDisplayName(id, displayName) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_accounts SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [displayName || '', id],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async updatePasswordHash(id, passwordHash) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE user_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [passwordHash, id],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }
}

module.exports = { UserAccountRepository };
