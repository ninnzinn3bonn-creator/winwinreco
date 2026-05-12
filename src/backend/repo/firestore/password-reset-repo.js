const crypto = require('crypto');
const { newId } = require('../../lib/ids');
const { getDb, fromTimestamp, serverTs, admin } = require('./db');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Firestore implementation of password-reset-token storage.
 *
 * Collection: `password_reset_tokens/{tokenId}`
 *
 * Interface (same as sqlite/password-reset-repo.js):
 *   create({ accountId, token })  → { id, expiresAt }
 *   findByToken(token)            → row | null  (unused + unexpired only)
 *   markUsed(tokenId)             → void
 *   pruneExpired()                → number (docs deleted)
 */
class PasswordResetRepository {
    constructor() {
        this.col = getDb().collection('password_reset_tokens');
    }

    _toDomain(id, d) {
        return {
            id,
            account_id: d.account_id,
            token_hash: d.token_hash,
            expires_at: fromTimestamp(d.expires_at),
            used_at: fromTimestamp(d.used_at) || null,
            created_at: fromTimestamp(d.created_at)
        };
    }

    /**
     * Persist a new reset token.
     *
     * @param {{ accountId: string, token: string }} opts
     * @returns {Promise<{ id: string, expiresAt: string }>}
     */
    async create({ accountId, token }) {
        if (!accountId) throw new Error('accountId is required');
        if (!token) throw new Error('token is required');

        const id = newId('pwr');
        const tokenHash = hashToken(token);
        const expiresAtDate = new Date(Date.now() + TOKEN_TTL_MS);

        await this.col.doc(id).set({
            account_id: accountId,
            token_hash: tokenHash,
            expires_at: admin.firestore.Timestamp.fromDate(expiresAtDate),
            used_at: null,
            created_at: serverTs()
        });

        return { id, expiresAt: expiresAtDate.toISOString() };
    }

    /**
     * Look up a token. Returns null if not found, already used, or expired.
     *
     * @param {string} token  plain opaque token from the URL
     * @returns {Promise<{ id, account_id, expires_at, used_at } | null>}
     */
    async findByToken(token) {
        if (!token) return null;
        const tokenHash = hashToken(token);

        const snap = await this.col
            .where('token_hash', '==', tokenHash)
            .limit(1)
            .get();

        if (snap.empty) return null;

        const doc = snap.docs[0];
        const row = this._toDomain(doc.id, doc.data());

        if (row.used_at) return null;
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

        return row;
    }

    /**
     * Mark a token as consumed.
     *
     * @param {string} tokenId  the `id` field (not the raw token)
     */
    async markUsed(tokenId) {
        await this.col.doc(tokenId).update({
            used_at: serverTs()
        });
    }

    /**
     * Delete expired tokens.
     *
     * @returns {Promise<number>} number of docs deleted
     */
    async pruneExpired() {
        const now = admin.firestore.Timestamp.now();
        const snap = await this.col.where('expires_at', '<', now).get();
        if (snap.empty) return 0;
        const batch = getDb().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        return snap.size;
    }
}

module.exports = { PasswordResetRepository };
