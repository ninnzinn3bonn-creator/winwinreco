const { getDb, fromTimestamp, serverTs } = require('./db');

class RoomRepository {
    constructor() {
        this.col = getDb().collection('rooms');
    }

    _toDomain(id, d) {
        return {
            id,
            owner_id: d.owner_id,
            owner_account_id: d.owner_account_id || null,
            status: d.status,
            material_summary: d.material_summary || '',
            title: d.title || '',
            created_at: fromTimestamp(d.created_at),
            ended_at: fromTimestamp(d.ended_at),
            title_updated_at: fromTimestamp(d.title_updated_at),
            summary_text: d.summary_text || '',
            summary_updated_at: fromTimestamp(d.summary_updated_at),
            minutes_text: d.minutes_text || '',
            minutes_updated_at: fromTimestamp(d.minutes_updated_at),
            todo_text: d.todo_text || '',
            todo_updated_at: fromTimestamp(d.todo_updated_at),
            insights_status: d.insights_status || 'idle',
            insights_dirty: !!d.insights_dirty ? 1 : 0,
            ai_provider: d.ai_provider || null,
            ai_model: d.ai_model || null,
            use_past_meetings: !!d.use_past_meetings ? 1 : 0,
            ai_workspace_json: d.ai_workspace_json || '',
            ai_workspace_updated_at: fromTimestamp(d.ai_workspace_updated_at),
            stt_provider: d.stt_provider || '',
            stt_language: d.stt_language || '',
            series_id: d.series_id || null
        };
    }

    async create(room) {
        const {
            id, owner_id, material_summary,
            owner_account_id = null,
            use_past_meetings = true,
            stt_provider = '',
            stt_language = '',
            series_id = null
        } = room;
        await this.col.doc(id).set({
            owner_id,
            owner_account_id: owner_account_id || null,
            status: 'active',
            material_summary: material_summary || '',
            use_past_meetings: !!use_past_meetings,
            stt_provider,
            stt_language,
            series_id: series_id || null,
            created_at: serverTs(),
            ended_at: null,
            title: '',
            title_updated_at: null,
            summary_text: '',
            summary_updated_at: null,
            minutes_text: '',
            minutes_updated_at: null,
            todo_text: '',
            todo_updated_at: null,
            insights_status: 'idle',
            insights_dirty: false,
            ai_provider: null,
            ai_model: null,
            ai_workspace_json: '',
            ai_workspace_updated_at: null
        });
    }

    async findById(id) {
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return undefined;
        return this._toDomain(id, snap.data());
    }

    async findRoomsForAccount(accountId, { limit = 50 } = {}) {
        if (!accountId) return [];
        const ownerSnap = await this.col
            .where('owner_account_id', '==', accountId)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .get();
        const ownerRooms = ownerSnap.docs.map((d) => this._toDomain(d.id, d.data()));

        const partSnap = await getDb().collectionGroup('participants')
            .where('user_account_id', '==', accountId)
            .get();
        const roomIds = new Set(partSnap.docs.map((d) => d.ref.parent.parent.id));
        for (const r of ownerRooms) roomIds.delete(r.id);

        const joined = [];
        for (const rid of roomIds) {
            const r = await this.findById(rid);
            if (r) joined.push(r);
        }
        const all = [...ownerRooms, ...joined];
        all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return all.slice(0, limit);
    }

    async findEndedRoomsForAccount(accountId, { limit = 5, excludeRoomId = null } = {}) {
        const all = await this.findRoomsForAccount(accountId, { limit: 200 });
        return all
            .filter((r) => r.status === 'ended' && r.summary_text && r.summary_text.trim() !== '')
            .filter((r) => !excludeRoomId || r.id !== excludeRoomId)
            .sort((a, b) => (b.ended_at || b.created_at || '').localeCompare(a.ended_at || a.created_at || ''))
            .slice(0, limit);
    }

    async endRoom(id) {
        await this.col.doc(id).update({ status: 'ended', ended_at: serverTs() });
    }

    async updateAiConfig(id, provider, model, usePastMeetings = null) {
        const fields = { ai_provider: provider, ai_model: model };
        if (typeof usePastMeetings === 'boolean') fields.use_past_meetings = usePastMeetings;
        await this.col.doc(id).update(fields);
    }

    async resetStuckProcessing() {
        const snap = await this.col.where('insights_status', '==', 'processing').get();
        const batch = getDb().batch();
        snap.docs.forEach((d) => batch.update(d.ref, { insights_status: 'error' }));
        if (snap.size > 0) await batch.commit();
        return snap.size;
    }

    async updateInsights(roomId, updates = {}) {
        const fields = {};
        const now = serverTs();
        if (typeof updates.summary_text === 'string') { fields.summary_text = updates.summary_text; fields.summary_updated_at = now; }
        if (typeof updates.minutes_text === 'string') { fields.minutes_text = updates.minutes_text; fields.minutes_updated_at = now; }
        if (typeof updates.todo_text === 'string')    { fields.todo_text = updates.todo_text; fields.todo_updated_at = now; }
        if (typeof updates.material_summary === 'string') fields.material_summary = updates.material_summary;
        if (typeof updates.title === 'string') { fields.title = updates.title; fields.title_updated_at = now; }
        if (typeof updates.ai_workspace_json === 'string') { fields.ai_workspace_json = updates.ai_workspace_json; fields.ai_workspace_updated_at = now; }
        if (typeof updates.insights_status === 'string') fields.insights_status = updates.insights_status;
        if (typeof updates.insights_dirty === 'boolean') fields.insights_dirty = updates.insights_dirty;
        if (typeof updates.use_past_meetings === 'boolean') fields.use_past_meetings = updates.use_past_meetings;

        if (Object.keys(fields).length === 0) return this.findById(roomId);
        await this.col.doc(roomId).update(fields);
        return this.findById(roomId);
    }

    // --- §54 利用状況ダッシュボード ----------------------------------------

    /** 全ルーム数。 */
    async countAll() {
        try {
            const agg = await this.col.count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.get();
            return snap.size;
        }
    }

    /** created_at >= date (Date オブジェクトまたは ISO 文字列) のルーム数。 */
    async countCreatedSince(date) {
        const d = date instanceof Date ? date : new Date(date);
        try {
            const agg = await this.col.where('created_at', '>=', d).count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.where('created_at', '>=', d).get();
            return snap.size;
        }
    }

    /** 進行中ルーム数 (ended_at が null のもの)。 */
    async countOngoing() {
        try {
            const agg = await this.col.where('ended_at', '==', null).count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.where('ended_at', '==', null).get();
            return snap.size;
        }
    }

    async deleteCascade(roomId) {
        const subs = ['participants', 'utterances', 'analyses', 'actions', 'chunks'];
        const docRef = this.col.doc(roomId);
        for (const sub of subs) {
            const snap = await docRef.collection(sub).get();
            const batch = getDb().batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            if (snap.size > 0) await batch.commit();
        }
        const exists = (await docRef.get()).exists;
        if (exists) await docRef.delete();
        return exists ? 1 : 0;
    }
}

module.exports = { RoomRepository };
