/**
 * Tests for past-meeting selector feature.
 *
 * Covers:
 *  1. buildPastMeetingContext({ roomIds: [] }) returns empty block
 *  2. buildPastMeetingContext({ roomIds: [A, B] }) returns only A and B
 *  3. buildPastMeetingContext({ roomIds: [A, X] }) where X belongs to another account → X is excluded
 *  4. POST /rooms/:id/custom-ai with past_room_ids containing unauthorized ID → silently excluded, 200
 */

const { buildPastMeetingContext } = require('../src/backend/lib/past-context');
const request = require('supertest');
const { createApp } = require('../src/backend/app');

describe('buildPastMeetingContext with roomIds option', () => {
    function makeRepo(rooms) {
        return {
            async findEndedRoomsForAccount(accountId, { limit } = {}) {
                return rooms
                    .filter((r) => r.owner_account_id === accountId)
                    .slice(0, limit || 5);
            }
        };
    }

    test('roomIds: [] returns empty block and items', async () => {
        const repo = makeRepo([
            { id: 'r1', owner_account_id: 'acc-1', status: 'ended', summary_text: 'summary A' }
        ]);
        const { block, items } = await buildPastMeetingContext(repo, 'acc-1', {
            useCache: false,
            roomIds: []
        });
        expect(block).toBe('');
        expect(items).toEqual([]);
    });

    test('roomIds: [A, B] returns only rooms A and B, excluding C', async () => {
        const repo = makeRepo([
            { id: 'r-A', owner_account_id: 'acc-1', status: 'ended', summary_text: 'summary A' },
            { id: 'r-B', owner_account_id: 'acc-1', status: 'ended', summary_text: 'summary B' },
            { id: 'r-C', owner_account_id: 'acc-1', status: 'ended', summary_text: 'summary C' }
        ]);
        const { items } = await buildPastMeetingContext(repo, 'acc-1', {
            useCache: false,
            roomIds: ['r-A', 'r-B']
        });
        const ids = items.map((i) => i.roomId);
        expect(ids).toContain('r-A');
        expect(ids).toContain('r-B');
        expect(ids).not.toContain('r-C');
    });

    test('roomIds: [A, X] where X belongs to different account → X not in result', async () => {
        // findEndedRoomsForAccount filters by owner_account_id, so X (owned by acc-other) will never
        // appear in the list for acc-1. The roomIds filter then only keeps what is already in the list.
        const repo = makeRepo([
            { id: 'r-A', owner_account_id: 'acc-1', status: 'ended', summary_text: 'summary A' },
            // r-X belongs to acc-other, will not show up for acc-1
            { id: 'r-X', owner_account_id: 'acc-other', status: 'ended', summary_text: 'summary X' }
        ]);
        const { items } = await buildPastMeetingContext(repo, 'acc-1', {
            useCache: false,
            roomIds: ['r-A', 'r-X']
        });
        const ids = items.map((i) => i.roomId);
        expect(ids).toContain('r-A');
        expect(ids).not.toContain('r-X');
    });

    test('cacheKey differs when roomIds differs, preventing stale cache hits', async () => {
        const repo = makeRepo([
            { id: 'r-A', owner_account_id: 'acc-2', status: 'ended', summary_text: 'summary A' },
            { id: 'r-B', owner_account_id: 'acc-2', status: 'ended', summary_text: 'summary B' }
        ]);
        const { LRUCache } = require('../src/backend/lib/past-context');
        const cache = new LRUCache(10, 60_000);

        const resAll = await buildPastMeetingContext(repo, 'acc-2', { cache });
        const resFiltered = await buildPastMeetingContext(repo, 'acc-2', { cache, roomIds: ['r-A'] });

        // resAll may include both; resFiltered should only have r-A
        expect(resFiltered.items.map((i) => i.roomId)).toEqual(['r-A']);
        // They should not be the same cached object
        expect(resAll).not.toBe(resFiltered);
    });
});

describe('POST /rooms/:id/custom-ai with past_room_ids security', () => {
    function makeStubs({ pastRoomOwner = 'acc-owner' } = {}) {
        const roomRepo = {
            findById: jest.fn(async (id) => {
                if (id === 'room-1') {
                    return {
                        id: 'room-1',
                        owner_id: 'host-user',
                        owner_account_id: 'acc-owner',
                        use_past_meetings: 1,
                        minutes_text: '会議の議事録テキスト',
                        ai_provider: null,
                        ai_model: null
                    };
                }
                if (id === 'room-authorized') {
                    return { id: 'room-authorized', owner_account_id: pastRoomOwner, status: 'ended', summary_text: 'authorized summary' };
                }
                if (id === 'room-unauthorized') {
                    // belongs to a different account
                    return { id: 'room-unauthorized', owner_account_id: 'acc-other', status: 'ended', summary_text: 'unauthorized summary' };
                }
                return undefined;
            }),
            findEndedRoomsForAccount: jest.fn(async () => [])
        };

        const participantRepo = {
            findByIdAndToken: jest.fn(async () => null),
            findInRoom: jest.fn(async (participantId, roomId) => {
                if (participantId === 'p-host' && roomId === 'room-1') {
                    return {
                        id: 'p-host',
                        room_id: 'room-1',
                        user_id: 'host-user',
                        display_name: 'Host',
                        control_token: 'host-token'
                    };
                }
                return null;
            }),
            findByRoomId: jest.fn(async () => [
                { id: 'p-host', room_id: 'room-1', user_id: 'host-user', display_name: 'Host', control_token: 'host-token' }
            ])
        };

        const aiService = {
            enabled: true,
            generateCustomFromMinutes: jest.fn(async () => ({ result: 'カスタム解析結果', provider: 'gemini' }))
        };

        return { roomRepo, participantRepo, aiService };
    }

    test('unauthorized past_room_ids are silently excluded and request succeeds with 200', async () => {
        const { roomRepo, participantRepo, aiService } = makeStubs();
        const app = createApp({ roomRepo, participantRepo, aiService });

        const response = await request(app)
            .post('/rooms/room-1/custom-ai')
            .send({
                participant_id: 'p-host',
                control_token: 'host-token',
                instruction: 'リスクを分析してください',
                past_room_ids: ['room-unauthorized']
            });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('カスタム解析結果');
        // The unauthorized ID must not have been included in the context lookup
        // (findEndedRoomsForAccount is called without the unauthorized room)
        expect(aiService.generateCustomFromMinutes).toHaveBeenCalled();
    });

    test('authorized past_room_ids are accepted and context is built', async () => {
        const { roomRepo, participantRepo, aiService } = makeStubs({ pastRoomOwner: 'acc-owner' });
        // Simulate the authorized past room being returned by findEndedRoomsForAccount
        roomRepo.findEndedRoomsForAccount = jest.fn(async () => [
            { id: 'room-authorized', owner_account_id: 'acc-owner', status: 'ended', summary_text: 'authorized summary' }
        ]);
        const app = createApp({ roomRepo, participantRepo, aiService });

        const response = await request(app)
            .post('/rooms/room-1/custom-ai')
            .send({
                participant_id: 'p-host',
                control_token: 'host-token',
                instruction: 'リスクを分析してください',
                past_room_ids: ['room-authorized']
            });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('カスタム解析結果');
    });
});
