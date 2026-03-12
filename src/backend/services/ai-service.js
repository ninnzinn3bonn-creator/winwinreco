const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Gemini API Provider
 */
class GeminiProvider {
    constructor(apiKey) {
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        this.name = 'gemini 2.5 flash';
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
    constructor(baseUrl = 'http://localhost:11434', modelName = 'llama3') {
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
                this.provider = new GeminiProvider(config.apiKey || process.env.GEMINI_API_KEY);
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
            case 'agenda':
                systemPrompt = '以下の会議ログから、決定事項 (Decisions) とネクストアクション (TODO) を箇条書きで抽出してください。';
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
