const speech = require('@google-cloud/speech');

class STTService {
    constructor(options = {}) {
        const apiKey = process.env.GOOGLE_API_KEY;
        this.client = options.client || new speech.SpeechClient({ apiKey });
        this.config = {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000, 
            languageCode: 'ja-JP',
            audioChannelCount: 1,
            ...options.config
        };
    }

    createStream(onData, onError) {
        const request = {
            config: this.config,
            interimResults: false,
        };

        return this.client
            .streamingRecognize(request)
            .on('error', (err) => {
                console.error('[STT Stream Error]:', err.message);
                onError(err);
            })
            .on('data', (data) => {
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const transcript = data.results[0].alternatives[0].transcript;
                    onData(transcript);
                }
            });
    }

    // Keep recognize for backward compatibility or simple tests
    async recognize(audioBuffer) {
        // ... (existing code if needed, but we'll use streaming)
    }
}

module.exports = { STTService };
