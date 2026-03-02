const { AudioProcessor } = require('../src/backend/services/audio-processor');

describe('AudioProcessor', () => {
    test('should buffer chunks and return full buffer when limit reached', () => {
        const processor = new AudioProcessor({ chunkLimit: 3 });
        const participantId = 'p1';

        const chunk1 = Buffer.from([1, 2]);
        const chunk2 = Buffer.from([3, 4]);
        const chunk3 = Buffer.from([5, 6]);

        let result = processor.addChunk(participantId, chunk1);
        expect(result).toBeNull();

        result = processor.addChunk(participantId, chunk2);
        expect(result).toBeNull();

        result = processor.addChunk(participantId, chunk3);
        expect(result).toBeDefined();
        expect(result.length).toBe(6);
        expect(result).toEqual(Buffer.concat([chunk1, chunk2, chunk3]));
        
        // Buffer should be cleared after returning
        result = processor.addChunk(participantId, chunk1);
        expect(result).toBeNull();
    });
});
