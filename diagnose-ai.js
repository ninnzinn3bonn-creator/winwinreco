require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function diagnose() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY が .env に設定されていません。");
        return;
    }

    console.log("APIキーの疎通確認を開始します...");
    const genAI = new GoogleGenerativeAI(apiKey);
    
    try {
        const modelNames = ["models/gemini-2.5-flash"];
        
        for (const name of modelNames) {
            console.log(`モデル '${name}' を試行中...`);
            try {
                const model = genAI.getGenerativeModel({ model: name });
                const result = await model.generateContent("Hi");
                const response = await result.response;
                console.log(`✅ モデル '${name}' は有効です。応答: ${response.text()}`);
                return name;
            } catch (e) {
                console.log(`❌ モデル '${name}' は失敗しました: ${e.message}`);
            }
        }
    } catch (error) {
        console.error("致命的なエラー:", error);
    }
}

diagnose();
