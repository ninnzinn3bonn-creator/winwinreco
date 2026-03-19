const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Gemini API Provider
 */
class GeminiProvider {
    constructor(apiKey, modelName) {
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
        const genAI = new GoogleGenerativeAI(apiKey);
        const actualModelName = modelName || process.env.GEMINI_MODEL || "gemini-2.5-flash";
        this.model = genAI.getGenerativeModel({ model: actualModelName });
        this.name = `gemini (${actualModelName})`;
    }

    async generate(prompt) {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    }
}

/**
 * Ollama (Local LLM) Provider
 */
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
                prompt: prompt,
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

/**
 * AIService - Facade for multiple AI providers
 */
class AIService {
    constructor(config = {}) {
        const providerType = config.provider || process.env.AI_PROVIDER || 'gemini';
        
        try {
            if (providerType === 'ollama') {
                this.provider = new OllamaProvider(
                    config.ollamaUrl || process.env.OLLAMA_BASE_URL,
                    config.ollamaModel || process.env.OLLAMA_MODEL || 'llama3'
                );
            } else {
                this.provider = new GeminiProvider(
                    config.apiKey || process.env.GEMINI_API_KEY,
                    config.geminiModel || process.env.GEMINI_MODEL
                );
            }
            this.enabled = true;
            console.log(`[AIService] Initialized with provider: ${this.provider.name}`);
        } catch (error) {
            console.warn(`[AIService] Failed to initialize provider "${providerType}":`, error.message);
            this.enabled = false;
        }
    }

    async analyzeMeeting(utterances, type = 'summary', customInstruction = '') {
        if (!this.enabled) {
            throw new Error('AI Service is not configured.');
        }

        const transcript = utterances
            .map(u => `${u.display_name}: ${u.transcript}`)
            .join('\n');

        let systemPrompt = '';
        switch (type) {
            case 'summary':
                systemPrompt = '以下の会議ログを要約してください。重要な議論のポイントを簡潔にまとめてください。';
                break;
            case 'todo':
                systemPrompt = '以下の会議ログから、決定事項 (Decisions) とネクストアクション (TODO) を箇条書きで抽出してください。誰がいつまでに何をするかを明確にしてください。必ず日本語で出力してください。';
                break;
            case 'topic_tree':
                systemPrompt = `あなたは会議の議論をトピックツリー形式で整理する専門家です。

指示：
- 会議ログから新しいトピックや議論の深まりを抽出し、ツリーに追加してください。
- 階層はインデント（スペース2つ）と記号（└, ├）で表現してください。
- もし「現在のトピックツリー」が提供されている場合は、その構造を維持しつつ、新しい内容を適切な位置に統合してください。
- 出力は純粋なトピックツリーのみ（テキスト形式）とし、説明文などは一切含めないでください。

${customInstruction ? `【重要】${customInstruction}` : ''}

出力例：
トピックA
  ├ 子要素A-1
  └ 子要素A-2
トピックB
`;
                break;
            case 'custom':
                systemPrompt = customInstruction || '以下の会議ログを分析してください。';
                break;
            default:
                systemPrompt = '以下の会議ログを要約してください。';
        }

        const prompt = `${systemPrompt}\n\n--- 会議ログ ---\n${transcript}`;

        try {
            const resultText = await this.provider.generate(prompt);
            return {
                result: resultText,
                prompt: prompt,
                provider: this.provider.name
            };
        } catch (error) {
            console.error('[AIService] Error generating content:', error);
            throw error;
        }
    }
}

module.exports = { AIService };
