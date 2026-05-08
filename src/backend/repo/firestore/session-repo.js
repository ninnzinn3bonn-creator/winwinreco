const crypto = require('crypto');
const { newId } = require('../../lib/ids');
const { getDb, fromTimestamp, toTimestamp, serverTs, admin } = require('./db');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

class SessionRepository {
    constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
        this.col = getDb().collection('sessions');
        this.ttlMs = ttlMs;
    }

    static hashToken(token) {
        return hashToken(token);
    }

    _toDomain(id, d) {
        return {
            id,
            account_id: d.account_id,
            token_hash: d.token_hash,
            expires_at: fromTimestamp(d.expires_at),
            created_at: fromTimestamp(d.created_at),
            last_used_at: fromTimestamp(d.last_used_at)
        };
    }

    async create(accountId, { ttlMs } = {}) {
        if (!accountId) throw new Error('accountId is required');
        const id = newId('sess');
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const ttl = ttlMs || this.ttlMs;
        const expiresAt = new Date(Date.now() + ttl);

        await this.col.doc(id).set({
            account_id: accountId,
            token_hash: tokenHash,
            expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
            created_at: serverTs(),
            last_used_at: serverTs()
        });
        return { id, accountId, token, expiresAt: expiresAt.toISOString() };
    }

    async findByToken(token) {
        if (!token) return null;
        const tokenHash = hashToken(token);
        const snap = await this.col.where('token_hash', '==', tokenHash).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        const row = this._toDomain(doc.id, doc.data());
        // Enforce expiry at read time
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
            return null;
        }
        return row;
    }

    async touch(sessionId, { ttlMs } = {}) {
        const ttl = ttlMs || this.ttlMs;
        const expiresAt = new Date(Date.now() + ttl);
        await this.col.doc(sessionId).update({
            expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
            last_used_at: serverTs()
        });
        return expiresAt.toISOString();
    }

    async destroyByToken(token) {
        if (!token) return;
        const tokenHash = hashToken(token);
        const snap = await this.col.where('token_hash', '==', tokenHash).limit(1).get();
        if (!snap.empty) {
            await snap.docs[0].ref.delete();
        }
    }

    async destroyAllForAccount(accountId) {
        const snap = await this.col.where('account_id', '==', accountId).get();
        if (snap.empty) return;
        const batch = getDb().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }

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

module.exports = { SessionRepository, hashToken };
