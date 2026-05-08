const { getDb, fromTimestamp, serverTs } = require('./db');

class AnalysisRepository {
    constructor() {
        this.db = getDb();
    }

    _roomCol(roomId) {
        return this.db.collection('rooms').doc(roomId).collection('analyses');
    }

    _toDomain(id, d) {
        return {
            id,
            room_id: d.room_id,
            type: d.type,
            input_prompt: d.input_prompt || '',
            result_text: d.result_text || '',
            created_at: fromTimestamp(d.created_at)
        };
    }

    async add(analysis) {
        const { id, room_id, type, input_prompt, result_text } = analysis;
        await this._roomCol(room_id).doc(id).set({
            room_id,
            type,
            input_prompt: input_prompt || '',
            result_text: result_text || '',
            created_at: serverTs()
        });
    }

    async findByRoomId(roomId) {
        const snap = await this._roomCol(roomId)
            .orderBy('created_at', 'desc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    async findLatestByTypes(roomId, types = []) {
        if (!types.length) return null;
        // Fetch all and filter in memory to avoid needing composite index
        const snap = await this._roomCol(roomId).get();
        if (snap.empty) return null;
        const docs = snap.docs
            .map((d) => this._toDomain(d.id, d.data()))
            .filter((doc) => types.includes(doc.type))
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return docs[0] || null;
    }
}

module.exports = { AnalysisRepository };
