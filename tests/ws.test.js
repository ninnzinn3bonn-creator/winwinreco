const WebSocket = require('ws');
const http = require('http');
const { createApp, setupWebSocket } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const path = require('path');
const fs = require('fs');

describe('WebSocket Room Broadcast', () => {
    let server;
    let port;
    let db;
    const dbPath = path.resolve(__dirname, './tmp/test_ws.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        const roomRepo = new RoomRepository(db);
        const participantRepo = new ParticipantRepository(db);
        
        const app = createApp({ roomRepo, participantRepo });
        server = http.createServer(app);
        setupWebSocket(server, { participantRepo });
        
        return new Promise((resolve) => {
            server.listen(0, () => {
                port = server.address().port;
                resolve();
            });
        });
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => db.close(resolve));
    });

    async function createWS(participantId, controlToken) {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({ participantId, controlToken: controlToken || '' });
            const ws = new WebSocket(`ws://localhost:${port}?${params.toString()}`);
            ws.on('open', () => resolve(ws));
            ws.on('error', reject);
        });
    }

    test('should broadcast message to same room participants', async () => {
        const roomRepo = new RoomRepository(db);
        const participantRepo = new ParticipantRepository(db);

        // Setup Room A
        await roomRepo.create({ id: 'room-A', owner_id: 'user-1' });
        await participantRepo.join({ id: 'p-A1', room_id: 'room-A', display_name: 'Alice', control_token: 'tok-A1' });
        await participantRepo.join({ id: 'p-A2', room_id: 'room-A', display_name: 'Bob', control_token: 'tok-A2' });

        // Setup Room B
        await roomRepo.create({ id: 'room-B', owner_id: 'user-2' });
        await participantRepo.join({ id: 'p-B1', room_id: 'room-B', display_name: 'Charlie', control_token: 'tok-B1' });

        const wsA1 = await createWS('p-A1', 'tok-A1');
        const wsA2 = await createWS('p-A2', 'tok-A2');
        const wsB1 = await createWS('p-B1', 'tok-B1');

        const receivedMessagesA2 = [];
        wsA2.on('message', (data) => receivedMessagesA2.push(JSON.parse(data)));

        const receivedMessagesB1 = [];
        wsB1.on('message', (data) => receivedMessagesB1.push(JSON.parse(data)));

        // Send message from A1
        const msg = { type: 'chat', text: 'Hello Room A' };
        wsA1.send(JSON.stringify(msg));

        // Wait for broadcast
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(receivedMessagesA2.length).toBe(1);
        expect(receivedMessagesA2[0].text).toBe('Hello Room A');
        expect(receivedMessagesB1.length).toBe(0);

        wsA1.close();
        wsA2.close();
        wsB1.close();
    });
});
