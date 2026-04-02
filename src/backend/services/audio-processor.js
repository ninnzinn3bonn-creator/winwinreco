class AudioProcessor {
    constructor(options = {}) {
        this.chunkLimit = options.chunkLimit || 5;
        this.buffers = new Map();
    }

    addChunk(participantId, chunk) {
        if (!this.buffers.has(participantId)) {
            this.buffers.set(participantId, []);
        }

        const bufferList = this.buffers.get(participantId);
        bufferList.push(chunk);

        if (bufferList.length >= this.chunkLimit) {
            const fullBuffer = Buffer.concat(bufferList);
            this.buffers.set(participantId, []);
            return fullBuffer;
        }

        return null;
    }

    clear(participantId) {
        this.buffers.delete(participantId);
    }
}

module.exports = { AudioProcessor };
