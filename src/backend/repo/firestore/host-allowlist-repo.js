const { getDb, fromTimestamp, serverTs } = require('./db');

class HostAllowlistRepository {
    constructor() {
        this.col = getDb().collection('host_allowlist');
    }

    _toDomain(id, d) {
        return {
            email: d.email || id,
            display_name: d.display_name || '',
            added_by: d.added_by || '',
            added_at: fromTimestamp(d.added_at),
            note: d.note || '',
            disabled: !!d.disabled ? 1 : 0
        };
    }

    async findByEmail(email) {
        const lower = (email || '').toLowerCase();
        const snap = await this.col.doc(lower).get();
        if (!snap.exists) return null;
        return this._toDomain(lower, snap.data());
    }

    async list() {
        const snap = await this.col.orderBy('added_at', 'desc').get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    async add({ email, display_name = '', note = '', added_by = '' }) {
        const lower = email.toLowerCase();
        await this.col.doc(lower).set(
            { email: lower, display_name, note, added_by, added_at: serverTs(), disabled: false },
            { merge: true }
        );
    }

    async remove(email) {
        await this.col.doc(email.toLowerCase()).delete();
    }

    async setDisabled(email, disabled) {
        await this.col.doc(email.toLowerCase()).update({ disabled: !!disabled });
    }
}

module.exports = { HostAllowlistRepository };
