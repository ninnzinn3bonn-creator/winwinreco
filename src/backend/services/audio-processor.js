class AudioProcessor {
    constructor(options = {}) {
        this.chunkLimit = options.chunkLimit || 5; // Process every 5 chunks (approx 5 seconds)
        this.buffers = new Map(); // participantId -> Buffer[]
        this.headers = new Map(); // participantId -> Buffer (The first chunk containing headers)
    }

    addChunk(participantId, chunk) {
        if (!this.headers.has(participantId)) {
            this.headers.set(participantId, chunk);
            // We don't add header to buffer, we just store it
            return null;
        }

        if (!this.buffers.has(participantId)) {
            this.buffers.set(participantId, []);
        }

        const bufferList = this.buffers.get(participantId);
        bufferList.push(chunk);

        if (bufferList.length >= this.chunkLimit) {
            // Prepend header to create a valid WebM container for each recognition request
            const header = this.headers.get(participantId);
            const fullBuffer = Buffer.concat([header, ...bufferList]);
            this.buffers.set(participantId, []); // Reset buffer for this participant
            return fullBuffer;
        }

        return null;
    }

    clear(participantId) {
        this.buffers.delete(participantId);
        this.headers.delete(participantId);
    }
}

module.exports = { AudioProcessor };
