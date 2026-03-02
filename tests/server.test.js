const request = require('supertest');
const WebSocket = require('ws');
const http = require('http');
const { createApp } = require('../src/backend/app');

describe('Server Basic Setup', () => {
    let app;
    let server;
    let port;

    beforeAll((done) => {
        app = createApp();
        server = http.createServer(app);
        const { setupWebSocket } = require('../src/backend/app');
        setupWebSocket(server);
        server.listen(0, () => {
            port = server.address().port;
            done();
        });
    });

    afterAll((done) => {
        server.close(done);
    });

    test('HTTP server should return 200 on /', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
    });

    test('WebSocket server should accept connections', (done) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on('open', () => {
            ws.close();
            done();
        });
        ws.on('error', (err) => {
            done(err);
        });
    });
});
