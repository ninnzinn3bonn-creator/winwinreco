const crypto = require('crypto');
const { newId } = require('../lib/ids');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding window.

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Session rows store sha-256 hashes of opaque 32-byte tokens. The plain token
 * is only ever returned by create() so the caller can put it in a cookie;
 * it's never logged or persisted. `touch()` slides expires_at forward on
 * every validated request so active users are not logged out.
 */
class SessionRepository {
    constructor(db, { ttlMs = DEFAULT_TTL_MS } = {}) {
        this.db = db;
        this.ttlMs = ttlMs;
    }

    static hashToken(token) {
        return hashToken(token);
    }

    async create(accountId, { ttlMs } = {}) {
        if (!accountId) throw new Error('accountId is required');
        const id = newId('sess');
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const ttl = ttlMs || this.ttlMs;
        const expiresAt = new Date(Date.now() + ttl).toISOString();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO sessions (id, account_id, token_hash, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [id, accountId, tokenHash, expiresAt],
                (err) => {
                    if (err) return reject(err);
                    resolve({ id, accountId, token, expiresAt });
                }
            );
        });
    }

    async findByToken(token) {
        if (!token) return null;
        const tokenHash = hashToken(token);
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM sessions WHERE token_hash = ?`,
                [tokenHash],
                (err, row) => {
                    if (err) return reject(err);
                    if (!row) return resolve(null);
                    // Enforce expiry at read time so an expired row never
                    // grants access even if prune hasn't run yet.
                    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
                        return resolve(null);
                    }
                    resolve(row);
                }
            );
        });
    }

    async touch(sessionId, { ttlMs } = {}) {
        const ttl = ttlMs || this.ttlMs;
        const expiresAt = new Date(Date.now() + ttl).toISOString();
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE sessions SET expires_at = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [expiresAt, sessionId],
                (err) => {
                    if (err) return reject(err);
                    resolve(expiresAt);
                }
            );
        });
    }

    async destroyByToken(token) {
        if (!token) return;
        const tokenHash = hashToken(token);
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM sessions WHERE token_hash = ?',
                [tokenHash],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async destroyAllForAccount(accountId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM sessions WHERE account_id = ?',
                [accountId],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async pruneExpired() {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP',
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }
}

module.exports = { SessionRepository, hashToken };
