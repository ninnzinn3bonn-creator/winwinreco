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
        expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-2.5-pro' });
        expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-2.5-flash' });
        expect(service.provider.name).toBe('gemini (gemini-2.5-flash)');
    });
});
