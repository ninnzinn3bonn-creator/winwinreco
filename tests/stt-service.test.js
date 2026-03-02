const { STTService } = require('../src/backend/services/stt-service');

describe('STTService', () => {
    test('should return transcript for audio buffer (mocked)', async () => {
        const mockSpeechClient = {
            recognize: jest.fn().mockResolvedValue([
                {
                    results: [
                        { alternatives: [{ transcript: 'Hello, world!' }] }
                    ]
                }
            ])
        };

        const service = new STTService({ client: mockSpeechClient });
        const audioBuffer = Buffer.from([1, 2, 3]);
        
        const result = await service.recognize(audioBuffer);
        
        expect(result).toBe('Hello, world!');
        expect(mockSpeechClient.recognize).toHaveBeenCalled();
    });

    test('should return empty string if no results', async () => {
        const mockSpeechClient = {
            recognize: jest.fn().mockResolvedValue([{ results: [] }])
        };
        const service = new STTService({ client: mockSpeechClient });
        const result = await service.recognize(Buffer.from([1]));
        expect(result).toBe('');
    });
});
