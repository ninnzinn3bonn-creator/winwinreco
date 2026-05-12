const crypto = require('crypto');
const { newId } = require('../../lib/ids');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * SQLite implementation of email-verification-token storage.
 *
 * Tokens are opaque 32-byte hex strings. Only the SHA-256 hash is persisted
 * so a DB dump cannot be used to verify emails. Mirrors the pattern used by
 * PasswordResetRepository (U-1).
 *
 * Interface (same as firestore/email-verification-repo.js):
 *   create({ accountId, token })  → { id, expiresAt }
 *   findByToken(token)            → row | null  (unused + unexpired only)
 *   markUsed(tokenId)             → void
 *   pruneExpired()                → number (rows deleted)
 */
class EmailVerificationRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Persist a new verification token.
     *
     * @param {{ accountId: string, token: string }} opts
     *   token — plain 32-byte hex string. Caller generates via
     *           crypto.randomBytes(32).toString('hex').
     * @returns {Promise<{ id: string, expiresAt: string }>}
     */
    async create({ accountId, token }) {
        if (!accountId) throw new Error('accountId is required');
        if (!token) throw new Error('token is required');

        const id = newId('emv');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO email_verification_tokens
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
                 FROM email_verification_tokens
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
                `UPDATE email_verification_tokens
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
                `DELETE FROM email_verification_tokens
                 WHERE expires_at < CURRENT_TIMESTAMP`,
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }
}

module.exports = { EmailVerificationRepository };
