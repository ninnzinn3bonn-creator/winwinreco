const WebSocket = require('ws');
const http = require('http');
const request = require('supertest');
const { createApp, setupWebSocket } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const path = require('path');
const fs = require('fs');

describe('Room Termination Sync', () => {
    let server, port, db, repos;
    const dbPath = path.resolve(__dirname, '../db/test_sync.db');

    beforeAll(async () => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        repos = {
            roomRepo: new RoomRepository(db),
            participantRepo: new ParticipantRepository(db)
        };
        const app = createApp(repos);
        server = http.createServer(app);
        const wss = setupWebSocket(server, repos);
        repos.wss = wss; // Link wss to repos so API can use it
        
        return new Promise(resolve => server.listen(0, () => {
            port = server.address().port;
            resolve();
        }));
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => db.close(resolve));
    });

    test('should close WebSocket connection when room ends via API', (done) => {
        const roomId = 'room-sync';
        const ownerId = 'owner-1';
        const participantId = 'p-sync';
        const controlToken = 'sync-token';

        (async () => {
            await repos.roomRepo.create({ id: roomId, owner_id: ownerId });
            await repos.participantRepo.join({
                id: participantId,
                room_id: roomId,
                user_id: ownerId,
                display_name: 'SyncUser',
                control_token: controlToken
            });

            const ws = new WebSocket(`ws://localhost:${port}?participantId=${participantId}`);
            
            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'hello' }));
            });

            ws.on('message', async (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'ready') {
                    // API Call
                    await request(server)
                        .post(`/rooms/${roomId}/end`)
                        .send({
                            participant_id: participantId,
                            control_token: controlToken
                        });
                }
            });

            ws.on('close', () => {
                done();
            });
        })();
    }, 10000);
});
