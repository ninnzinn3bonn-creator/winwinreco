const speech = require('@google-cloud/speech');
const { PassThrough } = require('stream');

class STTService {
    constructor(options = {}) {
        const apiKey = process.env.GOOGLE_API_KEY;
        this.client = options.client || new speech.SpeechClient({ apiKey });
        this.config = {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000, 
            languageCode: 'ja-JP',
            audioChannelCount: 1,
            enableAutomaticPunctuation: true,
            model: 'latest_long',
            useEnhanced: true,
            metadata: {
                microphoneDistance: 'NEARFIELD'
            },
            ...options.config
        };
    }

    buildConfig(overrides = {}) {
        const nextConfig = { ...this.config, ...overrides };
        if (this.config.metadata || overrides.metadata) {
            nextConfig.metadata = {
                ...(this.config.metadata || {}),
                ...(overrides.metadata || {})
            };
        }
        return nextConfig;
    }

    createStream(onData, onError, options = {}) {
        if (typeof this.client.streamingRecognize !== 'function') {
            const fallback = new PassThrough();
            const chunks = [];

            fallback.on('data', (chunk) => {
                chunks.push(Buffer.from(chunk));
            });

            fallback.on('finish', async () => {
                try {
                    const transcript = await this.recognize(Buffer.concat(chunks));
                    if (transcript) onData(transcript);
                } catch (err) {
                    onError(err);
                }
            });

            return fallback;
        }

        const request = {
            config: this.buildConfig(options.config || {}),
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
    async recognize(audioBuffer, options = {}) {
        const [response] = await this.client.recognize({
            config: this.buildConfig(options.config || {}),
            audio: {
                content: audioBuffer.toString('base64')
            }
        });

        if (!response.results || response.results.length === 0) {
            return '';
        }

        return response.results
            .map((result) => result.alternatives && result.alternatives[0] ? result.alternatives[0].transcript : '')
            .filter(Boolean)
            .join(' ')
            .trim();
    }
}

module.exports = { STTService };
