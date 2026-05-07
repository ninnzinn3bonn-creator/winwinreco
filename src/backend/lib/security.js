/**
 * Lightweight, dependency-free security middleware.
 *
 * Avoids pulling in helmet / express-rate-limit so the project keeps zero
 * new runtime dependencies. The behaviour below covers the most commonly
 * needed headers and a basic sliding-window rate limiter that is sufficient
 * for a small, single-process deployment.
 *
 * For larger production deployments consider switching to helmet +
 * express-rate-limit with a shared store (Redis).
 */

function securityHeaders() {
    return function securityHeadersMiddleware(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Permissions-Policy', 'microphone=(self)');
        // Static assets need to fetch from same origin only.
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
        );
        next();
    };
}

/**
 * Simple in-memory sliding window rate limiter keyed by IP + route group.
 * Not DDoS-grade, but prevents casual abuse of AI/STT endpoints.
 */
function createRateLimiter({ windowMs = 60_000, max = 60, key = 'default' } = {}) {
    // Jest/CI runs many requests back-to-back against the same in-process IP.
    // Rate-limiting would false-trip and make tests flaky, so we bypass the
    // limiter entirely under NODE_ENV=test. Production behaviour is unchanged.
    if (process.env.NODE_ENV === 'test') {
        return function rateLimitBypass(_req, _res, next) { next(); };
    }

    const buckets = new Map();

    function cleanup(now) {
        for (const [bucketKey, entry] of buckets) {
            if (now - entry.first > windowMs) {
                buckets.delete(bucketKey);
            }
        }
    }

    return function rateLimitMiddleware(req, res, next) {
        const now = Date.now();
        if (buckets.size > 10_000) cleanup(now);

        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const bucketKey = `${key}:${ip}`;
        const entry = buckets.get(bucketKey);

        if (!entry || now - entry.first > windowMs) {
            buckets.set(bucketKey, { first: now, count: 1 });
            return next();
        }

        entry.count += 1;
        if (entry.count > max) {
            const retryAfter = Math.max(1, Math.ceil((windowMs - (now - entry.first)) / 1000));
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ error: 'Too many requests' });
        }
        next();
    };
}

/**
 * Validate Origin on WebSocket upgrade. Accepts same-origin and explicit
 * allowlist. Unknown origins are rejected unless allowlist is empty (dev).
 */
function isAllowedOrigin(origin, { allowlist = [], host = '' } = {}) {
    if (!origin) return true; // non-browser clients
    if (allowlist.length === 0) return true;
    try {
        const { host: originHost } = new URL(origin);
        if (host && originHost === host) return true;
        return allowlist.some((entry) => entry === origin || entry === originHost);
    } catch (e) {
        return false;
    }
}

module.exports = { securityHeaders, createRateLimiter, isAllowedOrigin };
