const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

/**
 * Password hashing using Node's built-in scrypt KDF (memory-hard, bcrypt-
 * equivalent security, zero native deps). Output format:
 *
 *   scrypt$N$r$p$<saltHex>$<hashHex>
 *
 * N/r/p are tunable and stored inline so we can raise them later without
 * invalidating old hashes. Default: N=16384, r=8, p=1, 16-byte salt,
 * 64-byte output — the Node documentation's recommended profile.
 *
 * verifyPassword uses timingSafeEqual to avoid leaking timing on mismatch.
 */
const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 64;

async function hashPassword(plain, { N = DEFAULT_N, r = DEFAULT_R, p = DEFAULT_P } = {}) {
    if (typeof plain !== 'string' || plain.length === 0) {
        throw new Error('password must be a non-empty string');
    }
    const salt = crypto.randomBytes(SALT_BYTES);
    const derived = await scryptAsync(plain, salt, HASH_BYTES, { N, r, p, maxmem: 128 * N * r * 2 });
    return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
    if (typeof plain !== 'string' || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    let salt;
    let expected;
    try {
        salt = Buffer.from(saltHex, 'hex');
        expected = Buffer.from(hashHex, 'hex');
    } catch (_err) {
        return false;
    }
    if (expected.length === 0) return false;

    let derived;
    try {
        derived = await scryptAsync(plain, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
    } catch (_err) {
        return false;
    }
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
