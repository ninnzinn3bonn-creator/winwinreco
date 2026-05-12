const crypto = require('crypto');
const { newId } = require('../../lib/ids');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * SQLite implementation of password-reset-token storage.
 *
 * Tokens are opaque 32-byte hex strings. Only the SHA-256 hash is persisted
 * so a DB dump cannot be used to reset passwords. This mirrors the pattern
 * used by SessionRepository.
 *
 * Interface (same as firestore/password-reset-repo.js):
 *   create({ accountId, token })  → { id, expiresAt }
 *   findByToken(token)            → row | null  (unused + unexpired only)
 *   markUsed(tokenId)             → void
 *   pruneExpired()                → number (rows deleted)
 */
class PasswordResetRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Persist a new reset token.
     *
     * @param {{ accountId: string, token: string }} opts
     *   token — plain 32-byte hex string. Caller generates via
     *           crypto.randomBytes(32).toString('hex').
     * @returns {Promise<{ id: string, expiresAt: string }>}
     */
    async create({ accountId, token }) {
        if (!accountId) throw new Error('accountId is required');
        if (!token) throw new Error('token is required');

        const id = newId('pwr');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO password_reset_tokens
                    (id, account_id, token_hash, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [id, accountId, tokenHash, expiresAt],
                (err) => {
                    if (err) return reject(err);
                    resolve({ id, expiresAt });
                }
            );
        });
    }

    /**
     * Look up a token. Returns null if:
     *   - not found
     *   - already used (used_at IS NOT NULL)
     *   - expired (expires_at < now)
     *
     * @param {string} token  plain opaque token from the URL
     * @returns {Promise<{ id, account_id, expires_at, used_at } | null>}
     */
    async findByToken(token) {
        if (!token) return null;
        const tokenHash = hashToken(token);

        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT id, account_id, expires_at, used_at
                 FROM password_reset_tokens
                 WHERE token_hash = ?`,
                [tokenHash],
                (err, row) => {
                    if (err) return reject(err);
                    if (!row) return resolve(null);
                    if (row.used_at) return resolve(null);
                    if (new Date(row.expires_at).getTime() < Date.now()) return resolve(null);
                    resolve(row);
                }
            );
        });
    }

    /**
     * Mark a token as consumed. Idempotent.
     *
     * @param {string} tokenId  the `id` field (not the raw token)
     */
    async markUsed(tokenId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE password_reset_tokens
                 SET used_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [tokenId],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    /**
     * Delete expired tokens. Called opportunistically for housekeeping.
     *
     * @returns {Promise<number>} number of rows deleted
     */
    async pruneExpired() {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM password_reset_tokens
                 WHERE expires_at < CURRENT_TIMESTAMP`,
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }
}

module.exports = { PasswordResetRepository };
