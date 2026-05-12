'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const { UtteranceRepository } = require('../src/backend/repo/sqlite/utterance-repo');
const { UserRepository } = require('../src/backend/repo/sqlite/user-repo');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');

/**
 * GET /me/export — データエクスポート (ZIP)
 * POST /me/delete — アカウント完全削除
 */
describe('Account data export and deletion', () => {
    let app;
    let db;
    let accountRepo;
    let roomRepo;
    let sessionRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_account_data.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        accountRepo = new UserAccountRepository(db);
        roomRepo = new RoomRepository(db);
        sessionRepo = new SessionRepository(db);
        app = createApp({
            roomRepo,
            participantRepo: new ParticipantRepository(db),
            utteranceRepo: new UtteranceRepository(db),
            userRepo: new UserRepository(db),
            accountRepo,
            sessionRepo
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    // 事後承認フロー: signup → approved → login
    async function signupFresh(label, password = 'correcthorse99') {
        const agent = request.agent(app);
        const email = `${label}+${Date.now()}@example.test`;
        await agent.post('/auth/signup').send({ email, password, display_name: label });
        const account = await accountRepo.findByEmail(email);
        await accountRepo.setStatus(account.id, 'approved');
        const loginRes = await agent.post('/auth/login').send({ email, password });
        return { agent, account: loginRes.body.account, email, password };
    }

    // ── 1. GET /me/export 未ログイン → 401 ──────────────────────────────────
    test('GET /me/export 未ログイン → 401', async () => {
        const res = await request(app).get('/me/export');
        expect(res.status).toBe(401);
    });

    // ── 2. GET /me/export ログイン済み → 200 application/zip ─────────────────
    test('GET /me/export ログイン → 200 application/zip (ZIP 内に README.txt / account.json)', async () => {
        const { agent } = await signupFresh('exporter');

        // ルームを 1 つ作成しておく
        await agent.post('/rooms').send({});

        const res = await agent
            .get('/me/export')
            .buffer(true)
            .parse((response, callback) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => callback(null, Buffer.concat(chunks)));
                response.on('error', callback);
            });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/zip/);

        const buf = res.body;
        // ZIP マジックバイト PK\x03\x04 (0x504B0304)
        expect(buf[0]).toBe(0x50); // 'P'
        expect(buf[1]).toBe(0x4B); // 'K'
        expect(buf[2]).toBe(0x03);
        expect(buf[3]).toBe(0x04);

        // ファイル名として "README.txt" と "account.json" が含まれる
        const str = buf.toString('latin1');
        expect(str).toContain('README.txt');
        expect(str).toContain('account.json');
    });

    // ── 3. POST /me/delete パスワード不一致 → 401 ────────────────────────────
    test('POST /me/delete パスワード不一致 → 401', async () => {
        const { agent } = await signupFresh('deleter-wrong');
        const res = await agent.post('/me/delete').send({ password: 'wrongpassword' });
        expect(res.status).toBe(401);
    });

    // ── 4. POST /me/delete 正パスワード → 204 + DB から消える ────────────────
    test('POST /me/delete 正パスワード → 204 + account / rooms / sessions が消える', async () => {
        const { agent, account, password } = await signupFresh('deleter-ok');
        const accountId = account.id;

        // ルームを 1 つ作成
        const roomRes = await agent.post('/rooms').send({});
        expect(roomRes.status).toBeGreaterThanOrEqual(200);
        expect(roomRes.status).toBeLessThan(300);
        const roomId = roomRes.body.id;

        // 削除前: account が存在する
        const before = await accountRepo.findById(accountId);
        expect(before).toBeTruthy();

        // 削除
        const delRes = await agent.post('/me/delete').send({ password });
        expect(delRes.status).toBe(204);

        // account が消えている
        const after = await accountRepo.findById(accountId);
        expect(after).toBeFalsy();

        // own room が消えている
        const room = await roomRepo.findById(roomId);
        expect(room).toBeFalsy();

        // sessions が消えている (sessionRepo で直接確認)
        const sessions = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM sessions WHERE account_id = ?', [accountId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
        expect(sessions.length).toBe(0);
    });
});
