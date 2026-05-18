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
});
