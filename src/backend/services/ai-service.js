const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { logger } = require('../lib/logger');
const { recordApiCall } = require('../lib/metrics');

/**
 * Japanese text wrapper for character encoding consistency
 */
function jp(text) {
    return text;
}

/**
 * Helper to strip Markdown code fences and surrounding text
 */
function stripCodeFence(text) {
    if (!text) return '';
    const str = String(text).trim();
    // Try to extract content between triple backticks
    const match = str.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match) {
        return match[1].trim();
    }
    // Fallback: just strip markers if they are at start/end
    return str
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

/**
 * Helper to safely parse JSON from AI response
 */
function safeJsonParse(text) {
    const stripped = stripCodeFence(text);
    try {
        return JSON.parse(stripped);
    } catch (e) {
        // Try to find the first '{' and last '}' to extract a JSON object manually
        const firstBrace = stripped.indexOf('{');
        const lastBrace = stripped.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const candidate = stripped.slice(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(candidate);
            } catch (e2) {
                logger.error(e2, { tag: '[AIService] Failed to parse JSON even after brace extraction' });
            }
        }
        logger.error(e, { tag: '[AIService] JSON parse error', snippet: stripped.slice(0, 100) });
        throw e; // Rethrow to be caught by the caller with context
    }
}

function truncate(text, max) {
    const value = String(text || '').trim();
    return value.length > max ? value.slice(0, max) : value;
}

function cleanTask(task) {
    return String(task || '').trim();
}

function formatMinuteTimestamp(start, end) {
    const startValue = String(start || '').trim();
    const endValue = String(end || '').trim();
    if (!startValue && !endValue) return '';
    if (!endValue || startValue === endValue) return startValue;
    return `${startValue} - ${endValue}`;
}

/**
 * [L8] タイムアウト + 指数バックオフリトライ。
 *
 * @param {() => Promise<any>} fn          実行する非同期関数
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=60000]  1 回あたりのタイムアウト (ms)
 * @param {number} [opts.retries=3]        最大リトライ回数
 * @param {any}    [opts.placeholder=null] 全失敗時に返す値 (null の場合はエラー再スロー)
 * @returns {Promise<any>}
 */
async function withTimeoutAndRetry(fn, { timeoutMs = 60000, retries = 3, placeholder = null } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Chunk timeout after ${timeoutMs}ms`)), timeoutMs)
                ),
            ]);
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                // 指数バックオフ: 1s, 2s, 4s
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }
    if (placeholder !== null) return placeholder;
    throw lastError;
}

class GroqProvider {
    constructor(apiKey, modelName = 'openai/gpt-oss-120b') {
        if (!apiKey) throw new Error('GROQ_API_KEY is not set.');
        this.client = new Groq({ apiKey });
        this.modelName = modelName;
        this.name = `groq (${modelName})`;
    }

    async generate(prompt, options = {}) {
        const start = Date.now();
        const tokensIn = Math.ceil((prompt || '').length * 0.6);

        // Groq on_demand tier の TPM (tokens-per-minute) は 8000。
        // 入力 + 想定出力 (1024〜16384) で簡単に超過するので、
        // 推定入力が 6000 トークンを超えたら Gemini にフォールバックする。
        // Gemini は 1M tokens/min なので余裕がある。
        const TPM_SAFETY_THRESHOLD = 6000;
        const geminiKey = process.env.GEMINI_API_KEY;
        if (tokensIn > TPM_SAFETY_THRESHOLD && geminiKey && geminiKey !== 'dummy') {
            logger.warn('[GroqProvider] tokens_in exceeds TPM safety threshold, falling back to Gemini', {
                tokens_in: tokensIn,
                threshold: TPM_SAFETY_THRESHOLD,
                tag: 'tpm_fallback'
            });
            const gemini = new GeminiProvider(geminiKey);
            // fallback の API 呼出も recordApiCall を内部で行うので、ここでは
            // 元の Groq を呼んだ事実だけ skipped で記録しておく。
            recordApiCall({
                provider: 'groq',
                operation: 'generate',
                tokens_in: tokensIn,
                duration_ms: 0,
                status: 'skipped',
                error: 'tpm_fallback_to_gemini'
            });
            return gemini.generate(prompt, options);
        }

        try {
            const chatCompletion = await this.client.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: this.modelName,
                // 出力切り詰め対策。議事録は逐語で長文になるので 16384 を既定値とする。
                max_completion_tokens: options.maxOutputTokens || 16384,
                response_format: options.json ? { type: 'json_object' } : undefined
            });
            const result = chatCompletion.choices[0]?.message?.content || "";
            recordApiCall({
                provider: this.name.split(' ')[0],
                operation: 'generate',
                tokens_in: tokensIn,
                tokens_out: Math.ceil((result || '').length * 0.6),
                duration_ms: Date.now() - start,
                status: 'ok'
            });
            return result;
        } catch (error) {
            // 413 rate_limit_exceeded を捕捉して Gemini フォールバックを試みる
            // (静的閾値で漏れた場合の二段目の防御)
            const errMsg = String(error?.message || error);
            const isRateLimit = errMsg.includes('rate_limit_exceeded')
                || errMsg.includes('Request too large')
                || errMsg.includes('tokens per minute');
            if (isRateLimit && geminiKey && geminiKey !== 'dummy') {
                logger.warn('[GroqProvider] rate_limit_exceeded, falling back to Gemini', {
                    tokens_in: tokensIn,
                    error: errMsg.slice(0, 200),
                    tag: 'tpm_fallback'
                });
                recordApiCall({
                    provider: this.name.split(' ')[0],
                    operation: 'generate',
                    tokens_in: tokensIn,
                    duration_ms: Date.now() - start,
                    status: 'fallback',
                    error: errMsg.slice(0, 200)
                });
                const gemini = new GeminiProvider(geminiKey);
                return gemini.generate(prompt, options);
            }
            recordApiCall({
                provider: this.name.split(' ')[0],
                operation: 'generate',
                tokens_in: tokensIn,
                duration_ms: Date.now() - start,
                status: 'error',
                error: errMsg.slice(0, 200)
            });
            throw error;
        }
    }
}

class GeminiProvider {
    constructor(apiKey, modelName) {
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
        this.genAI = new GoogleGenerativeAI(apiKey);
        const envPreferredModel = process.env.GEMINI_MODEL === 'gemini-2.5-pro'
            ? 'gemini-2.5-flash'
            : process.env.GEMINI_MODEL;
        this.preferredModelName = modelName || envPreferredModel || 'gemini-2.5-flash';
        this.currentModelName = this.preferredModelName;
        this.fallbackModelNames = [
            this.preferredModelName,
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash'
        ].filter((name, index, array) => name && array.indexOf(name) === index);
        this.name = `gemini (${this.currentModelName})`;
    }

    get model() {
        return this.genAI.getGenerativeModel({ model: this.currentModelName });
    }

    isRetryableModelError(error) {
        const message = String(error?.message || '');
        // 429 (quota / rate limit)、404/400 (モデル不在) は別モデルに切替
        if (
            message.includes('[429') ||
            message.includes('Too Many Requests') ||
            message.includes('Quota exceeded') ||
            message.includes('is not found for API version') ||
            message.includes('is not supported for generateContent')
        ) return true;
        // 503 (Service Unavailable / high demand) は一時障害なので別モデル + バックオフリトライ
        if (
            message.includes('[503') ||
            message.includes('Service Unavailable') ||
            message.includes('high demand') ||
            message.includes('UNAVAILABLE') ||
            message.includes('overloaded')
        ) return true;
        return false;
    }

    isTransientError(error) {
        // 一時的なエラー (503 / overloaded) は同じモデルでもバックオフリトライする価値がある
        const message = String(error?.message || '');
        return (
            message.includes('[503') ||
            message.includes('Service Unavailable') ||
            message.includes('high demand') ||
            message.includes('UNAVAILABLE') ||
            message.includes('overloaded')
        );
    }

    async generate(prompt, options = {}) {
        const start = Date.now();
        const tokensIn = Math.ceil((prompt || '').length * 0.6);
        let lastError = null;

        for (const modelName of this.fallbackModelNames) {
            // 各モデルにつき、503 のような一時障害なら指数バックオフで最大 3 回試行する。
            // それでもダメなら次のフォールバックモデルへ。
            const MAX_ATTEMPTS = 3;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                try {
                    this.currentModelName = modelName;
                    this.name = `gemini (${modelName})`;

                    const generationConfig = {
                        // 議事録は逐語で長文になるので 16384 を既定値とする (Gemini 2.5 Flash は 65536 まで対応)。
                        maxOutputTokens: options.maxOutputTokens || 16384,
                    };

                    if (options.json) {
                        generationConfig.responseMimeType = "application/json";
                    }

                    const model = this.genAI.getGenerativeModel({
                        model: this.currentModelName,
                        generationConfig
                    });

                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();
                    recordApiCall({
                        provider: this.name.split(' ')[0],
                        operation: 'generate',
                        tokens_in: tokensIn,
                        tokens_out: Math.ceil((text || '').length * 0.6),
                        duration_ms: Date.now() - start,
                        status: 'ok'
                    });
                    return text;
                } catch (error) {
                    lastError = error;
                    if (!this.isRetryableModelError(error)) {
                        recordApiCall({
                            provider: this.name.split(' ')[0],
                            operation: 'generate',
                            tokens_in: tokensIn,
                            duration_ms: Date.now() - start,
                            status: 'error',
                            error: String(error?.message || error).slice(0, 200)
                        });
                        throw error;
                    }
                    // 503 系の一時障害なら、同じモデルでバックオフしてリトライ。
                    // それ以外 (quota / model not found) は即座に次のモデルへ。
                    if (this.isTransientError(error) && attempt < MAX_ATTEMPTS - 1) {
                        const waitMs = (1 << attempt) * 1000; // 1s, 2s, 4s
                        logger.warn('[GeminiProvider] transient error, retrying', {
                            model: modelName, attempt: attempt + 1, waitMs,
                            error: String(error?.message || error).slice(0, 200)
                        });
                        await new Promise((r) => setTimeout(r, waitMs));
                        continue;
                    }
                    // 別モデルへ
                    break;
                }
            }
        }

        recordApiCall({
            provider: this.name.split(' ')[0],
            operation: 'generate',
            tokens_in: tokensIn,
            duration_ms: Date.now() - start,
            status: 'error',
            error: String(lastError?.message || lastError).slice(0, 200)
        });
        throw lastError;
    }
}

class OllamaProvider {
    constructor(baseUrl = 'http://localhost:11434', modelName = 'gpt-oss:20b') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.modelName = modelName;
        this.name = `Local LLM (Ollama: ${modelName})`;
    }

    async generate(prompt, options = {}) {
        const start = Date.now();
        const tokensIn = Math.ceil((prompt || '').length * 0.6);
        const body = {
            model: this.modelName,
            prompt,
            stream: false
        };
        if (options.json) {
            body.format = 'json';
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Ollama API error (${response.status}): ${errBody}`);
            }

            const data = await response.json();
            const result = data.response;
            recordApiCall({
                provider: this.name.split(' ')[0],
                operation: 'generate',
                tokens_in: tokensIn,
                tokens_out: Math.ceil((result || '').length * 0.6),
                duration_ms: Date.now() - start,
                status: 'ok'
            });
            return result;
        } catch (error) {
            recordApiCall({
                provider: this.name.split(' ')[0],
                operation: 'generate',
                tokens_in: tokensIn,
                duration_ms: Date.now() - start,
                status: 'error',
                error: String(error?.message || error).slice(0, 200)
            });
            throw error;
        }
    }
}

class AIService {
    constructor(config = {}) {
        const groqKey = config.groqApiKey || process.env.GROQ_API_KEY;
        const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;
        const requestedProvider = config.provider || process.env.AI_PROVIDER || (groqKey ? 'groq' : 'gemini');

        try {
            if (requestedProvider === 'groq' && groqKey && groqKey !== 'dummy') {
                this.provider = new GroqProvider(groqKey, config.groqModel || 'openai/gpt-oss-120b');
                this.enabled = true;
            } else if ((requestedProvider === 'gemini' || !requestedProvider) && geminiKey && geminiKey !== 'dummy') {
                const envPreferredModel = process.env.GEMINI_MODEL === 'gemini-2.5-pro'
                    ? 'gemini-2.5-flash'
                    : process.env.GEMINI_MODEL;
                this.provider = new GeminiProvider(
                    geminiKey,
                    config.geminiModel || envPreferredModel || 'gemini-2.5-flash'
                );
                this.enabled = true;
            } else if (requestedProvider === 'ollama') {
                this.provider = new OllamaProvider();
                this.enabled = true;
            } else if (groqKey && groqKey !== 'dummy') {
                this.provider = new GroqProvider(groqKey, config.groqModel || 'openai/gpt-oss-120b');
                this.enabled = true;
            } else if (geminiKey && geminiKey !== 'dummy') {
                this.provider = new GeminiProvider(geminiKey, config.geminiModel || 'gemini-2.5-flash');
                this.enabled = true;
            } else {
                this.provider = new OllamaProvider();
                this.enabled = true;
            }
            logger.info('[AIService] Initialized', { provider: this.provider.name });
        } catch (error) {
            logger.warn('[AIService] Failed to initialize AI provider', { error: error.message });
            this.enabled = false;
        }
    }

    toMessages(utterances = []) {
        return utterances.map((u) => ({
            speaker: u.display_name || u.speaker || 'Unknown',
            text: u.transcript || '',
            timestamp: u.started_at || u.timestamp || ''
        }));
    }

    /**
     * 高精度 STT (ElevenLabs Scribe) かどうかを判定。
     * 高精度 STT の場合は議事録生成時に「内容を変更せず体裁を整える」プロンプトを使う。
     */
    _isHighAccuracyStt(roomMeta = {}) {
        const provider = String(roomMeta.stt_provider || '').toLowerCase();
        return provider === 'elevenlabs';
    }

    /**
     * 議事録生成時の編集ルール（[ALLOWED EDITS] / [FORBIDDEN EDITS]）を STT プロバイダー別に返す。
     * - 高精度 STT (ElevenLabs): 文字起こしをほぼそのままに、体裁整形のみ。
     * - 通常 STT (Google 等): 誤認識修正・言い直し整形を含む従来プロンプト。
     */
    _buildMinutesEditingRules(roomMeta = {}) {
        if (this._isHighAccuracyStt(roomMeta)) {
            return {
                systemNote: [
                    '文字起こしは高精度STT (ElevenLabs Scribe) で生成済みです。',
                    'あなたの仕事は「話し手が自然にしゃべっていた話し言葉」をできる限りそのまま残し、',
                    '「誰が」「何を話したか」が分かる形に並べるだけです。',
                    '書き言葉に直したり、要約・整理は一切しないでください。',
                    '会話の生々しさ・口調・語尾・言い回しが残っていれば成功です。'
                ].join('\n'),
                allowed: [
                    '[ALLOWED EDITS — 以下だけは触ってよい]',
                    '- 「えー」「あー」「えっと」「うーん」など意味のないフィラーの削除',
                    '- 「あ、ごめんなさい今のなしで」のような明らかな言い直しで前半を捨てる程度の整理',
                    '- 不鮮明・聞き取り欠落と思しき箇所のみ、前後文脈で自然な短い補完（断定できない場合は触らない）',
                    '- 同一話者の連続発話を1つの段落にまとめる（語順・語尾はそのまま）',
                    '- 句読点と改行の最小限の補正（読みやすさのため）'
                ].join('\n'),
                forbidden: [
                    '[FORBIDDEN EDITS — 絶対に触らない]',
                    '- 話し言葉を書き言葉・敬語・ですます調へ変換すること',
                    '- 言い回し・口調・語尾・方言・くだけた表現の修正',
                    '- 文字の置き換え・固有名詞の言い換え（高精度STTなので勝手に直さない）',
                    '- 内容の要約・抽象化・パラフレーズ・箇条書き化',
                    '- トピック・セクション・見出しによる分類',
                    '- 話していない結論や行動項目の補足',
                    '- 発言順の並び替え'
                ].join('\n')
            };
        }
        return {
            systemNote: '',
            allowed: [
                '[ALLOWED EDITS]',
                '- 明らかな誤認識（音声→文字の取り違え）の修正',
                '- 「えー」「あー」「えっと」など意味のないフィラーの削除',
                '- 重複した相槌・無関係な雑音の削除',
                '- 同一話者の連続発話を1段落にまとめる（語順・語尾は保つ）',
                '- 句読点と改行の補正'
            ].join('\n'),
            forbidden: [
                '[FORBIDDEN EDITS]',
                '- 内容の要約・抽象化・パラフレーズ・箇条書き化',
                '- トピック・セクション・見出しによる分類',
                '- 話していない結論や行動項目の補足',
                '- 発言順の並び替え',
                '- 敬語/口調の変更'
            ].join('\n')
        };
    }

    toMinuteMessages(utterances = []) {
        const merged = [];
        utterances.forEach((utterance) => {
            const speaker = utterance.display_name || utterance.speaker || 'Unknown';
            const rawText = String(utterance.raw_transcript || utterance.transcript || '').trim();
            if (!rawText) return;

            const start = utterance.started_at || utterance.timestamp || '';
            const end = utterance.ended_at || utterance.timestamp || start;
            const previous = merged[merged.length - 1];

            if (previous && previous.speaker === speaker) {
                previous.text = `${previous.text} ${rawText}`.trim();
                previous.end = end || previous.end;
                previous.timestamp = formatMinuteTimestamp(previous.start, previous.end);
                return;
            }

            merged.push({
                speaker,
                text: rawText,
                start,
                end,
                timestamp: formatMinuteTimestamp(start, end)
            });
        });

        return merged.map(({ speaker, text, timestamp }) => ({ speaker, text, timestamp }));
    }

    buildUserContextBlock(participants = [], userContexts = []) {
        const contextMap = new Map(userContexts.map((context) => [context.user_id, context]));
        const lines = participants.map((participant) => {
            const context = contextMap.get(participant.user_id) || {};
            const activeTasks = Array.isArray(context.active_tasks) && context.active_tasks.length
                ? context.active_tasks.join(' / ')
                : jp('\u4e0d\u660e');
            const profileText = participant.profile_text || jp('\u4e0d\u660e');

            return [
                `${participant.display_name}:`,
                `- profile_text: ${profileText}`,
                `- project_summary: ${context.project_summary || jp('\u4e0d\u660e')}`,
                `- current_status: ${context.current_status || jp('\u4e0d\u660e')}`,
                `- active_tasks: ${activeTasks}`
            ].join('\n');
        });

        return lines.length
            ? `${jp('\u0023 \u500b\u4eba\u30b3\u30f3\u30c6\u30af\u30b9\u30c8')}\n${lines.join('\n\n')}\n`
            : `${jp('\u0023 \u500b\u4eba\u30b3\u30f3\u30c6\u30af\u30b9\u30c8')}\n- ${jp('\u306a\u3057')}\n`;
    }

    buildStructuredInsightsPrompt(messages, participants = [], userContexts = []) {
        return [
            jp('\u3042\u306a\u305f\u306f\u7814\u7a76\u5ba4\u30bc\u30df\u306e\u9032\u6357\u7ba1\u7406\u3092\u652f\u63f4\u3059\u308b\u30a2\u30b7\u30b9\u30bf\u30f3\u30c8\u3067\u3059\u3002'),
            jp('\u4ee5\u4e0b\u306e\u4f1a\u8b70\u30ed\u30b0\u3092\u5206\u6790\u3057\u3001\u69cb\u9020\u5316\u3055\u308c\u305f\u60c5\u5831\u3092\u51fa\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            '',
            jp('\u0023 \u76ee\u7684'),
            jp('\u3053\u306e\u5206\u6790\u306f\u300c\u9032\u6357\u7ba1\u7406\u300d\u3068\u300c\u6b21\u306e\u884c\u52d5\u306e\u660e\u78ba\u5316\u300d\u3092\u76ee\u7684\u3068\u3057\u307e\u3059\u3002'),
            jp('\u66d6\u6627\u306a\u8868\u73fe\u3067\u306f\u306a\u304f\u3001\u884c\u52d5\u53ef\u80fd\u306a\u30ec\u30d9\u30eb\u307e\u3067\u5177\u4f53\u5316\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            '',
            jp('\u0023 \u5165\u529b\u30c7\u30fc\u30bf'),
            jp('- \u8907\u6570\u8a71\u8005\u306e\u4f1a\u8b70\u30ed\u30b0'),
            jp('- \u6642\u7cfb\u5217\u9806'),
            jp('- \u5404\u767a\u8a00\u306b\u306fspeaker\u304c\u4ed8\u4e0e\u3055\u308c\u3066\u3044\u308b'),
            '',
            jp('\u0023 \u51fa\u529b\u8981\u4ef6'),
            '',
            jp('\u0023\u0023 1. \u5168\u4f53\u8981\u7d04'),
            jp('- \u8b70\u8ad6\u306e\u6d41\u308c'),
            jp('- \u6c7a\u5b9a\u4e8b\u9805'),
            jp('- \u672a\u89e3\u6c7a\u306e\u8ad6\u70b9'),
            jp('\u3092\u542b\u3081\u3066\u7c21\u6f54\u306b\u307e\u3068\u3081\u308b'),
            '',
            jp('\u0023\u0023 2. \u8a71\u8005\u3054\u3068\u306e\u8981\u7d04'),
            jp('- \u5404\u8a71\u8005\u304c\u4f55\u3092\u8003\u3048\u3066\u3044\u308b\u304b'),
            jp('- \u5f79\u5272\u3084\u7acb\u5834\u304c\u5206\u304b\u308b\u3088\u3046\u306b\u6574\u7406\u3059\u308b'),
            '',
            jp('\u0023\u0023 3. \u8a71\u8005\u3054\u3068\u306eNext Action'),
            jp('- \u6b21\u306b\u53d6\u308b\u3079\u304d\u5177\u4f53\u7684\u884c\u52d5'),
            jp('- \u7b87\u6761\u66f8\u304d\u3067\u6700\u59273\u500b'),
            jp('- \u5b9f\u884c\u53ef\u80fd\u306a\u7c92\u5ea6\u306b\u3059\u308b'),
            '',
            jp('\u0023 \u5236\u7d04'),
            jp('- \u63a8\u6e2c\u3057\u3059\u304e\u306a\u3044'),
            jp('- \u4e0d\u660e\u306a\u70b9\u306f\u300c\u4e0d\u660e\u300d\u3068\u660e\u8a18'),
            jp('- \u5197\u9577\u306a\u8868\u73fe\u3092\u907f\u3051\u308b'),
            jp('- \u5fc5\u305aJSON\u5f62\u5f0f\u306e\u307f\u3067\u51fa\u529b\u3059\u308b\uff08\u8aac\u660e\u6587\u306f\u7981\u6b62\uff09'),
            '',
            jp('\u0023 \u51fa\u529b\u30d5\u30a9\u30fc\u30de\u30c3\u30c8'),
            '{',
            '  "overall_summary": "string",',
            '  "speaker_summaries": [',
            '    {',
            '      "speaker": "string",',
            '      "summary": "string"',
            '    }',
            '  ],',
            '  "next_actions": [',
            '    {',
            '      "speaker": "string",',
            '      "actions": ["string"]',
            '    }',
            '  ]',
            '}',
            '',
            this.buildUserContextBlock(participants, userContexts),
            jp('\u0023 \u30ed\u30b0'),
            JSON.stringify({ messages }, null, 2)
        ].join('\n');
    }

    normalizeStructuredInsights(parsed, participants = []) {
        const participantMap = new Map(participants.map((p) => [p.display_name, p.user_id || p.id]));
        const speakerSummaries = Array.isArray(parsed?.speaker_summaries)
            ? parsed.speaker_summaries
                .filter((item) => item && item.speaker)
                .map((item) => ({
                    speaker: String(item.speaker).trim(),
                    summary: String(item.summary || jp('\u60c5\u5831\u4e0d\u8db3')).trim() || jp('\u60c5\u5831\u4e0d\u8db3')
                }))
            : [];

        const nextActions = Array.isArray(parsed?.next_actions)
            ? parsed.next_actions
                .filter((item) => item && item.speaker)
                .map((item) => ({
                    speaker: String(item.speaker).trim(),
                    actions: Array.isArray(item.actions)
                        ? item.actions.map((action) => String(action || '').trim()).filter(Boolean).slice(0, 3)
                        : []
                }))
            : [];

        return {
            overall_summary: String(parsed?.overall_summary || '').trim(),
            speaker_summaries: speakerSummaries,
            next_actions: nextActions,
            flat_actions: nextActions.flatMap((entry) =>
                entry.actions.map((actionText) => ({
                    speaker_id: participantMap.get(entry.speaker) || null,
                    speaker_name: entry.speaker,
                    action_text: actionText
                }))
            )
        };
    }

    async generateStructuredInsights(utterances, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);
        const messages = this.toMessages(utterances);
        const prompt = this.buildStructuredInsightsPrompt(messages, participants, userContexts);
        const raw = await provider.generate(prompt, { json: true });
        const parsed = safeJsonParse(raw);

        return {
            ...this.normalizeStructuredInsights(parsed, participants),
            prompt,
            provider: provider.name,
            raw_result: stripCodeFence(raw)
        };
    }

    async analyzeMeeting(utterances, type = 'summary', customInstruction = '', participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);

        if (type === 'summary') {
            const structured = await this.generateStructuredInsights(utterances, participants, userContexts, aiConfig);
            return {
                result: structured.overall_summary,
                prompt: structured.prompt,
                provider: structured.provider
            };
        }

        if (type === 'minutes') {
            const messages = this.toMinuteMessages(utterances);
            // aiConfig.stt_provider に基づきプロンプトを差し替える。
            // 高精度STT (ElevenLabs) の場合は誤字修正をやめ、体裁整形のみに絞る。
            const isHighAccuracy = this._isHighAccuracyStt({ stt_provider: aiConfig.stt_provider });
            let prompt;
            if (isHighAccuracy) {
                prompt = [
                    jp('あなたは「話し言葉そのままの会話ログ」を整える担当です。'),
                    jp('入力は高精度STT (ElevenLabs Scribe) で生成済みなので、内容にはほぼ手を加えません。'),
                    jp('それぞれの話者が「自然にしゃべっていた感じ」をそのまま残し、誰が何を話したかが分かる並びに整えるだけ。'),
                    jp('書き言葉や敬語に直したり、要約・整理は一切しないでください。会話の生々しさ・口調・語尾・くだけた言い回しが残っていれば成功です。'),
                    '',
                    jp('# やってよいこと (これだけ)'),
                    jp('- 「えー」「あー」「えっと」「うーん」などの意味のないフィラーの削除'),
                    jp('- 「あ、今のなしで」のような明らかな言い直しで前半を捨てる程度の整理'),
                    jp('- 聞き取り欠落・不鮮明と思しき箇所のみ、前後の文脈で自然な短い補完（断定できない場合は触らない）'),
                    jp('- 同一話者の連続発話を1つの段落にまとめる（語順・語尾はそのまま）'),
                    jp('- 句読点と改行の最小限の補正'),
                    '',
                    jp('# 絶対にしないこと'),
                    jp('- 話し言葉を書き言葉・ですます調・敬語に変換すること'),
                    jp('- 口調・語尾・方言・くだけた表現の修正'),
                    jp('- 文字の置き換え・固有名詞の言い換え（高精度STTなので勝手に直さない）'),
                    jp('- 内容の要約・抽象化・パラフレーズ・箇条書き化'),
                    jp('- トピック・セクション・見出しによる分類'),
                    jp('- 話していない結論や行動項目の補足'),
                    jp('- 発言順の並び替え'),
                    '',
                    jp('# 出力フォーマット'),
                    jp('- 日本語で出力する'),
                    jp('- 各段落は `- 話者名: 話し言葉そのままの内容` の形式で始める'),
                    jp('- 時系列順を守る'),
                    jp('- 段落の前置きや説明は書かない。本文のみ返す'),
                    '',
                    this.buildUserContextBlock(participants, userContexts),
                    jp('# 生ログ (高精度STT済)'),
                    JSON.stringify({ messages }, null, 2)
                ].join('\n');
            } else {
                prompt = [
                    jp('あなたは研究室ゼミの議事録作成を支援するアシスタントです。'),
                    jp('以下の生ログを基に、そのまま議事録として配れる一歩手前の、読みやすい日本語の議事録を作成してください。'),
                    '',
                    jp('# 目的'),
                    jp('- 短く分断された生ログを、同じ話者の連続発話ごとに自然なまとまりへ統合する'),
                    jp('- 明らかな誤字や言い直しは、文脈上自然な表現へ整える'),
                    jp('- ただし、内容の捏造はしない'),
                    '',
                    jp('# 出力ルール'),
                    jp('- 日本語で出力する'),
                    jp('- 話者ごとにまとまった段落で並べる'),
                    jp('- 各段落は `- 話者名: 内容` の形式で始める'),
                    jp('- 時系列順を守る'),
                    jp('- 会議の議事録として、そのまま軽く手直しすれば使える読みやすさにする'),
                    jp('- 不明慮な固有名詞は、推測しすぎず自然な範囲で補正する'),
                    jp('- 箇条書きだけを返し、前置きや説明は書かない'),
                    '',
                    this.buildUserContextBlock(participants, userContexts),
                    jp('# 生ログ'),
                    JSON.stringify({ messages }, null, 2)
                ].join('\n');
            }

            const resultText = await provider.generate(prompt, { maxOutputTokens: 16384 });
            return {
                result: resultText.trim(),
                prompt,
                provider: provider.name
            };
        }

        const transcript = utterances
            .map((u) => `${u.display_name}: ${u.transcript}`)
            .join('\n');
        const contextBlock = this.buildUserContextBlock(participants, userContexts);

        let systemPrompt = '';
        switch (type) {
            case 'todo':
                systemPrompt = jp('\u4f1a\u8b70\u30ed\u30b0\u304b\u3089\u3001\u8a71\u8005\u3054\u3068\u306e\u5177\u4f53\u7684\u306a\u6b21\u306e\u884c\u52d5\u3092\u62bd\u51fa\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
                break;
            case 'topic_tree':
                systemPrompt = [
                    jp('\u4f1a\u8b70\u30ed\u30b0\u3092\u3001\u8a71\u984c\u306e\u307e\u3068\u307e\u308a\u304c\u5206\u304b\u308b\u30c8\u30d4\u30c3\u30af\u30c4\u30ea\u30fc\u5f62\u5f0f\u3067\u6574\u7406\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
                    jp('- \u30a4\u30f3\u30c7\u30f3\u30c8\u3067\u968e\u5c64\u3092\u8868\u73fe\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
                    jp('- \u5927\u9805\u76ee -> \u4e2d\u9805\u76ee -> \u8a73\u7d30\u9805\u76ee \u306e\u7c92\u5ea6\u3067\u307e\u3068\u3081\u3066\u304f\u3060\u3055\u3044\u3002'),
                    jp('- \u65e2\u5b58\u30c4\u30ea\u30fc\u304c\u3042\u308b\u5834\u5408\u306f\u3001\u305d\u306e\u6d41\u308c\u3092\u5f15\u304d\u7d99\u3044\u3067\u66f4\u65b0\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
                    customInstruction ? `${jp('\u8ffd\u52a0\u6307\u793a')}:\n${customInstruction}` : '',
                    '',
                    jp('\u51fa\u529b\u4f8b') + ':',
                    jp('\u30c8\u30d4\u30c3\u30afA'),
                    jp('  - \u8ad6\u70b9A-1'),
                    jp('  - \u8ad6\u70b9A-2'),
                    jp('\u30c8\u30d4\u30c3\u30afB')
                ].filter(Boolean).join('\n');
                break;
            case 'custom':
                systemPrompt = customInstruction || jp('\u4f1a\u8b70\u30ed\u30b0\u3092\u6574\u7406\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
                break;
            default:
                systemPrompt = jp('\u4f1a\u8b70\u30ed\u30b0\u3092\u6574\u7406\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
        }

        const prompt = `${systemPrompt}\n\n${contextBlock}\n${jp('\u0023 \u4f1a\u8b70\u30ed\u30b0')}\n${transcript}`;
        const result = await provider.generate(prompt);
        return {
            result: result.trim(),
            provider: provider.name
        };
    }

    async generateMinutesFromTranscript(utterances, roomMeta = {}, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);
        const isHighAccuracy = this._isHighAccuracyStt(roomMeta);

        // 高精度 STT (ElevenLabs) の場合は文字起こしを変更せず体裁のみ整える方針。
        // そのため reconstructSentences (誤変換修正等を含むクレンジング) はスキップし、
        // raw 文字起こしを直接プロンプトへ渡す。
        let transcript;
        if (isHighAccuracy) {
            transcript = this.toMinuteMessages(utterances)
                .map((message) => `${message.speaker}: ${message.text}`)
                .join('\n');
        } else {
            // Layer B: First pass - Reconstruct sentences to solve fragments and pronouns
            const reconstructed = await this.reconstructSentences(utterances, participants, userContexts, aiConfig);
            transcript = reconstructed
                .map((message) => `${message.speaker}: ${message.text}`)
                .join('\n');
        }

        const participantNames = participants.map((participant) => participant.display_name).filter(Boolean).join('、') || '不明';
        const editingRules = this._buildMinutesEditingRules(roomMeta);

        // Minutes are intentionally generated from THIS meeting only — past
        // meeting context is dropped so the output never leaks/imports
        // language or topics from prior sessions. (Summary/ToDo still get
        // the past block so trends across meetings are visible there.)
        const prompt = [
            '[SYSTEM]',
            'あなたは「忠実な発言録作成」を担当するAIです。',
            'これは要約ではありません。会話の流れを時系列のまま、話し手の口調・語彙・言い回しをできる限り残してください。',
            'トピックやセクションで分類・整理せず、発言順に並べた「発言録」を出力してください。',
            editingRules.systemNote,
            '',
            '[CONTEXT]',
            '以下はこの会議の文字起こしログです。',
            transcript || '(ログなし)',
            '',
            this.buildUserContextBlock(participants, userContexts),
            editingRules.allowed,
            '',
            editingRules.forbidden,
            '',
            '[FORMAT]',
            `日時: ${roomMeta.date || '不明'}`,
            `参加者: ${participantNames}`,
            '',
            '---',
            '',
            '発言者A: 実際に話した内容をそのまま',
            '発言者B: 同上',
            '発言者A: 続きの発言',
            '',
            '〔セクション見出し・箇条書き・トピックまとめは出力しない。会話を上から順に並べるだけ〕',
        ].join('\n');

        const result = await provider.generate(prompt, { maxOutputTokens: 16384 });
        return {
            result: String(result || '').trim(),
            prompt,
            provider: provider.name
        };
    }

    async generateSummaryFromMinutes(minutesText, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);

        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';
        const prompt = [
            '[SYSTEM]',
            'あなたは会議内容を構造的に要約するAIです。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[CONTEXT]',
            '以下は整理済み議事録です：',
            minutesText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            '以下を実行してください：',
            '1. トピックごとに分割',
            '2. 要点整理',
            '3. 重要な議論のみ抽出',
            '4. 無関係な内容を除外',
            '',
            '[FORMAT]',
            '## 要約',
            '',
            '### 1. トピック名',
            '',
            '* 概要:',
            '* 主な意見:',
            '* 結論:',
            '',
            '### 2. トピック名',
            '',
            '...',
            '',
            '## 次回の重要論点',
            '',
            '* ○○の検討',
            '* ○○の意思決定',
            '',
            '[REPEAT]',
            '重要な議論のみ抽出してください。'
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: provider.name
        };
    }

    async generateTodoFromMinutes(minutesText, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);

        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';
        const prompt = [
            '[SYSTEM]',
            'あなたは会議から行動と次の議題を抽出するAIです。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[CONTEXT]',
            '以下は議事録です：',
            minutesText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            '以下を抽出してください：',
            '',
            '【TODO条件】',
            '* 明確な行動',
            '* 担当者が特定可能',
            '* 実行意思がある',
            '',
            '【除外】',
            '* 仮案',
            '* 雑談',
            '* 未確定事項',
            '',
            'さらに以下も生成：',
            '',
            '【次回会議のトピック】',
            '* 未解決論点',
            '* 確認事項',
            '* 意思決定事項',
            '',
            '[FORMAT]',
            '## TODO一覧',
            '',
            '* 担当者:',
            '  内容:',
            '  期限:',
            '',
            '## 次回会議の確認事項',
            '',
            '* ○○の進捗確認',
            '* ○○の検討',
            '* ○○の意思決定',
            '',
            '[REPEAT]',
            '曖昧なものは含めない。'
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: provider.name
        };
    }

    async generateCustomFromMinutes(minutesText, customInstruction, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);

        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';
        const prompt = [
            '[SYSTEM]',
            'あなたは会議支援AIです。与えられた議事録だけを根拠に分析してください。',
            '生ログは使わず、議事録の内容だけを参照してください。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[CONTEXT]',
            '以下は整理済み議事録です：',
            minutesText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            customInstruction || '議事録を整理してください。'
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: provider.name
        };
    }

    async generateNextAgenda({ frameText, previousAgendaText, minutesText, todoText, aiConfig = {}, monthsAhead = 1 }) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        const provider = this.getProvider(aiConfig);

        const prompt = [
            '[ROLE]',
            'あなたは定例会議の「次回アジェンダ下書き」を作る書記です。',
            `次回会議までの間隔: 約 ${monthsAhead} ヶ月後。`,
            '入力されたフレームの章立て・見出しの言い回し・箇条書きスタイルを **だいたい踏襲** し、',
            '今回の会議で起きたこと・TODO・未解決事項を踏まえて、次回会議向けの下書きを作ります。',
            '出力は **プレーンテキスト** (Markdown でない、見出しもプレーンテキスト、装飾なし)。',
            '',
            '[FRAME — 形式の参考。章立て・見出しの呼び方を踏襲]',
            frameText || '(基準フレームなし)',
            '',
            '[前回アジェンダ — 直前の会議で使ったやつ]',
            previousAgendaText || '(なし)',
            '',
            '[INSTRUCTION — 内容の組み立てルール]',
            '1. フレームの章立て・見出しの呼び方を踏襲する (順序は柔軟でよい)',
            '2. 今回完了した議題 → 「(完了)」マーカー付きで残す (削除しない)',
            '3. 未完・継続審議 → 「(継続審議)」マーカー',
            '4. 今回新規に出てきた論点 → 新規議題として追加',
            '5. 今回出た TODO は「持ち越し事項」セクション (フレームに無ければ新設) に列挙',
            '6. 雑談・脱線は除外',
            '7. 出力はプレーンテキスト。Markdown 構文 (* や ** 等) は使わない',
            '8. 前置きや説明は書かない。本文だけ',
            '',
            '[今回の議事録]',
            minutesText || '(なし)',
            '',
            '[今回の TODO]',
            todoText || '(なし)',
            '',
            '[出力]'
        ].join('\n');

        const start = Date.now();
        const result = await provider.generate(prompt, { maxOutputTokens: 16384 });
        return {
            result: String(result || '').trim(),
            prompt,
            provider: provider.name,
            duration_ms: Date.now() - start
        };
    }

    buildUserContextUpdatePrompt(userContext, messages, targetSpeaker) {
        return [
            jp('\u3042\u306a\u305f\u306f\u7814\u7a76\u5ba4\u30bc\u30df\u306e\u9032\u6357\u7ba1\u7406\u3092\u652f\u63f4\u3059\u308b\u30a2\u30b7\u30b9\u30bf\u30f3\u30c8\u3067\u3059\u3002'),
            jp('\u4ee5\u4e0b\u306e\u30e6\u30fc\u30b6\u30fc\u30b3\u30f3\u30c6\u30af\u30b9\u30c8\u3068\u4f1a\u8b70\u30ed\u30b0\u3092\u3082\u3068\u306b\u3001\u305d\u306e\u30e6\u30fc\u30b6\u30fc\u306e\u73fe\u5728\u72b6\u614b\u3092\u66f4\u65b0\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            '',
            jp('\u0023 \u76ee\u7684'),
            jp('- \u53e4\u3044\u60c5\u5831\u3092\u6574\u7406\u3057\u3001\u73fe\u5728\u306e\u6b63\u3057\u3044\u72b6\u614b\u3092\u7dad\u6301\u3059\u308b'),
            jp('- \u60c5\u5831\u3092\u5727\u7e2e\u3057\u3001\u6b21\u56de\u306e\u610f\u601d\u6c7a\u5b9a\u306b\u4f7f\u3048\u308b\u5f62\u306b\u3059\u308b'),
            '',
            jp('\u0023 \u5165\u529b'),
            jp('\u0023\u0023 \u30e6\u30fc\u30b6\u30fc\u30b3\u30f3\u30c6\u30af\u30b9\u30c8\uff08\u904e\u53bb\u72b6\u614b\uff09'),
            jp('- project_summary: \u7814\u7a76\u30c6\u30fc\u30de\u30fb\u76ee\u7684'),
            jp('- current_status: \u73fe\u5728\u306e\u9032\u6357'),
            jp('- active_tasks: \u5b9f\u884c\u4e2d\u306e\u30bf\u30b9\u30af'),
            '',
            jp('\u0023\u0023 \u4f1a\u8b70\u30ed\u30b0'),
            jp('- \u8907\u6570\u4eba\u306e\u4f1a\u8a71'),
            jp('- \u5bfe\u8c61\u30e6\u30fc\u30b6\u30fc\u306e\u767a\u8a00\u3060\u3051\u3067\u306a\u304f\u3001\u4ed6\u8005\u306e\u767a\u8a00\u3082\u8003\u616e\u3059\u308b'),
            '',
            jp('\u0023 \u66f4\u65b0\u30eb\u30fc\u30eb'),
            '',
            jp('\u0023\u0023 1. project_summary'),
            jp('- \u57fa\u672c\u306f\u7dad\u6301'),
            jp('- \u660e\u78ba\u306b\u65b9\u5411\u6027\u304c\u5909\u308f\u3063\u305f\u5834\u5408\u306e\u307f\u66f4\u65b0'),
            '',
            jp('\u0023\u0023 2. current_status'),
            jp('- \u6700\u65b0\u306e\u9032\u6357\u306b\u4e0a\u66f8\u304d\u3059\u308b'),
            jp('- \u4f55\u304c\u5b8c\u4e86\u3057\u3001\u4f55\u304c\u672a\u5b8c\u4e86\u304b\u3092\u660e\u78ba\u306b\u3059\u308b'),
            '',
            jp('\u0023\u0023 3. active_tasks'),
            jp('- \u5b8c\u4e86\u3057\u305f\u30bf\u30b9\u30af\u306f\u524a\u9664'),
            jp('- \u65b0\u305f\u306b\u5fc5\u8981\u306a\u30bf\u30b9\u30af\u3092\u8ffd\u52a0'),
            jp('- \u6700\u59275\u4ef6\u307e\u3067'),
            jp('- \u62bd\u8c61\u7684\u306a\u8868\u73fe\u306f\u7981\u6b62\uff08\u5177\u4f53\u7684\u306a\u884c\u52d5\u306b\u3059\u308b\uff09'),
            '',
            jp('\u0023 \u5236\u7d04'),
            jp('- \u5bfe\u8c61\u30e6\u30fc\u30b6\u30fc\u306b\u95a2\u4fc2\u306e\u306a\u3044\u5185\u5bb9\u306f\u542b\u3081\u306a\u3044'),
            jp('- \u63a8\u6e2c\u3057\u3059\u304e\u306a\u3044\uff08\u4e0d\u660e\u306a\u5834\u5408\u306f\u73fe\u72b6\u7dad\u6301\uff09'),
            jp('- \u5197\u9577\u306a\u8868\u73fe\u3092\u907f\u3051\u308b'),
            jp('- \u60c5\u5831\u306f\u7c21\u6f54\u306b\u5727\u7e2e\u3059\u308b'),
            '',
            jp('\u0023 \u51fa\u529b\u5f62\u5f0f'),
            jp('\u5fc5\u305aJSON\u5f62\u5f0f\u306e\u307f\u3067\u51fa\u529b\u3059\u308b\uff08\u8aac\u660e\u6587\u306f\u7981\u6b62\uff09'),
            '',
            jp('\u0023 \u5bfe\u8c61\u30e6\u30fc\u30b6\u30fc'),
            targetSpeaker,
            '',
            jp('\u0023 \u30c7\u30fc\u30bf'),
            jp('\u30e6\u30fc\u30b6\u30fc\u30b3\u30f3\u30c6\u30af\u30b9\u30c8') + ':',
            JSON.stringify(userContext, null, 2),
            '',
            jp('\u4f1a\u8b70\u30ed\u30b0') + ':',
            JSON.stringify({ messages }, null, 2),
            '',
            jp('\u0023 \u51fa\u529b\u30d5\u30a9\u30fc\u30de\u30c3\u30c8'),
            '{',
            '  "project_summary": "string",',
            '  "current_status": "string",',
            '  "active_tasks": ["string"]',
            '}'
        ].join('\n');
    }

    async updateUserContexts(participants = [], userContexts = [], utterances = []) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const messages = this.toMessages(utterances);
        const contextMap = new Map(userContexts.map((context) => [context.user_id, context]));
        const results = [];

        for (const participant of participants) {
            if (!participant.user_id) continue;

            const currentContext = contextMap.get(participant.user_id) || {
                user_id: participant.user_id,
                project_summary: '',
                current_status: '',
                active_tasks: []
            };

            const ownMessages = messages.filter((message) => message.speaker === participant.display_name);
            if (ownMessages.length < 2) {
                results.push({
                    user_id: participant.user_id,
                    project_summary: currentContext.project_summary || '',
                    current_status: currentContext.current_status || '',
                    active_tasks: Array.isArray(currentContext.active_tasks) ? currentContext.active_tasks.slice(0, 5) : []
                });
                continue;
            }

            const prompt = this.buildUserContextUpdatePrompt(currentContext, messages, participant.display_name || participant.user_id);
            const raw = await this.provider.generate(prompt, { json: true });
            const parsed = safeJsonParse(raw);

            results.push({
                user_id: participant.user_id,
                project_summary: truncate(parsed?.project_summary || currentContext.project_summary || '', 200),
                current_status: truncate(parsed?.current_status || currentContext.current_status || '', 300),
                active_tasks: Array.isArray(parsed?.active_tasks)
                    ? parsed.active_tasks.map(cleanTask).filter(Boolean).slice(0, 5)
                    : (Array.isArray(currentContext.active_tasks) ? currentContext.active_tasks.slice(0, 5) : [])
            });
        }

        return results;
    }

    async correctTranscript(targetUtterance, contextUtterances = [], aiConfig = {}) {
        if (!this.enabled) {
            return {
                corrected: targetUtterance.transcript,
                provider: 'none'
            };
        }

        const provider = this.getProvider(aiConfig);
        const contextText = contextUtterances
            .map((u) => `${u.display_name}: ${u.transcript}`)
            .join('\n');

        const prompt = [
            '会議中の文字起こしを、自然な日本語に補正してください。',
            '意味を変えず、前後の文脈に合うように誤変換だけを直してください。',
            '出力は補正後テキストのみで、日本語本文だけを返してください。',
            '',
            '前後の文脈:',
            contextText || '(none)',
            '',
            '対象の文字起こし:',
            targetUtterance.raw_transcript || targetUtterance.transcript || ''
        ].join('\n');

        const corrected = (await provider.generate(prompt)).trim();
        return {
            corrected: corrected || targetUtterance.transcript,
            provider: provider.name,
            prompt
        };
    }

    async extractDictionaryTerms(text, aiConfig = {}) {
        if (!this.enabled) {
            throw new Error(jp('AIサービスが設定されていません。環境変数（GEMINI_API_KEYなど）を確認してください。'));
        }

        let provider;
        try {
            // Try requested provider, then default, then whatever is enabled
            if (aiConfig.provider) {
                provider = this.getProvider(aiConfig);
            } else {
                provider = this.provider;
            }
        } catch (e) {
            logger.warn('[AIService] Provider selection failed, using default', { error: e.message });
            provider = this.provider;
        }

        if (!provider) {
            throw new Error(jp('利用可能なAIプロバイダーが見つかりません。'));
        }

        const prompt = [
            '# ROLE',
            'Expert Meeting Assistant',
            '',
            '# TASK',
            'Extract specialized terms and proper nouns from the text for speech recognition dictionary.',
            '',
            '# RULES',
            '1. Extract ONLY specialized terms, project names, technical words, or person names.',
            '2. Exclude common daily words.',
            '3. Provide Japanese reading in KATAKANA for each term.',
            '4. Output MUST be valid JSON format only.',
            '',
            '# FORMAT',
            '{ "terms": [ { "term": "word", "reading": "ヨミカタ" } ] }',
            '',
            '# INPUT TEXT',
            text
        ].join('\n');

        try {
            const raw = await provider.generate(prompt, { json: true });
            const parsed = safeJsonParse(raw);
            const terms = (parsed.terms || []).filter(t => t.term && t.reading);
            if (terms.length === 0) {
                // If it returned something but not in format, try to extract manually or just fail gracefully
                logger.warn('[AIService] No terms found in AI response', { rawSnippet: String(raw).slice(0, 200) });
            }
            return terms;
        } catch (error) {
            logger.error(error, { tag: '[AIService] AI Generation or Parsing failed' });
            throw new Error(jp('AIの応答取得に失敗しました: ') + error.message);
        }
    }

    getProvider(options = {}) {
        if (options.provider === 'groq') {
            return new GroqProvider(process.env.GROQ_API_KEY, options.model || 'openai/gpt-oss-120b');
        }
        if (options.provider === 'gemini') {
            return new GeminiProvider(process.env.GEMINI_API_KEY, options.model || 'gemini-2.5-flash');
        }
        if (options.provider === 'ollama') {
            return new OllamaProvider(undefined, options.model);
        }
        return this.provider;
    }

    /**
     * Layer B: Reconstruct fragmented utterances into coherent sentences.
     * Handles pronoun resolution and sentence completion.
     */
    async reconstructSentences(utterances, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) return utterances;

        const provider = this.getProvider(aiConfig);
        const messages = this.toMinuteMessages(utterances);
        const prompt = [
            '[SYSTEM]',
            'あなたは音声文字起こしログの校正エキスパートです。',
            '断片的な発話ログを、意味の通じる一連の文章に再構成してください。',
            '',
            '[INSTRUCTION]',
            '1. 指示語（これ、それ、あれ）を文脈から補完・解決する',
            '2. 語尾の欠落や言い直しを自然な文章に整える',
            '3. 重複する相槌（はい、ええ）を整理する',
            '4. 専門用語（生物・昆虫系）の誤変換を文脈から推測して修正する',
            '5. 話者ごとの個性を残しつつ、読みやすい書き言葉（です・ます、だ・であるは原文に合わせる）に整える',
            '',
            '[FORMAT]',
            'JSON形式で、話者ごとの再構成済みテキストを返してください。',
            '{ "reconstructed": [ { "speaker": "...", "text": "..." } ] }',
            '',
            this.buildUserContextBlock(participants, userContexts),
            '[LOG]',
            JSON.stringify({ messages }, null, 2)
        ].join('\n');

        const raw = await provider.generate(prompt, { json: true });
        try {
            const parsed = safeJsonParse(raw);
            return parsed.reconstructed || [];
        } catch (e) {
            logger.warn('[AIService] Failed to parse reconstructed sentences, falling back to merged messages', { error: e.message });
            return messages;
        }
    }

    /**
     * [L2] チャンク単体の議事録を生成する。
     *
     * @param {{ index:number, startTs:string, endTs:string, utterances:Array, overlapWith:string[] }} chunk
     * @param {number} totalChunks
     * @param {object} roomMeta
     * @param {Array}  participants
     * @param {Array}  userContexts
     * @param {object} aiConfig
     * @returns {Promise<{ chunkIndex:number, startTs:string, endTs:string, overlapWith:string[], result:string, provider:string }>}
     */
    async generateMinutesPerChunk(chunk, totalChunks, roomMeta = {}, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const provider = this.getProvider(aiConfig);

        // overlapWith に含まれる ID は前チャンクの末尾と重複する発言。
        // 文脈として渡すが出力対象からは外す。重複防止のため。
        const overlapIdSet = new Set(chunk.overlapWith || []);
        const contextUtts = chunk.utterances.filter(u => overlapIdSet.has(u.id));
        const targetUtts  = chunk.utterances.filter(u => !overlapIdSet.has(u.id));
        // 万が一 targetUtts が空（全件がオーバーラップ）なら全件を対象にする
        const outputUtts  = targetUtts.length > 0 ? targetUtts : chunk.utterances;

        const contextMessages = this.toMinuteMessages(contextUtts);
        const targetMessages  = this.toMinuteMessages(outputUtts);

        const contextTranscript = contextMessages.map(m => `${m.speaker}: ${m.text}`).join('\n');
        const targetTranscript  = targetMessages.map(m => `${m.speaker}: ${m.text}`).join('\n');

        const participantNames = participants.map((p) => p.display_name).filter(Boolean).join('、') || '不明';
        const chunkLabel = `${chunk.index + 1}/${totalChunks} (${chunk.startTs}〜${chunk.endTs})`;

        const editingRules = this._buildMinutesEditingRules(roomMeta);

        const promptLines = [
            `[CHUNK INFO] ${chunkLabel}`,
            '',
            '[SYSTEM]',
            'あなたは「忠実な発言録作成」を担当するAIです。',
            'これは要約ではありません。会話の流れを時系列のまま、話し手の口調・語彙・言い回しをできる限り残してください。',
            'トピックやセクションで分類・整理せず、発言順に並べた「発言録」を出力してください。',
            editingRules.systemNote,
            '',
        ];

        // 前チャンクとの重複部分は文脈として渡す（出力しない）
        if (contextTranscript) {
            promptLines.push(
                '[CONTEXT - 前チャンクの末尾。文脈参照のみ、出力には含めないこと]',
                contextTranscript,
                '',
            );
        }

        promptLines.push(
            '[OUTPUT TARGET - ここから先のみを発言録として出力してください]',
            targetTranscript || '(ログなし)',
            '',
            editingRules.allowed,
            '',
            editingRules.forbidden,
            '',
            '[FORMAT]',
            `参加者: ${participantNames}`,
            '',
            '発言者A: 実際に話した内容をそのまま',
            '発言者B: 同上',
            '発言者A: 続きの発言',
            '',
            '〔セクション見出し・箇条書き・トピックまとめは出力しない。会話を上から順に並べるだけ〕',
        );

        const prompt = promptLines.join('\n');

        const result = await provider.generate(prompt, { maxOutputTokens: 16384 });
        return {
            chunkIndex: chunk.index,
            startTs: chunk.startTs,
            endTs: chunk.endTs,
            overlapWith: chunk.overlapWith,
            result: String(result || '').trim(),
            provider: provider.name,
        };
    }

    /**
     * [L3] チャンク結果を結合して最終議事録テキストを生成する（LLM呼び出しなし）。
     *
     * overlapWith に含まれる utterance ID はチャンク境界の重複だが、
     * LLM 出力はテキストのため ID ベースの行単位除去は行わず、
     * 空行2つで自然につなぐ。
     *
     * @param {Array<{ chunkIndex:number, startTs:string, endTs:string, result:string }>} chunkResults
     * @param {object} roomMeta
     * @returns {string}
     */
    mergeMinutesChunks(chunkResults, roomMeta = {}) {
        if (!chunkResults || chunkResults.length === 0) return '';
        if (chunkResults.length === 1) return chunkResults[0].result || '';

        const sorted = [...chunkResults].sort((a, b) => a.chunkIndex - b.chunkIndex);

        // チャンクヘッダーは挿入しない（議事録の読みやすさ優先）。
        // 空行2つで自然につなぐ。LLM が各チャンクの先頭・末尾を
        // 自然な段落で終えてくれるため、これで十分につながる。
        return sorted
            .map(c => (c.result || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }

    // ──────────────────────────────────────────────────────────────────
    // [L5] summary / todo / custom の Map-Reduce メソッド群
    // ──────────────────────────────────────────────────────────────────

    /**
     * 議事録テキストの 1 チャンク分の要約を生成する（Map 段）。
     */
    async generateSummaryPerChunk(chunkText, chunkIdx, totalChunks, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        const provider = this.getProvider(aiConfig);
        const chunkLabel = `${chunkIdx + 1}/${totalChunks}`;
        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';

        const prompt = [
            `[CHUNK INFO] 議事録チャンク ${chunkLabel}`,
            '',
            '[SYSTEM]',
            'あなたは会議内容を構造的に要約するAIです。',
            '以下は長い議事録の一部です。この部分だけを対象に部分要約を生成してください。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[CONTEXT]',
            `以下は議事録チャンク ${chunkLabel} です：`,
            chunkText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            '1. このチャンクのトピックを整理',
            '2. 要点を抽出',
            '3. 重要な議論と結論を記録',
            '',
            '[FORMAT]',
            `## チャンク ${chunkLabel} の要約`,
            '',
            '### トピック名',
            '* 概要:',
            '* 主な意見:',
            '* 結論または継続事項:',
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            chunkIndex: chunkIdx,
            result: String(result || '').trim(),
            provider: provider.name,
        };
    }

    /**
     * 複数チャンクの部分要約を LLM で統合する（Reduce 段）。
     */
    async mergeSummaryChunks(partialSummaries = [], participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        if (partialSummaries.length === 0) return { result: '', provider: 'none' };
        if (partialSummaries.length === 1) return { result: partialSummaries[0], provider: 'none' };

        const provider = this.getProvider(aiConfig);
        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';
        const combined = partialSummaries
            .map((s, i) => `--- チャンク ${i + 1}/${partialSummaries.length} ---\n${s}`)
            .join('\n\n');

        const prompt = [
            '[SYSTEM]',
            'あなたは会議内容を構造的に要約するAIです。',
            '以下は長い議事録を複数チャンクに分割して要約したものです。',
            'これらを統合して、一つの一貫した要約を作成してください。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[PARTIAL SUMMARIES]',
            combined,
            '',
            '[INSTRUCTION]',
            '全チャンクの要約を統合して：',
            '1. トピックごとに整理（重複排除）',
            '2. 会議全体の流れが分かる一貫した要約に',
            '3. 次回の重要論点も整理',
            '',
            '[FORMAT]',
            '## 要約',
            '',
            '### 1. トピック名',
            '',
            '* 概要:',
            '* 主な意見:',
            '* 結論:',
            '',
            '## 次回の重要論点',
            '',
            '* ○○の検討',
            '',
            '[REPEAT]',
            '重要な議論のみ抽出してください。',
        ].join('\n');

        const result = await provider.generate(prompt);
        return { result: String(result || '').trim(), provider: provider.name };
    }

    /**
     * 議事録テキストの 1 チャンク分の ToDo を生成する（Map 段）。
     */
    async generateTodoPerChunk(chunkText, chunkIdx, totalChunks, participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        const provider = this.getProvider(aiConfig);
        const chunkLabel = `${chunkIdx + 1}/${totalChunks}`;
        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';

        const prompt = [
            `[CHUNK INFO] 議事録チャンク ${chunkLabel}`,
            '',
            '[SYSTEM]',
            'あなたは会議から行動と次の議題を抽出するAIです。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[CONTEXT]',
            `以下は議事録チャンク ${chunkLabel} です：`,
            chunkText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            '以下を抽出してください：',
            '',
            '【TODO条件】',
            '* 明確な行動',
            '* 担当者が特定可能',
            '* 実行意思がある',
            '',
            '【除外】',
            '* 仮案',
            '* 雑談',
            '* 未確定事項',
            '',
            '[FORMAT]',
            `## チャンク ${chunkLabel} のTODO`,
            '',
            '* 担当者:',
            '  内容:',
            '  期限:',
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            chunkIndex: chunkIdx,
            result: String(result || '').trim(),
            provider: provider.name,
        };
    }

    /**
     * 複数チャンクの部分 ToDo を LLM で統合・重複排除する（Reduce 段）。
     */
    async mergeTodoChunks(partialTodos = [], participants = [], userContexts = [], aiConfig = {}) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        if (partialTodos.length === 0) return { result: '', provider: 'none' };
        if (partialTodos.length === 1) return { result: partialTodos[0], provider: 'none' };

        const provider = this.getProvider(aiConfig);
        const pastBlock = (aiConfig && aiConfig.pastContextBlock) ? `${aiConfig.pastContextBlock}\n\n` : '';
        const combined = partialTodos
            .map((s, i) => `--- チャンク ${i + 1}/${partialTodos.length} ---\n${s}`)
            .join('\n\n');

        const prompt = [
            '[SYSTEM]',
            'あなたは会議から行動と次の議題を抽出するAIです。',
            '以下は長い議事録を複数チャンクから抽出したTODOリストです。',
            'これらを統合・重複排除して、一つのTODOリストを作成してください。',
            '',
            this.buildUserContextBlock(participants, userContexts),
            pastBlock,
            '[PARTIAL TODO LISTS]',
            combined,
            '',
            '[INSTRUCTION]',
            '全チャンクのTODOを統合して：',
            '1. 重複するTODOを排除',
            '2. 担当者・期限・内容を整理',
            '3. 次回会議の確認事項も整理',
            '',
            '[FORMAT]',
            '## TODO一覧',
            '',
            '* 担当者:',
            '  内容:',
            '  期限:',
            '',
            '## 次回会議の確認事項',
            '',
            '* ○○の進捗確認',
            '',
            '[REPEAT]',
            '曖昧なものは含めない。',
        ].join('\n');

        const result = await provider.generate(prompt);
        return { result: String(result || '').trim(), provider: provider.name };
    }

    /**
     * 議事録テキストの 1 チャンク分をカスタム指示で解析する（Map 段）。
     */
    async generateCustomPerChunk(chunkText, chunkIdx, totalChunks, customInstruction, aiConfig = {}) {
        if (!this.enabled) throw new Error('AI Service is not configured.');
        const provider = this.getProvider(aiConfig);
        const chunkLabel = `${chunkIdx + 1}/${totalChunks}`;

        const prompt = [
            `[CHUNK INFO] 議事録チャンク ${chunkLabel}`,
            '',
            '[SYSTEM]',
            'あなたは会議支援AIです。与えられた議事録だけを根拠に分析してください。',
            `以下は長い議事録の一部（チャンク ${chunkLabel}）です。`,
            '',
            '[CONTEXT]',
            `以下は議事録チャンク ${chunkLabel} です：`,
            chunkText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            customInstruction || '議事録を整理してください。',
        ].join('\n');

        const result = await provider.generate(prompt);
        return {
            chunkIndex: chunkIdx,
            result: String(result || '').trim(),
            provider: provider.name,
        };
    }

    async generateSpeakerActions(utterances, participants = []) {
        const structured = await this.generateStructuredInsights(utterances, participants);
        return structured.flat_actions;
    }
}

module.exports = { AIService, withTimeoutAndRetry };
