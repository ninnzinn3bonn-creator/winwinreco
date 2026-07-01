const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(({ model }) => ({
    generateContent: (...args) => mockGenerateContent(model, ...args)
}));

jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: mockGetGenerativeModel
    }))
}));

const { AIService } = require('../src/backend/services/ai-service');

describe('AIService Gemini fallback', () => {
    beforeEach(() => {
        mockGenerateContent.mockReset();
        mockGetGenerativeModel.mockClear();
        process.env.GEMINI_API_KEY = 'test-key';
    });

    test('falls back from gemini-2.5-pro to gemini-2.5-flash on quota errors', async () => {
        mockGenerateContent.mockImplementation(async (model) => {
            if (model === 'gemini-2.5-pro') {
                throw new Error('[429 Too Many Requests] Quota exceeded for model');
            }
            return {
                response: Promise.resolve({
                    text: () => JSON.stringify({
                        overall_summary: 'summary',
                        speaker_summaries: [],
                        next_actions: []
                    })
                })
            };
        });

        const service = new AIService({
            apiKey: 'test-key',
            geminiModel: 'gemini-2.5-pro'
        });

        const result = await service.generateStructuredInsights([
            { display_name: 'A', transcript: 'hello', started_at: '2026-04-16T00:00:00.000Z' }
        ]);

        expect(result.overall_summary).toBe('summary');
        expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.5-pro',
            generationConfig: expect.any(Object)
        }));
        expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.5-flash',
            generationConfig: expect.any(Object)
        }));
        expect(service.provider.name).toBe('gemini (gemini-2.5-flash)');
    });

    test('summary prompt adds past-meeting comparison only when past context is provided', async () => {
        const service = new AIService({
            apiKey: 'test-key',
            geminiModel: 'gemini-2.5-flash'
        });
        service.provider = {
            name: 'mock-provider',
            generate: jest.fn(async () => '要約結果')
        };

        await service.generateSummaryFromMinutes(
            '今回の議事録',
            [],
            [],
            { pastContextBlock: '[過去関連会議サマリ]\n前回は試作が未完了。\n[/過去関連会議サマリ]' }
        );
        const promptWithPast = service.provider.generate.mock.calls[0][0];

        await service.generateSummaryFromMinutes('今回の議事録', [], [], {});
        const promptWithoutPast = service.provider.generate.mock.calls[1][0];

        expect(promptWithPast).toContain('## 過去会議との差分');
        expect(promptWithPast).toContain('過去会議の要約');
        expect(promptWithPast).toContain('今回の会議の要約');
        expect(promptWithPast).toContain('変化・差分コメント');
        expect(promptWithoutPast).not.toContain('## 過去会議との差分');
    });
});
