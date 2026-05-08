const { getDb, fromTimestamp, serverTs } = require('./db');

class ActionRepository {
    constructor() {
        this.db = getDb();
    }

    _roomCol(roomId) {
        return this.db.collection('rooms').doc(roomId).collection('actions');
    }

    _toDomain(id, d) {
        return {
            id,
            room_id: d.room_id,
            speaker_id: d.speaker_id || null,
            speaker_name: d.speaker_name || '',
            action_text: d.action_text || '',
            created_at: fromTimestamp(d.created_at)
        };
    }

    async replaceForRoom(roomId, actions = []) {
        await this.deleteByRoomId(roomId);
        for (const action of actions) {
            await this.add({
                id: action.id,
                room_id: roomId,
                speaker_id: action.speaker_id || null,
                speaker_name: action.speaker_name || '',
                action_text: action.action_text || ''
            });
        }
    }

    async add(action) {
        const { id, room_id, speaker_id, speaker_name, action_text } = action;
        await this._roomCol(room_id).doc(id).set({
            room_id,
            speaker_id: speaker_id || null,
            speaker_name: speaker_name || '',
            action_text: action_text || '',
            created_at: serverTs()
        });
    }

    async deleteByRoomId(roomId) {
        const snap = await this._roomCol(roomId).get();
        if (snap.empty) return;
        const batch = this.db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }

    async findByRoomId(roomId) {
        const snap = await this._roomCol(roomId).get();
        const docs = snap.docs.map((d) => this._toDomain(d.id, d.data()));
        // Sort by speaker_name ASC, created_at ASC (matching SQLite ORDER BY)
        docs.sort((a, b) => {
            const nameCompare = (a.speaker_name || '').localeCompare(b.speaker_name || '');
            if (nameCompare !== 0) return nameCompare;
            return (a.created_at || '').localeCompare(b.created_at || '');
        });
        return docs;
    }
}

module.exports = { ActionRepository };
