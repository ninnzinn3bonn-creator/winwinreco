/**
 * [U-3] WebSocket 再接続堅牢化 — hello + last_seen_utterance_id の差分復元テスト
 *
 * テスト対象: src/backend/app.js の sendReady() における last_seen_utterance_id フィルタロジック
 *
 * 手動確認手順 (フロントエンド):
 * 1. DevTools > Network > WS で WebSocket を切断する (または「オフライン」を一時切替)
 *    → 黄色バッジ + Toast「接続が切れました」が表示される
 *    → 指数バックオフで自動再接続が走る
 *    → 再接続成功 → 緑バッジ + Toast「再接続しました」が表示される
 * 2. 30 秒切断後に復帰
 *    → 切断中の発話が差分として UI に反映される (他参加者がしゃべっていれば)
 * 3. 終了ボタンで endRoom()
 *    → wsIntentional=true → 再接続は走らない
 */

const WebSocket = require('ws');
const http = require('http');
const { createApp, setupWebSocket } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { RoomRepository } = require('../src/backend/repo/sqlite/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/sqlite/participant-repo');
const { UtteranceRepository } = require('../src/backend/repo/sqlite/utterance-repo');
const path = require('path');
const fs = require('fs');

describe('[U-3] WebSocket hello last_seen_utterance_id — 差分復元', () => {
    let server;
    let port;
    let db;
    let roomRepo;
    let participantRepo;
    let utteranceRepo;

    const dbPath = path.resolve(__dirname, `./tmp/test_ws_reconnect_${Date.now()}.db`);

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        db = await initDB(dbPath);
        roomRepo = new RoomRepository(db);
        participantRepo = new ParticipantRepository(db);
        utteranceRepo = new UtteranceRepository(db);

        const app = createApp({ roomRepo, participantRepo, utteranceRepo });
        server = http.createServer(app);
        setupWebSocket(server, { participantRepo, utteranceRepo });

        await new Promise((resolve) => {
            server.listen(0, () => {
                port = server.address().port;
                resolve();
            });
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => db.close(resolve));
    });

    /**
     * WS に接続して最初に届く 'ready' メッセージを返す。
     * hello に last_seen_utterance_id を乗せられる。
     * @param {string} participantId
     * @param {string} controlToken
     * @param {string|null} lastSeenUtteranceId
     * @param {string} roomId  — findInRoom 経由で確実に participant を引くために渡す
     */
    async function connectAndGetReady(participantId, controlToken, lastSeenUtteranceId = null, roomId = '') {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                participantId,
                controlToken: controlToken || '',
                roomId: roomId || ''
            });
            const ws = new WebSocket(`ws://localhost:${port}?${params.toString()}`);
            let readyMsg = null;

            // 10 秒以内に ready が来なければ reject
            const timer = setTimeout(() => {
                ws.terminate();
                reject(new Error('Timeout: ready message not received within 10s'));
            }, 10_000);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    type: 'hello',
                    last_seen_utterance_id: lastSeenUtteranceId
                }));
            });

            ws.on('message', (data) => {
                let msg;
                try { msg = JSON.parse(data.toString()); } catch (_) { return; }
                if (msg.type === 'ready') {
                    readyMsg = msg;
                    clearTimeout(timer);
                    ws.close();
                }
            });

            ws.on('close', () => {
                clearTimeout(timer);
                if (readyMsg) resolve(readyMsg);
                else reject(new Error('WS closed without ready message'));
            });

            ws.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    // ----------------------------------------------------------------
    // テストケース 1: last_seen_utterance_id がある場合 → 差分のみ返す
    // ----------------------------------------------------------------
    test('Case 1: last_seen_utterance_id がある → その ID 以降の utterance だけ返す', async () => {
        const roomId = 'room-reconnect-1';
        await roomRepo.create({ id: roomId, owner_id: 'owner-1' });
        await participantRepo.join({ id: 'p-r1', room_id: roomId, display_name: 'Alice', control_token: 'tok-r1' });

        // 3 件の utterance を追加
        const u1 = { id: 'u-r1-1', room_id: roomId, participant_id: 'p-r1', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'first', raw_transcript: 'first', transcript_source: 'stt' };
        const u2 = { id: 'u-r1-2', room_id: roomId, participant_id: 'p-r1', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'second', raw_transcript: 'second', transcript_source: 'stt' };
        const u3 = { id: 'u-r1-3', room_id: roomId, participant_id: 'p-r1', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'third', raw_transcript: 'third', transcript_source: 'stt' };
        await utteranceRepo.add(u1);
        await utteranceRepo.add(u2);
        await utteranceRepo.add(u3);

        // u1 まで見た → u2, u3 だけ返ってくるはず
        const ready = await connectAndGetReady('p-r1', 'tok-r1', 'u-r1-1', roomId);
        expect(ready.history).toHaveLength(2);
        expect(ready.history[0].id).toBe('u-r1-2');
        expect(ready.history[1].id).toBe('u-r1-3');
    });

    // ----------------------------------------------------------------
    // テストケース 2: last_seen_utterance_id が見つからない → 全件返す (フォールバック)
    // ----------------------------------------------------------------
    test('Case 2: last_seen_utterance_id が存在しない ID → 全件返す (フォールバック)', async () => {
        const roomId = 'room-reconnect-2';
        await roomRepo.create({ id: roomId, owner_id: 'owner-2' });
        await participantRepo.join({ id: 'p-r2', room_id: roomId, display_name: 'Bob', control_token: 'tok-r2' });

        const u1 = { id: 'u-r2-1', room_id: roomId, participant_id: 'p-r2', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'alpha', raw_transcript: 'alpha', transcript_source: 'stt' };
        const u2 = { id: 'u-r2-2', room_id: roomId, participant_id: 'p-r2', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'beta', raw_transcript: 'beta', transcript_source: 'stt' };
        await utteranceRepo.add(u1);
        await utteranceRepo.add(u2);

        // 存在しない ID を指定 → 全件返る
        const ready = await connectAndGetReady('p-r2', 'tok-r2', 'u-nonexistent-id', roomId);
        expect(ready.history).toHaveLength(2);
        expect(ready.history[0].id).toBe('u-r2-1');
        expect(ready.history[1].id).toBe('u-r2-2');
    });

    // ----------------------------------------------------------------
    // テストケース 3: last_seen_utterance_id が null → 全件返す (既存挙動互換)
    // ----------------------------------------------------------------
    test('Case 3: last_seen_utterance_id が null (省略) → 全件返す (既存互換)', async () => {
        const roomId = 'room-reconnect-3';
        await roomRepo.create({ id: roomId, owner_id: 'owner-3' });
        await participantRepo.join({ id: 'p-r3', room_id: roomId, display_name: 'Charlie', control_token: 'tok-r3' });

        const u1 = { id: 'u-r3-1', room_id: roomId, participant_id: 'p-r3', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), transcript: 'hello', raw_transcript: 'hello', transcript_source: 'stt' };
        await utteranceRepo.add(u1);

        // last_seen_utterance_id を null のまま → 全件
        const ready = await connectAndGetReady('p-r3', 'tok-r3', null, roomId);
        expect(ready.history).toHaveLength(1);
        expect(ready.history[0].id).toBe('u-r3-1');
    });
});
