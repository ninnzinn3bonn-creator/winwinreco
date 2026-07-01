require('dotenv').config();
const http = require('http');
const { createApp, setupWebSocket } = require('./app');
const { createRepos } = require('./repo');
const { AudioProcessor } = require('./services/audio-processor');
const { STTService } = require('./services/stt-service');
const { AIService } = require('./services/ai-service');
const { logger } = require('./lib/logger');

async function start() {
    const repos = await createRepos();

    try {
        const pruned = await repos.sessionRepo.pruneExpired();
        if (pruned > 0) logger.info('[startup] Pruned expired sessions', { count: pruned });
    } catch (error) {
        logger.error(error, { tag: '[startup] Session prune failed' });
    }

    try {
        const swept = await repos.roomRepo.resetStuckProcessing();
        if (swept > 0) {
            logger.info('[startup] Reset stuck rooms from processing to error', { count: swept });
        }
    } catch (error) {
        logger.error(error, { tag: '[startup] Failed to reset stuck insights_status' });
    }

    const audioProcessor = new AudioProcessor({ chunkLimit: 10 });
    const sttService = new STTService({
        // Product decision (2026-06-29): production STT is fixed to
        // ElevenLabs Scribe. Do not read STT_PROVIDER here; stale .env values
        // from the old selectable-provider era must not switch runtime STT.
        provider: 'elevenlabs',
        groqApiKey: process.env.GROQ_API_KEY,
        groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
        googleApiKey: process.env.GOOGLE_API_KEY,
        language: process.env.STT_LANGUAGE || 'ja'
    });
    logger.info('[startup] STT configured', {
        provider: sttService.provider,
        language: sttService.language,
        model: sttService.provider === 'elevenlabs'
            ? sttService.elevenLabsRealtimeModel
            : sttService.provider === 'groq'
                ? sttService.groqModel
                : 'latest_long(google)'
    });

    const aiService = new AIService({
        // Product decision (2026-06-29): production AI is fixed to Groq.
        // AIService still contains provider implementations for tests and
        // emergency fallback paths, but app bootstrap must not honor stale
        // AI_PROVIDER values from older deployments.
        provider: 'groq',
        apiKey: process.env.GEMINI_API_KEY,
        groqApiKey: process.env.GROQ_API_KEY
    });
    logger.info('[startup] AI configured', { provider: aiService.provider?.name || 'groq' });

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
    const driver = process.env.DB_DRIVER || 'sqlite';
    server.listen(PORT, () => {
        logger.info('Server started', { port: PORT, driver });
    });

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info('[shutdown] Received signal, draining', { signal });

        const hardKill = setTimeout(() => {
            logger.error(new Error('[shutdown] Drain timeout exceeded; forcing exit.'), { tag: 'shutdown' });
            process.exit(1);
        }, 10_000);
        if (typeof hardKill.unref === 'function') hardKill.unref();

        try {
            await new Promise((resolve) => server.close(() => resolve()));
            try {
                wss.clients.forEach((client) => {
                    try { client.close(1001, 'Server shutting down'); } catch (_err) { /* noop */ }
                });
                await new Promise((resolve) => wss.close(() => resolve()));
            } catch (wsErr) {
                logger.error(wsErr, { tag: '[shutdown] WebSocket close error' });
            }

            // SQLite のみ db.close() が必要。Firestore は不要。
            if (repos._raw && typeof repos._raw.close === 'function') {
                await new Promise((resolve) => repos._raw.close(() => resolve()));
            }

            logger.info('[shutdown] Clean exit');
            clearTimeout(hardKill);
            process.exit(0);
        } catch (error) {
            logger.error(error, { tag: '[shutdown] Error during shutdown' });
            clearTimeout(hardKill);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
    logger.error(error, { tag: '[startup] Fatal error' });
    process.exit(1);
});
