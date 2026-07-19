'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { PassThrough } = require('stream');
const WebSocket = require('ws');
const { createApp, setupWebSocket } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');

function waitFor(predicate, timeoutMs = 2000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (predicate()) return resolve();
            if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for condition'));
            setTimeout(poll, 10);
        };
        poll();
    });
}

describe('WebSocket STT recovery', () => {
    let db;
    let server;
    let port;
    let roomRepo;
    let participantRepo;
    let sttService;
    let streams;
    let callbacks;
    const dbPath = path.resolve(__dirname, `./tmp/test_ws_stt_recovery_${Date.now()}.db`);

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        db = await initDB(dbPath);
        roomRepo = new RoomRepository(db);
        participantRepo = new ParticipantRepository(db);
        streams = [];
        callbacks = [];
        sttService = {
            provider: 'elevenlabs',
            createStream: jest.fn((onData, onError, _options, onPartial) => {
                const stream = new PassThrough();
                stream.on('data', () => {});
                streams.push(stream);
                callbacks.push({ onData, onError, onPartial });
                return stream;
            })
        };

        const app = createApp({ roomRepo, participantRepo });
        server = http.createServer(app);
        setupWebSocket(server, { roomRepo, participantRepo, sttService });
        await new Promise((resolve) => server.listen(0, resolve));
        port = server.address().port;

        await roomRepo.create({ id: 'room-stt-recovery', owner_id: 'host-stt-recovery' });
        await participantRepo.join({
            id: 'participant-stt-recovery',
            room_id: 'room-stt-recovery',
            display_name: 'Recovery Test',
            control_token: 'token-stt-recovery'
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => db.close(resolve));
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });

    async function connectClient() {
        const params = new URLSearchParams({
            participantId: 'participant-stt-recovery',
            controlToken: 'token-stt-recovery',
            roomId: 'room-stt-recovery'
        });
        const socket = new WebSocket(`ws://localhost:${port}?${params.toString()}`);
        const messages = [];
        socket.on('message', (data) => {
            try { messages.push(JSON.parse(data.toString())); } catch (_) { /* binary is not expected */ }
        });
        await new Promise((resolve, reject) => {
            socket.once('open', resolve);
            socket.once('error', reject);
        });
        socket.send(JSON.stringify({ type: 'hello' }));
        await waitFor(() => messages.some((message) => message.type === 'ready'));
        return { socket, messages };
    }

    afterEach(() => {
        streams.length = 0;
        callbacks.length = 0;
        sttService.createStream.mockClear();
    });

    test('a late close from an old stream does not replace the active stream', async () => {
        const { socket } = await connectClient();
        socket.send(Buffer.alloc(16000));
        await waitFor(() => streams.length === 1);
        const oldStream = streams[0];

        callbacks[0].onError(new Error('provider connection dropped'));
        socket.send(Buffer.alloc(16000));
        await waitFor(() => streams.length === 2);
        const activeStream = streams[1];

        oldStream.emit('close');
        socket.send(Buffer.alloc(16000));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(sttService.createStream).toHaveBeenCalledTimes(2);
        expect(activeStream.writable).toBe(true);
        await new Promise((resolve) => {
            socket.once('close', resolve);
            socket.close();
        });
    });

    test('client stall request restarts only STT and keeps the app socket open', async () => {
        const { socket, messages } = await connectClient();
        socket.send(Buffer.alloc(16000));
        await waitFor(() => streams.length === 1);

        socket.send(JSON.stringify({ type: 'restart_stt', reason: 'test-stall' }));
        await waitFor(() => streams.length === 2);
        await waitFor(() => messages.some((message) => message.type === 'stt_status'));

        expect(socket.readyState).toBe(WebSocket.OPEN);
        expect(messages.find((message) => message.type === 'stt_status')).toEqual({
            type: 'stt_status',
            status: 'restarting'
        });
        await new Promise((resolve) => {
            socket.once('close', resolve);
            socket.close();
        });
    });
});
