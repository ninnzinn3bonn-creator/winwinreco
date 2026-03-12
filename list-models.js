require('dotenv').config();
const https = require('https');

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const result = JSON.parse(data);
        if (result.models) {
            console.log("利用可能なモデルの一覧:");
            result.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.error("モデルが見つかりませんでした。レスポンス:", JSON.stringify(result, null, 2));
        }
    });
}).on('error', (err) => {
    console.error("リクエストエラー:", err.message);
});
