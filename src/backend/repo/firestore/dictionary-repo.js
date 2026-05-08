const { getDb, fromTimestamp, serverTs } = require('./db');

class DictionaryRepo {
    constructor() {
        this.col = getDb().collection('dictionary');
    }

    _toDomain(id, d) {
        return {
            id,
            label: d.label || '',
            term: d.term || '',
            reading: d.reading || '',
            created_at: fromTimestamp(d.created_at)
        };
    }

    async findAll() {
        const snap = await this.col.orderBy('created_at', 'desc').get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    async add({ id, label, term, reading }) {
        await this.col.doc(id).set({
            label: label || '',
            term: term || '',
            reading: reading || '',
            created_at: serverTs()
        });
        return { id, label, term, reading };
    }

    async delete(id) {
        await this.col.doc(id).delete();
    }

    async update(id, { label, term, reading }) {
        await this.col.doc(id).update({
            label: label || '',
            term: term || '',
            reading: reading || ''
        });
        return { id, label, term, reading };
    }
}

module.exports = { DictionaryRepo };
