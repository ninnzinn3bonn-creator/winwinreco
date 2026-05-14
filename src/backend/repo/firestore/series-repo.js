const { getDb, serverTs, fromTimestamp } = require('./db');
const { newId } = require('../../lib/ids');

class SeriesRepository {
    constructor() {
        this.col = getDb().collection('meeting_series');
    }

    _toDomain(id, d) {
        return {
            id,
            owner_account_id: d.owner_account_id || null,
            name: d.name || '',
            frame_text: d.frame_text || '',
            latest_agenda_text: d.latest_agenda_text || '',
            created_at: fromTimestamp(d.created_at),
            updated_at: fromTimestamp(d.updated_at)
        };
    }

    async create({ ownerAccountId, name, frameText }) {
        const id = newId('mss');
        await this.col.doc(id).set({
            owner_account_id: ownerAccountId,
            name: name || '',
            frame_text: frameText || '',
            latest_agenda_text: frameText || '',
            created_at: serverTs(),
            updated_at: serverTs()
        });
        return { id };
    }

    async findById(id) {
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return null;
        return this._toDomain(id, snap.data());
    }

    async findByOwner(accountId) {
        const snap = await this.col
            .where('owner_account_id', '==', accountId)
            .orderBy('created_at', 'desc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    async update(id, fields) {
        const allowed = ['name', 'frame_text', 'latest_agenda_text'];
        const updates = {};
        for (const key of allowed) {
            if (typeof fields[key] === 'string') {
                updates[key] = fields[key];
            }
        }
        if (!Object.keys(updates).length) return;
        updates.updated_at = serverTs();
        await this.col.doc(id).update(updates);
    }

    async delete(id) {
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return 0;
        await this.col.doc(id).delete();
        return 1;
    }
}

module.exports = { SeriesRepository };
