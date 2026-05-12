const { getDb, fromTimestamp, serverTs } = require('./db');

class UserRepository {
    constructor() {
        this.col = getDb().collection('users');
    }

    _toDomain(id, d) {
        return {
            id,
            name: d.name || '',
            profile_text: d.profile_text || '',
            account_id: d.account_id || null,
            created_at: fromTimestamp(d.created_at)
        };
    }

    async create(user) {
        const { id, name, profile_text = '' } = user;
        await this.col.doc(id).set({
            name,
            profile_text,
            account_id: null,
            created_at: serverTs()
        });
    }

    async findById(id) {
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return null;
        return this._toDomain(id, snap.data());
    }

    async findByName(name) {
        const snap = await this.col.where('name', '==', name).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return this._toDomain(doc.id, doc.data());
    }

    async deleteById(id) {
        const ref = this.col.doc(id);
        const snap = await ref.get();
        if (!snap.exists) return 0;
        await ref.delete();
        return 1;
    }

    async upsert(user) {
        const { id, name, profile_text = '' } = user;
        await this.col.doc(id).set(
            { name, profile_text },
            { merge: true }
        );
        return this.findById(id);
    }
}

module.exports = { UserRepository };
