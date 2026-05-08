const { newId } = require('../../lib/ids');
const { getDb, fromTimestamp, serverTs } = require('./db');

class UserAccountRepository {
    constructor() {
        this.col = getDb().collection('user_accounts');
    }

    static normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
    }

    _toDomain(id, d) {
        return {
            id,
            email: d.email,
            password_hash: d.password_hash,
            display_name: d.display_name || '',
            created_at: fromTimestamp(d.created_at),
            updated_at: fromTimestamp(d.updated_at)
        };
    }

    async create({ email, passwordHash, displayName = '' }) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) throw new Error('email is required');
        if (!passwordHash) throw new Error('passwordHash is required');

        // Check for duplicate email
        const existing = await this.findByEmail(normalized);
        if (existing) {
            const err = new Error('UNIQUE constraint failed: user_accounts.email');
            err.code = 'SQLITE_CONSTRAINT';
            throw err;
        }

        const id = newId('acc');
        await this.col.doc(id).set({
            email: normalized,
            password_hash: passwordHash,
            display_name: displayName,
            created_at: serverTs(),
            updated_at: serverTs()
        });
        return {
            id,
            email: normalized,
            password_hash: passwordHash,
            display_name: displayName
        };
    }

    async findByEmail(email) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) return null;
        const snap = await this.col.where('email', '==', normalized).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return this._toDomain(doc.id, doc.data());
    }

    async findById(id) {
        if (!id) return null;
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return null;
        return this._toDomain(id, snap.data());
    }

    async updateDisplayName(id, displayName) {
        await this.col.doc(id).update({
            display_name: displayName || '',
            updated_at: serverTs()
        });
    }

    async updatePasswordHash(id, passwordHash) {
        await this.col.doc(id).update({
            password_hash: passwordHash,
            updated_at: serverTs()
        });
    }
}

module.exports = { UserAccountRepository };
