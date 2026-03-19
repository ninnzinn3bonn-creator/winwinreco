const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

function createApp(repositories = {}) {
    const app = express();
    app.use(express.json());
    app.use(express.static('src/frontend'));

    const { roomRepo, participantRepo, utteranceRepo, analysisRepo, aiService } = repositories;

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

    // POST /rooms - Create a new room
    app.post('/rooms', async (req, res) => {
        try {
            const { owner_id } = req.body;
            const roomId = `room-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
            const { display_name, location_id } = req.body;

            const room = await roomRepo.findById(roomId);
            if (!room || room.status !== 'active') {
                return res.status(404).json({ error: 'Room not found or inactive' });
            }

            const participantId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const participant = { id: participantId, room_id: roomId, display_name, location_id };
            
            await participantRepo.join(participant);
            const joinedParticipant = await participantRepo.findById(participantId);

            res.status(201).json(joinedParticipant);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to join room' });
        }
    });

    // POST /rooms/:id/end - End a room
    app.post('/rooms/:id/end', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            await roomRepo.endRoom(roomId);

            // Notify all clients in this room via WebSocket
            const wss = repositories.wss;
            let notifiedCount = 0;
            if (wss && wss.rooms && wss.rooms.has(roomId)) {
                const roomClients = wss.rooms.get(roomId);
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'terminated' }));
                        notifiedCount++;
                    }
                }
            }
            console.log(`[Room End] Room ${roomId} ended. Notified ${notifiedCount} clients.`);

            res.status(200).json({ message: 'Room ended', notified: notifiedCount });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to end room' });
        }
    });

    // GET /rooms/:id/download - Download meeting minutes
    app.get('/rooms/:id/download', async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            
            if (utterances.length === 0) {
                return res.status(404).send('No logs found for this room.');
            }

            let markdown = `# 会議議事録\n`;
            markdown += `ルームID: ${roomId}\n`;
            markdown += `作成日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
            markdown += `---\n\n`;

            utterances.forEach(u => {
                const time = new Date(u.started_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                markdown += `**[${time}] ${u.display_name}**\n${u.transcript}\n\n`;
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
                ? `現在のトピックツリーは以下の通りです：\n${current_tree}\n\nこのツリーに、以下の新しい発言内容を反映・統合して、最新のツリーのみを出力してください。\n${instruction}`
                : instruction;

            const { result, prompt, provider } = await activeAiService.analyzeMeeting(utterances, type, combinedInstruction);
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
    const { participantRepo, utteranceRepo, audioProcessor, sttService } = repositories;
    const wss = new WebSocketServer({ server });
    
    wss.rooms = new Map();

    // Heartbeat to prevent timeouts
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        
        const url = new URL(req.url, `http://${req.headers.host}`);
        const participantId = url.searchParams.get('participantId');
        let sttStream = null;

        if (!participantId) {
            ws.terminate();
            return;
        }

        const startSTTStream = () => {
            if (sttStream || !sttService) return;
            
            console.log(`[STT] Starting new stream for participant ${participantId}`);
            sttStream = sttService.createStream(
                async (transcript) => {
                    try {
                        const utterance = {
                            id: `u-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                            room_id: ws.roomId,
                            participant_id: participantId,
                            started_at: new Date().toISOString(),
                            ended_at: new Date().toISOString(),
                            transcript: transcript
                        };

                        await utteranceRepo.add(utterance);

                        const broadcastMsg = JSON.stringify({
                            type: 'transcript',
                            participant_id: participantId,
                            display_name: ws.participant.display_name,
                            transcript: transcript,
                            timestamp: new Date().toISOString()
                        });

                        const roomClients = wss.rooms.get(ws.roomId);
                        if (roomClients) {
                            for (const client of roomClients) {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(broadcastMsg);
                                }
                            }
                        }
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

        ws.on('message', async (data, isBinary) => {
            try {
                // Initialize/Validate on first message if not already done
                if (!ws.validated && !ws.validating) {
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

                    if (!wss.rooms.has(ws.roomId)) {
                        wss.rooms.set(ws.roomId, new Set());
                    }
                    wss.rooms.get(ws.roomId).add(ws);
                    
                    // Fetch history
                    const history = await utteranceRepo.findByRoomIdWithParticipants(ws.roomId);
                    ws.send(JSON.stringify({ 
                        type: 'ready', 
                        history: history.map(h => ({
                            participant_id: h.participant_id,
                            display_name: h.display_name,
                            transcript: h.transcript,
                            timestamp: h.started_at
                        }))
                    }));
                    // Do not return here, process the current data if it's audio
                }

                // Wait for validation to complete before processing any data
                if (!ws.validated) return;

                if (isBinary || Buffer.isBuffer(data)) {
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
                        if (msg.type === 'hello') return;

                        // Broadcast other system messages to the room
                        const roomClients = wss.rooms.get(ws.roomId);
                        if (roomClients) {
                            for (const client of roomClients) {
                                if (client !== ws && client.readyState === WebSocket.OPEN) {
                                    client.send(msgStr);
                                }
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
