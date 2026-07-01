'use strict';

/**
 * tests/ai-elevenlabs-prompt.test.js
 * ElevenLabs / Google STT プロバイダ別プロンプト切替テスト
 */

process.env.GEMINI_API_KEY = 'dummy';

const { AIService } = require('../src/backend/services/ai-service');

describe('ElevenLabs prompt switch', () => {
    let svc;

    beforeEach(() => {
        svc = new AIService({ apiKey: 'x', provider: 'gemini' });
    });

    test('_isHighAccuracyStt detects elevenlabs (case insensitive)', () => {
        expect(svc._isHighAccuracyStt({ stt_provider: 'elevenlabs' })).toBe(true);
        expect(svc._isHighAccuracyStt({ stt_provider: 'ElevenLabs' })).toBe(true);
        expect(svc._isHighAccuracyStt({ stt_provider: 'google' })).toBe(false);
        expect(svc._isHighAccuracyStt({})).toBe(false);
    });

    test('_buildMinutesEditingRules: ElevenLabs forbids 書き言葉変換', () => {
        const rules = svc._buildMinutesEditingRules({ stt_provider: 'elevenlabs' });
        expect(rules.systemNote).toMatch(/話し言葉/);
        expect(rules.forbidden).toMatch(/書き言葉|敬語|ですます調/);
        expect(rules.forbidden).toMatch(/口調.*語尾/);
    });

    test('_buildMinutesEditingRules: Google permits 誤認識修正', () => {
        const rules = svc._buildMinutesEditingRules({ stt_provider: 'google' });
        expect(rules.allowed).toMatch(/誤認識.*修正/);
        expect(rules.forbidden).not.toMatch(/書き言葉/);
    });

    test('_buildMinutesEditingRules default (no stt_provider) = Google', () => {
        const rules = svc._buildMinutesEditingRules({});
        expect(rules.allowed).toMatch(/誤認識/);
    });

    test('M1-C: chunk prompt marks overlap context as non-output', async () => {
        const generate = jest.fn(async () => 'chunk minutes');
        svc.getProvider = jest.fn(() => ({ name: 'mock-provider', generate }));

        await svc.generateMinutesPerChunk(
            {
                index: 1,
                startTs: '2026-06-30T10:10:00.000Z',
                endTs: '2026-06-30T10:20:00.000Z',
                overlapWith: ['utt-overlap'],
                utterances: [
                    {
                        id: 'utt-overlap',
                        display_name: 'Alice',
                        transcript: '前チャンクと重複する発話です。',
                        started_at: '2026-06-30T10:09:40.000Z'
                    },
                    {
                        id: 'utt-target',
                        display_name: 'Bob',
                        transcript: 'ここから新しい発話です。',
                        started_at: '2026-06-30T10:10:10.000Z'
                    }
                ]
            },
            3,
            { stt_provider: 'elevenlabs' },
            [],
            [],
            {}
        );

        const prompt = generate.mock.calls[0][0];
        expect(prompt).toContain('[CONTEXT - 前チャンクの末尾。文脈参照のみ、出力には含めないこと]');
        expect(prompt).toContain('上記 CONTEXT と同じ発話');
        expect(prompt).toContain('[OUTPUT TARGET - ここから先のみを発言録として出力してください]');
        expect(prompt).toMatch(/Alice: 前チャンクと重複する発話です。[\s\S]*Bob: ここから新しい発話です。/);
    });
});
