const { getDb, fromTimestamp, toTimestamp, serverTs, admin } = require('./db');

class UtteranceRepository {
    constructor() {
        this.db = getDb();
    }

    _roomCol(roomId) {
        return this.db.collection('rooms').doc(roomId).collection('utterances');
    }

    _toDomain(d) {
        return {
            id: d.id,
            room_id: d.room_id,
            participant_id: d.participant_id,
            user_id: d.user_id || null,
            started_at: fromTimestamp(d.started_at),
            ended_at: fromTimestamp(d.ended_at),
            created_at: fromTimestamp(d.created_at),
            transcript: d.transcript || '',
            is_starred: !!d.is_starred ? 1 : 0,
            starred_at: fromTimestamp(d.starred_at),
            memory_note: d.memory_note || '',
            memo_text: d.memo_text || d.memory_note || '',
            raw_transcript: d.raw_transcript || d.transcript || '',
            transcript_source: d.transcript_source || 'stt',
            corrected_at: fromTimestamp(d.corrected_at),
            memo_updated_at: fromTimestamp(d.memo_updated_at)
        };
    }

    // Firestore フィールドのサブセットをドメイン形式に変換（updateMemory の返り値用）
    _fieldsToPartialDomain(fields) {
        const result = {};
        if ('is_starred' in fields) result.is_starred = !!fields.is_starred ? 1 : 0;
        if ('starred_at' in fields) result.starred_at = fromTimestamp(fields.starred_at);
        if ('memory_note' in fields) result.memory_note = fields.memory_note;
        if ('memo_text' in fields) result.memo_text = fields.memo_text;
        if ('memo_updated_at' in fields) result.memo_updated_at = fromTimestamp(fields.memo_updated_at);
        if ('transcript' in fields) result.transcript = fields.transcript;
        if ('transcript_source' in fields) result.transcript_source = fields.transcript_source;
        if ('corrected_at' in fields) result.corrected_at = fromTimestamp(fields.corrected_at);
        return result;
    }

    _enrichWithParticipants(utterances, participants) {
        const pMap = new Map(participants.map((p) => [p.id, p]));
        return utterances.map((u) => {
            const p = pMap.get(u.participant_id);
            return {
                ...u,
                display_name: p ? p.display_name || '' : '',
                user_id: p ? p.user_id || u.user_id : u.user_id,
                memo_text: u.memo_text || u.memory_note || '',
                memory_note: u.memo_text || u.memory_note || ''
            };
        });
    }

    async _getParticipants(roomId) {
        const snap = await this.db.collection('rooms').doc(roomId).collection('participants').get();
        return snap.docs.map((d) => d.data());
    }

    async add(utterance) {
        const {
            id,
            room_id,
            participant_id,
            user_id = null,
            started_at,
            ended_at,
            transcript,
            is_starred = 0,
            starred_at = null,
            memory_note = '',
            raw_transcript = transcript,
            transcript_source = 'stt',
            corrected_at = null
        } = utterance;
        await this._roomCol(room_id).doc(id).set({
            id,
            room_id,
            participant_id,
            user_id: user_id || null,
            started_at: toTimestamp(started_at),
            ended_at: toTimestamp(ended_at),
            created_at: serverTs(),
            transcript: transcript || '',
            is_starred: !!is_starred,
            starred_at: toTimestamp(starred_at),
            memory_note: memory_note || '',
            memo_text: memory_note || '',
            raw_transcript: raw_transcript || transcript || '',
            transcript_source: transcript_source || 'stt',
            corrected_at: toTimestamp(corrected_at),
            memo_updated_at: null
        });
    }

    async findById(id) {
        const snap = await this.db.collectionGroup('utterances')
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

    async findByRoomId(room_id) {
        const snap = await this._roomCol(room_id)
            .orderBy('started_at', 'asc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.data()));
    }

    async findByRoomIdWithParticipants(room_id) {
        const [uSnap, participants] = await Promise.all([
            this._roomCol(room_id).orderBy('started_at', 'asc').get(),
            this._getParticipants(room_id)
        ]);
        const utterances = uSnap.docs.map((d) => this._toDomain(d.data()));
        return this._enrichWithParticipants(utterances, participants);
    }

    async findNewerThan(room_id, last_timestamp) {
        const ts = toTimestamp(last_timestamp);
        const [uSnap, participants] = await Promise.all([
            this._roomCol(room_id)
                .where('started_at', '>', ts)
                .orderBy('started_at', 'asc')
                .get(),
            this._getParticipants(room_id)
        ]);
        const utterances = uSnap.docs.map((d) => this._toDomain(d.data()));
        return this._enrichWithParticipants(utterances, participants);
    }

    async findLatestByParticipant(room_id, participant_id) {
        const [uSnap, participants] = await Promise.all([
            this._roomCol(room_id)
                .where('participant_id', '==', participant_id)
                .orderBy('ended_at', 'desc')
                .limit(1)
                .get(),
            this._getParticipants(room_id)
        ]);
        if (uSnap.empty) return undefined;
        const utterances = uSnap.docs.map((d) => this._toDomain(d.data()));
        const enriched = this._enrichWithParticipants(utterances, participants);
        return enriched[0];
    }

    async findStarredByRoomId(room_id) {
        const [uSnap, participants] = await Promise.all([
            this._roomCol(room_id)
                .where('is_starred', '==', true)
                .get(),
            this._getParticipants(room_id)
        ]);
        const utterances = uSnap.docs.map((d) => this._toDomain(d.data()));
        // Sort by starred_at desc (matching SQLite ORDER BY COALESCE(starred_at, started_at) DESC)
        utterances.sort((a, b) =>
            (b.starred_at || b.started_at || '').localeCompare(a.starred_at || a.started_at || '')
        );
        return this._enrichWithParticipants(utterances, participants);
    }

    async updateMemory(id, updates = {}, roomId = null) {
        const existing = roomId ? await this.findInRoom(id, roomId) : await this.findById(id);
        if (!existing) return undefined;

        const fields = {};
        if (typeof updates.is_starred === 'boolean') {
            fields.is_starred = updates.is_starred;
            fields.starred_at = updates.is_starred
                ? admin.firestore.Timestamp.fromDate(new Date())
                : null;
        }
        if (typeof updates.memory_note === 'string') {
            fields.memory_note = updates.memory_note.trim();
        }
        if (typeof updates.memo_text === 'string') {
            const memoText = updates.memo_text.trim();
            fields.memo_text = memoText;
            fields.memory_note = memoText;
            fields.memo_updated_at = admin.firestore.Timestamp.fromDate(new Date());
        }
        if (typeof updates.transcript === 'string') {
            fields.transcript = updates.transcript.trim();
        }
        if (typeof updates.transcript_source === 'string') {
            fields.transcript_source = updates.transcript_source;
            fields.corrected_at = admin.firestore.Timestamp.fromDate(new Date());
        }

        if (Object.keys(fields).length === 0) return this._toDomain(existing);

        // room_id は findById の結果に含まれているので direct doc ref で更新（collectionGroup 不要）
        await this._roomCol(existing.room_id).doc(id).update(fields);
        return { ...this._toDomain(existing), ...this._fieldsToPartialDomain(fields) };
    }

    async mergeTranscript(id, nextTranscript, endedAt = new Date().toISOString(), roomId = null) {
        const existing = roomId ? await this.findInRoom(id, roomId) : await this.findById(id);
        if (!existing) return null;

        const mergedTranscript = [existing.transcript, nextTranscript].filter(Boolean).join(' ').trim();
        const mergedRaw = [existing.raw_transcript || existing.transcript, nextTranscript].filter(Boolean).join(' ').trim();

        // room_id は findById の結果に含まれているので direct doc ref で更新（collectionGroup 不要）
        const updateFields = {
            transcript: mergedTranscript,
            raw_transcript: mergedRaw,
            ended_at: toTimestamp(endedAt),
            transcript_source: 'stt'
        };
        await this._roomCol(existing.room_id).doc(id).update(updateFields);
        return { ...this._toDomain(existing), transcript: mergedTranscript, raw_transcript: mergedRaw };
    }
}

module.exports = { UtteranceRepository };
