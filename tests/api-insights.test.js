const request = require('supertest');
const { createApp } = require('../src/backend/app');

describe('Insights API', () => {
    test('GET /rooms/:id/insights should return shared minutes, summary, todo, and actions', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                minutes_text: '整理済み議事録',
                minutes_updated_at: '2026-04-08T10:00:00Z',
                summary_text: '会議の要約',
                summary_updated_at: '2026-04-08T10:10:00Z',
                todo_text: 'TODO一覧',
                todo_updated_at: '2026-04-08T10:20:00Z',
                insights_status: 'ready',
                insights_dirty: 0
            }))
        };
        const actionRepo = {
            findByRoomId: jest.fn(async () => ([
                {
                    id: 'act-1',
                    room_id: 'room-1',
                    speaker_id: 'user-1',
                    speaker_name: 'Alice',
                    action_text: '仕様書を更新する'
                }
            ]))
        };
        const analysisRepo = {
            findLatestByTypes: jest.fn(async (_roomId, types) => {
                if (types.includes('speaker_summaries')) {
                    return {
                        result_text: JSON.stringify([
                            { speaker: 'Alice', summary: '進捗共有と課題整理を担当した' }
                        ])
                    };
                }
                return null;
            })
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-user',
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'Alice',
                control_token: 'user-token'
            }))
        };
        const app = createApp({ roomRepo, actionRepo, analysisRepo, participantRepo });

        const response = await request(app)
            .get('/rooms/room-1/insights')
            .query({ participant_id: 'p-user', control_token: 'user-token' });

        expect(response.status).toBe(200);
        expect(response.body.minutes).toBe('整理済み議事録');
        expect(response.body.summary).toBe('会議の要約');
        expect(response.body.todo).toBe('TODO一覧');
        expect(response.body.speaker_summaries).toEqual([
            { speaker: 'Alice', summary: '進捗共有と課題整理を担当した' }
        ]);
        expect(response.body.actions).toHaveLength(1);
    });

    test('POST /rooms/:id/shared-ai/:type should reject non-host participants', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                owner_id: 'host-user'
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-guest',
                room_id: 'room-1',
                user_id: 'guest-user',
                display_name: 'Guest',
                control_token: 'guest-token'
            })),
            findByRoomId: jest.fn(async () => [])
        };
        const app = createApp({
            roomRepo,
            participantRepo,
            utteranceRepo: {},
            aiService: { enabled: true }
        });

        const response = await request(app)
            .post('/rooms/room-1/shared-ai/summary')
            .send({ participant_id: 'p-guest', control_token: 'guest-token' });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/[Hh]ost/);
    });

    test('POST /rooms/:id/shared-ai/summary should require minutes first', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                owner_id: 'host-user',
                minutes_text: ''
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-host',
                room_id: 'room-1',
                user_id: 'host-user',
                display_name: 'Host',
                control_token: 'host-token'
            })),
            findByRoomId: jest.fn(async () => [])
        };
        const app = createApp({
            roomRepo,
            participantRepo,
            utteranceRepo: {},
            aiService: { enabled: true }
        });

        const response = await request(app)
            .post('/rooms/room-1/shared-ai/summary')
            .send({ participant_id: 'p-host', control_token: 'host-token' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('Minutes must be generated first');
    });

    test('POST /rooms/:id/shared-ai/minutes should persist host-generated minutes', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                owner_id: 'host-user',
                minutes_updated_at: '2026-04-08T11:00:00Z'
            })),
            updateInsights: jest.fn(async () => ({
                id: 'room-1',
                minutes_text: '生成済み議事録'
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-host',
                room_id: 'room-1',
                user_id: 'host-user',
                display_name: 'Host',
                control_token: 'host-token'
            })),
            findByRoomId: jest.fn(async () => ([
                { id: 'p-host', room_id: 'room-1', user_id: 'host-user', display_name: 'Host', control_token: 'host-token' }
            ]))
        };
        const utteranceRepo = {
            findByRoomIdWithParticipants: jest.fn(async () => ([
                { display_name: 'Host', transcript: '今日は仕様を確認しました', started_at: '2026-04-08T10:00:00Z' }
            ]))
        };
        const aiService = {
            enabled: true,
            generateMinutesFromTranscript: jest.fn(async () => ({
                result: '生成済み議事録'
            }))
        };

        const app = createApp({
            roomRepo,
            participantRepo,
            utteranceRepo,
            aiService
        });

        const response = await request(app)
            .post('/rooms/room-1/shared-ai/minutes')
            .send({ participant_id: 'p-host', control_token: 'host-token' });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('生成済み議事録');
        expect(roomRepo.updateInsights).toHaveBeenCalledWith('room-1', expect.objectContaining({
            minutes_text: '生成済み議事録'
        }));
    });

    test('GET/POST /rooms/:id/custom-output should persist and return saved custom output', async () => {
        const add = jest.fn(async () => {});
        const findLatestByTypes = jest.fn(async (_roomId, types) => {
            if (!types.includes('custom_saved')) return null;
            return {
                result_text: JSON.stringify({
                    instruction: '箇条書きで整理してください',
                    result: '整理結果'
                }),
                created_at: '2026-04-08T13:00:00Z'
            };
        });
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-user',
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'Alice',
                control_token: 'user-token'
            }))
        };
        const app = createApp({
            analysisRepo: {
                add,
                findLatestByTypes
            },
            participantRepo
        });

        const saveResponse = await request(app)
            .post('/rooms/room-1/custom-output')
            .send({
                instruction: '箇条書きで整理してください',
                result: '整理結果',
                participant_id: 'p-user',
                control_token: 'user-token'
            });

        expect(saveResponse.status).toBe(200);
        expect(add).toHaveBeenCalled();

        const loadResponse = await request(app)
            .get('/rooms/room-1/custom-output')
            .query({ participant_id: 'p-user', control_token: 'user-token' });
        expect(loadResponse.status).toBe(200);
        expect(loadResponse.body.instruction).toBe('箇条書きで整理してください');
        expect(loadResponse.body.result).toBe('整理結果');
    });

    test('POST /rooms/:id/custom-ai should use saved minutes as context', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                minutes_text: '整理済み議事録'
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-user',
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'Alice',
                control_token: 'user-token'
            })),
            findByRoomId: jest.fn(async () => [])
        };
        const aiService = {
            enabled: true,
            generateCustomFromMinutes: jest.fn(async () => ({
                result: '議事録ベースの自由解析',
                provider: 'gemini'
            }))
        };
        const app = createApp({ roomRepo, participantRepo, aiService });

        const response = await request(app)
            .post('/rooms/room-1/custom-ai')
            .send({
                instruction: 'リスク観点で整理してください',
                participant_id: 'p-user',
                control_token: 'user-token'
            });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('議事録ベースの自由解析');
        expect(aiService.generateCustomFromMinutes).toHaveBeenCalledWith(
            '整理済み議事録',
            'リスク観点で整理してください',
            expect.any(Array), // participants
            expect.any(Array), // userContexts
            expect.any(Object) // aiConfig
        );
    });

    test('POST /rooms/:id/custom-ai should reject invalid participant tokens', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                minutes_text: '整理済み議事録'
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => null)
        };
        const aiService = { enabled: true };
        const app = createApp({ roomRepo, participantRepo, aiService });

        const response = await request(app)
            .post('/rooms/room-1/custom-ai')
            .send({
                instruction: '整理してください',
                participant_id: 'p-user',
                control_token: 'invalid'
            });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Participant validation failed');
    });

    test('POST /rooms/:id/custom-ai should reject when minutes do not exist', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                minutes_text: ''
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-user',
                room_id: 'room-1',
                user_id: 'user-1',
                display_name: 'Alice',
                control_token: 'user-token'
            }))
        };
        const aiService = { enabled: true };
        const app = createApp({ roomRepo, participantRepo, aiService });

        const response = await request(app)
            .post('/rooms/room-1/custom-ai')
            .send({
                instruction: '整理してください',
                participant_id: 'p-user',
                control_token: 'user-token'
            });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('Minutes must be generated first');
    });

    test('POST /rooms/:id/end should trigger automatic shared minutes, summary, and todo generation', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                owner_id: 'host-user',
                minutes_text: '生成された議事録',
                status: 'ended'
            })),
            endRoom: jest.fn(async () => ({})),
            updateInsights: jest.fn(async (_roomId, updates) => ({
                id: 'room-1',
                owner_id: 'host-user',
                minutes_text: updates.minutes_text || '生成された議事録',
                summary_text: updates.summary_text || '生成された要約',
                todo_text: updates.todo_text || '生成されたTODO',
                minutes_updated_at: '2026-04-16T10:00:00Z',
                summary_updated_at: '2026-04-16T10:01:00Z',
                todo_updated_at: '2026-04-16T10:02:00Z',
                insights_status: updates.insights_status || 'ready',
                insights_dirty: updates.insights_dirty ?? false
            }))
        };
        const participantRepo = {
            findByIdAndToken: jest.fn(async () => ({
                id: 'p-host',
                room_id: 'room-1',
                user_id: 'host-user',
                display_name: 'Host',
                control_token: 'host-token'
            })),
            findByRoomId: jest.fn(async () => ([
                { id: 'p-host', room_id: 'room-1', user_id: 'host-user', display_name: 'Host', control_token: 'host-token' }
            ]))
        };
        const utteranceRepo = {
            findByRoomIdWithParticipants: jest.fn(async () => ([
                { display_name: 'Host', transcript: '議事録の元になる発言', started_at: '2026-04-16T09:00:00Z' }
            ]))
        };
        const aiService = {
            enabled: true,
            generateMinutesFromTranscript: jest.fn(async () => ({ result: '生成された議事録' })),
            generateSummaryFromMinutes: jest.fn(async () => ({ result: '生成された要約' })),
            generateTodoFromMinutes: jest.fn(async () => ({ result: '生成されたTODO' }))
        };

        const app = createApp({
            roomRepo,
            participantRepo,
            utteranceRepo,
            aiService
        });

        const response = await request(app)
            .post('/rooms/room-1/end')
            .send({
                participant_id: 'p-host',
                control_token: 'host-token'
            });

        expect(response.status).toBe(200);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(roomRepo.endRoom).toHaveBeenCalledWith('room-1');
        expect(aiService.generateMinutesFromTranscript).toHaveBeenCalled();
        expect(aiService.generateSummaryFromMinutes).toHaveBeenCalledWith(
            '生成された議事録',
            expect.any(Array),
            expect.any(Array),
            expect.any(Object)
        );
        expect(aiService.generateTodoFromMinutes).toHaveBeenCalledWith(
            '生成された議事録',
            expect.any(Array),
            expect.any(Array),
            expect.any(Object)
        );
        expect(roomRepo.updateInsights).toHaveBeenCalledWith('room-1', expect.objectContaining({
            insights_status: 'processing'
        }));
        expect(roomRepo.updateInsights).toHaveBeenCalledWith('room-1', expect.objectContaining({
            insights_status: 'ready',
            insights_dirty: false
        }));
    });
});
