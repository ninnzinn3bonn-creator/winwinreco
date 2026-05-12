'use strict';

/**
 * tests/metrics.test.js
 * recordApiCall() の構造化ログ出力テスト
 */

const { recordApiCall } = require('../src/backend/lib/metrics');

describe('recordApiCall', () => {
    let logSpy;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    test('console.log を 1 回呼び出す', () => {
        recordApiCall({
            provider: 'gemini',
            operation: 'generate',
            tokens_in: 100,
            tokens_out: 50,
            duration_ms: 300,
            status: 'ok'
        });
        expect(logSpy).toHaveBeenCalledTimes(1);
    });

    test('出力が JSON パース可能', () => {
        recordApiCall({
            provider: 'gemini',
            operation: 'generate',
            tokens_in: 100,
            tokens_out: 50,
            duration_ms: 300,
            status: 'ok'
        });
        const line = logSpy.mock.calls[0][0];
        expect(() => JSON.parse(line)).not.toThrow();
    });

    test('必須フィールドが含まれる', () => {
        recordApiCall({
            provider: 'groq',
            operation: 'generate',
            tokens_in: 200,
            tokens_out: 80,
            duration_ms: 500,
            status: 'ok'
        });
        const parsed = JSON.parse(logSpy.mock.calls[0][0]);
        expect(parsed.kind).toBe('api_call');
        expect(parsed.provider).toBe('groq');
        expect(parsed.operation).toBe('generate');
        expect(typeof parsed.duration_ms).toBe('number');
        expect(parsed.status).toBe('ok');
    });

    test('timestamp フィールドが ISO 8601 形式', () => {
        recordApiCall({
            provider: 'ollama',
            operation: 'generate',
            tokens_in: 50,
            duration_ms: 120,
            status: 'ok'
        });
        const parsed = JSON.parse(logSpy.mock.calls[0][0]);
        expect(typeof parsed.timestamp).toBe('string');
        expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
    });

    test('status=error のとき error フィールドが含まれる', () => {
        recordApiCall({
            provider: 'gemini',
            operation: 'generate',
            tokens_in: 100,
            duration_ms: 1200,
            status: 'error',
            error: 'quota exceeded'
        });
        const parsed = JSON.parse(logSpy.mock.calls[0][0]);
        expect(parsed.kind).toBe('api_call');
        expect(parsed.status).toBe('error');
        expect(parsed.error).toBe('quota exceeded');
    });

    test('STT ストリーム終了イベントも記録できる', () => {
        recordApiCall({
            provider: 'google-stt',
            operation: 'stt-stream-end',
            duration_ms: 45000,
            status: 'ok'
        });
        const parsed = JSON.parse(logSpy.mock.calls[0][0]);
        expect(parsed.kind).toBe('api_call');
        expect(parsed.provider).toBe('google-stt');
        expect(parsed.operation).toBe('stt-stream-end');
        expect(parsed.status).toBe('ok');
    });

    test('オプションフィールド (tokens_in/out, room_id) が存在すれば出力に含まれる', () => {
        recordApiCall({
            provider: 'groq',
            operation: 'generate',
            tokens_in: 300,
            tokens_out: 120,
            duration_ms: 700,
            room_id: 'room-abc',
            status: 'ok'
        });
        const parsed = JSON.parse(logSpy.mock.calls[0][0]);
        expect(parsed.tokens_in).toBe(300);
        expect(parsed.tokens_out).toBe(120);
        expect(parsed.room_id).toBe('room-abc');
    });
});
