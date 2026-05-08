const { getDb, fromTimestamp, serverTs, admin } = require('./db');

/**
 * [L9] room_chunks の Firestore 実装。
 * ドキュメント ID は `${chunk_index}_${analysis_type}` とし、
 * (room_id, chunk_index, analysis_type) の一意性を保つ。
 */
class ChunkRepository {
    constructor() {
        this.db = getDb();
    }

    _roomCol(roomId) {
        return this.db.collection('rooms').doc(roomId).collection('chunks');
    }

    _docId(chunk_index, analysis_type) {
        return `${chunk_index}_${analysis_type || 'minutes'}`;
    }

    _toDomain(d) {
        return {
            id: d.id || '',
            room_id: d.room_id,
            chunk_index: d.chunk_index,
            analysis_type: d.analysis_type || 'minutes',
            start_ts: d.start_ts || '',
            end_ts: d.end_ts || '',
            result_text: d.result_text || '',
            status: d.status || 'done',
            created_at: fromTimestamp(d.created_at),
            updated_at: fromTimestamp(d.updated_at)
        };
    }

    async upsert({ room_id, chunk_index, analysis_type, start_ts, end_ts, result_text, status }) {
        const atype = analysis_type || 'minutes';
        const docId = this._docId(chunk_index, atype);
        const now = admin.firestore.Timestamp.fromDate(new Date());
        const ref = this._roomCol(room_id).doc(docId);
        const snap = await ref.get();
        if (snap.exists) {
            await ref.update({
                result_text: result_text || '',
                status: status || 'done',
                updated_at: now
            });
        } else {
            await ref.set({
                id: docId,
                room_id,
                chunk_index,
                analysis_type: atype,
                start_ts: start_ts || '',
                end_ts: end_ts || '',
                result_text: result_text || '',
                status: status || 'done',
                created_at: now,
                updated_at: now
            });
        }
    }

    async findByRoom(roomId, analysisType) {
        const atype = analysisType || 'minutes';
        const snap = await this._roomCol(roomId)
            .where('analysis_type', '==', atype)
            .orderBy('chunk_index', 'asc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.data()));
    }

    async findByIndex(roomId, analysisType, chunkIndex) {
        const atype = analysisType || 'minutes';
        const docId = this._docId(chunkIndex, atype);
        const snap = await this._roomCol(roomId).doc(docId).get();
        if (!snap.exists) return null;
        return this._toDomain(snap.data());
    }

    async deleteByRoom(roomId) {
        const snap = await this._roomCol(roomId).get();
        if (snap.empty) return;
        const batch = this.db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }
}

module.exports = { ChunkRepository };
