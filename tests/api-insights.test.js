const request = require('supertest');
const { createApp } = require('../src/backend/app');

describe('Insights API', () => {
    test('GET /rooms/:id/insights should return room summary, speaker summaries, and speaker actions', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({
                id: 'room-1',
                summary_text: '会議の要約',
                summary_updated_at: '2026-03-26T12:00:00Z',
                insights_status: 'ready',
                insights_dirty: 1
            }))
        };
        const actionRepo = {
            findByRoomId: jest.fn(async () => ([
                {
                    id: 'act-1',
                    room_id: 'room-1',
                    speaker_id: 'user-1',
                    speaker_name: 'Alice',
                    action_text: '仕様確認を進める'
                }
            ]))
        };
        const analysisRepo = {
            findLatestByTypes: jest.fn(async (_roomId, types) => {
                if (types.includes('speaker_summaries')) {
                    return {
                        result_text: JSON.stringify([
                            { speaker: 'Alice', summary: '進捗共有と課題整理を担当している。' }
                        ])
                    };
                }
                return null;
            })
        };
        const app = createApp({ roomRepo, actionRepo, analysisRepo });

        const response = await request(app).get('/rooms/room-1/insights');

        expect(response.status).toBe(200);
        expect(response.body.summary).toBe('会議の要約');
        expect(response.body.speaker_summaries).toEqual([
            { speaker: 'Alice', summary: '進捗共有と課題整理を担当している。' }
        ]);
        expect(response.body.actions).toHaveLength(1);
    });

    test('POST /rooms/:id/insights/regenerate should mark processing and return 202', async () => {
        const roomRepo = {
            findById: jest.fn(async () => ({ id: 'room-1' })),
            updateInsights: jest.fn(async () => ({ id: 'room-1', insights_status: 'processing' }))
        };
        const app = createApp({
            roomRepo,
            utteranceRepo: {
                findByRoomIdWithParticipants: jest.fn(async () => [])
            },
            participantRepo: {
                findByRoomId: jest.fn(async () => [])
            },
            userContextRepo: {
                findByUserIds: jest.fn(async () => []),
                upsert: jest.fn(async () => ({}))
            },
            analysisRepo: {
                add: jest.fn(async () => {}),
                findLatestByTypes: jest.fn(async () => null)
            },
            actionRepo: {
                findByRoomId: jest.fn(async () => []),
                replaceForRoom: jest.fn(async () => {})
            },
            aiService: {
                enabled: true,
                generateStructuredInsights: jest.fn(async () => ({
                    overall_summary: '要約',
                    speaker_summaries: [],
                    next_actions: [],
                    flat_actions: [],
                    prompt: 'prompt',
                    provider: 'test'
                })),
                updateUserContexts: jest.fn(async () => [])
            }
        });

        const response = await request(app)
            .post('/rooms/room-1/insights/regenerate')
            .send({});

        expect(response.status).toBe(202);
        expect(response.body.status).toBe('processing');
    });

    test('GET/POST /rooms/:id/custom-output should persist and return saved custom output', async () => {
        const add = jest.fn(async () => {});
        const findLatestByTypes = jest.fn(async (_roomId, types) => {
            if (!types.includes('custom_saved')) return null;
            return {
                result_text: JSON.stringify({
                    instruction: '論点ごとに整理して',
                    result: '整理結果'
                }),
                created_at: '2026-03-26T13:00:00Z'
            };
        });
        const app = createApp({
            analysisRepo: {
                add,
                findLatestByTypes
            }
        });

        const saveResponse = await request(app)
            .post('/rooms/room-1/custom-output')
            .send({
                instruction: '論点ごとに整理して',
                result: '整理結果'
            });

        expect(saveResponse.status).toBe(200);
        expect(add).toHaveBeenCalled();

        const loadResponse = await request(app).get('/rooms/room-1/custom-output');
        expect(loadResponse.status).toBe(200);
        expect(loadResponse.body.instruction).toBe('論点ごとに整理して');
        expect(loadResponse.body.result).toBe('整理結果');
    });

    test('GET /rooms/:id/user-contexts should return room participants with lightweight contexts', async () => {
        const app = createApp({
            participantRepo: {
                findByRoomId: jest.fn(async () => ([
                    { id: 'p-1', user_id: 'user-1', display_name: 'Alice' }
                ]))
            },
            userContextRepo: {
                findByUserIds: jest.fn(async () => ([
                    {
                        user_id: 'user-1',
                        project_summary: '研究A',
                        current_status: '進行中',
                        active_tasks: ['検証する']
                    }
                ]))
            }
        });

        const response = await request(app).get('/rooms/room-1/user-contexts');
        expect(response.status).toBe(200);
        expect(response.body[0].name).toBe('Alice');
        expect(response.body[0].context.project_summary).toBe('研究A');
        expect(response.body[0].context.active_tasks).toEqual(['検証する']);
    });
});
