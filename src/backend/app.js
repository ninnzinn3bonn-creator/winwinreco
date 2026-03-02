const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

function createApp(repositories = {}) {
    const app = express();
    app.use(express.json());
    app.use(express.static('src/frontend'));

    const { roomRepo, participantRepo, utteranceRepo, wss } = repositories;

    app.get('/', (req, res) => {
        res.status(200).send('Meeting Minutes API');
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
            if (wss && wss.rooms && wss.rooms.has(roomId)) {
                const roomClients = wss.rooms.get(roomId);
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'terminated' }));
                    }
                }
            }

            res.status(200).json({ message: 'Room ended' });
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

    return app;
}

function setupWebSocket(server, repositories = {}) {
    const { participantRepo, utteranceRepo, audioProcessor, sttService } = repositories;
    const wss = new WebSocketServer({ server });
    
    wss.rooms = new Map();

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const participantId = url.searchParams.get('participantId');
        let sttStream = null;

        if (!participantId) {
            ws.terminate();
            return;
        }

        const startSTTStream = () => {
            if (sttStream || !sttService) return;
            
            sttStream = sttService.createStream(
                async (transcript) => {
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
                },
                (err) => {
                    console.error('[STT Stream Error]', err.message);
                    ws.send(JSON.stringify({ type: 'error', message: '音声認識ストリームでエラーが発生しました' }));
                    sttStream = null; // Reset to allow restart on next chunk
                }
            );
        };

        ws.on('message', async (data, isBinary) => {
            try {
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
                    
                    if (!isBinary && !Buffer.isBuffer(data)) {
                        try {
                            const msg = JSON.parse(data.toString());
                            if (msg.type === 'hello') return;
                        } catch(e) {}
                    }
                }

                if (!ws.validated) return;

                if (isBinary || Buffer.isBuffer(data)) {
                    if (!sttStream) startSTTStream();
                    if (sttStream) {
                        sttStream.write(data);
                    }
                } else {
                    const roomClients = wss.rooms.get(ws.roomId);
                    if (roomClients) {
                        for (const client of roomClients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(data.toString());
                            }
                        }
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
