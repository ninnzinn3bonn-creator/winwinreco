const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/backend/app');
const { shouldChunk } = require('../src/backend/services/chunking');

const minutesScenarios = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/minutes/scenarios.json'), 'utf8')
);

function expandMinutesScenario(key) {
    const scenario = minutesScenarios[key];
    const startMs = new Date(scenario.startedAt).getTime();
    if (Array.isArray(scenario.utterances)) {
        return scenario.utterances.map((utterance) => ({
            ...utterance,
            started_at: new Date(startMs + (utterance.offsetMs || 0)).toISOString()
        }));
    }
    const generated = scenario.generatedUtterances || {};
    return Array.from({ length: generated.count || 0 }, (_, index) => ({
        id: `${key}-${index}`,
        display_name: generated.speakers[index % generated.speakers.length],
        transcript: `${generated.transcriptTemplate} ${index + 1}`,
        started_at: new Date(startMs + index * generated.intervalMs).toISOString()
    }));
}

function buildMinutesHarness({
    scenarioKey,
    roomOverrides = {},
    aiServiceOverrides = {},
    chunkRepo = null,
    wss = null
}) {
    const scenario = minutesScenarios[scenarioKey];
    const utterances = expandMinutesScenario(scenarioKey);
    const room = {
        id: scenario.roomId,
        owner_id: 'host-user',
        owner_account_id: 'account-host',
        use_past_meetings: 1,
        stt_provider: 'elevenlabs',
        ...roomOverrides
    };
    const roomState = { ...room };
    const participantRepo = {
        findByIdAndToken: jest.fn(async () => ({
            id: 'p-host',
            room_id: scenario.roomId,
            user_id: 'host-user',
            display_name: 'Host',
            control_token: 'host-token'
        })),
        findByRoomId: jest.fn(async () => ([
            { id: 'p-host', room_id: scenario.roomId, user_id: 'host-user', display_name: 'Host', control_token: 'host-token' },
            { id: 'p-alice', room_id: scenario.roomId, user_id: 'alice-user', display_name: 'Alice', control_token: 'alice-token' },
            { id: 'p-bob', room_id: scenario.roomId, user_id: 'bob-user', display_name: 'Bob', control_token: 'bob-token' }
        ]))
    };
    const roomRepo = {
        findById: jest.fn(async () => roomState),
        findEndedRoomsForAccount: jest.fn(async () => ([
            {
                id: 'past-room',
                ended_at: '2026-06-01T00:00:00.000Z',
                summary_text: '過去会議の要約。議事録生成には混ぜない。',
                minutes_text: '過去会議の議事録。'
            }
        ])),
        endRoom: jest.fn(async () => {
            roomState.status = 'ended';
            roomState.ended_at = '2026-06-30T16:30:00.000Z';
            return { ...roomState };
        }),
        updateInsights: jest.fn(async (_roomId, updates) => {
            Object.assign(roomState, updates);
            return {
                ...roomState,
                minutes_updated_at: '2026-06-30T16:00:00.000Z',
                summary_updated_at: '2026-06-30T16:01:00.000Z',
                todo_updated_at: '2026-06-30T16:02:00.000Z'
            };
        })
    };
    const utteranceRepo = {
        findByRoomIdWithParticipants: jest.fn(async () => utterances)
    };
    const userRepo = {
        findById: jest.fn(async (id) => ({
            id,
            profile_text: `profile for ${id}`
        }))
    };
    const userContextRepo = {
        findByUserIds: jest.fn(async () => ([
            {
                user_id: 'host-user',
                project_summary: '過去状態',
                current_status: '議事録生成中',
                active_tasks: ['この情報は議事録 prompt へ渡さない']
            }
        ]))
    };
    const baseAiService = {
        enabled: true,
        generateMinutesFromTranscript: jest.fn(async () => ({ result: '短時間会議の議事録' })),
        generateMinutesPerChunk: jest.fn(async (chunk) => ({
            chunkIndex: chunk.index,
            startTs: chunk.startTs,
            endTs: chunk.endTs,
            overlapWith: chunk.overlapWith,
            result: `chunk-${chunk.index}`,
            provider: 'groq (mock)'
        })),
        mergeMinutesChunks: jest.fn((chunkResults) =>
            [...chunkResults]
                .sort((a, b) => a.chunkIndex - b.chunkIndex)
                .map((item) => item.result)
                .join('\n\n')
        ),
        generateSummaryFromMinutes: jest.fn(async () => ({ result: '終了後AI要約' })),
        generateTodoFromMinutes: jest.fn(async () => ({ result: '終了後AITODO' })),
        ...aiServiceOverrides
    };
    const app = createApp({
        roomRepo,
        participantRepo,
        utteranceRepo,
        userRepo,
        userContextRepo,
        aiService: baseAiService,
        chunkRepo,
        wss
    });
    return {
        app,
        scenario,
        roomRepo,
        participantRepo,
        utteranceRepo,
        userContextRepo,
        aiService: baseAiService,
        utterances
    };
}

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

    test('M1-A: short post-meeting minutes use fixed provider metadata and exclude past context', async () => {
        const harness = buildMinutesHarness({
            scenarioKey: 'short',
            roomOverrides: {
                // room-level past context is intentionally enabled here so the
                // test proves minutes generation strips it before calling AI.
                owner_account_id: 'account-host',
                use_past_meetings: 1
            }
        });

        expect(shouldChunk(harness.utterances)).toBe(false);

        const response = await request(harness.app)
            .post(`/rooms/${harness.scenario.roomId}/shared-ai/minutes`)
            .send({
                participant_id: 'p-host',
                control_token: 'host-token',
                use_past_context: true
            });

        expect(response.status).toBe(200);
        expect(response.body.result).toBe('短時間会議の議事録');
        expect(response.body.chunk_total).toBe(0);
        expect(response.body.chunk_failed).toBe(0);
        expect(response.body.chunk_status).toEqual([]);
        expect(harness.roomRepo.findEndedRoomsForAccount).toHaveBeenCalled();
        expect(harness.userContextRepo.findByUserIds).toHaveBeenCalled();
        expect(harness.aiService.generateMinutesFromTranscript).toHaveBeenCalledTimes(1);
        expect(harness.aiService.generateMinutesPerChunk).not.toHaveBeenCalled();

        const [
            passedUtterances,
            roomMeta,
            participants,
            userContexts,
            aiConfig
        ] = harness.aiService.generateMinutesFromTranscript.mock.calls[0];

        expect(passedUtterances).toEqual(harness.utterances);
        expect(roomMeta).toEqual(expect.objectContaining({
            roomId: harness.scenario.roomId,
            stt_provider: 'elevenlabs'
        }));
        expect(participants.map((participant) => participant.display_name)).toEqual(['Host', 'Alice', 'Bob']);
        expect(userContexts).toEqual([]);
        expect(aiConfig).toEqual(expect.objectContaining({
            provider: 'groq',
            model: 'openai/gpt-oss-120b'
        }));
        expect(aiConfig).not.toHaveProperty('pastContextBlock');
    });

    test('M1-A: long post-meeting minutes use chunk path, persist chunks, and emit progress', async () => {
        const chunkRepo = {
            upsert: jest.fn(async () => {})
        };
        const wsClient = {
            readyState: 1,
            send: jest.fn()
        };
        const wss = {
            rooms: new Map([
                [minutesScenarios.long90.roomId, new Set([wsClient])]
            ])
        };
        const harness = buildMinutesHarness({
            scenarioKey: 'long90',
            chunkRepo,
            wss
        });

        expect(shouldChunk(harness.utterances)).toBe(true);

        const response = await request(harness.app)
            .post(`/rooms/${harness.scenario.roomId}/shared-ai/minutes`)
            .send({
                participant_id: 'p-host',
                control_token: 'host-token',
                use_past_context: true
            });

        const chunkCallCount = harness.aiService.generateMinutesPerChunk.mock.calls.length;
        expect(response.status).toBe(200);
        expect(chunkCallCount).toBeGreaterThan(1);
        expect(harness.aiService.generateMinutesFromTranscript).not.toHaveBeenCalled();
        expect(harness.aiService.mergeMinutesChunks).toHaveBeenCalledTimes(1);
        expect(chunkRepo.upsert).toHaveBeenCalledTimes(chunkCallCount);
        expect(chunkRepo.upsert.mock.calls.every(([row]) => row.status === 'done')).toBe(true);

        const [firstChunk, totalChunks, roomMeta, _participants, userContexts, aiConfig] =
            harness.aiService.generateMinutesPerChunk.mock.calls[0];
        expect(firstChunk.index).toBe(0);
        expect(totalChunks).toBe(chunkCallCount);
        expect(roomMeta.stt_provider).toBe('elevenlabs');
        expect(userContexts).toEqual([]);
        expect(aiConfig).toEqual(expect.objectContaining({
            provider: 'groq',
            model: 'openai/gpt-oss-120b'
        }));
        expect(aiConfig).not.toHaveProperty('pastContextBlock');

        const progressMessages = wsClient.send.mock.calls
            .map(([payload]) => JSON.parse(payload))
            .filter((message) => message.type === 'chunk_progress' && message.analysis_type === 'minutes');
        expect(progressMessages[0]).toEqual(expect.objectContaining({
            completed: 0,
            total: chunkCallCount
        }));
        expect(progressMessages[progressMessages.length - 1]).toEqual(expect.objectContaining({
            completed: chunkCallCount,
            total: chunkCallCount
        }));
        expect(response.body.chunk_total).toBe(chunkCallCount);
        expect(response.body.chunk_failed).toBe(0);
        expect(response.body.chunk_status).toHaveLength(chunkCallCount);
        expect(response.body.chunk_status.every((chunk) => chunk.status === 'done')).toBe(true);
        expect(response.body.result).toContain('chunk-0');
    });

    test('M1-A: chunk partial failure is persisted as error and remains visible in merged minutes', async () => {
        const failChunkIndex = minutesScenarios.partialFailure.failChunkIndex;
        const chunkRepo = {
            upsert: jest.fn(async () => {})
        };
        const generateMinutesPerChunk = jest.fn(async (chunk) => {
            if (chunk.index === failChunkIndex) {
                return {
                    chunkIndex: chunk.index,
                    startTs: chunk.startTs,
                    endTs: chunk.endTs,
                    overlapWith: chunk.overlapWith,
                    result: `[このチャンクの解析に失敗しました: 範囲 ${chunk.startTs}〜${chunk.endTs}]`,
                    provider: 'error'
                };
            }
            return {
                chunkIndex: chunk.index,
                startTs: chunk.startTs,
                endTs: chunk.endTs,
                overlapWith: chunk.overlapWith,
                result: `ok-${chunk.index}`,
                provider: 'groq (mock)'
            };
        });
        const harness = buildMinutesHarness({
            scenarioKey: 'partialFailure',
            chunkRepo,
            aiServiceOverrides: { generateMinutesPerChunk }
        });

        expect(shouldChunk(harness.utterances)).toBe(true);

        const response = await request(harness.app)
            .post(`/rooms/${harness.scenario.roomId}/shared-ai/minutes`)
            .send({
                participant_id: 'p-host',
                control_token: 'host-token'
            });

        expect(response.status).toBe(200);
        expect(response.body.result).toContain('解析に失敗しました');
        expect(response.body.chunk_failed).toBe(1);
        expect(response.body.chunk_status).toContainEqual(expect.objectContaining({
            chunk_index: failChunkIndex,
            status: 'error'
        }));

        const persistedRows = chunkRepo.upsert.mock.calls.map(([row]) => row);
        const failedRow = persistedRows.find((row) => row.chunk_index === failChunkIndex);
        expect(failedRow).toEqual(expect.objectContaining({
            status: 'error',
            result_text: expect.stringContaining('解析に失敗しました')
        }));
        expect(persistedRows.filter((row) => row.status === 'done').length).toBeGreaterThan(0);
        expect(harness.roomRepo.updateInsights).toHaveBeenCalledWith(
            harness.scenario.roomId,
            expect.objectContaining({
                minutes_text: expect.stringContaining('解析に失敗しました')
            })
        );
    });

    test('M1-B: chunks endpoint returns partial-failure metadata for warning UI', async () => {
        const chunkRows = [
            {
                chunk_index: 0,
                analysis_type: 'minutes',
                start_ts: '2026-06-30T10:00:00.000Z',
                end_ts: '2026-06-30T10:10:00.000Z',
                result_text: 'ok-0',
                status: 'done'
            },
            {
                chunk_index: 1,
                analysis_type: 'minutes',
                start_ts: '2026-06-30T10:10:00.000Z',
                end_ts: '2026-06-30T10:20:00.000Z',
                result_text: '[このチャンクの解析に失敗しました]',
                status: 'error'
            }
        ];
        const chunkRepo = {
            findByRoom: jest.fn(async () => chunkRows)
        };
        const harness = buildMinutesHarness({
            scenarioKey: 'partialFailure',
            chunkRepo
        });

        const response = await request(harness.app)
            .get(`/rooms/${harness.scenario.roomId}/chunks`)
            .query({
                participant_id: 'p-host',
                control_token: 'host-token'
            });

        expect(response.status).toBe(200);
        expect(chunkRepo.findByRoom).toHaveBeenCalledWith(harness.scenario.roomId, 'minutes');
        expect(response.body.chunks).toEqual(chunkRows);
        expect(response.body.chunk_total).toBe(2);
        expect(response.body.chunk_failed).toBe(1);
        expect(response.body.chunk_status).toEqual([
            expect.objectContaining({ chunk_index: 0, status: 'done', has_result: true }),
            expect.objectContaining({ chunk_index: 1, status: 'error', has_result: true })
        ]);
    });

    test('post-meeting AI: short transcript completes minutes, summary, and todo without chunking', async () => {
        const harness = buildMinutesHarness({ scenarioKey: 'short' });

        expect(shouldChunk(harness.utterances)).toBe(false);

        const response = await request(harness.app)
            .post(`/rooms/${harness.scenario.roomId}/end`)
            .send({
                participant_id: 'p-host',
                control_token: 'host-token'
            });

        expect(response.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(harness.roomRepo.endRoom).toHaveBeenCalledWith(harness.scenario.roomId);
        expect(harness.aiService.generateMinutesFromTranscript).toHaveBeenCalledTimes(1);
        expect(harness.aiService.generateMinutesPerChunk).not.toHaveBeenCalled();
        expect(harness.aiService.generateSummaryFromMinutes).toHaveBeenCalledWith(
            '短時間会議の議事録',
            expect.any(Array),
            expect.any(Array),
            expect.objectContaining({ provider: 'groq', model: 'openai/gpt-oss-120b' })
        );
        expect(harness.aiService.generateTodoFromMinutes).toHaveBeenCalledWith(
            '短時間会議の議事録',
            expect.any(Array),
            expect.any(Array),
            expect.objectContaining({ provider: 'groq', model: 'openai/gpt-oss-120b' })
        );
        expect(harness.roomRepo.updateInsights).toHaveBeenCalledWith(
            harness.scenario.roomId,
            expect.objectContaining({ summary_text: '終了後AI要約' })
        );
        expect(harness.roomRepo.updateInsights).toHaveBeenCalledWith(
            harness.scenario.roomId,
            expect.objectContaining({ todo_text: '終了後AITODO' })
        );
    });

    test('post-meeting AI: long transcript chunks minutes then completes summary and todo', async () => {
        const chunkRepo = {
            upsert: jest.fn(async () => {})
        };
        const harness = buildMinutesHarness({
            scenarioKey: 'long90',
            chunkRepo
        });

        expect(shouldChunk(harness.utterances)).toBe(true);

        const response = await request(harness.app)
            .post(`/rooms/${harness.scenario.roomId}/end`)
            .send({
                participant_id: 'p-host',
                control_token: 'host-token'
            });

        expect(response.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 30));

        const chunkCallCount = harness.aiService.generateMinutesPerChunk.mock.calls.length;
        expect(chunkCallCount).toBeGreaterThan(1);
        expect(harness.aiService.generateMinutesFromTranscript).not.toHaveBeenCalled();
        expect(harness.aiService.mergeMinutesChunks).toHaveBeenCalledTimes(1);
        expect(chunkRepo.upsert).toHaveBeenCalledTimes(chunkCallCount);

        const mergedMinutes = [...Array(chunkCallCount).keys()].map((index) => `chunk-${index}`).join('\n\n');
        expect(harness.aiService.generateSummaryFromMinutes).toHaveBeenCalledWith(
            mergedMinutes,
            expect.any(Array),
            expect.any(Array),
            expect.objectContaining({ provider: 'groq', model: 'openai/gpt-oss-120b' })
        );
        expect(harness.aiService.generateTodoFromMinutes).toHaveBeenCalledWith(
            mergedMinutes,
            expect.any(Array),
            expect.any(Array),
            expect.objectContaining({ provider: 'groq', model: 'openai/gpt-oss-120b' })
        );
        expect(harness.roomRepo.updateInsights).toHaveBeenCalledWith(
            harness.scenario.roomId,
            expect.objectContaining({ minutes_text: mergedMinutes })
        );
        expect(harness.roomRepo.updateInsights).toHaveBeenCalledWith(
            harness.scenario.roomId,
            expect.objectContaining({ insights_status: 'ready', insights_dirty: false })
        );
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
