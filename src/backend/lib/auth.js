/**
 * Authorization middleware.
 *
 * Participant auth (in-room):
 *   - requireParticipant: validates (participant_id, control_token) against the
 *     :id / :roomId route param.
 *   - requireHost: requireParticipant + check that the participant's user_id
 *     matches the room owner.
 *
 * Host-account auth (cross-room):
 *   - requireSession: reads the session_token cookie, loads the session and
 *     attaches req.account. 401 if missing/expired/invalid.
 *   - attachSessionIfPresent: same lookup but non-failing. Used by /rooms/:id/join
 *     so anonymous joins still work while logged-in participants get linked to
 *     their account automatically.
 *
 * Credentials for participant auth may come from either the JSON body or the
 * query string, so both GET and POST/PATCH routes can use the same middleware.
 */
const { parseCookie, SESSION_COOKIE_NAME } = require('./cookies');

function extractCreds(req) {
    const body = req.body || {};
    const query = req.query || {};
    const participantId = String(body.participant_id || query.participant_id || '').trim();
    const controlToken = String(body.control_token || query.control_token || '').trim();
    return { participantId, controlToken };
}

function getRoomIdFromReq(req) {
    return req.params.roomId || req.params.id || '';
}

function extractSessionToken(req) {
    const cookieHeader = req.headers && req.headers.cookie;
    if (!cookieHeader) return '';
    const jar = parseCookie(cookieHeader);
    return jar[SESSION_COOKIE_NAME] || '';
}

function createAuth({ participantRepo, roomRepo, sessionRepo, accountRepo } = {}) {
    async function requireParticipant(req, res, next) {
        if (!participantRepo) {
            return res.status(503).json({ error: 'Participant repository unavailable' });
        }

        const roomId = getRoomIdFromReq(req);
        if (!roomId) {
            return res.status(400).json({ error: 'Room id is required' });
        }

        const { participantId, controlToken } = extractCreds(req);
        if (!participantId || !controlToken) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        let participant = null;
        try {
            participant = typeof participantRepo.findByIdAndToken === 'function'
                ? await participantRepo.findByIdAndToken(participantId, controlToken)
                : await participantRepo.findById(participantId);
        } catch (error) {
            return res.status(500).json({ error: 'Authentication lookup failed' });
        }

        if (!participant || participant.room_id !== roomId) {
            return res.status(403).json({ error: 'Participant validation failed' });
        }

        if (participant.control_token && participant.control_token !== controlToken) {
            return res.status(403).json({ error: 'Participant validation failed' });
        }

        req.participant = participant;
        req.roomId = roomId;
        next();
    }

    async function requireHost(req, res, next) {
        await requireParticipant(req, res, async () => {
            if (!roomRepo) {
                return res.status(503).json({ error: 'Room repository unavailable' });
            }
            let room = null;
            try {
                room = await roomRepo.findById(req.roomId);
            } catch (error) {
                return res.status(500).json({ error: 'Room lookup failed' });
            }
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }
            if (!req.participant.user_id || req.participant.user_id !== room.owner_id) {
                return res.status(403).json({ error: 'Host privileges required' });
            }
            req.room = room;
            next();
        });
    }

    /**
     * Validate a WebSocket upgrade. Returns the participant record on success,
     * null on failure (caller should terminate the socket).
     */
    async function validateWsCredentials(participantId, controlToken) {
        if (!participantRepo || !participantId || !controlToken) return null;
        try {
            const participant = typeof participantRepo.findByIdAndToken === 'function'
                ? await participantRepo.findByIdAndToken(participantId, controlToken)
                : await participantRepo.findById(participantId);
            if (!participant) return null;
            if (participant.control_token && participant.control_token !== controlToken) {
                return null;
            }
            return participant;
        } catch (error) {
            return null;
        }
    }

    async function loadSession(req) {
        if (!sessionRepo || !accountRepo) return null;
        const token = extractSessionToken(req);
        if (!token) return null;
        try {
            const row = await sessionRepo.findByToken(token);
            if (!row) return null;
            const account = await accountRepo.findById(row.account_id);
            if (!account) return null;
            // Slide expiry forward on every use so active users stay logged
            // in. Fire-and-forget: a failed touch shouldn't fail the request.
            sessionRepo.touch(row.id).catch(() => {});
            return { session: row, account, token };
        } catch (_err) {
            return null;
        }
    }

    async function requireSession(req, res, next) {
        if (!sessionRepo || !accountRepo) {
            return res.status(503).json({ error: 'Session repository unavailable' });
        }
        const ctx = await loadSession(req);
        if (!ctx) return res.status(401).json({ error: 'Login required' });
        req.account = ctx.account;
        req.session = ctx.session;
        req.sessionToken = ctx.token;
        next();
    }

    async function attachSessionIfPresent(req, _res, next) {
        const ctx = await loadSession(req);
        if (ctx) {
            req.account = ctx.account;
            req.session = ctx.session;
            req.sessionToken = ctx.token;
        }
        next();
    }

    return {
        requireParticipant,
        requireHost,
        requireSession,
        attachSessionIfPresent,
        validateWsCredentials,
        extractCreds,
        extractSessionToken
    };
}

module.exports = { createAuth, extractSessionToken };
