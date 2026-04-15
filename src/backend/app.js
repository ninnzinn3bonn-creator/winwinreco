const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

function generateShortRoomId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i += 1) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
}

async function enrichParticipantsWithProfiles(participantRepo, userRepo, roomId) {
    const participants = participantRepo ? await participantRepo.findByRoomId(roomId) : [];
    if (!userRepo) {
        return participants.map((participant) => ({ ...participant, profile_text: '' }));
    }

    return Promise.all(participants.map(async (participant) => {
        if (!participant.user_id) {
            return { ...participant, profile_text: '' };
        }
        const user = await userRepo.findById(participant.user_id);
        return {
            ...participant,
            profile_text: user?.profile_text || ''
        };
    }));
}

function collectSpeechHints(participants = []) {
    const phrases = new Set();

    participants.forEach((participant) => {
        if (participant.display_name) {
            phrases.add(String(participant.display_name).trim());
        }

        const profileText = String(participant.profile_text || '');
        profileText
            .split(/[\n、。,.\/／;；:：]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2 && token.length <= 32)
            .slice(0, 8)
            .forEach((token) => phrases.add(token));
    });

    return Array.from(phrases).slice(0, 40);
}

function generateControlToken() {
    return crypto.randomBytes(24).toString('hex');
}

function createApp(repositories = {}) {
    const app = express();
    app.use(express.json());
    app.use(express.static('src/frontend'));

    const { roomRepo, participantRepo, utteranceRepo, analysisRepo, actionRepo, userRepo, userContextRepo, aiService } = repositories;

    async function authorizeParticipant(roomId, participantId, controlToken) {
        if (!participantRepo || !participantId || !controlToken) {
            return null;
        }

        const participant = typeof participantRepo.findByIdAndToken === 'function'
            ? await participantRepo.findByIdAndToken(participantId, controlToken)
            : await participantRepo.findById(participantId);

        if (!participant || participant.room_id !== roomId) {
            return null;
        }

        if (participant.control_token && participant.control_token !== controlToken) {
            return null;
        }

        return participant;
    }

    async function buildInsightsResponse(roomId) {
        const [room, actions, speakerSummaryAnalysis] = await Promise.all([
            roomRepo ? roomRepo.findById(roomId) : null,
            actionRepo ? actionRepo.findByRoomId(roomId) : [],
            analysisRepo ? analysisRepo.findLatestByTypes(roomId, ['speaker_summaries']) : null
        ]);

        let speakerSummaries = [];
        if (speakerSummaryAnalysis?.result_text) {
            try {
                speakerSummaries = JSON.parse(speakerSummaryAnalysis.result_text);
            } catch (error) {
                speakerSummaries = [];
            }
        }

        return {
            summary: room?.summary_text || '',
            summary_updated_at: room?.summary_updated_at || null,
            minutes: room?.minutes_text || '',
            minutes_updated_at: room?.minutes_updated_at || null,
            todo: room?.todo_text || '',
            todo_updated_at: room?.todo_updated_at || null,
            status: room?.insights_status || 'idle',
            dirty: !!room?.insights_dirty,
            actions: actions || [],
            speaker_summaries: speakerSummaries
        };
    }

    async function generateInsightsForRoom(roomId, aiConfig = null) {
        if (!roomRepo || !utteranceRepo || !participantRepo || !actionRepo) {
            throw new Error('Repositories required for insight generation are unavailable');
        }

        let activeAiService = aiService;
        if (aiConfig && aiConfig.provider) {
            const { AIService: AIServiceClass } = require('./services/ai-service');
            activeAiService = new AIServiceClass({
                provider: aiConfig.provider,
                geminiModel: aiConfig.provider === 'gemini' ? aiConfig.model : null,
                ollamaModel: aiConfig.provider === 'ollama' ? aiConfig.model : null,
                apiKey: process.env.GEMINI_API_KEY
            });
        }

        if (!activeAiService || !activeAiService.enabled) {
            throw new Error('AI Service is not configured or disabled.');
        }

        await roomRepo.updateInsights(roomId, {
            insights_status: 'processing'
        });

        try {
            const [utterances, participants] = await Promise.all([
                utteranceRepo.findByRoomIdWithParticipants(roomId),
                enrichParticipantsWithProfiles(participantRepo, userRepo, roomId)
            ]);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];

            const structured = await activeAiService.generateStructuredInsights(utterances, participants, userContexts);
            const summaryText = structured.overall_summary;
            const generatedActions = structured.flat_actions;

            await roomRepo.updateInsights(roomId, {
                summary_text: summaryText,
                insights_status: 'ready',
                insights_dirty: false
            });

            await actionRepo.replaceForRoom(roomId, generatedActions.map((action, index) => ({
                id: `act-${Date.now()}-${index}`,
                speaker_id: action.speaker_id || null,
                speaker_name: action.speaker_name || '',
                action_text: action.action_text || ''
            })));

            if (userContextRepo && participants.length) {
                const updatedContexts = await activeAiService.updateUserContexts(participants, userContexts, utterances);
                for (const context of updatedContexts) {
                    if (!context.user_id) continue;
                    await userContextRepo.upsert({
                        user_id: context.user_id,
                        project_summary: context.project_summary || '',
                        current_status: context.current_status || '',
                        active_tasks: Array.isArray(context.active_tasks) ? context.active_tasks : [],
                        last_updated: new Date().toISOString()
                    });
                }
            }

            if (analysisRepo) {
                await analysisRepo.add({
                    id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}-summary`,
                    room_id: roomId,
                    type: 'summary',
                    input_prompt: structured.prompt,
                    result_text: summaryText
                });
                await analysisRepo.add({
                    id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}-speaker-summaries`,
                    room_id: roomId,
                    type: 'speaker_summaries',
                    input_prompt: structured.prompt,
                    result_text: JSON.stringify(structured.speaker_summaries)
                });
                await analysisRepo.add({
                    id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}-speaker-actions`,
                    room_id: roomId,
                    type: 'speaker_actions',
                    input_prompt: structured.prompt,
                    result_text: JSON.stringify(generatedActions)
                });
                if (userContextRepo) {
                    const latestContexts = await userContextRepo.findByUserIds(userIds);
                    await analysisRepo.add({
                        id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}-user-contexts`,
                        room_id: roomId,
                        type: 'user_contexts',
                        input_prompt: 'context update',
                        result_text: JSON.stringify(latestContexts)
                    });
                }
            }

            return buildInsightsResponse(roomId);
        } catch (error) {
            await roomRepo.updateInsights(roomId, {
                insights_status: 'error',
                insights_dirty: true
            });
            throw error;
        }
    }

    app.get('/', (req, res) => {
        res.status(200).send('Meeting Minutes API');
    });

    // GET /api/status - Check if API keys are configured properly
    app.get('/api/status', (req, res) => {
        const status = {
            google_stt: !!process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'dummy',
            gemini_ai: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy'
        };
        res.status(200).json(status);
    });

    app.get('/rooms/:id/logs', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            res.status(200).json(logs);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });

    app.get('/rooms/:id/memory', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const logs = await utteranceRepo.findStarredByRoomId(roomId);
            res.status(200).json(logs);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to fetch starred logs' });
        }
    });

    app.get('/rooms/:id/insights', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            res.status(200).json(await buildInsightsResponse(roomId));
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to fetch insights' });
        }
    });

    app.get('/rooms/:id/user-contexts', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const contexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
            const contextMap = new Map(contexts.map((context) => [context.user_id, context]));

            res.status(200).json(participants.map((participant) => ({
                user_id: participant.user_id,
                name: participant.display_name,
                profile_text: participant.profile_text || '',
                context: contextMap.get(participant.user_id) || null
            })));
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to fetch user contexts' });
        }
    });

    app.patch('/users/:id/context', async (req, res) => {
        try {
            const { id: userId } = req.params;
            if (!userContextRepo) {
                return res.status(503).json({ error: 'User context repository is unavailable' });
            }

            const updated = await userContextRepo.upsert({
                user_id: userId,
                project_summary: req.body.project_summary || '',
                current_status: req.body.current_status || '',
                active_tasks: Array.isArray(req.body.active_tasks) ? req.body.active_tasks : [],
                last_updated: new Date().toISOString()
            });

            res.status(200).json(updated);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to update user context' });
        }
    });

    app.get('/rooms/:id/custom-output', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const latest = analysisRepo
                ? await analysisRepo.findLatestByTypes(roomId, ['custom_saved'])
                : null;

            if (!latest) {
                return res.status(200).json({
                    instruction: '',
                    result: '',
                    saved_at: null
                });
            }

            let payload = {};
            try {
                payload = JSON.parse(latest.result_text || '{}');
            } catch (error) {
                payload = { result: latest.result_text || '' };
            }

            res.status(200).json({
                mode: payload.mode || '',
                title: payload.title || '',
                instruction: payload.instruction || '',
                result: payload.result || '',
                saved_at: latest.created_at || null
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to fetch custom output' });
        }
    });

    app.post('/rooms/:id/custom-output', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { mode = '', title = '', instruction = '', result = '' } = req.body || {};

            if (!analysisRepo) {
                return res.status(503).json({ error: 'Analysis repository is unavailable' });
            }

            await analysisRepo.add({
                id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}-custom-saved`,
                room_id: roomId,
                type: 'custom_saved',
                input_prompt: instruction,
                result_text: JSON.stringify({
                    mode,
                    title,
                    instruction,
                    result
                })
            });

            res.status(200).json({
                mode,
                title,
                instruction,
                result,
                saved_at: new Date().toISOString()
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to save custom output' });
        }
    });

    app.post('/rooms/:id/insights/regenerate', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            await roomRepo.updateInsights(roomId, {
                insights_status: 'processing'
            });

            generateInsightsForRoom(roomId, req.body?.ai_config || null)
                .catch((generationError) => console.error('[Insights] Regeneration failed', generationError));

            res.status(202).json({
                status: 'processing'
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to start insight regeneration' });
        }
    });

    app.patch('/rooms/:roomId/logs/:utteranceId', async (req, res) => {
        try {
            const { roomId, utteranceId } = req.params;
            const existing = await utteranceRepo.findById(utteranceId);

            if (!existing || existing.room_id !== roomId) {
                return res.status(404).json({ error: 'Log not found' });
            }

            const updated = await utteranceRepo.updateMemory(utteranceId, {
                is_starred: req.body.is_starred,
                memory_note: req.body.memory_note,
                memo_text: req.body.memo_text,
                transcript: req.body.transcript,
                transcript_source: req.body.transcript_source
            });

            if (typeof req.body.transcript === 'string' && roomRepo) {
                await roomRepo.updateInsights(roomId, { insights_dirty: true });
            }

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const enriched = logs.find((log) => log.id === utteranceId) || updated;

            res.status(200).json(enriched);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to update log memory' });
        }
    });

    app.post('/rooms/:roomId/logs/:utteranceId/correct', async (req, res) => {
        try {
            const { roomId, utteranceId } = req.params;
            const existing = await utteranceRepo.findById(utteranceId);

            if (!existing || existing.room_id !== roomId) {
                return res.status(404).json({ error: 'Log not found' });
            }

            if (!aiService || !aiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            const roomLogs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const currentIndex = roomLogs.findIndex((log) => log.id === utteranceId);
            const contextLogs = roomLogs.filter((_, index) => Math.abs(index - currentIndex) <= 2);
            const target = roomLogs[currentIndex];

            const correction = await aiService.correctTranscript(target, contextLogs);
            const updated = await utteranceRepo.updateMemory(utteranceId, {
                transcript: correction.corrected,
                transcript_source: 'ai'
            });

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const enriched = logs.find((log) => log.id === utteranceId) || updated;

            res.status(200).json({ ...enriched, correction_provider: correction.provider });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to correct transcript' });
        }
    });

    app.post('/rooms/:roomId/correct', async (req, res) => {
        try {
            const { roomId } = req.params;
            const roomLogs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const { ai_config } = req.body || {};

            let activeAiService = aiService;
            if (ai_config && ai_config.provider) {
                const { AIService: AIServiceClass } = require('./services/ai-service');
                activeAiService = new AIServiceClass({
                    provider: ai_config.provider,
                    geminiModel: ai_config.provider === 'gemini' ? ai_config.model : null,
                    ollamaModel: ai_config.provider === 'ollama' ? ai_config.model : null,
                    apiKey: process.env.GEMINI_API_KEY
                });
            }

            if (!activeAiService || !activeAiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            const targets = roomLogs.filter((log) => log.transcript_source !== 'user');
            const updatedLogs = [];

            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                const currentIndex = roomLogs.findIndex((log) => log.id === target.id);
                const contextLogs = roomLogs.filter((_, ctxIndex) => Math.abs(ctxIndex - currentIndex) <= 2);
                const correction = await activeAiService.correctTranscript(target, contextLogs);
                const updated = await utteranceRepo.updateMemory(target.id, {
                    transcript: correction.corrected,
                    transcript_source: 'ai'
                });
                updatedLogs.push(updated);
            }

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            res.status(200).json({
                updated_count: updatedLogs.length,
                logs
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to run bulk correction' });
        }
    });

    // POST /rooms - Create a new room
    app.post('/rooms', async (req, res) => {
        try {
            const { owner_id } = req.body;
            let roomId = '';
            let exists = true;
            while (exists) {
                roomId = generateShortRoomId();
                exists = !!(await roomRepo.findById(roomId));
            }
            const room = { id: roomId, owner_id };
            
            await roomRepo.create(room);
            const createdRoom = await roomRepo.findById(roomId);
            
            res.status(201).json(createdRoom);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to create room' });
        }
    });

    // POST /rooms/:id/join - Join a room
    app.post('/rooms/:id/join', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { user_id, display_name, location_id, profile_text = '' } = req.body;

            const room = await roomRepo.findById(roomId);
            if (!room || room.status !== 'active') {
                return res.status(404).json({ error: 'Room not found or inactive' });
            }

            let resolvedUserId = user_id || null;
            if (resolvedUserId && userRepo) {
                const existingUser = await userRepo.findById(resolvedUserId);
                const nextProfileText = profile_text.trim() || existingUser?.profile_text || '';
                await userRepo.upsert({ id: resolvedUserId, name: display_name, profile_text: nextProfileText });
            }

            const participantId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const controlToken = generateControlToken();
            const participant = { id: participantId, room_id: roomId, user_id: resolvedUserId, display_name, control_token: controlToken, location_id };
            
            await participantRepo.join(participant);
            const joinedParticipant = await participantRepo.findById(participantId);

            res.status(201).json({
                ...joinedParticipant,
                control_token: controlToken,
                is_host: !!resolvedUserId && room.owner_id === resolvedUserId
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to join room' });
        }
    });

    app.post('/rooms/:id/custom-ai', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { instruction = '', participant_id, control_token } = req.body || {};

            if (!roomRepo || !aiService || !aiService.enabled) {
                return res.status(503).json({ error: 'AI generation is unavailable' });
            }

            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            const participant = await authorizeParticipant(roomId, participant_id, control_token);
            if (!participant) {
                return res.status(403).json({ error: 'Participant validation failed' });
            }

            const minutesText = String(room.minutes_text || '').trim();
            if (!minutesText) {
                return res.status(409).json({ error: 'Minutes must be generated first' });
            }

            const generated = await aiService.generateCustomFromMinutes(minutesText, instruction);
            res.status(200).json({
                result: generated.result,
                provider: generated.provider
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to generate custom AI result' });
        }
    });

    app.post('/rooms/:id/shared-ai/:type', async (req, res) => {
        try {
            const { id: roomId, type } = req.params;
            const { participant_id, control_token } = req.body || {};

            if (!roomRepo || !participantRepo || !utteranceRepo || !aiService) {
                return res.status(503).json({ error: 'AI generation is unavailable' });
            }

            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            const participant = await authorizeParticipant(roomId, participant_id, control_token);
            if (!participant) {
                return res.status(403).json({ error: 'Participant validation failed' });
            }

            if (!participant.user_id || participant.user_id !== room.owner_id) {
                return res.status(403).json({ error: 'Only the host can generate shared AI results' });
            }

            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((item) => item.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];

            if (type === 'minutes') {
                const utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
                const generated = await aiService.generateMinutesFromTranscript(utterances, {
                    roomId,
                    date: new Date().toLocaleString('ja-JP'),
                    title: `ルーム ${roomId}`
                }, participants, userContexts);

                await roomRepo.updateInsights(roomId, {
                    minutes_text: generated.result
                });

                return res.status(200).json({
                    type,
                    result: generated.result,
                    updated_at: (await roomRepo.findById(roomId))?.minutes_updated_at || null
                });
            }

            const latestRoom = await roomRepo.findById(roomId);
            const minutesText = String(latestRoom?.minutes_text || '').trim();
            if (!minutesText) {
                return res.status(409).json({ error: 'Minutes must be generated first' });
            }

            if (type === 'summary') {
                const generated = await aiService.generateSummaryFromMinutes(minutesText);
                await roomRepo.updateInsights(roomId, {
                    summary_text: generated.result,
                    insights_dirty: false
                });
                return res.status(200).json({
                    type,
                    result: generated.result,
                    updated_at: (await roomRepo.findById(roomId))?.summary_updated_at || null
                });
            }

            if (type === 'todo') {
                const generated = await aiService.generateTodoFromMinutes(minutesText);
                await roomRepo.updateInsights(roomId, {
                    todo_text: generated.result
                });
                return res.status(200).json({
                    type,
                    result: generated.result,
                    updated_at: (await roomRepo.findById(roomId))?.todo_updated_at || null
                });
            }

            return res.status(400).json({ error: 'Unsupported shared AI type' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to generate shared AI result' });
        }
    });

    // POST /rooms/:id/end - End a room
    app.post('/rooms/:id/end', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { participant_id, control_token } = req.body || {};

            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            const participant = await authorizeParticipant(roomId, participant_id, control_token);
            if (!participant) {
                return res.status(403).json({ error: 'Participant validation failed' });
            }

            if (!participant.user_id || participant.user_id !== room.owner_id) {
                return res.status(403).json({ error: 'Only the host can end the room' });
            }

            await roomRepo.endRoom(roomId);
            const endedRoom = await roomRepo.findById(roomId);

            // Notify all clients in this room via WebSocket
            const wss = repositories.wss;
            let notifiedCount = 0;
            if (wss && wss.rooms && wss.rooms.has(roomId)) {
                const roomClients = wss.rooms.get(roomId);
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'terminated' }));
                        client.close();
                        notifiedCount++;
                    }
                }
            }
            console.log(`[Room End] Room ${roomId} ended. Notified ${notifiedCount} clients.`);

            res.status(200).json({ ...endedRoom, notified: notifiedCount });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to end room' });
        }
    });

    // GET /rooms/:id/download - Download meeting minutes
    app.get('/rooms/:id/download', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const [utterances, room, participants] = await Promise.all([
                utteranceRepo.findByRoomIdWithParticipants(roomId),
                roomRepo.findById(roomId),
                enrichParticipantsWithProfiles(participantRepo, userRepo, roomId)
            ]);

            if (utterances.length === 0) {
                return res.status(404).send('No logs found for this room.');
            }

            let markdown = `# 会議ログ\n\n`;
            markdown += `ルームID: ${roomId}\n`;
            markdown += `出力日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
            markdown += `## 参加者情報\n\n`;
            participants.forEach((participant) => {
                markdown += `### ${participant.display_name}\n`;
                markdown += `- 参加時刻: ${new Date(participant.joined_at).toLocaleString('ja-JP')}\n`;
                markdown += `- 得意なこと・スキル・担当プロジェクト: ${participant.profile_text || '未記入'}\n\n`;
            });
            markdown += `---\n\n`;

            const roomStartTime = utterances.length
                ? new Date(utterances[0].started_at || room?.created_at).getTime()
                : new Date(room?.created_at || Date.now()).getTime();
            const firstUtteranceByParticipant = new Map();
            utterances.forEach((utterance) => {
                if (!firstUtteranceByParticipant.has(utterance.participant_id)) {
                    firstUtteranceByParticipant.set(utterance.participant_id, utterance.id);
                }
            });
            const participantMap = new Map(participants.map((participant) => [participant.id, participant]));

            utterances.forEach((utterance) => {
                const participant = participantMap.get(utterance.participant_id);
                const joinedAt = participant?.joined_at ? new Date(participant.joined_at).getTime() : roomStartTime;
                const joinedMidway = joinedAt - roomStartTime > 30000;
                if (participant && joinedMidway && firstUtteranceByParticipant.get(utterance.participant_id) === utterance.id) {
                    markdown += `> 途中参加プロフィール: ${participant.display_name}\n`;
                    markdown += `> 得意なこと・スキル・担当プロジェクト: ${participant.profile_text || '未記入'}\n\n`;
                }

                const time = new Date(utterance.started_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                const marker = utterance.is_starred ? ' [重要]' : '';
                const noteText = utterance.memo_text || utterance.memory_note || '';
                const note = noteText ? `\nメモ: ${noteText}` : '';
                markdown += `**[${time}] ${utterance.display_name}${marker}**\n${utterance.transcript}${note}\n\n`;
            });

            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="minutes-${roomId}.md"`);
            res.send(markdown);
        } catch (error) {
            console.error(error);
            res.status(500).send('Failed to generate transcript');
        }
    });

    // POST /rooms/:id/analyze - AI Analysis (Summary, Agenda, TODO, etc.)
    app.post('/rooms/:id/analyze', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { type, instruction, last_timestamp, current_tree, ai_config } = req.body;
            
            // Fetch utterances for context (all or only new ones)
            let utterances;
            if (last_timestamp) {
                utterances = await utteranceRepo.findNewerThan(roomId, last_timestamp);
                console.log(`[AI-Incremental] Analyzing ${utterances.length} NEW utterances for room ${roomId}. (Since: ${last_timestamp})`);
            } else {
                utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
                console.log(`[AI-Full] Analyzing ALL ${utterances.length} utterances for room ${roomId}.`);
            }

            if (utterances.length === 0) {
                return res.status(200).json({ result: current_tree || '', provider: 'none', message: 'No new utterances.' });
            }

            // Decide which AI service/config to use
            let activeAiService = aiService;
            if (ai_config && ai_config.provider) {
                const { AIService: AIServiceClass } = require('./services/ai-service');
                // Create a temporary service instance with the requested config
                activeAiService = new AIServiceClass({
                    provider: ai_config.provider,
                    geminiModel: ai_config.provider === 'gemini' ? ai_config.model : null,
                    ollamaModel: ai_config.provider === 'ollama' ? ai_config.model : null,
                    apiKey: process.env.GEMINI_API_KEY
                });
            }

            if (!activeAiService || !activeAiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            // Pass current_tree to aiService as instruction if provided
            const combinedInstruction = current_tree
                ? `現在のトピックツリーは次のとおりです。\n${current_tree}\n\nこのツリーに、今回の新しい発言内容を反映して更新してください。\n${instruction}`
                : instruction;

            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
            const { result, prompt, provider } = await activeAiService.analyzeMeeting(utterances, type, combinedInstruction, participants, userContexts);
            const latestTimestamp = utterances[utterances.length - 1].started_at;

            // Save analysis result
            const analysis = {
                id: `a-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                room_id: roomId,
                type: type,
                input_prompt: prompt,
                result_text: result
            };
            if (analysisRepo) {
                await analysisRepo.add(analysis);
            }

            res.status(200).json({ result, provider, latest_timestamp: latestTimestamp });
        } catch (error) {
            console.error('[API] Analysis error:', error);
            res.status(500).json({ error: error.message || 'Failed to perform AI analysis' });
        }
    });

    return app;
}

function setupWebSocket(server, repositories = {}) {
    const { participantRepo, utteranceRepo, audioProcessor, sttService, userRepo } = repositories;
    const wss = new WebSocketServer({ server });
    const mergeWindowMs = 4500;
    
    wss.rooms = new Map();

    // Heartbeat to prevent timeouts
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
    if (typeof interval.unref === 'function') {
        interval.unref();
    }

    server.on('close', () => {
        clearInterval(interval);
        wss.clients.forEach((client) => client.terminate());
        wss.close();
    });

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        
        const url = new URL(req.url, `http://${req.headers.host}`);
        const participantId = url.searchParams.get('participantId');
        ws.participantId = participantId;
        let sttStream = null;

        if (!participantId) {
            ws.terminate();
            return;
        }

        const ensureValidated = async () => {
            if (ws.validated) return;
            if (ws.validationPromise) {
                await ws.validationPromise;
                return;
            }

            ws.validationPromise = (async () => {
                ws.validating = true;
                const participant = await participantRepo.findById(participantId);
                if (!participant) {
                    ws.terminate();
                    return;
                }

                ws.participant = participant;
                ws.roomId = participant.room_id;
                ws.validated = true;
                ws.validating = false;

                const roomParticipants = await enrichParticipantsWithProfiles(participantRepo, userRepo, ws.roomId);
                ws.speechHints = collectSpeechHints(roomParticipants);

                if (!wss.rooms.has(ws.roomId)) {
                    wss.rooms.set(ws.roomId, new Set());
                }
                wss.rooms.get(ws.roomId).add(ws);
            })();

            try {
                await ws.validationPromise;
            } finally {
                ws.validationPromise = null;
            }
        };
        ws.ensureValidated = ensureValidated;

        const sendReady = async () => {
            if (ws.readySent || ws.readyState !== WebSocket.OPEN) return;

            const history = utteranceRepo
                ? await utteranceRepo.findByRoomIdWithParticipants(ws.roomId)
                : [];

            ws.readySent = true;
            ws.send(JSON.stringify({
                type: 'ready',
                history: history.map(h => ({
                    id: h.id,
                    participant_id: h.participant_id,
                    display_name: h.display_name,
                    transcript: h.transcript,
                    timestamp: h.started_at,
                    is_starred: !!h.is_starred,
                    memo_text: h.memo_text || h.memory_note || '',
                    memory_note: h.memory_note || '',
                    starred_at: h.starred_at || null,
                    raw_transcript: h.raw_transcript || h.transcript,
                    transcript_source: h.transcript_source || 'stt',
                    corrected_at: h.corrected_at || null
                }))
            }));
        };

        const persistAndBroadcastTranscript = async (transcript) => {
            const nowIso = new Date().toISOString();
            let utterance = {
                id: `u-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                room_id: ws.roomId,
                participant_id: participantId,
                started_at: nowIso,
                ended_at: nowIso,
                transcript: transcript,
                raw_transcript: transcript,
                transcript_source: 'stt'
            };

            if (utteranceRepo) {
                const latest = await utteranceRepo.findLatestByParticipant(ws.roomId, participantId);
                const latestEndedAt = latest ? new Date(latest.ended_at || latest.started_at).getTime() : 0;
                const withinWindow = latest && (Date.now() - latestEndedAt) <= mergeWindowMs;
                const canMerge = withinWindow
                    && latest.transcript_source === 'stt'
                    && !latest.is_starred
                    && !((latest.memo_text || latest.memory_note || '').trim());

                if (canMerge) {
                    utterance = await utteranceRepo.mergeTranscript(latest.id, transcript, nowIso);
                } else {
                    await utteranceRepo.add(utterance);
                }
            }

            const broadcastMsg = JSON.stringify({
                type: 'transcript',
                id: utterance.id,
                participant_id: participantId,
                display_name: ws.participant.display_name,
                transcript: utterance.transcript,
                timestamp: utterance.started_at,
                is_starred: !!utterance.is_starred,
                memo_text: utterance.memo_text || utterance.memory_note || '',
                memory_note: utterance.memory_note || '',
                starred_at: utterance.starred_at || null,
                raw_transcript: utterance.raw_transcript || utterance.transcript,
                transcript_source: utterance.transcript_source || 'stt',
                corrected_at: utterance.corrected_at || null
            });

            const roomClients = wss.rooms.get(ws.roomId);
            if (roomClients) {
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastMsg);
                    }
                }
            }
        };

        const startSTTStream = () => {
            if (sttStream || !sttService) return;
            
            console.log(`[STT] Starting new stream for participant ${participantId}`);
            sttStream = sttService.createStream(
                async (transcript) => {
                    try {
                        await persistAndBroadcastTranscript(transcript);
                    } catch (err) {
                        console.error('[STT Callback Error]', err.message);
                    }
                },
                (err) => {
                    console.error('[STT Stream Error]', err.message);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'error', message: '音声認識ストリームでエラーが発生しました' }));
                    }
                    sttStream = null;
                }
            );

            // Important: Handle graceful closure (e.g. Google's 305s limit)
            sttStream.on('end', () => {
                console.log('[STT Stream End] Stream closed gracefully by provider');
                sttStream = null;
            });
            sttStream.on('close', () => {
                sttStream = null;
            });
        };

        ensureValidated().catch((error) => {
            console.error('[WS] Validation error:', error);
        });

        ws.on('message', async (data, isBinary) => {
            try {
                if (!ws.validated) {
                    await ensureValidated();
                }

                // Wait for validation to complete before processing any data
                if (!ws.validated) return;

                if (isBinary) {
                    if (audioProcessor && sttService && typeof sttService.recognize === 'function') {
                        const bufferedAudio = audioProcessor.addChunk(participantId, Buffer.from(data));
                        if (bufferedAudio) {
                            const transcript = await sttService.recognize(bufferedAudio, {
                                config: ws.speechHints && ws.speechHints.length
                                    ? {
                                        speechContexts: [{
                                            phrases: ws.speechHints,
                                            boost: 10
                                        }]
                                    }
                                    : {}
                            });
                            if (transcript) {
                                await persistAndBroadcastTranscript(transcript);
                            }
                        }
                        return;
                    }

                    // Start or restart stream if needed
                    if (!sttStream || !sttStream.writable) {
                        startSTTStream();
                    }
                    
                    if (sttStream && sttStream.writable) {
                        try {
                            sttStream.write(data);
                        } catch (e) {
                            console.error('[STT Write Error]', e.message);
                            sttStream = null; // Force restart on next chunk
                        }
                    }
                } else {
                    // Handle text messages (JSON)
                    try {
                        const msgStr = data.toString();
                        const msg = JSON.parse(msgStr);
                        
                        // Ignore 'hello' if it was already used for validation
                        if (msg.type === 'hello') {
                            await sendReady();
                            return;
                        }

                        const senderParticipant = ws.participant || await participantRepo.findById(participantId);
                        if (!senderParticipant) return;
                        ws.participant = senderParticipant;
                        ws.roomId = senderParticipant.room_id;

                        for (const client of wss.clients) {
                            if (!client.participant && client.participantId) {
                                client.participant = await participantRepo.findById(client.participantId);
                                client.roomId = client.participant ? client.participant.room_id : null;
                            }
                            if (
                                client !== ws &&
                                client.readyState === WebSocket.OPEN &&
                                client.roomId &&
                                client.roomId === ws.roomId
                            ) {
                                client.send(msgStr);
                            }
                        }
                    } catch (e) {
                        // Not JSON or other error
                    }
                }
            } catch (error) {
                console.error('[WS] Error handling message:', error);
            }
        });

        ws.on('close', () => {
            if (sttStream) {
                sttStream.end();
                sttStream = null;
            }
            if (audioProcessor) {
                audioProcessor.clear(participantId);
            }
            if (ws.roomId && wss.rooms.has(ws.roomId)) {
                const roomClients = wss.rooms.get(ws.roomId);
                roomClients.delete(ws);
                if (roomClients.size === 0) {
                    wss.rooms.delete(ws.roomId);
                }
            }
        });
    });
    return wss;
}

module.exports = { createApp, setupWebSocket };
