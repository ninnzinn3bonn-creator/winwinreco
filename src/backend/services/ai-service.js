const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiProvider {
    constructor(apiKey, modelName) {
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
        const genAI = new GoogleGenerativeAI(apiKey);
        const actualModelName = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
        this.model = genAI.getGenerativeModel({ model: actualModelName });
        this.name = `gemini (${actualModelName})`;
    }

    async generate(prompt) {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    }
}

class OllamaProvider {
    constructor(baseUrl = 'http://localhost:11434', modelName = 'gpt-oss:20b') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.modelName = modelName;
        this.name = `Local LLM (Ollama: ${modelName})`;
    }

    async generate(prompt) {
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.modelName,
                prompt,
                stream: false
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errBody}`);
        }

        const data = await response.json();
        return data.response;
    }
}

function stripCodeFence(text) {
    return String(text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function safeJsonParse(text) {
    return JSON.parse(stripCodeFence(text));
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

function jp(text) {
    return text;
}

class AIService {
    constructor(config = {}) {
        const providerType = 'gemini';

        try {
            this.provider = new GeminiProvider(
                config.apiKey || process.env.GEMINI_API_KEY,
                config.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-pro'
            );
            this.enabled = true;
            console.log(`[AIService] Initialized with provider: ${this.provider.name}`);
        } catch (error) {
            console.warn(`[AIService] Failed to initialize provider "${providerType}":`, error.message);
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

    async generateStructuredInsights(utterances, participants = [], userContexts = []) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const messages = this.toMessages(utterances);
        const prompt = this.buildStructuredInsightsPrompt(messages, participants, userContexts);
        const raw = await this.provider.generate(prompt);
        const parsed = safeJsonParse(raw);

        return {
            ...this.normalizeStructuredInsights(parsed, participants),
            prompt,
            provider: this.provider.name,
            raw_result: stripCodeFence(raw)
        };
    }

    async analyzeMeeting(utterances, type = 'summary', customInstruction = '', participants = [], userContexts = []) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        if (type === 'summary') {
            const structured = await this.generateStructuredInsights(utterances, participants, userContexts);
            return {
                result: structured.overall_summary,
                prompt: structured.prompt,
                provider: structured.provider
            };
        }

        if (type === 'minutes') {
            const messages = this.toMinuteMessages(utterances);
            const prompt = [
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
                jp('- 不明瞭な固有名詞は、推測しすぎず自然な範囲で補正する'),
                jp('- 箇条書きだけを返し、前置きや説明は書かない'),
                '',
                this.buildUserContextBlock(participants, userContexts),
                jp('# 生ログ'),
                JSON.stringify({ messages }, null, 2)
            ].join('\n');

            const resultText = await this.provider.generate(prompt);
            return {
                result: resultText.trim(),
                prompt,
                provider: this.provider.name
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
        const resultText = await this.provider.generate(prompt);
        return {
            result: resultText,
            prompt,
            provider: this.provider.name
        };
    }

    async generateMinutesFromTranscript(utterances, roomMeta = {}, participants = [], userContexts = []) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const transcript = this.toMessages(utterances)
            .map((message) => `[${message.timestamp || '-'}] ${message.speaker}: ${message.text}`)
            .join('\n');

        const participantNames = participants.map((participant) => participant.display_name).filter(Boolean).join('、') || '不明';
        const prompt = [
            '[SYSTEM]',
            'あなたは高精度な議事録作成AIです。',
            '音声文字起こしには誤認識・ノイズ・クロストークが含まれます。',
            '文脈を理解し、正しい議事録に再構成してください。',
            '',
            '[CONTEXT]',
            '以下は会議の文字起こしログです：',
            transcript || '(ログなし)',
            '',
            this.buildUserContextBlock(participants, userContexts),
            '[INSTRUCTION]',
            '以下を実行してください：',
            '1. ノイズ・誤変換・無意味な発言を削除',
            '2. クロストークを文脈から整理',
            '3. 発言者ごとに整理',
            '4. 自然な日本語に修正',
            '5. 意味単位で統合',
            '6. 時系列を維持',
            '',
            '[FORMAT]',
            '## 会議情報',
            '',
            `* 日時: ${roomMeta.date || '不明'}`,
            `* 会議名: ${roomMeta.title || roomMeta.roomId || '会議'}`,
            `* 参加者: ${participantNames}`,
            '',
            '## 議事録',
            '',
            '### セクション1: トピック名',
            '',
            '* 発言者A: 内容',
            '* 発言者B: 内容',
            '',
            '### セクション2',
            '',
            '...',
            '',
            '[REPEAT]',
            'ノイズを除去し、意味のある発言のみで構成してください。'
        ].join('\n');

        const result = await this.provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: this.provider.name
        };
    }

    async generateSummaryFromMinutes(minutesText) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const prompt = [
            '[SYSTEM]',
            'あなたは会議内容を構造的に要約するAIです。',
            '',
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

        const result = await this.provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: this.provider.name
        };
    }

    async generateTodoFromMinutes(minutesText) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const prompt = [
            '[SYSTEM]',
            'あなたは会議から行動と次の議題を抽出するAIです。',
            '',
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

        const result = await this.provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: this.provider.name
        };
    }

    async generateCustomFromMinutes(minutesText, customInstruction) {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const prompt = [
            '[SYSTEM]',
            'あなたは会議支援AIです。与えられた議事録だけを根拠に分析してください。',
            '生ログは使わず、議事録の内容だけを参照してください。',
            '',
            '[CONTEXT]',
            '以下は整理済み議事録です：',
            minutesText || '(議事録なし)',
            '',
            '[INSTRUCTION]',
            customInstruction || '議事録を整理してください。'
        ].join('\n');

        const result = await this.provider.generate(prompt);
        return {
            result: String(result || '').trim(),
            prompt,
            provider: this.provider.name
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
            const raw = await this.provider.generate(prompt);
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

    async correctTranscript(targetUtterance, contextUtterances = []) {
        if (!this.enabled) {
            return {
                corrected: targetUtterance.transcript,
                provider: 'none'
            };
        }

        const contextText = contextUtterances
            .map((u) => `${u.display_name}: ${u.transcript}`)
            .join('\n');

        const prompt = [
            jp('\u4f1a\u8b70\u4e2d\u306e\u6587\u5b57\u8d77\u3053\u3057\u3092\u3001\u81ea\u7136\u306a\u65e5\u672c\u8a9e\u306b\u88dc\u6b63\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            jp('\u610f\u5473\u3092\u5909\u3048\u305a\u3001\u524d\u5f8c\u306e\u6587\u8108\u306b\u5408\u3046\u3088\u3046\u306b\u8aa4\u5909\u63db\u3060\u3051\u3092\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            jp('\u51fa\u529b\u306f\u88dc\u6b63\u5f8c\u30c6\u30ad\u30b9\u30c8\u306e\u307f\u3067\u3001\u65e5\u672c\u8a9e\u672c\u6587\u3060\u3051\u3092\u8fd4\u3057\u3066\u304f\u3060\u3055\u3044\u3002'),
            '',
            jp('\u524d\u5f8c\u306e\u6587\u8108') + ':',
            contextText || '(none)',
            '',
            jp('\u5bfe\u8c61\u306e\u6587\u5b57\u8d77\u3053\u3057') + ':',
            targetUtterance.raw_transcript || targetUtterance.transcript || ''
        ].join('\n');

        const corrected = (await this.provider.generate(prompt)).trim();
        return {
            corrected: corrected || targetUtterance.transcript,
            provider: this.provider.name,
            prompt
        };
    }

    async generateSpeakerActions(utterances, participants = []) {
        const structured = await this.generateStructuredInsights(utterances, participants);
        return structured.flat_actions;
    }
}

module.exports = { AIService };
