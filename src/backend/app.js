const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const { STTService } = require('./services/stt-service');
const { newId, newToken } = require('./lib/ids');
const { createAuth } = require('./lib/auth');
const { securityHeaders, createRateLimiter, isAllowedOrigin } = require('./lib/security');
const { hashPassword, verifyPassword } = require('./lib/passwords');
const { buildSessionCookie, buildClearCookie } = require('./lib/cookies');
const { buildPastMeetingContext } = require('./lib/past-context');
const { shouldChunk, chunkUtterances, createSemaphore, shouldChunkText, chunkText } = require('./services/chunking');
const { withTimeoutAndRetry } = require('./services/ai-service');
const {
    sanitizeDisplayName,
    sanitizeProfileText,
    sanitizeMemoText,
    sanitizeTranscript,
    sanitizeInstruction
} = require('./lib/ai-sanitize');
const { sendPasswordReset, sendVerification } = require('./lib/mail');
const { logger } = require('./lib/logger');

// RFC-5322-lite email shape check. Server-side defense; final authority is the
// DB UNIQUE constraint + login flow.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;

function validateSignupInput(body) {
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const displayName = sanitizeDisplayName(body?.display_name || email.split('@')[0] || '');
    if (!EMAIL_RE.test(email)) return { error: 'Invalid email address' };
    if (email.length > 254) return { error: 'Invalid email address' };
    if (password.length < MIN_PASSWORD_LEN) return { error: `Password must be at least ${MIN_PASSWORD_LEN} characters` };
    if (password.length > MAX_PASSWORD_LEN) return { error: 'Password too long' };
    return { email, password, displayName };
}

// Cookie `Secure` flag is only meaningful over HTTPS; disable in dev so cookies
// actually reach the browser when we're on localhost. Production should set
// COOKIE_SECURE=true (server.js env).
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

function generateShortRoomId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    // Use crypto.randomInt for a cryptographically sound, non-biased pick so the
    // 6-char room id cannot be inferred from wall-clock timing.
    let id = '';
    for (let i = 0; i < 6; i += 1) {
        id += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    return id;
}

async function enrichParticipantsWithProfiles(participantRepo, userRepo, roomId) {
    const participants = participantRepo ? await participantRepo.findByRoomId(roomId) : [];
    if (!userRepo) {
        return participants.map((participant) => ({ ...participant, profile_text: '' }));
    }

    return Promise.all(participants.map(async (participant) => {
        if (!participant.user_id) {
            return { ...participant, profile_text: '' };
        }
        const user = await userRepo.findById(participant.user_id);
        return {
            ...participant,
            profile_text: user?.profile_text || ''
        };
    }));
}

function collectSpeechHints(participants = [], dictionaryTerms = []) {
    const phrases = new Set();

    participants.forEach((participant) => {
        if (participant.display_name) {
            phrases.add(String(participant.display_name).trim());
        }

        const profileText = String(participant.profile_text || '');
        profileText
            .split(/[\n、。,.\/／;；:：]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2 && token.length <= 32)
            .slice(0, 8)
            .forEach((token) => phrases.add(token));
    });

    dictionaryTerms.forEach((item) => {
        if (item.term) phrases.add(item.term.trim());
        if (item.reading) phrases.add(item.reading.trim());
    });

    return Array.from(phrases).slice(0, 100);
}

function createApp(repositories = {}) {
    const app = express();

    // Size limit prevents trivial memory abuse. 1MB is already far larger than
    // any expected JSON payload (transcripts go via WebSocket binary).
    app.use(express.json({ limit: '1mb' }));
    app.use(securityHeaders());
    app.use(express.static('src/frontend'));

    // Legal static pages
    app.get('/terms', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../frontend/terms.html'));
    });
    app.get('/privacy', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../frontend/privacy.html'));
    });

    // リクエスト ID ミドルウェア: 全リクエストに UUID を付与し、ログの追跡に使う。
    // フロントエンドまたはロードバランサーが x-request-id を渡した場合はそれを優先する。
    app.use((req, res, next) => {
        req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
        res.setHeader('x-request-id', req.requestId);
        next();
    });

    // リクエストログミドルウェア: 静的ファイルと heartbeat を除く全リクエストをログする。
    // REQUEST_LOG=0 で無効化できる (テスト時など)。
    if (process.env.REQUEST_LOG !== '0') {
        app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const latency = Date.now() - start;
                // 静的ファイル (拡張子付き) と heartbeat は省く
                if (/\.\w+$/.test(req.path) || req.path === '/api/status') return;
                logger.info('request', {
                    requestId: req.requestId,
                    method: req.method,
                    path: req.path,
                    status: res.statusCode,
                    latency_ms: latency
                });
            });
            next();
        });
    }

    const {
        roomRepo, participantRepo, utteranceRepo, analysisRepo, actionRepo,
        userRepo, userContextRepo, dictionaryRepo, aiService,
        accountRepo, sessionRepo, chunkRepo, passwordResetRepo, emailVerificationRepo
    } = repositories;

    const auth = createAuth({ participantRepo, roomRepo, accountRepo, sessionRepo });
    const { requireParticipant, requireHost, requireSession, requireOwner, attachSessionIfPresent } = auth;

    // Rate limiters — tune per concern:
    //   general:  covers all /rooms/* + /api/*
    //   ai:       tighter cap for the expensive AI generation routes
    //   auth:     tight cap on signup/login to slow credential stuffing
    const generalLimiter = createRateLimiter({ windowMs: 60_000, max: 120, key: 'general' });
    const aiLimiter = createRateLimiter({ windowMs: 60_000, max: 20, key: 'ai' });
    const authLimiter = createRateLimiter({ windowMs: 60_000, max: 8, key: 'auth' });
    app.use('/rooms', generalLimiter);
    app.use('/api', generalLimiter);
    app.use('/auth', generalLimiter);
    app.use('/me', generalLimiter);

    function serializeAccount(account) {
        if (!account) return null;
        // OWNER_EMAIL 環境変数による後方互換オーナー判定もここで合算しておく。
        // フロント側で is_owner=true なら管理リンクを表示する判断に使える。
        const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
        const matchesOwnerEmail = ownerEmail
            && (account.email || '').toLowerCase() === ownerEmail;
        return {
            id: account.id,
            email: account.email,
            display_name: account.display_name || '',
            // 'pending' | 'approved' | 'rejected'。フロントが承認待ち画面を出すのに使う。
            status: account.status || 'approved',
            is_owner: Number(account.is_owner) === 1 || matchesOwnerEmail
        };
    }

    /**
     * [L6] 指定ルームの全 WebSocket クライアントにメッセージをブロードキャストする。
     * 会議終了後も WS が開いていれば summary 画面に進捗を届けられる。
     */
    function broadcastToRoom(roomId, message) {
        const wss = repositories.wss;
        if (!wss || !wss.rooms || !wss.rooms.has(roomId)) return;
        const msgStr = JSON.stringify(message);
        for (const client of wss.rooms.get(roomId)) {
            if (client.readyState === WebSocket.OPEN) {
                try { client.send(msgStr); } catch (_) { /* ignore */ }
            }
        }
    }

    async function buildInsightsResponse(roomId) {
        const [room, actions, speakerSummaryAnalysis] = await Promise.all([
            roomRepo ? roomRepo.findById(roomId) : null,
            actionRepo ? actionRepo.findByRoomId(roomId) : [],
            analysisRepo ? analysisRepo.findLatestByTypes(roomId, ['speaker_summaries']) : null
        ]);

        let speakerSummaries = [];
        if (speakerSummaryAnalysis?.result_text) {
            try {
                speakerSummaries = JSON.parse(speakerSummaryAnalysis.result_text);
            } catch (error) {
                speakerSummaries = [];
            }
        }

        return {
            summary: room?.summary_text || '',
            summary_updated_at: room?.summary_updated_at || null,
            minutes: room?.minutes_text || '',
            minutes_updated_at: room?.minutes_updated_at || null,
            todo: room?.todo_text || '',
            todo_updated_at: room?.todo_updated_at || null,
            status: room?.insights_status || 'idle',
            dirty: !!room?.insights_dirty,
            actions: actions || [],
            speaker_summaries: speakerSummaries
        };
    }

    async function generateSharedAiResult(roomId, type, options = {}) {
        const room = await roomRepo.findById(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        const provider = room.ai_provider || 'gemini';
        const aiConfig = {
            provider,
            model: room.ai_model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
        };

        // Past-meeting context is gated by:
        //   1) the host being logged in (owner_account_id present)
        //   2) the room-level toggle (room.use_past_meetings)
        //   3) the per-call override (options.usePastContext === false)
        //   4) optional explicit roomIds list (options.pastRoomIds) for manual selection
        // The override lets the AI 解析 panel toggle past context per click
        // without mutating the room setting. Minutes always passes false.
        const overrideOff = options.usePastContext === false;
        if (!overrideOff && room.owner_account_id && room.use_past_meetings !== 0) {
            try {
                const pastOpts = { excludeRoomId: roomId };
                if (Array.isArray(options.pastRoomIds)) {
                    pastOpts.roomIds = options.pastRoomIds;
                }
                const { block } = await buildPastMeetingContext(roomRepo, room.owner_account_id, pastOpts);
                if (block) aiConfig.pastContextBlock = block;
            } catch (err) {
                logger.warn('[pastContext] build failed; continuing without it', { error: err.message, roomId });
            }
        }

        const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
        const userIds = participants.map((item) => item.user_id).filter(Boolean);
        const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];

        if (type === 'minutes') {
            const utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            // Minutes are intentionally generated from this meeting only —
            // we strip pastContextBlock so the verbatim minutes never inherit
            // language or topics from prior sessions.
            const minutesAiConfig = { ...aiConfig };
            delete minutesAiConfig.pastContextBlock;

            const roomMeta = {
                roomId,
                date: new Date().toLocaleString('ja-JP'),
                title: `ルーム ${roomId}`,
                stt_provider: room.stt_provider || 'google'
            };

            let minutesText;

            if (shouldChunk(utterances)) {
                // ── Map-Reduce パス (長時間会議) ──────────────────────────
                const chunks = chunkUtterances(utterances);
                logger.info('[SharedAI] minutes: chunking utterances', { utteranceCount: utterances.length, chunkCount: chunks.length, roomId });
                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'minutes', completed: 0, total: chunks.length });

                let completedMinutes = 0;
                const limit = createSemaphore(2);
                const chunkResults = await Promise.all(
                    chunks.map((chunk) =>
                        limit(() =>
                            // [L8] タイムアウト 60 秒 + 最大 3 回リトライ
                            withTimeoutAndRetry(
                                () => aiService.generateMinutesPerChunk(
                                    chunk, chunks.length, roomMeta,
                                    participants, userContexts, minutesAiConfig
                                ),
                                {
                                    timeoutMs: 60000,
                                    retries: 3,
                                    placeholder: {
                                        chunkIndex: chunk.index,
                                        startTs: chunk.startTs,
                                        endTs: chunk.endTs,
                                        overlapWith: chunk.overlapWith,
                                        result: `[このチャンクの解析に失敗しました: 範囲 ${chunk.startTs}〜${chunk.endTs}]`,
                                        provider: 'error',
                                    }
                                }
                            ).then(result => {
                                completedMinutes++;
                                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'minutes', completed: completedMinutes, total: chunks.length });
                                // [L9] チャンク結果を DB に保存 (失敗チャンクも error ステータスで保存)
                                if (chunkRepo) {
                                    chunkRepo.upsert({
                                        room_id: roomId,
                                        chunk_index: result.chunkIndex,
                                        analysis_type: 'minutes',
                                        start_ts: result.startTs || '',
                                        end_ts: result.endTs || '',
                                        result_text: result.result || '',
                                        status: result.provider === 'error' ? 'error' : 'done'
                                    }).catch(e => logger.warn('[L9] chunk upsert failed', { error: e.message, roomId }));
                                }
                                return result;
                            })
                        )
                    )
                );

                minutesText = aiService.mergeMinutesChunks(chunkResults, roomMeta);
            } else {
                // ── 通常パス (短い会議) ───────────────────────────────────
                const generated = await aiService.generateMinutesFromTranscript(
                    utterances, roomMeta, participants, userContexts, minutesAiConfig
                );
                minutesText = generated.result;
            }

            const updatedRoom = await roomRepo.updateInsights(roomId, {
                minutes_text: minutesText
            });

            return {
                type,
                result: minutesText,
                updated_at: updatedRoom?.minutes_updated_at || null
            };
        }

        const latestRoom = await roomRepo.findById(roomId);
        const minutesText = String(latestRoom?.minutes_text || '').trim();
        if (!minutesText) {
            throw new Error('Minutes must be generated first');
        }

        if (type === 'summary') {
            let summaryResult;
            if (shouldChunkText(minutesText)) {
                // ── [L5] Map-Reduce パス (議事録が長い場合) ──────────────
                const textChunks = chunkText(minutesText);
                logger.info('[SharedAI] summary: chunking minutes', { chunkCount: textChunks.length, roomId });
                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'summary', completed: 0, total: textChunks.length });

                let completedSummary = 0;
                const limit = createSemaphore(2);
                const partialSummaries = await Promise.all(
                    textChunks.map(chunk =>
                        limit(() =>
                            withTimeoutAndRetry(
                                () => aiService.generateSummaryPerChunk(
                                    chunk.text, chunk.index, textChunks.length,
                                    participants, userContexts, aiConfig
                                ),
                                {
                                    timeoutMs: 60000,
                                    retries: 3,
                                    placeholder: {
                                        chunkIndex: chunk.index,
                                        result: `[チャンク ${chunk.index + 1}/${textChunks.length} の要約生成に失敗しました]`,
                                        provider: 'error',
                                    }
                                }
                            ).then(r => {
                                completedSummary++;
                                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'summary', completed: completedSummary, total: textChunks.length });
                                return r;
                            })
                        )
                    )
                );
                summaryResult = await aiService.mergeSummaryChunks(
                    partialSummaries.map(r => r.result),
                    participants, userContexts, aiConfig
                );
            } else {
                summaryResult = await aiService.generateSummaryFromMinutes(minutesText, participants, userContexts, aiConfig);
            }
            const updatedRoom = await roomRepo.updateInsights(roomId, {
                summary_text: summaryResult.result,
                insights_dirty: false
            });
            return {
                type,
                result: summaryResult.result,
                updated_at: updatedRoom?.summary_updated_at || null
            };
        }

        if (type === 'todo') {
            let todoResult;
            if (shouldChunkText(minutesText)) {
                // ── [L5] Map-Reduce パス ──────────────────────────────────
                const textChunks = chunkText(minutesText);
                logger.info('[SharedAI] todo: chunking minutes', { chunkCount: textChunks.length, roomId });
                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'todo', completed: 0, total: textChunks.length });

                let completedTodo = 0;
                const limit = createSemaphore(2);
                const partialTodos = await Promise.all(
                    textChunks.map(chunk =>
                        limit(() =>
                            withTimeoutAndRetry(
                                () => aiService.generateTodoPerChunk(
                                    chunk.text, chunk.index, textChunks.length,
                                    participants, userContexts, aiConfig
                                ),
                                {
                                    timeoutMs: 60000,
                                    retries: 3,
                                    placeholder: {
                                        chunkIndex: chunk.index,
                                        result: `[チャンク ${chunk.index + 1}/${textChunks.length} のTODO生成に失敗しました]`,
                                        provider: 'error',
                                    }
                                }
                            ).then(r => {
                                completedTodo++;
                                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'todo', completed: completedTodo, total: textChunks.length });
                                return r;
                            })
                        )
                    )
                );
                todoResult = await aiService.mergeTodoChunks(
                    partialTodos.map(r => r.result),
                    participants, userContexts, aiConfig
                );
            } else {
                todoResult = await aiService.generateTodoFromMinutes(minutesText, participants, userContexts, aiConfig);
            }
            const updatedRoom = await roomRepo.updateInsights(roomId, {
                todo_text: todoResult.result
            });
            return {
                type,
                result: todoResult.result,
                updated_at: updatedRoom?.todo_updated_at || null
            };
        }

        throw new Error('Unsupported shared AI type');
    }

    async function triggerAutomaticMeetingOutputs(roomId) {
        if (!roomRepo || !participantRepo || !utteranceRepo || !aiService || !aiService.enabled) {
            return;
        }

        try {
            await roomRepo.updateInsights(roomId, {
                insights_status: 'processing'
            });

            const utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            if (!utterances.length) {
                await roomRepo.updateInsights(roomId, {
                    insights_status: 'ready',
                    insights_dirty: false
                });
                return;
            }

            await generateSharedAiResult(roomId, 'minutes');
            await generateSharedAiResult(roomId, 'summary');
            await generateSharedAiResult(roomId, 'todo');

            await roomRepo.updateInsights(roomId, {
                insights_status: 'ready',
                insights_dirty: false
            });
        } catch (error) {
            logger.error(error, { route: 'triggerAutomaticMeetingOutputs', roomId });
            await roomRepo.updateInsights(roomId, {
                insights_status: 'error',
                insights_dirty: true
            });
        }
    }

    async function generateInsightsForRoom(roomId, aiConfig = null, opts = {}) {
        if (!roomRepo || !utteranceRepo || !participantRepo || !actionRepo) {
            throw new Error('Repositories required for insight generation are unavailable');
        }

        const room = await roomRepo.findById(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        const provider = room.ai_provider || 'gemini';
        const resolvedAiConfig = aiConfig || {
            provider,
            model: room.ai_model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
        };

        // Inject past-meeting context block if requested via manual room selection
        if (Array.isArray(opts.pastRoomIds) && room.owner_account_id) {
            try {
                const pastOpts = { excludeRoomId: roomId, roomIds: opts.pastRoomIds };
                const { block } = await buildPastMeetingContext(roomRepo, room.owner_account_id, pastOpts);
                if (block) resolvedAiConfig.pastContextBlock = block;
            } catch (err) {
                logger.warn('[pastContext] build failed in generateInsightsForRoom', { error: err.message, roomId });
            }
        }

        let activeAiService = aiService;
        if (resolvedAiConfig.provider) {
            const { AIService: AIServiceClass } = require('./services/ai-service');
            activeAiService = new AIServiceClass({
                provider: resolvedAiConfig.provider,
                geminiModel: resolvedAiConfig.provider === 'gemini' ? resolvedAiConfig.model : null,
                groqModel: resolvedAiConfig.provider === 'groq' ? resolvedAiConfig.model : null,
                ollamaModel: resolvedAiConfig.provider === 'ollama' ? resolvedAiConfig.model : null,
                apiKey: process.env.GEMINI_API_KEY,
                groqApiKey: process.env.GROQ_API_KEY
            });
        }

        if (!activeAiService || !activeAiService.enabled) {
            throw new Error('AI Service is not configured or disabled.');
        }

        await roomRepo.updateInsights(roomId, {
            insights_status: 'processing'
        });

        try {
            const [utterances, participants] = await Promise.all([
                utteranceRepo.findByRoomIdWithParticipants(roomId),
                enrichParticipantsWithProfiles(participantRepo, userRepo, roomId)
            ]);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];

            const structured = await activeAiService.generateStructuredInsights(utterances, participants, userContexts, resolvedAiConfig);
            const summaryText = structured.overall_summary;
            const generatedActions = structured.flat_actions;

            await roomRepo.updateInsights(roomId, {
                summary_text: summaryText,
                insights_status: 'ready',
                insights_dirty: false
            });

            await actionRepo.replaceForRoom(roomId, generatedActions.map((action) => ({
                id: newId('act'),
                speaker_id: action.speaker_id || null,
                speaker_name: action.speaker_name || '',
                action_text: action.action_text || ''
            })));

            if (userContextRepo && participants.length) {
                const updatedContexts = await activeAiService.updateUserContexts(participants, userContexts, utterances);
                for (const context of updatedContexts) {
                    if (!context.user_id) continue;
                    await userContextRepo.upsert({
                        user_id: context.user_id,
                        project_summary: context.project_summary || '',
                        current_status: context.current_status || '',
                        active_tasks: Array.isArray(context.active_tasks) ? context.active_tasks : [],
                        last_updated: new Date().toISOString()
                    });
                }
            }

            if (analysisRepo) {
                await analysisRepo.add({
                    id: newId('a-summary'),
                    room_id: roomId,
                    type: 'summary',
                    input_prompt: structured.prompt,
                    result_text: summaryText
                });
                await analysisRepo.add({
                    id: newId('a-speaker-summaries'),
                    room_id: roomId,
                    type: 'speaker_summaries',
                    input_prompt: structured.prompt,
                    result_text: JSON.stringify(structured.speaker_summaries)
                });
                await analysisRepo.add({
                    id: newId('a-speaker-actions'),
                    room_id: roomId,
                    type: 'speaker_actions',
                    input_prompt: structured.prompt,
                    result_text: JSON.stringify(generatedActions)
                });
                if (userContextRepo) {
                    const latestContexts = await userContextRepo.findByUserIds(userIds);
                    await analysisRepo.add({
                        id: newId('a-user-contexts'),
                        room_id: roomId,
                        type: 'user_contexts',
                        input_prompt: 'context update',
                        result_text: JSON.stringify(latestContexts)
                    });
                }
            }

            return buildInsightsResponse(roomId);
        } catch (error) {
            await roomRepo.updateInsights(roomId, {
                insights_status: 'error',
                insights_dirty: true
            });
            throw error;
        }
    }

    app.get('/', (req, res) => {
        res.status(200).send('GIJIRO API');
    });

    // GET /api/status - Check if API keys are configured properly. Now also
    // surfaces the active STT language, model, and dictionary boost-word
    // count so the setup screen can confirm "GROQ / Japanese / N boost words"
    // at a glance instead of guessing from server logs.
    app.get('/api/status', async (req, res) => {
        // STT defaults to Google (matches server.js bootstrap). AI defaults
        // to Groq when its API key is present, otherwise Gemini.
        const sttProvider = process.env.STT_PROVIDER || 'google';
        const aiProvider = process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'gemini');
        const sttLanguage = process.env.STT_LANGUAGE || 'ja';
        const sttModel = sttProvider === 'groq'
            ? (process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo')
            : sttProvider === 'elevenlabs'
                ? (process.env.ELEVENLABS_STT_MODEL || 'scribe_v2_flash')
                : 'latest_long';
        let dictionaryCount = 0;
        try {
            if (dictionaryRepo && typeof dictionaryRepo.findAll === 'function') {
                const terms = await dictionaryRepo.findAll();
                dictionaryCount = Array.isArray(terms) ? terms.length : 0;
            }
        } catch (_err) {
            dictionaryCount = 0;
        }
        // The "boost words" count is the dictionary table size — those terms
        // get folded into Groq's prompt / Google's speechContexts at room
        // start. Whisper accepts roughly 224 prompt tokens, and we cap the
        // SpeechContext phrases at 100 in collectSpeechHints(); we surface
        // both so the UI can show "N 語登録 / 最大 100 語送信" honestly.
        const STT_BOOST_CAP = 100;
        const status = {
            speech_to_text: sttProvider === 'groq'
                ? !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'dummy'
                : sttProvider === 'elevenlabs'
                    ? !!process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'dummy'
                    : !!process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'dummy',
            stt_provider: sttProvider,
            stt_language: sttLanguage,
            stt_model: sttModel,
            // フロントエンドが切り替え可能なプロバイダー一覧
            stt_available_providers: [
                'google',
                ...(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'dummy' ? ['elevenlabs'] : [])
            ],
            stt_dictionary_words: dictionaryCount,
            stt_boost_cap: STT_BOOST_CAP,
            // Effective per-meeting boost = min(dictionary + participants, cap).
            // We don't know participants count here, so report the dictionary
            // figure as the lower bound. The active-meeting view can show the
            // exact number once a room is connected.
            stt_boost_words: Math.min(dictionaryCount, STT_BOOST_CAP),
            ai_provider: aiProvider,
            groq_ai: !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'dummy',
            gemini_ai: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy'
        };
        res.status(200).json(status);
    });

    // Dictionary API
    app.get('/api/dictionary', async (req, res) => {
        try {
            if (!dictionaryRepo) return res.status(503).json({ error: 'Dictionary repo unavailable' });
            const terms = await dictionaryRepo.findAll();
            res.status(200).json(terms);
        } catch (error) {
            logger.error(error, { route: 'GET /api/dictionary', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to fetch dictionary' });
        }
    });

    app.post('/api/dictionary/extract', async (req, res) => {
        try {
            const { text, ai_config } = req.body;
            if (!text) return res.status(400).json({ error: 'Text is required' });
            if (!aiService || !aiService.enabled) return res.status(503).json({ error: 'AI service unavailable' });

            // Use Groq if available or requested, otherwise fallback
            const config = ai_config || { provider: 'groq', model: 'openai/gpt-oss-120b' };
            const terms = await aiService.extractDictionaryTerms(text, config);
            res.status(200).json({ terms });
        } catch (error) {
            logger.error(error, { route: 'POST /api/dictionary/extract', requestId: req.requestId });
            res.status(500).json({ error: error.message || 'Failed to extract terms' });
        }
    });

    app.post('/api/dictionary', async (req, res) => {
        try {
            if (!dictionaryRepo) return res.status(503).json({ error: 'Dictionary repo unavailable' });
            const { label, term, reading } = req.body;
            if (!term) return res.status(400).json({ error: 'term is required' });
            const added = await dictionaryRepo.add({ id: newId('d'), label: label || '', term, reading: reading || '' });
            res.status(201).json(added);
        } catch (error) {
            logger.error(error, { route: 'POST /api/dictionary', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to add term' });
        }
    });

    app.delete('/api/dictionary/:id', async (req, res) => {
        try {
            if (!dictionaryRepo) return res.status(503).json({ error: 'Dictionary repo unavailable' });
            await dictionaryRepo.delete(req.params.id);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error(error, { route: 'DELETE /api/dictionary/:id', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to delete term' });
        }
    });

    // --- Account / session endpoints -------------------------------------
    // Design notes:
    //  - Signup / login share a single error shape ("Invalid email or password")
    //    on failure so they don't leak whether an email exists.
    //  - On success the session_token cookie is set HttpOnly + SameSite=Lax;
    //    the body intentionally omits the raw token so it can't be scraped
    //    from a non-cookie-aware client.
    //  - Logout destroys the current session row (not all of the account's
    //    sessions) so other devices stay logged in.
    app.post('/auth/signup', authLimiter, async (req, res) => {
        try {
            if (!accountRepo || !sessionRepo) {
                return res.status(503).json({ error: 'Accounts unavailable' });
            }
            const parsed = validateSignupInput(req.body || {});
            if (parsed.error) return res.status(400).json({ error: parsed.error });

            const existing = await accountRepo.findByEmail(parsed.email);
            if (existing) {
                // Same generic shape as a signup with a bad password so
                // enumeration of existing accounts is harder.
                return res.status(409).json({ error: 'Email already registered' });
            }

            const passwordHash = await hashPassword(parsed.password);
            // 事後承認フロー:
            //   - OWNER_EMAIL に一致 → 自動 approved (後方互換)
            //   - それ以外は status='pending' で作成。admin が /admin で承認するまでログイン不可。
            // Owner 権限 (is_owner) は signup 時には付与しない。Bootstrap エンドポイント
            // (/admin/bootstrap-owner) で初回ログインユーザーが自分自身を昇格させる。
            const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
            const isOwnerEmail = ownerEmail && parsed.email === ownerEmail;
            // オーナーメールは直接 approved。通常ユーザーはメール認証後に pending へ進む。
            const initialStatus = isOwnerEmail ? 'approved' : 'pending_email';

            const account = await accountRepo.create({
                email: parsed.email,
                passwordHash,
                displayName: parsed.displayName,
                status: initialStatus
            });

            // Mirror the account into the legacy `users` table so the existing
            // participant/user_id plumbing keeps working for logged-in hosts.
            if (userRepo) {
                await userRepo.upsert({ id: account.id, name: parsed.displayName, profile_text: '' });
            }

            // approved (=オーナー) のみセッション発行。pending_email は確認前なのでセッション無し。
            if (initialStatus === 'approved') {
                const { token } = await sessionRepo.create(account.id);
                res.setHeader('Set-Cookie', buildSessionCookie(token, {
                    maxAgeSeconds: SESSION_TTL_SECONDS,
                    secure: COOKIE_SECURE
                }));
                return res.status(201).json({ account: serializeAccount(account) });
            }

            // 確認トークンを生成してメール送信 (fire-and-forget: メール失敗でもアカウントは作成済み)
            if (emailVerificationRepo) {
                try {
                    const verifyToken = crypto.randomBytes(32).toString('hex');
                    await emailVerificationRepo.create({ accountId: account.id, token: verifyToken });
                    const host = process.env.APP_HOST || `${req.protocol}://${req.get('host')}`;
                    const verifyUrl = `${host}/auth/verify?token=${verifyToken}`;
                    sendVerification(account, verifyUrl).catch((err) => {
                        logger.warn('[auth/signup] verification mail error', { error: err.message, requestId: req.requestId });
                    });
                } catch (mailErr) {
                    logger.error(mailErr, { route: '/auth/signup', detail: 'emailVerificationRepo.create failed', requestId: req.requestId });
                }
            }

            return res.status(201).json({
                pending: true,
                message: 'ご登録ありがとうございます。確認メールをお送りしました。メール内のリンクをクリックして登録を完了してください。'
            });
        } catch (error) {
            logger.error(error, { route: '/auth/signup', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to sign up' });
        }
    });

    app.post('/auth/login', authLimiter, async (req, res) => {
        try {
            if (!accountRepo || !sessionRepo) {
                return res.status(503).json({ error: 'Accounts unavailable' });
            }
            const email = String(req.body?.email || '').trim().toLowerCase();
            const password = String(req.body?.password || '');
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const account = await accountRepo.findByEmail(email);
            // Verify even when the account is missing so timing is ~constant.
            const dummy = 'scrypt$16384$8$1$00$00';
            const ok = await verifyPassword(password, account?.password_hash || dummy);
            if (!account || !ok) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            // 事後承認フロー: 'approved' 以外は機能解放しない。
            // フロントは error_code を見て承認待ち / 拒否のメッセージを出し分ける。
            const status = account.status || 'approved';
            if (status === 'pending_email') {
                return res.status(403).json({
                    error_code: 'email_not_verified',
                    error: 'メールアドレスの確認が完了していません。受信箱を確認してください。'
                });
            }
            if (status === 'pending') {
                return res.status(403).json({
                    error_code: 'pending_approval',
                    error: 'アカウントは管理者の承認待ちです。'
                });
            }
            if (status === 'rejected') {
                return res.status(403).json({
                    error_code: 'account_rejected',
                    error: 'このアカウントは承認されませんでした。管理者にお問い合わせください。'
                });
            }

            const { token } = await sessionRepo.create(account.id);
            res.setHeader('Set-Cookie', buildSessionCookie(token, {
                maxAgeSeconds: SESSION_TTL_SECONDS,
                secure: COOKIE_SECURE
            }));
            // §54: last_login_at を非同期で更新。失敗してもログインは通す。
            if (accountRepo && accountRepo.touchLastLogin) {
                accountRepo.touchLastLogin(account.id).catch(() => {});
            }
            res.status(200).json({ account: serializeAccount(account) });
        } catch (error) {
            logger.error(error, { route: '/auth/login', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to log in' });
        }
    });

    app.post('/auth/logout', async (req, res) => {
        try {
            if (sessionRepo && req.headers && req.headers.cookie) {
                // Use the raw cookie extraction logic from the auth module so
                // destroyByToken matches what requireSession saw.
                const { extractSessionToken } = require('./lib/auth');
                const token = extractSessionToken(req);
                if (token) await sessionRepo.destroyByToken(token);
            }
            res.setHeader('Set-Cookie', buildClearCookie({ secure: COOKIE_SECURE }));
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/auth/logout', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to log out' });
        }
    });

    app.get('/auth/me', async (req, res) => {
        try {
            await new Promise((resolve) => attachSessionIfPresent(req, res, resolve));
            if (!req.account) return res.status(401).json({ error: 'Not authenticated' });
            res.status(200).json({ account: serializeAccount(req.account) });
        } catch (error) {
            logger.error(error, { route: '/auth/me', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to load session' });
        }
    });

    // --- Password reset (U-1) -------------------------------------------

    /**
     * GET /auth/reset
     * Serves the password-reset HTML form (reset.html).
     * The token query-param is consumed client-side by the page JS.
     */
    app.get('/auth/reset', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../frontend/reset.html'));
    });

    /**
     * POST /auth/forgot-password
     * Accepts { email }. Always returns 200 to prevent enumeration.
     * When a matching approved/pending account exists, generates a token
     * and sends a reset link by email.
     */
    app.post('/auth/forgot-password', authLimiter, async (req, res) => {
        try {
            if (!accountRepo || !passwordResetRepo) {
                return res.status(503).json({ error: 'Unavailable' });
            }
            const email = String(req.body?.email || '').trim().toLowerCase();
            // Always 200 — enumeration prevention. Don't short-circuit on bad email.
            if (email) {
                const account = await accountRepo.findByEmail(email);
                // Only send if account exists and is not rejected.
                if (account && account.status !== 'rejected') {
                    const token = crypto.randomBytes(32).toString('hex');
                    await passwordResetRepo.create({ accountId: account.id, token });
                    const host = process.env.APP_HOST ||
                        `${req.protocol}://${req.get('host')}`;
                    const resetUrl = `${host}/auth/reset?token=${token}`;
                    // Fire-and-forget: mail errors must not change the 200 response.
                    sendPasswordReset(account, resetUrl).catch((err) => {
                        logger.warn('[auth/forgot-password] mail error', { error: err.message, requestId: req.requestId });
                    });
                }
            }
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/auth/forgot-password', requestId: req.requestId });
            // Still 200 to avoid leaking information.
            res.status(200).json({ ok: true });
        }
    });

    /**
     * POST /auth/reset-password
     * Accepts { token, new_password }.
     * Validates token, updates password hash, destroys all existing sessions.
     */
    app.post('/auth/reset-password', authLimiter, async (req, res) => {
        try {
            if (!accountRepo || !sessionRepo || !passwordResetRepo) {
                return res.status(503).json({ error: 'Unavailable' });
            }
            const token = String(req.body?.token || '');
            const newPassword = String(req.body?.new_password || '');

            if (newPassword.length < MIN_PASSWORD_LEN) {
                return res.status(400).json({ error: `パスワードは${MIN_PASSWORD_LEN}文字以上にしてください` });
            }
            if (newPassword.length > MAX_PASSWORD_LEN) {
                return res.status(400).json({ error: 'パスワードが長すぎます' });
            }

            const row = await passwordResetRepo.findByToken(token);
            if (!row) {
                return res.status(400).json({ error: 'invalid_or_expired_token' });
            }

            const newHash = await hashPassword(newPassword);
            await accountRepo.updatePasswordHash(row.account_id, newHash);
            await passwordResetRepo.markUsed(row.id);
            // Revoke all existing sessions for this account so any stolen
            // session cookies are invalidated immediately.
            await sessionRepo.destroyAllForAccount(row.account_id);

            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/auth/reset-password', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to reset password' });
        }
    });

    // --- Email Verification (U-6) -------------------------------------------

    /**
     * GET /auth/verify
     * Serves the email-verification HTML page (verify.html).
     * The token query-param is consumed client-side by the page JS.
     */
    app.get('/auth/verify', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../frontend/verify.html'));
    });

    /**
     * POST /auth/verify
     * Accepts { token }. Validates token and advances account status from
     * 'pending_email' to 'pending' (awaiting owner approval).
     */
    app.post('/auth/verify', authLimiter, async (req, res) => {
        try {
            const { token } = req.body || {};
            if (!token) return res.status(400).json({ error: 'token required' });
            if (!emailVerificationRepo || !accountRepo) {
                return res.status(503).json({ error: 'Unavailable' });
            }
            const row = await emailVerificationRepo.findByToken(token);
            if (!row) return res.status(400).json({ error: 'invalid_or_expired_token' });
            // account を取得して status を pending に昇格
            const account = await accountRepo.findById(row.account_id);
            if (!account) return res.status(400).json({ error: 'invalid_or_expired_token' });
            if (account.status === 'pending_email') {
                await accountRepo.setStatus(account.id, 'pending');
            }
            await emailVerificationRepo.markUsed(row.id);
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/auth/verify', requestId: req.requestId });
            res.status(500).json({ error: 'failed_to_verify' });
        }
    });

    // --- Admin: 事後承認ユーザー管理 ---
    // 全 admin エンドポイントは OWNER_EMAIL の所有者セッションが必要。

    app.get('/admin', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../frontend/admin.html'));
    });

    /**
     * オーナー状態の確認用エンドポイント。ログイン済みなら誰でも呼べる。
     * フロント (/admin) は最初にこれを叩いて、以下のいずれかを判定する:
     *   - has_owner=false  → 初回セットアップ画面 (「自分をオーナーにする」ボタン)
     *   - is_self_owner=true → 通常の admin UI を表示
     *   - 以外            → 「権限がありません」表示
     */
    app.get('/admin/owner-status', async (req, res) => {
        try {
            await new Promise((resolve) => attachSessionIfPresent(req, res, resolve));
            if (!req.account) return res.status(401).json({ error: 'Not authenticated' });
            const ownerCount = accountRepo ? await accountRepo.countOwners() : 0;
            const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
            const matchesEnvOwner = !!(ownerEmail
                && (req.account.email || '').toLowerCase() === ownerEmail);
            const isSelfOwner = Number(req.account.is_owner) === 1 || matchesEnvOwner;
            // OWNER_EMAIL 環境変数が設定されている場合は実質オーナーがいるので
            // ブートストラップは許可しない (env のオーナーがログインすれば admin に入れる)。
            const hasOwner = ownerCount > 0 || !!ownerEmail;
            res.json({
                has_owner: hasOwner,
                is_self_owner: isSelfOwner,
                can_bootstrap: !hasOwner
            });
        } catch (error) {
            logger.error(error, { route: '/admin/owner-status', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to fetch owner status' });
        }
    });

    /**
     * ブートストラップ: まだオーナーが 1 人もいない状態で、approved な
     * ログインユーザーが自分自身をオーナーに昇格できる。一度誰かが昇格すると
     * has_owner=true になり、以降このエンドポイントは 409 で拒否される。
     */
    app.post('/admin/bootstrap-owner', authLimiter, async (req, res) => {
        try {
            await new Promise((resolve) => attachSessionIfPresent(req, res, resolve));
            if (!req.account) return res.status(401).json({ error: 'Not authenticated' });
            if (!accountRepo) return res.status(503).json({ error: 'Accounts unavailable' });

            const ownerCount = await accountRepo.countOwners();
            const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
            if (ownerCount > 0 || ownerEmail) {
                return res.status(409).json({
                    error: 'Owner already exists. Bootstrap is disabled.'
                });
            }
            // approved 状態でなければ admin に入れる意味がない
            if ((req.account.status || 'approved') !== 'approved') {
                return res.status(403).json({ error: 'Approve the account first.' });
            }
            await accountRepo.setOwner(req.account.id, true);
            const updated = await accountRepo.findById(req.account.id);
            res.json({ ok: true, account: serializeAccount(updated) });
        } catch (error) {
            logger.error(error, { route: '/admin/bootstrap-owner', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to bootstrap owner' });
        }
    });

    // 承認待ち件数 (admin リンクのバッジ表示用)。owner なら誰でも参照可。
    app.get('/admin/users/pending/count', requireOwner, async (req, res) => {
        try {
            const count = accountRepo ? await accountRepo.countPending() : 0;
            res.json({ count });
        } catch (error) {
            logger.error(error, { route: '/admin/users/pending/count', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to count pending users' });
        }
    });

    // 承認待ちユーザー一覧。
    app.get('/admin/users/pending', requireOwner, async (req, res) => {
        try {
            const users = accountRepo ? await accountRepo.findPending() : [];
            res.json({ users });
        } catch (error) {
            logger.error(error, { route: '/admin/users/pending', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to list pending users' });
        }
    });

    // 全ユーザー一覧 (status 別の管理用)。§54: 会議統計も付加。
    app.get('/admin/users', requireOwner, async (req, res) => {
        try {
            const users = accountRepo ? await accountRepo.findAll() : [];
            // 会議統計を各ユーザーに付加 (N+1 だが admin のみ & 100 ユーザー以下を想定)
            if (roomRepo) {
                await Promise.all(users.map(async (u) => {
                    try {
                        const rooms = await roomRepo.findRoomsForAccount(u.id, { limit: 200 });
                        u.meeting_count = rooms.length;
                        u.last_meeting_at = rooms.length > 0 ? (rooms[0].created_at || null) : null;
                        u.total_duration_minutes = rooms.reduce((sum, r) => {
                            if (!r.ended_at || !r.created_at) return sum;
                            const ms = new Date(r.ended_at) - new Date(r.created_at);
                            return sum + (ms > 0 ? ms / 60000 : 0);
                        }, 0);
                    } catch (_) {
                        u.meeting_count = 0;
                        u.last_meeting_at = null;
                        u.total_duration_minutes = 0;
                    }
                }));
            } else {
                for (const u of users) {
                    u.meeting_count = 0;
                    u.last_meeting_at = null;
                    u.total_duration_minutes = 0;
                }
            }
            res.json({ users });
        } catch (error) {
            logger.error(error, { route: 'GET /admin/users', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to list users' });
        }
    });

    // §54: 特定ユーザーの会議履歴 (最大 100 件)。
    app.get('/admin/users/:id/meetings', requireOwner, async (req, res) => {
        try {
            if (!roomRepo) return res.json({ meetings: [] });
            const rooms = await roomRepo.findRoomsForAccount(req.params.id, { limit: 100 });
            const meetings = rooms.map((r) => {
                let duration_minutes = null;
                if (r.ended_at && r.created_at) {
                    const ms = new Date(r.ended_at) - new Date(r.created_at);
                    duration_minutes = ms > 0 ? Math.round(ms / 60000) : 0;
                }
                return {
                    id: r.id,
                    title: r.title || '',
                    status: r.status,
                    created_at: r.created_at || null,
                    ended_at: r.ended_at || null,
                    duration_minutes,
                    has_minutes: !!(r.minutes_text && r.minutes_text.trim()),
                    has_summary: !!(r.summary_text && r.summary_text.trim()),
                    has_todo: !!(r.todo_text && r.todo_text.trim())
                };
            });
            res.json({ meetings });
        } catch (error) {
            logger.error(error, { route: '/admin/users/:id/meetings', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to list meetings' });
        }
    });

    // §54: 全体サマリ統計。
    app.get('/admin/stats', requireOwner, async (req, res) => {
        try {
            const now = new Date();
            // 直近 7 日
            const date7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            // 直近 30 日
            const date30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            // 今週月曜 00:00
            const dayOfWeek = now.getDay(); // 0=Sun
            const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const monday = new Date(now);
            monday.setHours(0, 0, 0, 0);
            monday.setDate(monday.getDate() - daysToMonday);
            // 今月 1 日 00:00
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            const [
                totalUsers, approvedUsers, pendingUsers, rejectedUsers,
                active7d, active30d,
                totalRooms, thisWeekRooms, thisMonthRooms, ongoingRooms
            ] = await Promise.all([
                accountRepo ? accountRepo.findAll().then((a) => a.length) : 0,
                accountRepo && accountRepo.countByStatus ? accountRepo.countByStatus('approved') : 0,
                accountRepo ? accountRepo.countPending() : 0,
                accountRepo && accountRepo.countByStatus ? accountRepo.countByStatus('rejected') : 0,
                accountRepo && accountRepo.countActiveSince ? accountRepo.countActiveSince(date7d) : 0,
                accountRepo && accountRepo.countActiveSince ? accountRepo.countActiveSince(date30d) : 0,
                roomRepo && roomRepo.countAll ? roomRepo.countAll() : 0,
                roomRepo && roomRepo.countCreatedSince ? roomRepo.countCreatedSince(monday) : 0,
                roomRepo && roomRepo.countCreatedSince ? roomRepo.countCreatedSince(firstOfMonth) : 0,
                roomRepo && roomRepo.countOngoing ? roomRepo.countOngoing() : 0
            ]);

            res.json({
                users: {
                    total: totalUsers,
                    approved: approvedUsers,
                    pending: pendingUsers,
                    rejected: rejectedUsers,
                    active_7d: active7d,
                    active_30d: active30d
                },
                rooms: {
                    total: totalRooms,
                    this_week: thisWeekRooms,
                    this_month: thisMonthRooms,
                    ongoing: ongoingRooms
                }
            });
        } catch (error) {
            logger.error(error, { route: '/admin/stats', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    // 承認 / 拒否 / 保留戻し。レコードは削除しない (拒否でも保持)。
    app.post('/admin/users/:id/approve', requireOwner, async (req, res) => {
        try {
            if (!accountRepo) return res.status(503).json({ error: 'Accounts unavailable' });
            const result = await accountRepo.setStatus(req.params.id, 'approved');
            if (!result.changes) return res.status(404).json({ error: 'user not found' });
            res.json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/admin/users/:id/approve', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to approve user' });
        }
    });

    app.post('/admin/users/:id/reject', requireOwner, async (req, res) => {
        try {
            if (!accountRepo) return res.status(503).json({ error: 'Accounts unavailable' });
            // owner 自身の reject は禁止 (admin がロックアウトされるため)
            const target = await accountRepo.findById(req.params.id);
            const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
            if (target && ownerEmail && target.email.toLowerCase() === ownerEmail) {
                return res.status(400).json({ error: 'cannot reject the owner account' });
            }
            const result = await accountRepo.setStatus(req.params.id, 'rejected');
            if (!result.changes) return res.status(404).json({ error: 'user not found' });
            res.json({ ok: true });
        } catch (error) {
            logger.error(error, { route: '/admin/users/:id/reject', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to reject user' });
        }
    });

    app.get('/me/profile', requireSession, async (req, res) => {
        try {
            const user = userRepo ? await userRepo.findById(req.account.id) : null;
            res.status(200).json({
                account: serializeAccount(req.account),
                profile_text: user?.profile_text || ''
            });
        } catch (error) {
            logger.error(error, { route: 'GET /me/profile', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to load profile' });
        }
    });

    app.patch('/me/profile', requireSession, async (req, res) => {
        try {
            const displayName = sanitizeDisplayName(req.body?.display_name || req.account.display_name || '');
            const profileText = sanitizeProfileText(req.body?.profile_text || '');

            if (accountRepo) {
                await accountRepo.updateDisplayName(req.account.id, displayName);
            }
            if (userRepo) {
                await userRepo.upsert({
                    id: req.account.id,
                    name: displayName || req.account.email.split('@')[0] || 'User',
                    profile_text: profileText
                });
            }

            const updatedAccount = accountRepo ? await accountRepo.findById(req.account.id) : req.account;
            res.status(200).json({
                account: serializeAccount(updatedAccount),
                profile_text: profileText
            });
        } catch (error) {
            logger.error(error, { route: 'PATCH /me/profile', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to update profile' });
        }
    });

    // --- Easter egg: high score (本仕様に影響しない隠し機能) -----------------
    app.post('/me/easter-score', requireSession, async (req, res) => {
        try {
            const accountId = req.account?.id;
            const score = Math.max(0, Math.min(99999, Math.floor(Number(req.body?.score) || 0)));
            if (!accountRepo || typeof accountRepo.updateGameHighScore !== 'function') {
                return res.status(200).json({ is_new_high_score: false, high_score: 0, previous: 0 });
            }
            const result = await accountRepo.updateGameHighScore(accountId, score);
            res.status(200).json(result);
        } catch (error) {
            logger.error(error, { route: 'POST /me/easter-score', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to save score' });
        }
    });

    app.get('/me/easter-score', requireSession, async (req, res) => {
        try {
            const accountId = req.account?.id;
            if (!accountRepo || typeof accountRepo.getGameHighScore !== 'function') {
                return res.status(200).json({ high_score: 0 });
            }
            const high = await accountRepo.getGameHighScore(accountId);
            res.status(200).json({ high_score: high });
        } catch (error) {
            logger.error(error, { route: 'GET /me/easter-score', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to load score' });
        }
    });

    // --- Password change -------------------------------------------------
    app.post('/me/password', requireSession, async (req, res) => {
        try {
            const { current_password, new_password } = req.body || {};
            if (!current_password || !new_password) {
                return res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
            }
            if (new_password.length < 8) {
                return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
            }
            if (!accountRepo) return res.status(503).json({ error: 'Unavailable' });
            const account = await accountRepo.findById(req.account.id);
            if (!account) return res.status(404).json({ error: 'Account not found' });
            const ok = await verifyPassword(current_password, account.password_hash);
            if (!ok) return res.status(400).json({ error: '現在のパスワードが正しくありません' });
            const newHash = await hashPassword(new_password);
            await accountRepo.updatePasswordHash(req.account.id, newHash);
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error(error, { route: 'POST /me/password', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to change password' });
        }
    });

    // --- Data export (ZIP) -----------------------------------------------
    app.get('/me/export', requireSession, async (req, res) => {
        try {
            const { exportAccountToZip } = require('./lib/account-export');
            const zipBuf = await exportAccountToZip(
                { accountRepo, userRepo, roomRepo, utteranceRepo, participantRepo },
                req.account.id
            );
            const filename = `gijiro-export-${req.account.id}-${Date.now()}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', zipBuf.length);
            res.status(200).end(zipBuf);
        } catch (error) {
            logger.error(error, { route: 'GET /me/export', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to generate export' });
        }
    });

    // --- Account deletion (cascade) --------------------------------------
    app.post('/me/delete', requireSession, async (req, res) => {
        try {
            const { password } = req.body || {};
            if (!password) {
                return res.status(400).json({ error: 'パスワードを入力してください' });
            }
            if (!accountRepo) return res.status(503).json({ error: 'Unavailable' });

            const account = await accountRepo.findById(req.account.id);
            if (!account) return res.status(404).json({ error: 'Account not found' });

            const ok = await verifyPassword(password, account.password_hash);
            if (!ok) return res.status(401).json({ error: 'パスワードが正しくありません' });

            const { deleteAccountCascade } = require('./lib/account-delete');
            await deleteAccountCascade(
                { accountRepo, userRepo, roomRepo, sessionRepo },
                req.account.id
            );

            // セッション cookie を消去してクライアントをログアウト
            res.setHeader('Set-Cookie', buildClearCookie({ secure: COOKIE_SECURE }));
            res.status(204).end();
        } catch (error) {
            logger.error(error, { route: 'POST /me/delete', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to delete account' });
        }
    });

    // --- Account history endpoints ---------------------------------------
    /**
     * Backfill: when a user signs up or logs in for the first time on a
     * device, any rooms they previously joined anonymously have a
     * participants.user_account_id of NULL. We use the stable
     * browser-side local_user_id (localStorage) as the bridge: any
     * participant rows whose user_id matches get linked to the new account.
     *
     * Called automatically by the frontend right after login/signup.
     */
    app.post('/me/backfill', requireSession, async (req, res) => {
        try {
            if (!participantRepo || typeof participantRepo.backfillAccountByUserId !== 'function') {
                return res.status(503).json({ error: 'Backfill unavailable' });
            }
            const localUserId = String((req.body && req.body.user_id) || '').trim();
            if (!localUserId) {
                return res.status(400).json({ error: 'user_id required' });
            }
            const linked = await participantRepo.backfillAccountByUserId(localUserId, req.account.id);
            res.status(200).json({ linked });
        } catch (error) {
            logger.error(error, { route: 'POST /me/backfill', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Backfill failed' });
        }
    });

    app.get('/me/rooms', requireSession, async (req, res) => {
        try {
            if (!roomRepo || typeof roomRepo.findRoomsForAccount !== 'function') {
                return res.status(503).json({ error: 'Room history unavailable' });
            }
            const rows = await roomRepo.findRoomsForAccount(req.account.id, { limit: 50 });
            const history = rows.map((room) => ({
                id: room.id,
                title: room.title || '',
                status: room.status,
                created_at: room.created_at,
                ended_at: room.ended_at,
                is_owner: room.owner_account_id === req.account.id,
                summary_excerpt: (room.summary_text || '').slice(0, 280),
                has_minutes: !!(room.minutes_text && room.minutes_text.length),
                has_todo: !!(room.todo_text && room.todo_text.length),
                has_ai_workspace: !!(room.ai_workspace_json && room.ai_workspace_json.length)
            }));
            res.status(200).json({ rooms: history });
        } catch (error) {
            logger.error(error, { route: 'GET /me/rooms', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to load room history' });
        }
    });

    /**
     * Authorize the request account against a room and tell the caller whether
     * it's the host. Returns { room, isOwner } on success or { status, error }
     * on failure so endpoints can branch uniformly.
     */
    async function authorizeRoomForAccount(roomId, accountId) {
        const room = await roomRepo.findById(roomId);
        if (!room) return { status: 404, error: 'Room not found' };
        const isOwner = !!(room.owner_account_id && room.owner_account_id === accountId);
        let authorized = isOwner;
        if (!authorized && participantRepo) {
            const parts = await participantRepo.findByRoomId(room.id);
            authorized = parts.some((p) => p.user_account_id === accountId);
        }
        if (!authorized) return { status: 403, error: 'Not authorized for this room' };
        return { room, isOwner };
    }

    app.get('/me/rooms/:id', requireSession, async (req, res) => {
        try {
            const room = await roomRepo.findById(req.params.id);
            if (!room) return res.status(404).json({ error: 'Room not found' });
            // Authorize: owner or participant.
            let authorized = room.owner_account_id && room.owner_account_id === req.account.id;
            if (!authorized && participantRepo) {
                const parts = await participantRepo.findByRoomId(room.id);
                authorized = parts.some((p) => p.user_account_id === req.account.id);
            }
            if (!authorized) return res.status(403).json({ error: 'Not authorized for this room' });

            // ai_workspace_json is stored as a JSON string. Try to parse so
            // the client gets structured data; fall back to the raw string
            // if it's malformed (shouldn't happen but harmless).
            let aiWorkspace = null;
            if (room.ai_workspace_json) {
                try {
                    aiWorkspace = JSON.parse(room.ai_workspace_json);
                } catch (_) {
                    aiWorkspace = { raw: room.ai_workspace_json };
                }
            }

            res.status(200).json({
                id: room.id,
                title: room.title || '',
                title_updated_at: room.title_updated_at,
                status: room.status,
                created_at: room.created_at,
                ended_at: room.ended_at,
                is_owner: room.owner_account_id === req.account.id,
                summary: room.summary_text || '',
                summary_updated_at: room.summary_updated_at,
                minutes: room.minutes_text || '',
                minutes_updated_at: room.minutes_updated_at,
                todo: room.todo_text || '',
                todo_updated_at: room.todo_updated_at,
                ai_workspace: aiWorkspace,
                ai_workspace_updated_at: room.ai_workspace_updated_at
            });
        } catch (error) {
            logger.error(error, { route: 'GET /me/rooms/:id', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to load room' });
        }
    });

    /**
     * Remove a room from the user's profile history.
     *  - Host: deletes the room and every dependent record (utterances,
     *    participants, analyses, actions). The room is gone for everyone.
     *  - Non-host participant: only their participant link is detached, so
     *    the meeting stays intact for the host & other guests but disappears
     *    from this user's /me/rooms list.
     */
    app.delete('/me/rooms/:id', requireSession, async (req, res) => {
        try {
            const auth = await authorizeRoomForAccount(req.params.id, req.account.id);
            if (auth.error) return res.status(auth.status).json({ error: auth.error });
            if (auth.isOwner) {
                await roomRepo.deleteCascade(auth.room.id);
                return res.status(200).json({ deleted: true, scope: 'room' });
            }
            if (!participantRepo || typeof participantRepo.unlinkAccountFromRoom !== 'function') {
                return res.status(503).json({ error: 'Unlink unavailable' });
            }
            const unlinked = await participantRepo.unlinkAccountFromRoom(auth.room.id, req.account.id);
            res.status(200).json({ deleted: true, scope: 'participant', unlinked });
        } catch (error) {
            logger.error(error, { route: 'DELETE /me/rooms/:id', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to delete room' });
        }
    });

    /**
     * Edit metadata of a room from the profile screen. Host-only since these
     * are shared fields. Currently supports title, summary, minutes, todo —
     * mirrors the fields exposed by GET /me/rooms/:id.
     */
    app.patch('/me/rooms/:id', requireSession, async (req, res) => {
        try {
            const auth = await authorizeRoomForAccount(req.params.id, req.account.id);
            if (auth.error) return res.status(auth.status).json({ error: auth.error });
            if (!auth.isOwner) return res.status(403).json({ error: 'Only the host can edit this room' });

            const updates = {};
            const body = req.body || {};
            if (typeof body.title === 'string') {
                updates.title = body.title.trim().slice(0, 200);
            }
            if (typeof body.summary === 'string') {
                updates.summary_text = body.summary.slice(0, 64 * 1024);
            }
            if (typeof body.minutes === 'string') {
                updates.minutes_text = body.minutes.slice(0, 64 * 1024);
            }
            if (typeof body.todo === 'string') {
                updates.todo_text = body.todo.slice(0, 64 * 1024);
            }
            if (!Object.keys(updates).length) {
                return res.status(400).json({ error: 'No editable fields supplied' });
            }
            const updated = await roomRepo.updateInsights(auth.room.id, updates);
            res.status(200).json({
                id: updated.id,
                title: updated.title || '',
                summary: updated.summary_text || '',
                minutes: updated.minutes_text || '',
                todo: updated.todo_text || ''
            });
        } catch (error) {
            logger.error(error, { route: 'PATCH /me/rooms/:id', requestId: req.requestId, accountId: req.account?.id });
            res.status(500).json({ error: 'Failed to update room' });
        }
    });

    // Room creation is host-only and requires a logged-in account. owner_id is
    // derived from req.account.id (ignoring any body field) so a host can't
    // impersonate another user's identity at room-creation time.
    app.post('/rooms', requireSession, async (req, res) => {
        try {
            const ownerId = req.account.id;

            let roomId = '';
            do {
                roomId = generateShortRoomId();
            } while (await roomRepo.findById(roomId));

            // F4: ホストの現在の STT 設定をルームに保存し全参加者へ伝播する。
            const roomSttProvider = process.env.STT_PROVIDER || 'google';
            const roomSttLanguage = process.env.STT_LANGUAGE || 'ja';
            await roomRepo.create({
                id: roomId,
                owner_id: ownerId,
                owner_account_id: req.account.id,
                use_past_meetings: true,
                stt_provider: roomSttProvider,
                stt_language: roomSttLanguage
            });

            // Keep the legacy `users` row in sync so existing enrichment code
            // (user_contexts, profile_text) resolves the host cleanly.
            if (userRepo) {
                const displayName = req.account.display_name || req.account.email.split('@')[0] || 'Host';
                await userRepo.upsert({ id: ownerId, name: displayName, profile_text: '' });
            }

            res.status(201).json({ id: roomId });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to create room' });
        }
    });

    // Participants can join anonymously OR while logged in. If logged in we
    // attach user_account_id so the meeting lands in their history, but we
    // still accept a guest display_name — logging in is *optional* for
    // participants and never required to join a shared room.
    app.post('/rooms/:id/join', attachSessionIfPresent, async (req, res) => {
        try {
            const { id: roomId } = req.params;
            const { user_id, display_name, location_id = 'web-browser', profile_text = '', ai_config } = req.body || {};

            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            // Logged-in participants: their account.id is authoritative.
            // Anonymous participants: user_id comes from the body (client-
            // generated local id) and display_name is required.
            const accountId = req.account ? req.account.id : null;
            const normalizedUserId = accountId || String(user_id || '').trim().slice(0, 128);
            const rawDisplayName = display_name || (req.account?.display_name) || '';
            const normalizedDisplayName = sanitizeDisplayName(rawDisplayName);
            const normalizedProfileText = sanitizeProfileText(profile_text);
            if (!normalizedUserId || !normalizedDisplayName) {
                return res.status(400).json({ error: 'display_name is required' });
            }

            if (userRepo) {
                const existingUser = await userRepo.findById(normalizedUserId);
                await userRepo.upsert({
                    id: normalizedUserId,
                    name: normalizedDisplayName,
                    profile_text: normalizedProfileText || existingUser?.profile_text || ''
                });
            }

            const participantId = newId('p');
            const controlToken = newToken();

            await participantRepo.join({
                id: participantId,
                room_id: roomId,
                user_id: normalizedUserId,
                display_name: normalizedDisplayName,
                control_token: controlToken,
                location_id,
                user_account_id: accountId
            });

            // findInRoom は direct doc get なので collectionGroup インデックス不要
            const joinedParticipant = await (participantRepo.findInRoom
                ? participantRepo.findInRoom(participantId, roomId)
                : participantRepo.findById(participantId));
            // is_host: trust the account link when present (strongest signal),
            // fall back to the legacy owner_id match for anonymous hosts.
            const isHost = (!!accountId && room.owner_account_id === accountId)
                || normalizedUserId === room.owner_id;

            if (isHost && ai_config) {
                await roomRepo.updateAiConfig(
                    roomId,
                    ai_config.provider,
                    ai_config.model,
                    typeof ai_config.use_past_meetings === 'boolean' ? ai_config.use_past_meetings : null
                );
            }

            res.status(201).json({
                ...joinedParticipant,
                control_token: controlToken,
                is_host: isHost
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/join', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to join room' });
        }
    });

    app.get('/rooms/:id/logs', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            res.status(200).json(logs);
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/logs', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });

    app.get('/rooms/:id/memory', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const logs = await utteranceRepo.findStarredByRoomId(roomId);
            res.status(200).json(logs);
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/memory', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to fetch starred logs' });
        }
    });

    app.get('/rooms/:id/insights', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            res.status(200).json(await buildInsightsResponse(roomId));
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/insights', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to fetch insights' });
        }
    });

    app.get('/rooms/:id/user-contexts', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const contexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
            const contextMap = new Map(contexts.map((context) => [context.user_id, context]));

            res.status(200).json(participants.map((participant) => ({
                user_id: participant.user_id,
                name: participant.display_name,
                profile_text: participant.profile_text || '',
                context: contextMap.get(participant.user_id) || null
            })));
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/user-contexts', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to fetch user contexts' });
        }
    });

    app.patch('/users/:id/context', async (req, res) => {
        try {
            const { id: userId } = req.params;
            if (!userContextRepo) {
                return res.status(503).json({ error: 'User context repository is unavailable' });
            }

            const updated = await userContextRepo.upsert({
                user_id: userId,
                project_summary: req.body.project_summary || '',
                current_status: req.body.current_status || '',
                active_tasks: Array.isArray(req.body.active_tasks) ? req.body.active_tasks : [],
                last_updated: new Date().toISOString()
            });

            res.status(200).json(updated);
        } catch (error) {
            logger.error(error, { route: 'PATCH /users/:id/context', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to update user context' });
        }
    });

    app.get('/rooms/:id/custom-output', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const latest = analysisRepo
                ? await analysisRepo.findLatestByTypes(roomId, ['custom_saved'])
                : null;

            if (!latest) {
                return res.status(200).json({
                    instruction: '',
                    result: '',
                    saved_at: null
                });
            }

            let payload = {};
            try {
                payload = JSON.parse(latest.result_text || '{}');
            } catch (error) {
                payload = { result: latest.result_text || '' };
            }

            res.status(200).json({
                mode: payload.mode || '',
                title: payload.title || '',
                instruction: payload.instruction || '',
                result: payload.result || '',
                saved_at: latest.created_at || null
            });
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/custom-output', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to fetch custom output' });
        }
    });

    app.post('/rooms/:id/custom-output', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const { mode = '', title = '', instruction = '', result = '' } = req.body || {};

            if (!analysisRepo) {
                return res.status(503).json({ error: 'Analysis repository is unavailable' });
            }

            await analysisRepo.add({
                id: newId('a-custom-saved'),
                room_id: roomId,
                type: 'custom_saved',
                input_prompt: sanitizeInstruction(instruction),
                result_text: JSON.stringify({
                    mode,
                    title,
                    instruction,
                    result
                })
            });

            res.status(200).json({
                mode,
                title,
                instruction,
                result,
                saved_at: new Date().toISOString()
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/custom-output', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to save custom output' });
        }
    });

    app.post('/rooms/:id/insights/regenerate', aiLimiter, requireHost, async (req, res) => {
        try {
            const roomId = req.roomId;
            // req.room is set by requireHost
            const ownerAccountId = req.room?.owner_account_id;

            // Validate and sanitize past_room_ids (max 10, must belong to the room owner's account)
            let pastRoomIds;
            if (ownerAccountId && Array.isArray(req.body?.past_room_ids)) {
                const rawIds = req.body.past_room_ids.slice(0, 10);
                const verified = [];
                for (const rid of rawIds) {
                    if (typeof rid !== 'string') continue;
                    try {
                        const r = await roomRepo.findById(rid);
                        if (r && r.owner_account_id === ownerAccountId) verified.push(rid);
                    } catch (_) {}
                }
                pastRoomIds = verified;
            }

            await roomRepo.updateInsights(roomId, {
                insights_status: 'processing'
            });

            generateInsightsForRoom(roomId, req.body?.ai_config || null, { pastRoomIds })
                .catch((generationError) => logger.error(generationError, { route: '/rooms/:id/insights/regenerate', roomId }));

            res.status(202).json({
                status: 'processing'
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/insights/regenerate', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to start insight regeneration' });
        }
    });

    app.patch('/rooms/:roomId/logs/:utteranceId', requireParticipant, async (req, res) => {
        try {
            const { roomId, utteranceId } = req.params;
            const existing = utteranceRepo.findInRoom
                ? await utteranceRepo.findInRoom(utteranceId, roomId)
                : await utteranceRepo.findById(utteranceId);

            if (!existing || existing.room_id !== roomId) {
                return res.status(404).json({ error: 'Log not found' });
            }

            const sanitizedTranscript = typeof req.body.transcript === 'string'
                ? sanitizeTranscript(req.body.transcript)
                : undefined;
            const sanitizedMemo = typeof req.body.memo_text === 'string'
                ? sanitizeMemoText(req.body.memo_text)
                : undefined;
            const sanitizedNote = typeof req.body.memory_note === 'string'
                ? sanitizeMemoText(req.body.memory_note)
                : undefined;

            const updated = await utteranceRepo.updateMemory(utteranceId, {
                is_starred: req.body.is_starred,
                memory_note: sanitizedNote,
                memo_text: sanitizedMemo,
                transcript: sanitizedTranscript,
                transcript_source: req.body.transcript_source
            }, roomId);

            if (typeof req.body.transcript === 'string' && roomRepo) {
                await roomRepo.updateInsights(roomId, { insights_dirty: true });
            }

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const enriched = logs.find((log) => log.id === utteranceId) || updated;

            res.status(200).json(enriched);
        } catch (error) {
            logger.error(error, { route: 'PATCH /rooms/:roomId/logs/:utteranceId', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to update log memory' });
        }
    });

    app.post('/rooms/:roomId/logs/:utteranceId/correct', aiLimiter, requireParticipant, async (req, res) => {
        try {
            const { roomId, utteranceId } = req.params;
            const existing = utteranceRepo.findInRoom
                ? await utteranceRepo.findInRoom(utteranceId, roomId)
                : await utteranceRepo.findById(utteranceId);

            if (!existing || existing.room_id !== roomId) {
                return res.status(404).json({ error: 'Log not found' });
            }

            if (!aiService || !aiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            const roomLogs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const currentIndex = roomLogs.findIndex((log) => log.id === utteranceId);
            const contextLogs = roomLogs.filter((_, index) => Math.abs(index - currentIndex) <= 2);
            const target = roomLogs[currentIndex];

            const room = await roomRepo.findById(roomId);
            const provider = room?.ai_provider || 'gemini';
            const aiConfig = {
                provider,
                model: room?.ai_model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
            };

            const correction = await aiService.correctTranscript(target, contextLogs, aiConfig);
            const updated = await utteranceRepo.updateMemory(utteranceId, {
                transcript: correction.corrected,
                transcript_source: 'ai'
            }, roomId);

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const enriched = logs.find((log) => log.id === utteranceId) || updated;

            res.status(200).json({ ...enriched, correction_provider: correction.provider });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:roomId/logs/:utteranceId/correct', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to correct transcript' });
        }
    });

    app.post('/rooms/:roomId/correct', aiLimiter, requireHost, async (req, res) => {
        try {
            const { roomId } = req.params;
            const roomLogs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            const { ai_config } = req.body || {};

            let activeAiService = aiService;
            if (ai_config && ai_config.provider) {
                const { AIService: AIServiceClass } = require('./services/ai-service');
                activeAiService = new AIServiceClass({
                    provider: ai_config.provider,
                    geminiModel: ai_config.provider === 'gemini' ? ai_config.model : null,
                    groqModel: ai_config.provider === 'groq' ? ai_config.model : null,
                    ollamaModel: ai_config.provider === 'ollama' ? ai_config.model : null,
                    apiKey: process.env.GEMINI_API_KEY,
                    groqApiKey: process.env.GROQ_API_KEY
                });
            }

            if (!activeAiService || !activeAiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            const targets = roomLogs.filter((log) => log.transcript_source !== 'user');
            const updatedLogs = [];

            const room = await roomRepo.findById(roomId);
            const provider = room?.ai_provider || 'gemini';
            const aiConfig = {
                provider,
                model: room?.ai_model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
            };

            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                const currentIndex = roomLogs.findIndex((log) => log.id === target.id);
                const contextLogs = roomLogs.filter((_, ctxIndex) => Math.abs(ctxIndex - currentIndex) <= 2);
                const correction = await aiService.correctTranscript(target, contextLogs, aiConfig);
                const updated = await utteranceRepo.updateMemory(target.id, {
                    transcript: correction.corrected,
                    transcript_source: 'ai'
                });
                updatedLogs.push(updated);
            }

            const logs = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            res.status(200).json({
                updated_count: updatedLogs.length,
                logs
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:roomId/logs/correct-bulk', requestId: req.requestId });
            res.status(500).json({ error: 'Failed to correct transcripts' });
        }
    });

    app.post('/rooms/:id/custom-ai', aiLimiter, requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const { instruction = '', use_past_context: usePastContext, past_room_ids: rawPastRoomIds } = req.body || {};

            if (!roomRepo || !aiService || !aiService.enabled) {
                return res.status(503).json({ error: 'AI generation is unavailable' });
            }

            const room = await roomRepo.findById(roomId);
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            const minutesText = String(room.minutes_text || '').trim();
            if (!minutesText) {
                return res.status(409).json({ error: 'Minutes must be generated first' });
            }

            const aiConfig = {
                provider: room.ai_provider || 'gemini',
                model: room.ai_model || 'gemini-2.5-flash'
            };

            // Per-call override: if use_past_context === false, skip the
            // past block for this analysis only (room-level setting unchanged).
            const overrideOff = usePastContext === false;
            // Host-linked past-meeting context (no-op for anonymous rooms).
            if (!overrideOff && room.owner_account_id && room.use_past_meetings !== 0) {
                // Validate and sanitize past_room_ids (max 10, must belong to the room owner's account)
                let verifiedPastRoomIds;
                if (Array.isArray(rawPastRoomIds)) {
                    const rawIds = rawPastRoomIds.slice(0, 10);
                    const verified = [];
                    for (const rid of rawIds) {
                        if (typeof rid !== 'string') continue;
                        try {
                            const r = await roomRepo.findById(rid);
                            if (r && r.owner_account_id === room.owner_account_id) verified.push(rid);
                        } catch (_) {}
                    }
                    verifiedPastRoomIds = verified;
                }
                try {
                    const pastOpts = { excludeRoomId: roomId };
                    if (Array.isArray(verifiedPastRoomIds)) {
                        pastOpts.roomIds = verifiedPastRoomIds;
                    }
                    const { block } = await buildPastMeetingContext(roomRepo, room.owner_account_id, pastOpts);
                    if (block) aiConfig.pastContextBlock = block;
                } catch (err) {
                    logger.warn('[pastContext] build failed; continuing without it', { error: err.message, roomId });
                }
            }

            const [participants, userContexts] = await Promise.all([
                enrichParticipantsWithProfiles(participantRepo, userRepo, roomId),
                (async () => {
                    const roomParticipants = await participantRepo.findByRoomId(roomId);
                    const userIds = roomParticipants.map((item) => item.user_id).filter(Boolean);
                    return userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
                })()
            ]);

            const safeInstruction = sanitizeInstruction(instruction);
            let customResult;
            if (shouldChunkText(minutesText)) {
                // [L5] 議事録が長い場合は Map-Reduce で各チャンクに適用
                const textChunks = chunkText(minutesText);
                logger.info('[CustomAI] chunking minutes', { chunkCount: textChunks.length, roomId });
                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'custom', completed: 0, total: textChunks.length });

                let completedCustom = 0;
                const customLimit = createSemaphore(2);
                const partialCustom = await Promise.all(
                    textChunks.map(chunk =>
                        customLimit(() =>
                            withTimeoutAndRetry(
                                () => aiService.generateCustomPerChunk(
                                    chunk.text, chunk.index, textChunks.length,
                                    safeInstruction, aiConfig
                                ),
                                {
                                    timeoutMs: 60000,
                                    retries: 3,
                                    placeholder: {
                                        chunkIndex: chunk.index,
                                        result: `[チャンク ${chunk.index + 1}/${textChunks.length} の解析に失敗しました]`,
                                        provider: 'error',
                                    }
                                }
                            ).then(r => {
                                completedCustom++;
                                broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'custom', completed: completedCustom, total: textChunks.length });
                                return r;
                            })
                        )
                    )
                );
                // カスタム結果はチャンク境界を区切って連結する（フォーマットが任意のため LLM マージ不可）
                const mergedText = partialCustom
                    .sort((a, b) => a.chunkIndex - b.chunkIndex)
                    .map(r => r.result)
                    .filter(Boolean)
                    .join('\n\n---\n\n');
                customResult = { result: mergedText, provider: partialCustom[0]?.provider || 'unknown' };
            } else {
                customResult = await aiService.generateCustomFromMinutes(minutesText, safeInstruction, participants, userContexts, aiConfig);
            }
            res.status(200).json({
                result: customResult.result,
                provider: customResult.provider
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/custom-ai', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to generate custom AI result' });
        }
    });

    app.post('/rooms/:id/shared-ai/:type', aiLimiter, requireHost, async (req, res) => {
        try {
            const roomId = req.roomId;
            const { type } = req.params;

            if (!roomRepo || !participantRepo || !utteranceRepo || !aiService) {
                return res.status(503).json({ error: 'AI generation is unavailable' });
            }

            // Per-call override: when the AI 解析 toggle is OFF, force-skip
            // past-meeting context for this analysis only. (true/undefined →
            // honor the room-level setting.)
            const usePastContext = req.body && typeof req.body.use_past_context === 'boolean'
                ? req.body.use_past_context
                : undefined;
            const generated = await generateSharedAiResult(roomId, type, { usePastContext });
            return res.status(200).json(generated);
        } catch (error) {
            if (error.message === 'Minutes must be generated first') {
                return res.status(409).json({ error: error.message });
            }
            if (error.message === 'Unsupported shared AI type') {
                return res.status(400).json({ error: error.message });
            }
            logger.error(error, { route: 'POST /rooms/:id/shared-ai/:type', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to generate shared AI result' });
        }
    });

    // [L9] GET /rooms/:id/chunks — ホストがチャンク一覧を取得する。
    // フロントでの部分再生成 UI 用。
    app.get('/rooms/:id/chunks', requireHost, async (req, res) => {
        if (!chunkRepo) return res.status(503).json({ error: 'Chunk storage unavailable' });
        try {
            const chunks = await chunkRepo.findByRoom(req.roomId, 'minutes');
            res.status(200).json({ chunks });
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/chunks', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to load chunks' });
        }
    });

    // [L9] POST /rooms/:id/regenerate-chunk/:index — 特定チャンクを再生成する (ホスト限定)。
    // DB に保存済みのチャンク結果を 1 件だけ差し替えて議事録全体を再合成する。
    app.post('/rooms/:id/regenerate-chunk/:index', aiLimiter, requireHost, async (req, res) => {
        if (!chunkRepo || !utteranceRepo || !aiService) {
            return res.status(503).json({ error: 'AI generation or chunk storage unavailable' });
        }

        const roomId = req.roomId;
        const chunkIndex = parseInt(req.params.index, 10);
        if (isNaN(chunkIndex) || chunkIndex < 0) {
            return res.status(400).json({ error: 'Invalid chunk index' });
        }

        try {
            const room = await roomRepo.findById(roomId);
            if (!room) return res.status(404).json({ error: 'Room not found' });

            const utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
            if (!shouldChunk(utterances)) {
                return res.status(409).json({ error: 'この会議はチャンク分割されていません' });
            }

            const chunks = chunkUtterances(utterances);
            const targetChunk = chunks[chunkIndex];
            if (!targetChunk) {
                return res.status(404).json({ error: `チャンク ${chunkIndex} が見つかりません (合計 ${chunks.length} チャンク)` });
            }

            const provider = room.ai_provider || 'gemini';
            const minutesAiConfig = {
                provider,
                model: room.ai_model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash')
            };
            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((p) => p.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
            const roomMeta = {
                roomId,
                date: new Date().toLocaleString('ja-JP'),
                title: `ルーム ${roomId}`,
                stt_provider: room.stt_provider || 'google'
            };

            // 対象チャンクを再生成
            broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'minutes', completed: 0, total: 1 });
            const newResult = await withTimeoutAndRetry(
                () => aiService.generateMinutesPerChunk(
                    targetChunk, chunks.length, roomMeta,
                    participants, userContexts, minutesAiConfig
                ),
                { timeoutMs: 60000, retries: 3 }
            );
            broadcastToRoom(roomId, { type: 'chunk_progress', analysis_type: 'minutes', completed: 1, total: 1 });

            // DB のチャンクを更新
            await chunkRepo.upsert({
                room_id: roomId,
                chunk_index: chunkIndex,
                analysis_type: 'minutes',
                start_ts: newResult.startTs || targetChunk.startTs || '',
                end_ts: newResult.endTs || targetChunk.endTs || '',
                result_text: newResult.result || '',
                status: 'done'
            });

            // 全チャンク結果を DB から読み直して再 Merge
            const allChunks = await chunkRepo.findByRoom(roomId, 'minutes');
            // DB 行を ai-service が期待する shape に変換
            const mergeInput = allChunks.map((row) => ({
                chunkIndex: row.chunk_index,
                startTs: row.start_ts,
                endTs: row.end_ts,
                result: row.result_text,
                provider: 'regenerated'
            }));
            const mergedMinutes = aiService.mergeMinutesChunks(mergeInput, roomMeta);

            const updatedRoom = await roomRepo.updateInsights(roomId, { minutes_text: mergedMinutes });

            return res.status(200).json({
                chunk_index: chunkIndex,
                result: mergedMinutes,
                updated_at: updatedRoom?.minutes_updated_at || null
            });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/regenerate-chunk/:index', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: `チャンク再生成に失敗しました: ${error.message}` });
        }
    });

    // POST /rooms/:id/ai-workspace — any participant can persist their
    // last AI workspace output (custom analysis, action extraction,
    // free-form result) so it survives reload and shows up in
    // /me/rooms/:id history. Stored as a JSON string in rooms.ai_workspace_json.
    app.post('/rooms/:id/ai-workspace', requireParticipant, async (req, res) => {
        try {
            const payload = (req.body && typeof req.body.payload === 'object' && req.body.payload) || null;
            if (!payload) return res.status(400).json({ error: 'payload required' });
            // Length cap: ~64 KB serialized so a runaway client can't bloat DB
            let serialized;
            try {
                serialized = JSON.stringify(payload);
            } catch (e) {
                return res.status(400).json({ error: 'payload not serializable' });
            }
            if (serialized.length > 65536) {
                return res.status(413).json({ error: 'payload too large' });
            }
            const updated = await roomRepo.updateInsights(req.roomId, { ai_workspace_json: serialized });
            res.status(200).json({
                id: updated.id,
                ai_workspace_updated_at: updated.ai_workspace_updated_at
            });
        } catch (error) {
            logger.error(error, { route: 'PATCH /rooms/:id/ai-workspace', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to save AI workspace' });
        }
    });

    // PATCH /rooms/:id/title — host updates the meeting title.
    // Title is optional (empty string clears it). Trimmed and length-capped
    // server-side so a misbehaving client can't bloat the DB.
    app.patch('/rooms/:id/title', requireHost, async (req, res) => {
        try {
            const raw = (req.body && typeof req.body.title === 'string') ? req.body.title : '';
            const title = raw.trim().slice(0, 200);
            const updated = await roomRepo.updateInsights(req.roomId, { title });
            res.status(200).json({ id: updated.id, title: updated.title || '', title_updated_at: updated.title_updated_at });
        } catch (error) {
            logger.error(error, { route: 'PATCH /rooms/:id/title', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to update title' });
        }
    });

    // POST /rooms/:id/end - End a room
    app.post('/rooms/:id/end', requireHost, async (req, res) => {
        try {
            const roomId = req.roomId;

            await roomRepo.endRoom(roomId);
            const endedRoom = await roomRepo.findById(roomId);

            const wss = repositories.wss;
            let notifiedCount = 0;
            if (wss && wss.rooms && wss.rooms.has(roomId)) {
                const roomClients = wss.rooms.get(roomId);
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'terminated' }));
                        // WS は意図的に閉じない。summary 画面が chunk_progress を受信できるよう
                        // 接続を維持し、クライアント側でページ離脱時に自然にクローズさせる。
                        notifiedCount++;
                    }
                }
            }
            logger.info('[Room End] Room ended', { roomId, notifiedCount });

            setTimeout(() => {
                triggerAutomaticMeetingOutputs(roomId)
                    .catch((generationError) => logger.error(generationError, { route: 'POST /rooms/:id/end', roomId, tag: 'AutoGeneration' }));
            }, 0);

            res.status(200).json({ ...endedRoom, notified: notifiedCount });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/end', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: 'Failed to end room' });
        }
    });

    // GET /rooms/:id/download - Download meeting minutes
    app.get('/rooms/:id/download', requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const [utterances, room, participants] = await Promise.all([
                utteranceRepo.findByRoomIdWithParticipants(roomId),
                roomRepo.findById(roomId),
                enrichParticipantsWithProfiles(participantRepo, userRepo, roomId)
            ]);

            if (utterances.length === 0) {
                return res.status(404).send('No logs found for this room.');
            }

            let markdown = `# 会議ログ\n\n`;
            markdown += `ルームID: ${roomId}\n`;
            markdown += `出力日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
            markdown += `## 参加者情報\n\n`;
            participants.forEach((participant) => {
                markdown += `### ${participant.display_name}\n`;
                markdown += `- 参加時刻: ${new Date(participant.joined_at).toLocaleString('ja-JP')}\n`;
                markdown += `- 得意なこと・スキル・担当プロジェクト: ${participant.profile_text || '未記入'}\n\n`;
            });
            markdown += `---\n\n`;

            const roomStartTime = utterances.length
                ? new Date(utterances[0].started_at || room?.created_at).getTime()
                : new Date(room?.created_at || Date.now()).getTime();
            const firstUtteranceByParticipant = new Map();
            utterances.forEach((utterance) => {
                if (!firstUtteranceByParticipant.has(utterance.participant_id)) {
                    firstUtteranceByParticipant.set(utterance.participant_id, utterance.id);
                }
            });
            const participantMap = new Map(participants.map((participant) => [participant.id, participant]));

            utterances.forEach((utterance) => {
                const participant = participantMap.get(utterance.participant_id);
                const joinedAt = participant?.joined_at ? new Date(participant.joined_at).getTime() : roomStartTime;
                const joinedMidway = joinedAt - roomStartTime > 30000;
                if (participant && joinedMidway && firstUtteranceByParticipant.get(utterance.participant_id) === utterance.id) {
                    markdown += `> 途中参加プロフィール: ${participant.display_name}\n`;
                    markdown += `> 得意なこと・スキル・担当プロジェクト: ${participant.profile_text || '未記入'}\n\n`;
                }

                const time = new Date(utterance.started_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                const marker = utterance.is_starred ? ' [重要]' : '';
                const noteText = utterance.memo_text || utterance.memory_note || '';
                const note = noteText ? `\nメモ: ${noteText}` : '';
                markdown += `**[${time}] ${utterance.display_name}${marker}**\n${utterance.transcript}${note}\n\n`;
            });

            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="minutes-${roomId}.md"`);
            res.send(markdown);
        } catch (error) {
            logger.error(error, { route: 'GET /rooms/:id/download', requestId: req.requestId, roomId: req.roomId });
            res.status(500).send('Failed to generate transcript');
        }
    });

    // POST /rooms/:id/analyze - AI Analysis (Summary, Agenda, TODO, etc.)
    app.post('/rooms/:id/analyze', aiLimiter, requireParticipant, async (req, res) => {
        try {
            const roomId = req.roomId;
            const { type, instruction, last_timestamp, current_tree, ai_config: reqAiConfig } = req.body;

            const room = await roomRepo.findById(roomId);
            if (!room) return res.status(404).json({ error: 'Room not found' });

            const provider = room.ai_provider || reqAiConfig?.provider || 'gemini';
            const aiConfig = {
                provider,
                model: room.ai_model || reqAiConfig?.model || (provider === 'groq' ? 'openai/gpt-oss-120b' : 'gemini-2.5-flash'),
                stt_provider: room.stt_provider || 'google'
            };

            // Fetch utterances for context (all or only new ones)
            let utterances;
            if (last_timestamp) {
                utterances = await utteranceRepo.findNewerThan(roomId, last_timestamp);
                logger.info('[AI-Incremental] Analyzing NEW utterances', { utteranceCount: utterances.length, roomId, since: last_timestamp });
            } else {
                utterances = await utteranceRepo.findByRoomIdWithParticipants(roomId);
                logger.info('[AI-Full] Analyzing ALL utterances', { utteranceCount: utterances.length, roomId });
            }

            if (utterances.length === 0) {
                return res.status(200).json({ result: current_tree || '', provider: 'none', message: 'No new utterances.' });
            }

            // Decide which AI service/config to use
            let activeAiService = aiService;
            if (reqAiConfig && reqAiConfig.provider) {
                const { AIService: AIServiceClass } = require('./services/ai-service');
                // Create a temporary service instance with the requested config
                activeAiService = new AIServiceClass({
                    provider: reqAiConfig.provider,
                    geminiModel: reqAiConfig.provider === 'gemini' ? reqAiConfig.model : null,
                    groqModel: reqAiConfig.provider === 'groq' ? reqAiConfig.model : null,
                    ollamaModel: reqAiConfig.provider === 'ollama' ? reqAiConfig.model : null,
                    apiKey: process.env.GEMINI_API_KEY,
                    groqApiKey: process.env.GROQ_API_KEY
                });
            }

            if (!activeAiService || !activeAiService.enabled) {
                return res.status(503).json({ error: 'AI Service is not configured or disabled.' });
            }

            // Pass current_tree to aiService as instruction if provided
            const combinedInstruction = current_tree
                ? `現在のトピックツリーは次のとおりです。\n${current_tree}\n\nこのツリーに、今回の新しい発言内容を反映して更新してください。\n${instruction}`
                : instruction;

            const participants = await enrichParticipantsWithProfiles(participantRepo, userRepo, roomId);
            const userIds = participants.map((participant) => participant.user_id).filter(Boolean);
            const userContexts = userContextRepo ? await userContextRepo.findByUserIds(userIds) : [];
            const { result, prompt, provider: resultProvider } = await activeAiService.analyzeMeeting(utterances, type, combinedInstruction, participants, userContexts, aiConfig);
            const latestTimestamp = utterances[utterances.length - 1].started_at;

            // Save analysis result
            const analysis = {
                id: newId('a'),
                room_id: roomId,
                type: type,
                input_prompt: prompt,
                result_text: result
            };
            if (analysisRepo) {
                await analysisRepo.add(analysis);
            }

            res.status(200).json({ result, provider: resultProvider, latest_timestamp: latestTimestamp });
        } catch (error) {
            logger.error(error, { route: 'POST /rooms/:id/analyze', requestId: req.requestId, roomId: req.roomId });
            res.status(500).json({ error: error.message || 'Failed to perform AI analysis' });
        }
    });

    return app;
}

function setupWebSocket(server, repositories = {}, options = {}) {
    const { participantRepo, utteranceRepo, roomRepo, audioProcessor, sttService, userRepo, dictionaryRepo } = repositories;
    const { allowedOrigins = [], expectedHost = '' } = options;
    // Use noServer so we can run credential + Origin checks before the HTTP
    // upgrade hands off to the protocol. A rejected socket never enters
    // wss.clients and cannot leak audio / transcripts.
    const wss = new WebSocketServer({ noServer: true });
    const mergeWindowMs = 4500;

    wss.rooms = new Map();

    const parseUpgradeUrl = (req) => {
        try {
            return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        } catch (_err) {
            return null;
        }
    };

    const rejectUpgrade = (socket, code = 401, reason = 'Unauthorized') => {
        try {
            socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
        } catch (_err) { /* socket may already be dead */ }
        try { socket.destroy(); } catch (_err) { /* noop */ }
    };

    server.on('upgrade', async (req, socket, head) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (!isAllowedOrigin(origin, { allowlist: allowedOrigins, host: expectedHost || host })) {
            return rejectUpgrade(socket, 403, 'Forbidden');
        }

        const url = parseUpgradeUrl(req);
        if (!url) return rejectUpgrade(socket, 400, 'Bad Request');

        const participantId = url.searchParams.get('participantId');
        const controlToken = url.searchParams.get('controlToken') || url.searchParams.get('control_token');
        const wsRoomId = url.searchParams.get('roomId') || '';
        if (!participantId || !controlToken) {
            return rejectUpgrade(socket, 401, 'Unauthorized');
        }

        let participant = null;
        try {
            // roomId があれば direct doc get（collectionGroup インデックス不要）
            if (wsRoomId && typeof participantRepo?.findInRoom === 'function') {
                participant = await participantRepo.findInRoom(participantId, wsRoomId);
            } else if (typeof participantRepo?.findByIdAndToken === 'function') {
                participant = await participantRepo.findByIdAndToken(participantId, controlToken);
            } else {
                participant = await participantRepo?.findById(participantId);
            }
        } catch (_err) {
            return rejectUpgrade(socket, 500, 'Internal Server Error');
        }

        if (!participant) return rejectUpgrade(socket, 403, 'Forbidden');
        if (participant.control_token && participant.control_token !== controlToken) {
            return rejectUpgrade(socket, 403, 'Forbidden');
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            ws._preVerifiedParticipant = participant;
            ws._preVerifiedParticipantId = participantId;
            // upgrade 時点で wss.rooms に即登録することで、
            // hello メッセージ待ち中に terminated が来てもゲストへ届くようにする
            const earlyRoomId = participant.room_id || wsRoomId;
            if (earlyRoomId) {
                if (!wss.rooms.has(earlyRoomId)) wss.rooms.set(earlyRoomId, new Set());
                wss.rooms.get(earlyRoomId).add(ws);
            }
            wss.emit('connection', ws, req);
        });
    });

    // Heartbeat to prevent timeouts
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
    if (typeof interval.unref === 'function') {
        interval.unref();
    }

    server.on('close', () => {
        clearInterval(interval);
        wss.clients.forEach((client) => client.terminate());
        wss.close();
    });

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        const participantId = ws._preVerifiedParticipantId;
        ws.participantId = participantId;
        let sttStream = null;

        // Fix B-3: STT 再起動クールダウン（無限ループ防止）
        let sttRestartAttempts = 0;
        let sttRestartLastFail = 0;

        if (!participantId || !ws._preVerifiedParticipant) {
            // Should never happen — upgrade handler above guarantees this — but
            // be defensive so we never accept an un-authed connection.
            ws.terminate();
            return;
        }

        const ensureValidated = async () => {
            if (ws.validated) return;
            if (ws.validationPromise) {
                await ws.validationPromise;
                return;
            }

            ws.validationPromise = (async () => {
                ws.validating = true;
                // Credentials were already verified in the upgrade handler.
                const participant = ws._preVerifiedParticipant;

                ws.participant = participant;
                ws.roomId = participant.room_id;
                ws.validated = true;
                ws.validating = false;

                const [roomParticipants, dictionaryTerms] = await Promise.all([
                    enrichParticipantsWithProfiles(participantRepo, userRepo, ws.roomId),
                    dictionaryRepo ? dictionaryRepo.findAll() : []
                ]);
                ws.speechHints = collectSpeechHints(roomParticipants, dictionaryTerms);
                if (ws.speechHints.length > 0) {
                    logger.info('[WS] Collected speech hints', { hintCount: ws.speechHints.length, participantId, preview: ws.speechHints.slice(0, 5).join(', ') });
                }

                if (!wss.rooms.has(ws.roomId)) {
                    wss.rooms.set(ws.roomId, new Set());
                }
                wss.rooms.get(ws.roomId).add(ws);
            })();

            try {
                await ws.validationPromise;
            } finally {
                ws.validationPromise = null;
            }
        };
        ws.ensureValidated = ensureValidated;

        const sendReady = async (lastSeenUtteranceId) => {
            if (ws.readySent || ws.readyState !== WebSocket.OPEN) return;

            const [allHistory, room] = await Promise.all([
                utteranceRepo ? utteranceRepo.findByRoomIdWithParticipants(ws.roomId) : [],
                roomRepo ? roomRepo.findById(ws.roomId) : null
            ]);

            // [U-3] 差分復元: last_seen_utterance_id が来た場合はその ID 以降だけを返す
            let history = allHistory;
            if (lastSeenUtteranceId) {
                const idx = allHistory.findIndex((u) => u.id === lastSeenUtteranceId);
                if (idx >= 0) {
                    history = allHistory.slice(idx + 1);
                }
                // 見つからなければ全件返す (フォールバック: 再接続でセッション切替など)
            }

            ws.readySent = true;
            ws.send(JSON.stringify({
                type: 'ready',
                // F4: ホストが設定した STT プロバイダーを参加者全員に伝える。
                room_stt_provider: room?.stt_provider || '',
                room_stt_language: room?.stt_language || '',
                history: history.map(h => ({
                    id: h.id,
                    participant_id: h.participant_id,
                    display_name: h.display_name,
                    transcript: h.transcript,
                    timestamp: h.started_at,
                    is_starred: !!h.is_starred,
                    memo_text: h.memo_text || h.memory_note || '',
                    memory_note: h.memory_note || '',
                    starred_at: h.starred_at || null,
                    raw_transcript: h.raw_transcript || h.transcript,
                    transcript_source: h.transcript_source || 'stt',
                    corrected_at: h.corrected_at || null
                }))
            }));
        };

        const broadcastInterim = (text) => {
            const interimMsg = JSON.stringify({
                type: 'transcript_interim',
                participant_id: participantId,
                display_name: ws.participant?.display_name || '',
                text,
                ts: Date.now()
            });
            const roomClients = wss.rooms.get(ws.roomId);
            if (roomClients) {
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(interimMsg);
                    }
                }
            }
        };

        const persistAndBroadcastTranscript = async (transcript) => {
            const nowIso = new Date().toISOString();
            let utterance = {
                id: newId('u'),
                room_id: ws.roomId,
                participant_id: participantId,
                started_at: nowIso,
                ended_at: nowIso,
                transcript: transcript,
                raw_transcript: transcript,
                transcript_source: 'stt'
            };

            if (utteranceRepo) {
                const latest = await utteranceRepo.findLatestByParticipant(ws.roomId, participantId);
                const latestEndedAt = latest ? new Date(latest.ended_at || latest.started_at).getTime() : 0;
                const withinWindow = latest && (Date.now() - latestEndedAt) <= mergeWindowMs;
                const canMerge = withinWindow
                    && latest.transcript_source === 'stt'
                    && !latest.is_starred
                    && !((latest.memo_text || latest.memory_note || '').trim());

                if (canMerge) {
                    utterance = await utteranceRepo.mergeTranscript(latest.id, transcript, nowIso, ws.roomId);
                } else {
                    await utteranceRepo.add(utterance);
                }
            }

            const broadcastMsg = JSON.stringify({
                type: 'transcript',
                id: utterance.id,
                participant_id: participantId,
                display_name: ws.participant.display_name,
                transcript: utterance.transcript,
                timestamp: utterance.started_at,
                is_starred: !!utterance.is_starred,
                memo_text: utterance.memo_text || utterance.memory_note || '',
                memory_note: utterance.memory_note || '',
                starred_at: utterance.starred_at || null,
                raw_transcript: utterance.raw_transcript || utterance.transcript,
                transcript_source: utterance.transcript_source || 'stt',
                corrected_at: utterance.corrected_at || null
            });

            const roomClients = wss.rooms.get(ws.roomId);
            if (roomClients) {
                for (const client of roomClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastMsg);
                    }
                }
            }
        };

        const startSTTStream = () => {
            // セッション専用インスタンスがあればそちらを優先する
            const activeSttService = ws.sessionSttService || sttService;
            if (sttStream || !activeSttService) return;

            // Fix B-3: 過去 60 秒で 5 回以上失敗していたら 30 秒クールダウン
            if (sttRestartAttempts >= 5 && Date.now() - sttRestartLastFail < 60000) {
                if (Date.now() - sttRestartLastFail < 30000) {
                    logger.warn('[STT] restart cooldown active', { attempts: sttRestartAttempts, participantId });
                    return;
                }
                // クールダウン明け: カウンターリセット
                sttRestartAttempts = 0;
            }

            logger.info('[STT] Starting new stream', { participantId, provider: activeSttService.provider, hintCount: ws.speechHints?.length || 0 });

            let newStream;
            try {
                newStream = activeSttService.createStream(
                    async (transcript) => {
                        try {
                            await persistAndBroadcastTranscript(transcript);
                        } catch (err) {
                            logger.error(err, { tag: 'STT Callback Error', participantId });
                        }
                    },
                    (err) => {
                        logger.error(err, { tag: 'STT Stream Error', participantId });
                        sttRestartAttempts++;
                        sttRestartLastFail = Date.now();
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: '音声認識ストリームでエラーが発生しました' }));
                        }
                        sttStream = null;
                    },
                    {
                        config: (() => {
                            const cfg = {};
                            if (ws.speechHints && ws.speechHints.length) {
                                cfg.speechContexts = [{ phrases: ws.speechHints, boost: 10 }];
                            }
                            if (ws.sttMeta && (ws.sttMeta.microphoneDistance || ws.sttMeta.recordingDeviceType)) {
                                cfg.metadata = {};
                                if (ws.sttMeta.microphoneDistance) cfg.metadata.microphoneDistance = ws.sttMeta.microphoneDistance;
                                if (ws.sttMeta.recordingDeviceType) cfg.metadata.recordingDeviceType = ws.sttMeta.recordingDeviceType;
                            }
                            return cfg;
                        })()
                    },
                    (partialText) => {
                        try { broadcastInterim(partialText); } catch (_) { /* ignore */ }
                    }
                );
            } catch (err) {
                sttRestartAttempts++;
                sttRestartLastFail = Date.now();
                logger.error(err, { tag: '[STT] startSTTStream failed', attempts: sttRestartAttempts, participantId });
                return;
            }

            sttStream = newStream;

            // Important: Handle graceful closure (e.g. Google's 305s limit)
            sttStream.on('end', () => {
                logger.info('[STT Stream End] Stream closed gracefully by provider', { participantId });
                sttStream = null;
            });
            sttStream.on('close', () => {
                sttStream = null;
                // ElevenLabs: WS が閉じたら即プリウォーム。次の発言開始時に
                // 接続確立の待ち時間がなくなる（session_started を先に取得しておく）。
                const activeSvc = ws.sessionSttService || sttService;
                if (activeSvc?.provider === 'elevenlabs' && ws.validated && ws.readyState === WebSocket.OPEN) {
                    setTimeout(() => {
                        if (!sttStream && ws.readyState === WebSocket.OPEN) {
                            logger.info('[ElevenLabs STT] Pre-warming next connection', { participantId });
                            startSTTStream();
                        }
                    }, 300);
                }
            });
            sttStream.on('error', (err) => {
                sttRestartAttempts++;
                sttRestartLastFail = Date.now();
                logger.error(err, { tag: '[STT] stream error', attempts: sttRestartAttempts, participantId });
                sttStream = null;
            });
            // 最初のデータが来たら成功とみなしカウンターをリセット
            sttStream.once('data', () => { sttRestartAttempts = 0; });
        };

        ensureValidated().catch((error) => {
            logger.error(error, { tag: 'WS Validation error' });
        });

        ws.on('message', async (data, isBinary) => {
            try {
                // Ensure validation and hint collection is complete before processing any data
                await ensureValidated();
                if (!ws.validated) return;

                if (isBinary) {
                    // Start or restart stream if needed
                    if (!sttStream || !sttStream.writable) {
                        startSTTStream();
                    }
                    
                    const activeSttService = ws.sessionSttService || sttService;

                    // ElevenLabs はリアルタイム WebSocket ストリームを使う。
                    // audioProcessor のバッファを経由せず、直接 sttStream に書き込む。
                    // 無音 1.5 秒で自動コミット（Google STT の utterance 区切りに相当）。
                    if (activeSttService?.provider === 'elevenlabs') {
                        if (sttStream && sttStream.writable) {
                            try {
                                sttStream.write(data);
                            } catch (e) {
                                logger.error(e, { tag: 'ElevenLabs STT Write Error', participantId });
                                sttStream = null;
                            }
                        }

                        // 無音タイマーをリセット。2 秒間音声が来なければ commit を送る。
                        if (ws.elevenLabsSilenceTimer) {
                            clearTimeout(ws.elevenLabsSilenceTimer);
                        }
                        ws.elevenLabsSilenceTimer = setTimeout(() => {
                            ws.elevenLabsSilenceTimer = null;
                            if (sttStream && typeof sttStream.commit === 'function') {
                                sttStream.commit();
                            }
                        }, 2000);

                        return;
                    }

                    // Google / Groq: audioProcessor でバッファしてバッチ認識
                    if (audioProcessor && activeSttService && typeof activeSttService.recognize === 'function') {
                        const bufferedAudio = audioProcessor.addChunk(participantId, Buffer.from(data));
                        if (bufferedAudio) {
                            const transcript = await activeSttService.recognize(bufferedAudio, {
                                config: (() => {
                                    const cfg = {};
                                    if (ws.speechHints && ws.speechHints.length) {
                                        cfg.speechContexts = [{ phrases: ws.speechHints, boost: 10 }];
                                    }
                                    if (ws.sttMeta && (ws.sttMeta.microphoneDistance || ws.sttMeta.recordingDeviceType)) {
                                        cfg.metadata = {};
                                        if (ws.sttMeta.microphoneDistance) cfg.metadata.microphoneDistance = ws.sttMeta.microphoneDistance;
                                        if (ws.sttMeta.recordingDeviceType) cfg.metadata.recordingDeviceType = ws.sttMeta.recordingDeviceType;
                                    }
                                    return cfg;
                                })()
                            });
                            if (transcript) {
                                await persistAndBroadcastTranscript(transcript);
                            }
                        }
                        return;
                    }

                    if (sttStream && sttStream.writable) {
                        try {
                            sttStream.write(data);
                        } catch (e) {
                            logger.error(e, { tag: 'STT Write Error', participantId });
                            sttStream = null;
                        }
                    }
                } else {
                    // Handle text messages (JSON)
                    try {
                        const msgStr = data.toString();
                        const msg = JSON.parse(msgStr);

                        // Ignore 'hello' if it was already used for validation
                        // [U-3] last_seen_utterance_id を渡して差分のみ返す
                        if (msg.type === 'hello') {
                            await sendReady(msg.last_seen_utterance_id || null);
                            return;
                        }

                        // Mic preset metadata. The client sends this once on
                        // connection and again whenever the user picks a new
                        // preset. Stored on ws so the next STT stream/recognize
                        // call can build the correct Google config (microphone
                        // distance, recording device type, audio topic).
                        if (msg.type === 'mic_preset') {
                            const meta = (msg.mic && typeof msg.mic === 'object') ? msg.mic : {};
                            ws.sttMeta = {
                                microphoneDistance: ['NEARFIELD', 'MIDFIELD', 'FARFIELD']
                                    .includes(meta.microphoneDistance) ? meta.microphoneDistance : undefined,
                                recordingDeviceType: typeof meta.recordingDeviceType === 'string'
                                    ? meta.recordingDeviceType.slice(0, 64) : undefined
                            };

                            // Session-level STT provider switch.
                            // When the frontend sends stt_provider, create a
                            // session-specific instance if it differs from global.
                            const requestedProvider = typeof msg.stt_provider === 'string'
                                ? msg.stt_provider.toLowerCase() : null;
                            const allowedProviders = ['google', 'elevenlabs', 'groq'];
                            if (requestedProvider && allowedProviders.includes(requestedProvider)) {
                                const currentProvider = (ws.sessionSttService || sttService)?.provider;
                                if (requestedProvider !== currentProvider) {
                                    ws.sessionSttService = new STTService({
                                        provider: requestedProvider,
                                        googleApiKey: process.env.GOOGLE_API_KEY,
                                        groqApiKey: process.env.GROQ_API_KEY,
                                        groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
                                        elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
                                        elevenLabsModel: process.env.ELEVENLABS_STT_MODEL || 'scribe_v2_flash',
                                        language: process.env.STT_LANGUAGE || 'ja'
                                    });
                                    logger.info('[STT] Session provider switched', { provider: requestedProvider, participantId });
                                }
                            }

                            // Restart the streaming recognizer so the new
                            // metadata / provider takes effect on the next utterance.
                            if (ws.elevenLabsSilenceTimer) {
                                clearTimeout(ws.elevenLabsSilenceTimer);
                                ws.elevenLabsSilenceTimer = null;
                            }
                            try { if (sttStream && typeof sttStream.end === 'function') sttStream.end(); } catch (_) { /* ignore */ }
                            sttStream = null;
                            return;
                        }

                        const senderParticipant = ws.participant || await participantRepo.findById(participantId);
                        if (!senderParticipant) return;
                        ws.participant = senderParticipant;
                        ws.roomId = senderParticipant.room_id;

                        for (const client of wss.clients) {
                            if (!client.participant && client.participantId) {
                                client.participant = await participantRepo.findById(client.participantId);
                                client.roomId = client.participant ? client.participant.room_id : null;
                            }
                            if (
                                client !== ws &&
                                client.readyState === WebSocket.OPEN &&
                                client.roomId &&
                                client.roomId === ws.roomId
                            ) {
                                client.send(msgStr);
                            }
                        }
                    } catch (e) {
                        // Not JSON or other error
                    }
                }
            } catch (error) {
                logger.error(error, { tag: 'WS Error handling message' });
            }
        });

        ws.on('close', () => {
            if (ws.elevenLabsSilenceTimer) {
                clearTimeout(ws.elevenLabsSilenceTimer);
                ws.elevenLabsSilenceTimer = null;
            }
            if (sttStream) {
                sttStream.end();
                sttStream = null;
            }
            if (audioProcessor) {
                audioProcessor.clear(participantId);
            }
            if (ws.roomId && wss.rooms.has(ws.roomId)) {
                const roomClients = wss.rooms.get(ws.roomId);
                roomClients.delete(ws);
                if (roomClients.size === 0) {
                    wss.rooms.delete(ws.roomId);
                }
            }
        });
    });
    return wss;
}

module.exports = { createApp, setupWebSocket };
