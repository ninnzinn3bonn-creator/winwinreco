const speech = require('@google-cloud/speech');
const { PassThrough } = require('stream');
const WebSocket = require('ws');

function pcm16ToWav(audioBuffer, {
    sampleRate = 16000,
    channels = 1,
    bitDepth = 16
} = {}) {
    const dataSize = audioBuffer.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
    header.writeUInt16LE(channels * (bitDepth / 8), 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, audioBuffer]);
}

class STTService {
    constructor(options = {}) {
        this.provider = options.provider
            || process.env.STT_PROVIDER
            || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : process.env.GROQ_API_KEY ? 'groq' : 'google');

        this.sampleRate = options.sampleRate || 16000;
        this.language = options.language || 'ja';
        this.googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY;
        this.groqApiKey = options.groqApiKey || process.env.GROQ_API_KEY;
        this.groqModel = options.groqModel || process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
        this.elevenLabsApiKey = options.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
        // バッチ API 用モデル (scribe_v2) とリアルタイム WS 用モデル (scribe_v2_realtime) は別物
        this.elevenLabsModel = options.elevenLabsModel || process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
        this.elevenLabsRealtimeModel = options.elevenLabsRealtimeModel || process.env.ELEVENLABS_STT_REALTIME_MODEL || 'scribe_v2_realtime';
        this.fetchImpl = options.fetchImpl || global.fetch;

        if (this.provider === 'google') {
            this.client = options.client || new speech.SpeechClient({ apiKey: this.googleApiKey });
            this.config = {
                encoding: 'LINEAR16',
                sampleRateHertz: this.sampleRate,
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
        } else {
            this.client = null;
            this.config = options.config || {};
        }
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

    // -----------------------------------------------------------------------
    // ElevenLabs: リアルタイムストリーミング認識
    //
    // 正しいプロトコル:
    //   - モデル・言語は URL クエリパラメータで指定 (model_id, language_code)
    //   - 認証は xi-api-key ヘッダー
    //   - 接続後は初期化メッセージ不要。すぐに input_audio_chunk を送る
    //   - リアルタイム専用モデル: scribe_v2_realtime (バッチの scribe_v2 とは別)
    // -----------------------------------------------------------------------
    createElevenLabsStream(onData, onError) {
        if (!this.elevenLabsApiKey) {
            const err = new Error('ELEVENLABS_API_KEY is not set.');
            onError(err);
            return new PassThrough();
        }

        const params = new URLSearchParams({
            model_id: this.elevenLabsRealtimeModel
        });
        const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`;

        console.log(`[ElevenLabs STT] Connecting to ${wsUrl}`);

        const ws = new WebSocket(wsUrl, {
            headers: { 'xi-api-key': this.elevenLabsApiKey }
        });

        const passThrough = new PassThrough();
        // session_started を受け取るまで音声チャンクをキューイング
        let sessionReady = false;
        const pending = [];
        // 最後のコミット以降に実際に音声を送ったかどうか。
        // 送っていない場合はコミットしない（空コミット → WS 強制切断を防ぐ）。
        let audioSentSinceLastCommit = false;

        const sendChunk = (buf, commit = false) => {
            ws.send(JSON.stringify({
                message_type: 'input_audio_chunk',
                audio_base_64: commit ? '' : buf.toString('base64'),
                commit,
                sample_rate: this.sampleRate
            }));
        };

        ws.on('open', () => {
            console.log('[ElevenLabs STT] WebSocket connected, waiting for session_started...');
        });

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }

            console.log('[ElevenLabs STT] msg:', JSON.stringify(msg).slice(0, 200));

            switch (msg.message_type) {
                case 'session_started':
                    console.log('[ElevenLabs STT] session_started — flushing', pending.length, 'pending chunks');
                    sessionReady = true;
                    for (const buf of pending) {
                        sendChunk(buf);
                    }
                    pending.length = 0;
                    break;

                case 'partial_transcript':
                    if (msg.text) {
                        console.log('[ElevenLabs STT] partial:', msg.text);
                    }
                    break;

                case 'committed_transcript':
                    if (msg.text) {
                        console.log('[ElevenLabs STT] committed transcript:', msg.text);
                        onData(msg.text);
                    }
                    break;

                default:
                    if (msg.error || msg.message_type === 'error') {
                        const errMsg = `ElevenLabs STT error: ${msg.error || msg.message || JSON.stringify(msg)}`;
                        console.error('[ElevenLabs STT]', errMsg);
                        onError(new Error(errMsg));
                    }
                    break;
            }
        });

        ws.on('error', (err) => {
            console.error('[ElevenLabs STT Error]:', err.message);
            onError(err);
        });

        ws.on('close', (code, reason) => {
            console.log(`[ElevenLabs STT] WebSocket closed: code=${code} reason=${reason}`);
            // WS が閉じたら PassThrough も破棄する。
            // app.js の sttStream.on('close') が sttStream = null するので、
            // 次の音声チャンク到着時に startSTTStream() が新しい接続を作り直す。
            if (!passThrough.destroyed) {
                passThrough.destroy();
            }
        });

        // PassThrough に流れてきた音声チャンクを WS へ転送
        passThrough.on('data', (chunk) => {
            const buf = Buffer.from(chunk);
            if (sessionReady && ws.readyState === WebSocket.OPEN) {
                sendChunk(buf);
                audioSentSinceLastCommit = true;
            } else {
                pending.push(buf);
            }
        });

        // 途中コミット（セッション維持）: WS を閉じずに commit フラグだけ送る。
        // 無音検出タイマーから呼ばれる。ElevenLabs はコミット後も同一セッションで
        // 音声を受け付け、次の committed_transcript を送り返してくる。
        // audioSentSinceLastCommit が false（ミュート中など音声ゼロ）のときは
        // 空コミットを送らない — 空コミットを受けた ElevenLabs が WS を閉じるのを防ぐ。
        passThrough.commit = () => {
            if (!audioSentSinceLastCommit) return;
            if (sessionReady && ws.readyState === WebSocket.OPEN) {
                console.log('[ElevenLabs STT] mid-session commit sent');
                audioSentSinceLastCommit = false;
                sendChunk(null, true);
            }
        };

        passThrough.on('finish', () => {
            if (ws.readyState === WebSocket.OPEN) {
                // セッション終了時の最終コミット
                sendChunk(null, true);
                setTimeout(() => ws.close(), 5000);
            }
        });

        return passThrough;
    }

    // -----------------------------------------------------------------------
    // ElevenLabs: バッチ認識 (非ストリーミング用 fallback)
    // /v1/speech-to-text REST API に WAV を送信する。
    // -----------------------------------------------------------------------
    async recognizeWithElevenLabs(audioBuffer, options = {}) {
        if (!this.elevenLabsApiKey) {
            throw new Error('ELEVENLABS_API_KEY is not set.');
        }
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('fetch is unavailable for ElevenLabs STT requests.');
        }

        const wavBuffer = pcm16ToWav(audioBuffer, { sampleRate: this.sampleRate });
        const form = new FormData();
        form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
        form.append('model_id', this.elevenLabsModel);
        form.append('language_code', 'jpn');

        const response = await this.fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: { 'xi-api-key': this.elevenLabsApiKey },
            body: form
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`ElevenLabs STT error (${response.status}): ${detail}`);
        }

        const data = await response.json();
        return String(data?.text || '').trim();
    }

    createStream(onData, onError, options = {}) {
        // ElevenLabs: WebSocket リアルタイムストリームを返す
        if (this.provider === 'elevenlabs') {
            return this.createElevenLabsStream(onData, onError);
        }

        // Google: ネイティブストリーミング
        if (this.provider === 'google' && typeof this.client?.streamingRecognize === 'function') {
            const request = {
                config: this.buildConfig(options.config || {}),
                interimResults: false
            };

            return this.client
                .streamingRecognize(request)
                .on('error', (err) => {
                    console.error('[STT Stream Error]:', err.message);
                    onError(err);
                })
                .on('data', (data) => {
                    if (data.results?.[0]?.alternatives?.[0]) {
                        onData(data.results[0].alternatives[0].transcript);
                    }
                });
        }

        // Groq / その他: バッファしてバッチ認識
        const fallback = new PassThrough();
        const chunks = [];

        fallback.on('data', (chunk) => {
            chunks.push(Buffer.from(chunk));
        });

        fallback.on('finish', async () => {
            try {
                const transcript = await this.recognize(Buffer.concat(chunks), options);
                if (transcript) onData(transcript);
            } catch (err) {
                onError(err);
            }
        });

        return fallback;
    }

    async recognize(audioBuffer, options = {}) {
        if (!audioBuffer || !audioBuffer.length) {
            return '';
        }

        if (this.provider === 'elevenlabs') {
            return this.recognizeWithElevenLabs(audioBuffer, options);
        }

        if (this.provider === 'groq') {
            return this.recognizeWithGroq(audioBuffer, options);
        }

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
            .map((result) => result.alternatives?.[0]?.transcript || '')
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    async recognizeWithGroq(audioBuffer, options = {}) {
        if (!this.groqApiKey) {
            throw new Error('GROQ_API_KEY is not set.');
        }
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('fetch is unavailable for Groq STT requests.');
        }

        const wavBuffer = pcm16ToWav(audioBuffer, { sampleRate: this.sampleRate });
        const form = new FormData();
        const promptHints = options?.config?.speechContexts?.[0]?.phrases;
        const prompt = Array.isArray(promptHints) && promptHints.length
            ? `Japanese meeting transcription. Prefer these spellings and names when relevant: ${promptHints.slice(0, 30).join(', ')}`
            : 'Japanese meeting transcription with technical terms and proper nouns.';

        form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
        form.append('model', this.groqModel);
        form.append('language', this.language);
        form.append('temperature', '0');
        form.append('response_format', 'json');
        form.append('prompt', prompt);

        const response = await this.fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.groqApiKey}`
            },
            body: form
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Groq STT error (${response.status}): ${detail}`);
        }

        const data = await response.json();
        return String(data?.text || '').trim();
    }
}

module.exports = { STTService, pcm16ToWav };
