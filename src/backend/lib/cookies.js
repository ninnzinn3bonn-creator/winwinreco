/**
 * Minimal cookie helpers — no `cookie` npm dep.
 *
 * parseCookie handles the subset of RFC6265 we actually encounter: comma /
 * semicolon separation, whitespace trimming, no quoting. Returns a plain
 * object with decoded values; unparseable pairs are skipped.
 *
 * buildSessionCookie emits a Set-Cookie value for the opaque session token:
 *   - HttpOnly (can't be read from JS — mitigates XSS token theft)
 *   - SameSite=Lax (blocks cross-site POST / top-level GET CSRF)
 *   - Secure (when `secure: true` — set by server.js in production)
 *   - Path=/ so it's sent on every API call
 *   - Max-Age in seconds; mirrors the sliding session window
 */

const SESSION_COOKIE_NAME = 'session_token';

function parseCookie(header) {
    const out = {};
    if (!header || typeof header !== 'string') return out;
    const pairs = header.split(/;\s*/);
    for (const pair of pairs) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!name) continue;
        try {
            out[name] = decodeURIComponent(value);
        } catch (_err) {
            out[name] = value;
        }
    }
    return out;
}

function buildSessionCookie(token, { maxAgeSeconds, secure = false } = {}) {
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/'
    ];
    if (typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds)) {
        parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
    }
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

function buildClearCookie({ secure = false } = {}) {
    const parts = [
        `${SESSION_COOKIE_NAME}=`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0'
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

module.exports = {
    SESSION_COOKIE_NAME,
    parseCookie,
    buildSessionCookie,
    buildClearCookie
};
