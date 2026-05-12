/**
 * tests/auth-reset.test.js
 *
 * Integration tests for U-1: password reset endpoints.
 *
 * Coverage (7 cases):
 *   1. POST /auth/forgot-password with existing email → 200, token created in DB
 *   2. POST /auth/forgot-password with unknown email  → 200 (enumeration prevention)
 *   3. POST /auth/reset-password with valid token     → 200, password updated, sessions destroyed
 *   4. POST /auth/reset-password with expired token   → 400
 *   5. POST /auth/reset-password with used token      → 400  (second use rejected)
 *   6. POST /auth/reset-password with short password  → 400
 *   7. GET  /auth/reset?token=anything                → 200 HTML
 */

process.env.MAIL_PROVIDER = 'console'; // suppress real mail in tests

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { PasswordResetRepository } = require('../src/backend/repo/sqlite/password-reset-repo');

const DB_PATH = path.resolve(__dirname, './tmp/test_auth_reset.db');

describe('Password Reset (U-1)', () => {
    let app;
    let db;
    let accountRepo;
    let sessionRepo;
    let passwordResetRepo;

    // A seeded account used across most tests
    let testAccount;
    const TEST_EMAIL = 'reset-test@example.test';
    const TEST_PASS = 'password123';

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

        db = await initDB(DB_PATH);
        accountRepo = new UserAccountRepository(db);
        sessionRepo = new SessionRepository(db);
        passwordResetRepo = new PasswordResetRepository(db);

        // Pre-create a test account in 'approved' state
        const { hashPassword } = require('../src/backend/lib/passwords');
        const hash = await hashPassword(TEST_PASS);
        testAccount = await accountRepo.create({
            email: TEST_EMAIL,
            passwordHash: hash,
            status: 'approved'
        });

        app = createApp({ accountRepo, sessionRepo, passwordResetRepo });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    // -----------------------------------------------------------------------
    // 1. Existing email → 200, token is persisted
    // -----------------------------------------------------------------------
    test('POST /auth/forgot-password with existing email returns 200 and creates token', async () => {
        const res = await request(app)
            .post('/auth/forgot-password')
            .send({ email: TEST_EMAIL });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // Token should now exist in the database
        const rows = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM password_reset_tokens WHERE account_id = ?',
                [testAccount.id],
                (err, r) => { if (err) return reject(err); resolve(r); }
            );
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].token_hash).toBeDefined();
        expect(rows[0].used_at).toBeNull();
    });

    // -----------------------------------------------------------------------
    // 2. Unknown email → 200 (enumeration prevention)
    // -----------------------------------------------------------------------
    test('POST /auth/forgot-password with unknown email still returns 200', async () => {
        const res = await request(app)
            .post('/auth/forgot-password')
            .send({ email: 'nobody@example.test' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 3. Valid token → password updated, sessions destroyed
    // -----------------------------------------------------------------------
    test('POST /auth/reset-password with valid token updates password and destroys sessions', async () => {
        // Create a fresh session for the account
        const { token: sessionToken } = await sessionRepo.create(testAccount.id);
        const sessionsBefore = await new Promise((resolve, reject) => {
            db.all(
                'SELECT id FROM sessions WHERE account_id = ?',
                [testAccount.id],
                (err, rows) => { if (err) return reject(err); resolve(rows); }
            );
        });
        expect(sessionsBefore.length).toBeGreaterThan(0);

        // Generate a reset token directly via the repo
        const plainToken = crypto.randomBytes(32).toString('hex');
        const { id: tokenId } = await passwordResetRepo.create({
            accountId: testAccount.id,
            token: plainToken
        });

        const newPass = 'NewSecure!99';
        const res = await request(app)
            .post('/auth/reset-password')
            .send({ token: plainToken, new_password: newPass });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // Password hash should have changed
        const updated = await accountRepo.findById(testAccount.id);
        const { verifyPassword } = require('../src/backend/lib/passwords');
        const oldOk = await verifyPassword(TEST_PASS, updated.password_hash);
        const newOk = await verifyPassword(newPass, updated.password_hash);
        expect(oldOk).toBe(false);
        expect(newOk).toBe(true);

        // Sessions should be destroyed
        const sessionsAfter = await new Promise((resolve, reject) => {
            db.all(
                'SELECT id FROM sessions WHERE account_id = ?',
                [testAccount.id],
                (err, rows) => { if (err) return reject(err); resolve(rows); }
            );
        });
        expect(sessionsAfter.length).toBe(0);

        // Token should be marked used
        const tokenRow = await new Promise((resolve, reject) => {
            db.get(
                'SELECT used_at FROM password_reset_tokens WHERE id = ?',
                [tokenId],
                (err, row) => { if (err) return reject(err); resolve(row); }
            );
        });
        expect(tokenRow.used_at).not.toBeNull();

        // Restore password for later tests
        const { hashPassword } = require('../src/backend/lib/passwords');
        const restored = await hashPassword(TEST_PASS);
        await accountRepo.updatePasswordHash(testAccount.id, restored);
    });

    // -----------------------------------------------------------------------
    // 4. Expired token → 400
    // -----------------------------------------------------------------------
    test('POST /auth/reset-password with expired token returns 400', async () => {
        const plainToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(plainToken, 'utf8').digest('hex');

        // Insert a token that expired 1 second ago
        const expiredAt = new Date(Date.now() - 1000).toISOString();
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO password_reset_tokens (id, account_id, token_hash, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [`pwr-expired-test`, testAccount.id, tokenHash, expiredAt],
                (err) => { if (err) return reject(err); resolve(); }
            );
        });

        const res = await request(app)
            .post('/auth/reset-password')
            .send({ token: plainToken, new_password: 'ShouldFail1' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_or_expired_token');
    });

    // -----------------------------------------------------------------------
    // 5. Used token → 400  (second use rejected)
    // -----------------------------------------------------------------------
    test('POST /auth/reset-password with used token returns 400', async () => {
        const plainToken = crypto.randomBytes(32).toString('hex');
        const { id: tokenId } = await passwordResetRepo.create({
            accountId: testAccount.id,
            token: plainToken
        });
        // Use it once — should succeed
        const first = await request(app)
            .post('/auth/reset-password')
            .send({ token: plainToken, new_password: 'FirstUse!99' });
        expect(first.status).toBe(200);

        // Restore password
        const { hashPassword } = require('../src/backend/lib/passwords');
        await accountRepo.updatePasswordHash(testAccount.id, await hashPassword(TEST_PASS));

        // Second use — must fail
        const second = await request(app)
            .post('/auth/reset-password')
            .send({ token: plainToken, new_password: 'SecondUse!99' });
        expect(second.status).toBe(400);
        expect(second.body.error).toBe('invalid_or_expired_token');
    });

    // -----------------------------------------------------------------------
    // 6. New password too short → 400
    // -----------------------------------------------------------------------
    test('POST /auth/reset-password with short new_password returns 400', async () => {
        const plainToken = crypto.randomBytes(32).toString('hex');
        await passwordResetRepo.create({ accountId: testAccount.id, token: plainToken });

        const res = await request(app)
            .post('/auth/reset-password')
            .send({ token: plainToken, new_password: 'short' });

        expect(res.status).toBe(400);
        // Should mention length requirement (not the token error)
        expect(res.body.error).not.toBe('invalid_or_expired_token');
    });

    // -----------------------------------------------------------------------
    // 7. GET /auth/reset?token= → 200 HTML
    // -----------------------------------------------------------------------
    test('GET /auth/reset returns 200 HTML', async () => {
        const res = await request(app).get('/auth/reset?token=sometoken');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });
});
