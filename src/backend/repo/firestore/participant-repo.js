const { getDb, fromTimestamp, serverTs } = require('./db');

class ParticipantRepository {
    constructor() {
        this.db = getDb();
    }

    _toDomain(d) {
        return {
            id: d.id,
            room_id: d.room_id,
            user_id: d.user_id || null,
            display_name: d.display_name || '',
            control_token: d.control_token || null,
            location_id: d.location_id || null,
            user_account_id: d.user_account_id || null,
            joined_at: fromTimestamp(d.joined_at)
        };
    }

    _roomCol(roomId) {
        return this.db.collection('rooms').doc(roomId).collection('participants');
    }

    async join(participant) {
        const {
            id,
            room_id,
            user_id = null,
            display_name,
            control_token = null,
            location_id = null,
            user_account_id = null
        } = participant;
        await this._roomCol(room_id).doc(id).set({
            id,
            room_id,
            user_id: user_id || null,
            display_name,
            control_token: control_token || null,
            location_id: location_id || null,
            user_account_id: user_account_id || null,
            joined_at: serverTs()
        });
    }

    async findById(id) {
        const snap = await this.db.collectionGroup('participants')
            .where('id', '==', id)
            .limit(1)
            .get();
        if (snap.empty) return undefined;
        return this._toDomain(snap.docs[0].data());
    }

    // room_id が分かっている場合はこちらを使う（collectionGroup インデックス不要）
    async findInRoom(id, roomId) {
        const doc = await this._roomCol(roomId).doc(id).get();
        if (!doc.exists) return undefined;
        return this._toDomain(doc.data());
    }

    async findByIdAndToken(id, controlToken) {
        const snap = await this.db.collectionGroup('participants')
            .where('id', '==', id)
            .where('control_token', '==', controlToken)
            .limit(1)
            .get();
        if (snap.empty) return undefined;
        return this._toDomain(snap.docs[0].data());
    }

    async findByRoomId(room_id) {
        const snap = await this._roomCol(room_id).get();
        return snap.docs.map((d) => this._toDomain(d.data()));
    }

    async backfillAccountByUserId(localUserId, accountId) {
        if (!localUserId || !accountId) return 0;
        const snap = await this.db.collectionGroup('participants')
            .where('user_id', '==', localUserId)
            .where('user_account_id', '==', null)
            .get();
        if (snap.empty) return 0;
        const batch = this.db.batch();
        snap.docs.forEach((d) => batch.update(d.ref, { user_account_id: accountId }));
        await batch.commit();
        return snap.size;
    }

    async unlinkAccountFromRoom(roomId, accountId) {
        if (!roomId || !accountId) return 0;
        const snap = await this._roomCol(roomId)
            .where('user_account_id', '==', accountId)
            .get();
        if (snap.empty) return 0;
        const batch = this.db.batch();
        snap.docs.forEach((d) => batch.update(d.ref, { user_account_id: null }));
        await batch.commit();
        return snap.size;
    }
}

module.exports = { ParticipantRepository };
