/**
 * series.test.js — 定例会議シリーズ + 次回アジェンダ生成
 *
 * 1. POST /me/series → 201 + latest_agenda_text = frame_text 初期値
 * 2. GET  /me/series → 自分のシリーズだけ返る
 * 3. PATCH /me/series/:id → 自分のシリーズのみ更新可、他人は 404
 * 4. DELETE /me/series/:id → 削除後 GET で 404
 * 5. POST /rooms with series_id → ルームに保存、別アカウントのシリーズ ID は 400
 * 6. POST /rooms/:id/series/generate-next-agenda → 200 + latest_agenda_text 保存
 * 7. POST /rooms/:id/series/generate-next-agenda (series 未紐付き) → 400
 * 8. POST /rooms/:id/series/generate-next-agenda (非ホスト) → 403
 */
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { SeriesRepository } = require('../src/backend/repo/sqlite/series-repo');

// AI サービスをモック (実際の LLM 呼び出しを回避)
const mockGenerateNextAgenda = jest.fn().mockResolvedValue({
    result: 'モック生成アジェンダ\n1. 前回確認事項 (継続審議)\n2. 新規議題',
    prompt: 'mock-prompt',
    provider: 'gemini (mock)',
    duration_ms: 100
});

const mockAiService = {
    enabled: true,
    generateNextAgenda: mockGenerateNextAgenda,
    analyzeMeeting: jest.fn().mockResolvedValue({ result: '', provider: 'mock' }),
    generateMinutesFromTranscript: jest.fn().mockResolvedValue({ result: '', provider: 'mock' }),
    generateSummaryFromMinutes: jest.fn().mockResolvedValue({ result: '', provider: 'mock' }),
    generateTodoFromMinutes: jest.fn().mockResolvedValue({ result: '', provider: 'mock' }),
    generateCustomFromMinutes: jest.fn().mockResolvedValue({ result: '', provider: 'mock' }),
    getProvider: jest.fn().mockReturnValue({ name: 'mock', generate: jest.fn().mockResolvedValue('') }),
};

describe('定例シリーズ API', () => {
    let app;
    let db;
    let accountRepo;
    let seriesRepo;
    const dbPath = path.resolve(__dirname, './tmp/test_series.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        accountRepo = new UserAccountRepository(db);
        seriesRepo = new SeriesRepository(db);
        const roomRepo = new RoomRepository(db);
        const participantRepo = new ParticipantRepository(db);
        const sessionRepo = new SessionRepository(db);
        app = createApp({
            roomRepo,
            participantRepo,
            accountRepo,
            sessionRepo,
            seriesRepo,
            aiService: mockAiService
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    // ---- ヘルパー ----
    let uniqCounter = 0;
    async function signupFresh(label) {
        uniqCounter++;
        const agent = request.agent(app);
        const email = `${label}${uniqCounter}+${Date.now()}@series.test`;
        const password = 'testpassword123';
        await agent.post('/auth/signup').send({ email, password, display_name: label });
        const account = await accountRepo.findByEmail(email);
        await accountRepo.setStatus(account.id, 'approved');
        await agent.post('/auth/login').send({ email, password });
        return { agent, account };
    }

    // ---------- テスト 1 ----------
    test('POST /me/series → 201, latest_agenda_text = frame_text', async () => {
        const { agent } = await signupFresh('user1');
        const frame = '1. 前回議事録確認\n2. 進捗報告\n3. 課題確認';
        const res = await agent.post('/me/series').send({
            name: '月次定例ゼミ',
            frame_text: frame
        });
        expect(res.status).toBe(201);
        expect(res.body.id).toBeTruthy();

        // DB で latest_agenda_text = frame_text を確認
        const created = await seriesRepo.findById(res.body.id);
        expect(created).not.toBeNull();
        expect(created.latest_agenda_text).toBe(frame);
        expect(created.frame_text).toBe(frame);
    });

    // ---------- テスト 2 ----------
    test('GET /me/series → 自分のシリーズだけ返る (他人は見えない)', async () => {
        const { agent: agentA } = await signupFresh('userA');
        const { agent: agentB } = await signupFresh('userB');

        const resA = await agentA.post('/me/series').send({ name: 'Series-A', frame_text: 'frame-a' });
        expect(resA.status).toBe(201);
        await agentB.post('/me/series').send({ name: 'Series-B', frame_text: 'frame-b' });

        const listA = await agentA.get('/me/series');
        expect(listA.status).toBe(200);
        const names = listA.body.series.map((s) => s.name);
        expect(names).toContain('Series-A');
        expect(names).not.toContain('Series-B');
    });

    // ---------- テスト 3 ----------
    test('PATCH /me/series/:id → 自分のみ更新可、他人は 404', async () => {
        const { agent: agentC } = await signupFresh('userC');
        const { agent: agentD } = await signupFresh('userD');

        const create = await agentC.post('/me/series').send({ name: 'Series-C', frame_text: 'frame-c' });
        expect(create.status).toBe(201);
        const sid = create.body.id;

        // 本人は更新可
        const patchOwn = await agentC.patch(`/me/series/${sid}`).send({ name: '更新済みシリーズ' });
        expect(patchOwn.status).toBe(200);
        expect(patchOwn.body.name).toBe('更新済みシリーズ');

        // 他人は 404
        const patchOther = await agentD.patch(`/me/series/${sid}`).send({ name: 'Hijack' });
        expect(patchOther.status).toBe(404);
    });

    // ---------- テスト 4 ----------
    test('DELETE /me/series/:id → 削除後 GET で 404', async () => {
        const { agent } = await signupFresh('userE');
        const create = await agent.post('/me/series').send({ name: 'ToDelete', frame_text: '' });
        const sid = create.body.id;

        const del = await agent.delete(`/me/series/${sid}`);
        expect(del.status).toBe(200);

        const get = await agent.get(`/me/series/${sid}`);
        expect(get.status).toBe(404);
    });

    // ---------- テスト 5 ----------
    test('POST /rooms with series_id → ルームに series_id 保存、他人のシリーズは 400', async () => {
        const { agent: agentF } = await signupFresh('userF');
        const { agent: agentG } = await signupFresh('userG');

        const seriesRes = await agentF.post('/me/series').send({ name: 'F-series', frame_text: 'f' });
        const sid = seriesRes.body.id;

        // 正常ケース: 自分のシリーズで room を作成
        const roomRes = await agentF.post('/rooms').send({ series_id: sid });
        expect(roomRes.status).toBe(201);
        expect(roomRes.body.series_id).toBe(sid);

        // 異常ケース: 他人のシリーズ ID は 400
        const badRoom = await agentG.post('/rooms').send({ series_id: sid });
        expect(badRoom.status).toBe(400);
    });

    // ---------- テスト 6 ----------
    test('POST /rooms/:id/series/generate-next-agenda → 200 + latest_agenda_text 更新', async () => {
        const { agent } = await signupFresh('userH');
        const seriesCreate = await agent.post('/me/series').send({
            name: 'H-series',
            frame_text: '1. 報告\n2. 議題'
        });
        const sid = seriesCreate.body.id;

        // rooms を作成して series_id を紐付け
        const roomCreate = await agent.post('/rooms').send({ series_id: sid });
        const roomId = roomCreate.body.id;

        // 次回アジェンダ生成 (requireSession: セッションクッキーが有効)
        const genRes = await agent
            .post(`/rooms/${roomId}/series/generate-next-agenda`)
            .send({});
        expect(genRes.status).toBe(200);
        expect(genRes.body.agenda_text).toBeTruthy();
        expect(genRes.body.generated_at).toBeTruthy();

        // DB に latest_agenda_text が保存されたことを確認
        const updatedSeries = await seriesRepo.findById(sid);
        expect(updatedSeries.latest_agenda_text).toBe(genRes.body.agenda_text);
    });

    // ---------- テスト 7 ----------
    test('POST /rooms/:id/series/generate-next-agenda (series 未紐付き) → 400', async () => {
        const { agent } = await signupFresh('userI');
        // series_id なしでルーム作成
        const roomCreate = await agent.post('/rooms').send({});
        const roomId = roomCreate.body.id;

        const genRes = await agent
            .post(`/rooms/${roomId}/series/generate-next-agenda`)
            .send({});
        expect(genRes.status).toBe(400);
        expect(genRes.body.error).toBe('room_not_linked_to_series');
    });

    // ---------- テスト 8 ----------
    test('POST /rooms/:id/series/generate-next-agenda (非ホスト) → 403', async () => {
        const { agent: hostAgent } = await signupFresh('userJ-host');
        const { agent: guestAgent, account: guestAccount } = await signupFresh('userJ-guest');

        const seriesCreate = await hostAgent.post('/me/series').send({ name: 'J-series', frame_text: 'j' });
        const sid = seriesCreate.body.id;

        const roomCreate = await hostAgent.post('/rooms').send({ series_id: sid });
        const roomId = roomCreate.body.id;

        // ゲストが次回アジェンダを生成しようとする → 403 (owner_account_id が違う)
        const genRes = await guestAgent
            .post(`/rooms/${roomId}/series/generate-next-agenda`)
            .send({});
        expect(genRes.status).toBe(403);
    });
});
