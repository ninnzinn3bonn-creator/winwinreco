const WebSocket = require('ws');
const http = require('http');
const { createApp, setupWebSocket } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UtteranceRepository } = require('../src/backend/repo/utterance-repo');
const { AudioProcessor } = require('../src/backend/services/audio-processor');
const { STTService } = require('../src/backend/services/stt-service');
const path = require('path');
const fs = require('fs');

describe('End-to-End Audio Flow', () => {
    let server, port, db;
    const dbPath = path.resolve(__dirname, '../db/test_e2e.db');

    beforeAll(async () => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        const repos = {
            roomRepo: new RoomRepository(db),
            participantRepo: new ParticipantRepository(db),
            utteranceRepo: new UtteranceRepository(db)
        };
        
        // Mock STT
        const mockSpeechClient = {
            recognize: jest.fn().mockResolvedValue([{ results: [{ alternatives: [{ transcript: 'Test Transcript' }] }] }])
        };
        const sttService = new STTService({ client: mockSpeechClient });
        const audioProcessor = new AudioProcessor({ chunkLimit: 2 }); // Process every 2 chunks

        const app = createApp(repos);
        server = http.createServer(app);
        setupWebSocket(server, { ...repos, sttService, audioProcessor });
        
        return new Promise(resolve => server.listen(0, () => {
            port = server.address().port;
            resolve();
        }));
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => db.close(resolve));
    });

    test('should receive transcript after sending audio chunks', (done) => {
        const participantId = 'p-1';
        (async () => {
            await new RoomRepository(db).create({ id: 'room-1', owner_id: 'u1' });
            await new ParticipantRepository(db).join({ id: participantId, room_id: 'room-1', display_name: 'Alice' });

            const ws = new WebSocket(`ws://localhost:${port}?participantId=${participantId}`);
            
            ws.on('open', () => {
                console.log('[TEST] WS Open');
                // First message to trigger validation
                ws.send(JSON.stringify({ type: 'hello' }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    console.log('[TEST] Received:', msg.type);
                    if (msg.type === 'ready') {
                        // After ready, send binary chunks
                        ws.send(Buffer.from([0, 1]), { binary: true });
                        ws.send(Buffer.from([2, 3]), { binary: true });
                    } else if (msg.type === 'transcript') {
                        expect(msg.transcript).toBe('Test Transcript');
                        ws.close();
                        done();
                    }
                } catch (e) {
                    console.error('[TEST] Parse Error:', e);
                }
            });
        })();
    }, 10000);
});
