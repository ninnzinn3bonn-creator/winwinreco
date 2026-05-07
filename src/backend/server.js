require('dotenv').config();
const http = require('http');
const { createApp, setupWebSocket } = require('./app');
const { RoomRepository } = require('./repo/room-repo');
const { ParticipantRepository } = require('./repo/participant-repo');
const { UtteranceRepository } = require('./repo/utterance-repo');
const { AnalysisRepository } = require('./repo/analysis-repo');
const { ActionRepository } = require('./repo/action-repo');
const { UserRepository } = require('./repo/user-repo');
const { UserContextRepository } = require('./repo/user-context-repo');
const { DictionaryRepo } = require('./repo/dictionary-repo');
const { UserAccountRepository } = require('./repo/user-account-repo');
const { SessionRepository } = require('./repo/session-repo');
const { initDB } = require('./repo/db');
const { AudioProcessor } = require('./services/audio-processor');
const { STTService } = require('./services/stt-service');
const { AIService } = require('./services/ai-service');

async function start() {
    const dbPath = process.env.DB_PATH || './db/meeting.db';
    const db = await initDB(dbPath);

    const repos = {
        roomRepo: new RoomRepository(db),
        participantRepo: new ParticipantRepository(db),
        utteranceRepo: new UtteranceRepository(db),
        analysisRepo: new AnalysisRepository(db),
        actionRepo: new ActionRepository(db),
        userRepo: new UserRepository(db),
        userContextRepo: new UserContextRepository(db),
        dictionaryRepo: new DictionaryRepo(db),
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db)
    };

    try {
        const pruned = await repos.sessionRepo.pruneExpired();
        if (pruned > 0) console.log(`[startup] Pruned ${pruned} expired session(s).`);
    } catch (error) {
        console.error('[startup] Session prune failed:', error);
    }

    try {
        const swept = await repos.roomRepo.resetStuckProcessing();
        if (swept > 0) {
            console.log(`[startup] Reset ${swept} room(s) from 'processing' to 'error'.`);
        }
    } catch (error) {
        console.error('[startup] Failed to reset stuck insights_status:', error);
    }

    const audioProcessor = new AudioProcessor({ chunkLimit: 10 });
    // STT defaults to Google Speech-to-Text. Set STT_PROVIDER=groq to opt
    // into Groq's whisper-large-v3-turbo. AI inference (summary/minutes)
    // remains on Groq by default — that's a separate setting.
    const sttService = new STTService({
        provider: process.env.STT_PROVIDER || 'google',
        groqApiKey: process.env.GROQ_API_KEY,
        groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
        googleApiKey: process.env.GOOGLE_API_KEY,
        language: process.env.STT_LANGUAGE || 'ja'
    });
    console.log(`[startup] STT provider=${sttService.provider} language=${sttService.language}`
        + (sttService.provider === 'groq' ? ` model=${sttService.groqModel}` : ' model=latest_long(google)'));
    const aiService = new AIService({
        provider: process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'gemini'),
        apiKey: process.env.GEMINI_API_KEY,
        groqApiKey: process.env.GROQ_API_KEY
    });
    console.log(`[startup] AI provider=${aiService.provider || (process.env.AI_PROVIDER || 'auto')}`);

    repos.aiService = aiService;

    const app = createApp(repos);
    const server = http.createServer(app);

    const allowedOrigins = (process.env.WS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const wss = setupWebSocket(server, { ...repos, audioProcessor, sttService }, { allowedOrigins });

    repos.wss = wss;

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[shutdown] Received ${signal}, draining...`);

        const hardKill = setTimeout(() => {
            console.error('[shutdown] Drain timeout exceeded; forcing exit.');
            process.exit(1);
        }, 10_000);
        if (typeof hardKill.unref === 'function') hardKill.unref();

        try {
            await new Promise((resolve) => server.close(() => resolve()));
            try {
                wss.clients.forEach((client) => {
                    try {
                        client.close(1001, 'Server shutting down');
                    } catch (_err) {
                        // noop
                    }
                });
                await new Promise((resolve) => wss.close(() => resolve()));
            } catch (wsErr) {
                console.error('[shutdown] WebSocket close error:', wsErr);
            }

            if (db && typeof db.close === 'function') {
                await new Promise((resolve) => db.close(() => resolve()));
            }

            console.log('[shutdown] Clean exit.');
            clearTimeout(hardKill);
            process.exit(0);
        } catch (error) {
            console.error('[shutdown] Error during shutdown:', error);
            clearTimeout(hardKill);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
    console.error('[startup] Fatal error:', error);
    process.exit(1);
});
