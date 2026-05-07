const path = require('path');
const fs = require('fs');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UtteranceRepository } = require('../src/backend/repo/utterance-repo');

describe('UtteranceRepository', () => {
    let db;
    let repo;
    const dbPath = path.resolve(__dirname, './tmp/test_utterance.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        const roomRepo = new RoomRepository(db);
        await roomRepo.create({ id: 'room-1', owner_id: 'user-1' });
        const participantRepo = new ParticipantRepository(db);
        await participantRepo.join({ id: 'p-1', room_id: 'room-1', display_name: 'Alice', location_id: 'loc-1' });
        repo = new UtteranceRepository(db);
    });

    afterAll((done) => {
        db.close(done);
    });

    test('should add and find utterances', async () => {
        const utterance = { id: 'u-1', room_id: 'room-1', participant_id: 'p-1', started_at: '2026-02-24T20:00:00Z', ended_at: '2026-02-24T20:00:10Z', transcript: 'Hello, world!' };
        await repo.add(utterance);
        
        const list = await repo.findByRoomId('room-1');
        expect(list.length).toBe(1);
        expect(list[0].transcript).toBe('Hello, world!');
    });

    test('should update memory fields for an utterance', async () => {
        const updated = await repo.updateMemory('u-1', {
            is_starred: true,
            memo_text: 'Follow up on budget',
            transcript: 'Hello, edited world!',
            transcript_source: 'user'
        });

        expect(updated.is_starred).toBe(1);
        expect(updated.memo_text).toBe('Follow up on budget');
        expect(updated.memory_note).toBe('Follow up on budget');
        expect(updated.memo_updated_at).toBeTruthy();
        expect(updated.transcript).toBe('Hello, edited world!');
        expect(updated.transcript_source).toBe('user');

        const starred = await repo.findStarredByRoomId('room-1');
        expect(starred).toHaveLength(1);
        expect(starred[0].id).toBe('u-1');
        expect(starred[0].memo_text).toBe('Follow up on budget');
    });

    test('should merge transcript chunks into the latest utterance', async () => {
        await repo.add({
            id: 'u-2',
            room_id: 'room-1',
            participant_id: 'p-1',
            started_at: '2026-02-24T20:01:00Z',
            ended_at: '2026-02-24T20:01:01Z',
            transcript: 'first chunk',
            raw_transcript: 'first chunk'
        });

        const merged = await repo.mergeTranscript('u-2', 'second chunk', '2026-02-24T20:01:02Z');
        expect(merged.transcript).toBe('first chunk second chunk');
        expect(merged.raw_transcript).toBe('first chunk second chunk');

        const latest = await repo.findLatestByParticipant('room-1', 'p-1');
        expect(latest.id).toBe('u-2');
    });
});
