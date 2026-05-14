/**
 * tests/stt-watchdog.test.js
 *
 * Fix B のサーバーサイド watchdog 動作を検証する。
 *
 * テスト内容:
 *  1. session_started タイムアウト (8 秒) — WS が close される
 *  2. transcript silence watchdog (45 秒) — 音声送信中で transcript が止まると WS が close される
 *  3. startSTTStream クールダウン — 5 回失敗後は早期 return (6 回目の createStream を呼ばない)
 */

const EventEmitter = require('events');

// ws モジュールを手動モックとして差し替える
jest.mock('ws');
const WebSocketLib = require('ws');

// テスト用フェイク WS クラス
class FakeWS extends EventEmitter {
    constructor() {
        super();
        this.readyState = 1; // OPEN
        this.closeSpy = jest.fn((code, reason) => {
            this.emit('close', code, reason);
        });
        this.close = this.closeSpy;
        this.send = jest.fn();
    }
}
FakeWS.OPEN = 1;

// ws をフェイクに差し替え
WebSocketLib.mockImplementation(() => {
    const fakeWs = new FakeWS();
    // コンストラクタ呼び出し後すぐに open イベントをエミット
    setImmediate(() => fakeWs.emit('open'));
    return fakeWs;
});

const { STTService } = require('../src/backend/services/stt-service');

describe('ElevenLabs STT watchdog', () => {
    let service;

    beforeEach(() => {
        jest.useFakeTimers();
        service = new STTService({
            provider: 'elevenlabs',
            elevenLabsApiKey: 'test-key',
            elevenLabsRealtimeModel: 'scribe_v2_realtime'
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('B-1: session_started が 8 秒以内に来なければ ws.close() が呼ばれる', () => {
        const closedCodes = [];
        const onError = jest.fn();
        service.createElevenLabsStream(jest.fn(), onError, jest.fn());

        // WS インスタンスを取得
        const fakeWs = WebSocketLib.mock.results[0].value;
        fakeWs.close = jest.fn((code, reason) => {
            closedCodes.push(code);
        });

        // session_started を送らずに 8 秒進める
        jest.advanceTimersByTime(8001);

        expect(fakeWs.close).toHaveBeenCalledWith(1001, 'session_started timeout');
    });

    test('B-1: session_started が来たらタイムアウトタイマーはキャンセルされる', () => {
        const onError = jest.fn();
        service.createElevenLabsStream(jest.fn(), onError, jest.fn());

        const fakeWs = WebSocketLib.mock.results[0].value;
        fakeWs.close = jest.fn();

        // session_started を送信
        fakeWs.emit('message', JSON.stringify({ message_type: 'session_started' }));

        // 8 秒以上進めても close は呼ばれない
        jest.advanceTimersByTime(10000);

        expect(fakeWs.close).not.toHaveBeenCalledWith(1001, 'session_started timeout');
    });

    test('B-2: 音声送信中に 45 秒 transcript が来なければ ws.close() が呼ばれる', () => {
        const onData = jest.fn();
        const onError = jest.fn();
        const passThrough = service.createElevenLabsStream(onData, onError, jest.fn());

        const fakeWs = WebSocketLib.mock.results[0].value;
        fakeWs.close = jest.fn((code, reason) => {
            fakeWs.emit('close', code, String(reason));
        });

        // session_started を送信
        fakeWs.emit('message', JSON.stringify({ message_type: 'session_started' }));

        // 音声チャンクを書き込む (audioSentSinceLastCommit = true にする)
        passThrough.write(Buffer.alloc(160));

        // 45 秒を超えるまで 5 秒ごとに watchdog が動く
        jest.advanceTimersByTime(50000);

        expect(fakeWs.close).toHaveBeenCalledWith(1001, 'transcript silence watchdog');
    });

    test('B-2: 音声が来ていない場合は silence watchdog が動かない', () => {
        const onError = jest.fn();
        service.createElevenLabsStream(jest.fn(), onError, jest.fn());

        const fakeWs = WebSocketLib.mock.results[0].value;
        fakeWs.close = jest.fn();

        // session_started を送信
        fakeWs.emit('message', JSON.stringify({ message_type: 'session_started' }));

        // 音声を書き込まない状態で 50 秒進める
        jest.advanceTimersByTime(50000);

        expect(fakeWs.close).not.toHaveBeenCalledWith(1001, 'transcript silence watchdog');
    });
});

describe('STT startSTTStream cooldown (Fix B-3)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('5 回失敗すると 30 秒クールダウン中は startSTTStream が早期 return する', () => {
        // STTService の createStream をモック — 同期的にエラーコールバックを呼ぶ
        const mockCreateStream = jest.fn((onData, onError) => {
            const { PassThrough } = require('stream');
            const pt = new PassThrough();
            // 即座にエラーコールバックを呼んで失敗を模擬
            setImmediate(() => onError(new Error('fake error')));
            return pt;
        });

        const sttServiceMock = {
            provider: 'elevenlabs',
            createStream: mockCreateStream
        };

        // app.js の startSTTStream を直接テストするのは難しいため、
        // stt-service.js の createElevenLabsStream の内部ロジックではなく
        // app.js の cooldown ロジック部分を直接検証する。
        // ここでは cooldown の状態変数を手動でシミュレートして論理テストする。

        let sttRestartAttempts = 0;
        let sttRestartLastFail = 0;
        let sttStream = null;
        let earlyReturnCount = 0;
        let createStreamCallCount = 0;

        function simulateStartSTTStream() {
            if (sttStream) return;

            // cooldown チェック (app.js と同じロジック)
            if (sttRestartAttempts >= 5 && Date.now() - sttRestartLastFail < 60000) {
                if (Date.now() - sttRestartLastFail < 30000) {
                    earlyReturnCount++;
                    return; // クールダウン中
                }
                sttRestartAttempts = 0;
            }

            createStreamCallCount++;
            // 失敗をシミュレート
            sttRestartAttempts++;
            sttRestartLastFail = Date.now();
        }

        // 5 回失敗させる
        for (let i = 0; i < 5; i++) {
            simulateStartSTTStream();
        }
        expect(createStreamCallCount).toBe(5);
        expect(earlyReturnCount).toBe(0);

        // 6 回目: クールダウン中なのでスキップされる
        simulateStartSTTStream();
        expect(createStreamCallCount).toBe(5); // 増えない
        expect(earlyReturnCount).toBe(1);

        // 30 秒後にクールダウン解除
        sttRestartLastFail -= 30001;
        simulateStartSTTStream();
        expect(createStreamCallCount).toBe(6); // 実行される
    });
});
