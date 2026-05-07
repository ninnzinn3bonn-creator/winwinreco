const crypto = require('crypto');

/**
 * Generate a strong, unguessable identifier with an optional prefix.
 * Backed by crypto.randomUUID() (or a randomBytes fallback on older runtimes).
 *
 * The previous implementation used `${prefix}-${Date.now()}-${Math.random()*1000}`,
 * which only has ~1000 variants per millisecond and is trivially guessable.
 * newId('p') → 'p-3f5c8d2e-4a91-4b7d-9e3a-0c1b7f2d8e4f'
 */
function newId(prefix = '') {
    const uuid = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    return prefix ? `${prefix}-${uuid}` : uuid;
}

/**
 * Generate a secret token for participant control (join → end, shared AI).
 */
function newToken(bytes = 24) {
    return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { newId, newToken };
