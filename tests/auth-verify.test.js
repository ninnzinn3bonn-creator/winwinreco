/**
 * tests/auth-verify.test.js
 *
 * Integration tests for U-6: email verification endpoints.
 *
 * Coverage (6 cases):
 *   1. Signup → status='pending_email', emailVerificationRepo has token
 *   2. POST /auth/login with status=pending_email → 403 email_not_verified
 *   3. POST /auth/verify with valid token → 200, status becomes 'pending', token marked used
 *   4. POST /auth/verify with invalid token → 400
 *   5. POST /auth/verify with used token → 400 (second call rejected)
 *   6. POST /auth/verify with expired token → 400
 */

process.env.MAIL_PROVIDER = 'console'; // suppress real mail in tests
process.env.REQUEST_LOG = '0';
// このスイートはメール認証フロー (U-6) の挙動を検証するため、明示的に ON にする。
// 本番では既定 OFF (admin 承認のみ) で運用される。
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { UserAccountRepository } = require('../src/backend/repo/sqlite/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/sqlite/session-repo');
const { EmailVerificationRepository } = require('../src/backend/repo/sqlite/email-verification-repo');

const DB_PATH = path.resolve(__dirname, './tmp/test_auth_verify.db');

describe('Email Verification (U-6)', () => {
    let app;
    let db;
    let accountRepo;
    let sessionRepo;
    let emailVerificationRepo;

    const TEST_EMAIL = 'verify-test@example.test';
    const TEST_PASS = 'password123';

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

        db = await initDB(DB_PATH);
        accountRepo = new UserAccountRepository(db);
        sessionRepo = new SessionRepository(db);
        emailVerificationRepo = new EmailVerificationRepository(db);

        app = createApp({ accountRepo, sessionRepo, emailVerificationRepo });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    // -----------------------------------------------------------------------
    // 1. Signup → status='pending_email', token created in DB
    // -----------------------------------------------------------------------
    test('POST /auth/signup creates account with status=pending_email and verification token', async () => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: TEST_EMAIL, password: TEST_PASS, display_name: 'Verify Tester' });

        expect(res.status).toBe(201);
        expect(res.body.pending).toBe(true);
        // Message should mention confirmation email
        expect(res.body.message).toMatch(/確認メール/);

        // Account should have status=pending_email
        const account = await accountRepo.findByEmail(TEST_EMAIL);
        expect(account).not.toBeNull();
        expect(account.status).toBe('pending_email');

        // A verification token should have been created
        const rows = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM email_verification_tokens WHERE account_id = ?',
                [account.id],
                (err, r) => { if (err) return reject(err); resolve(r); }
            );
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].token_hash).toBeDefined();
        expect(rows[0].used_at).toBeNull();
    });

    // -----------------------------------------------------------------------
    // 2. Login with status=pending_email → 403 email_not_verified
    // -----------------------------------------------------------------------
    test('POST /auth/login with status=pending_email returns 403 email_not_verified', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: TEST_EMAIL, password: TEST_PASS });

        expect(res.status).toBe(403);
        expect(res.body.error_code).toBe('email_not_verified');
    });

    // -----------------------------------------------------------------------
    // 3. Valid token → 200, status=pending, token marked used
    // -----------------------------------------------------------------------
    test('POST /auth/verify with valid token returns 200 and advances status to pending', async () => {
        const account = await accountRepo.findByEmail(TEST_EMAIL);

        // Create a fresh verification token
        const plainToken = crypto.randomBytes(32).toString('hex');
        const { id: tokenId } = await emailVerificationRepo.create({
            accountId: account.id,
            token: plainToken
        });

        const res = await request(app)
            .post('/auth/verify')
            .send({ token: plainToken });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // Status should have advanced to 'pending'
        const updated = await accountRepo.findById(account.id);
        expect(updated.status).toBe('pending');

        // Token should be marked used
        const tokenRow = await new Promise((resolve, reject) => {
            db.get(
                'SELECT used_at FROM email_verification_tokens WHERE id = ?',
                [tokenId],
                (err, row) => { if (err) return reject(err); resolve(row); }
            );
        });
        expect(tokenRow.used_at).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // 4. Invalid token → 400
    // -----------------------------------------------------------------------
    test('POST /auth/verify with invalid token returns 400', async () => {
        const res = await request(app)
            .post('/auth/verify')
            .send({ token: 'completely-invalid-token-that-does-not-exist' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_or_expired_token');
    });

    // -----------------------------------------------------------------------
    // 5. Used token → 400 on second use
    // -----------------------------------------------------------------------
    test('POST /auth/verify with already-used token returns 400', async () => {
        // Get or create a test account in pending_email state
        const { hashPassword } = require('../src/backend/lib/passwords');
        const hash = await hashPassword('testpass456');
        let account2;
        try {
            account2 = await accountRepo.create({
                email: 'verify-used@example.test',
                passwordHash: hash,
                status: 'pending_email'
            });
        } catch (_) {
            account2 = await accountRepo.findByEmail('verify-used@example.test');
        }

        const plainToken = crypto.randomBytes(32).toString('hex');
        await emailVerificationRepo.create({ accountId: account2.id, token: plainToken });

        // First use — should succeed
        const first = await request(app)
            .post('/auth/verify')
            .send({ token: plainToken });
        expect(first.status).toBe(200);

        // Second use — must fail
        const second = await request(app)
            .post('/auth/verify')
            .send({ token: plainToken });
        expect(second.status).toBe(400);
        expect(second.body.error).toBe('invalid_or_expired_token');
    });

    // -----------------------------------------------------------------------
    // 6. Expired token → 400
    // -----------------------------------------------------------------------
    test('POST /auth/verify with expired token returns 400', async () => {
        const { hashPassword } = require('../src/backend/lib/passwords');
        const hash = await hashPassword('testpass789');
        let account3;
        try {
            account3 = await accountRepo.create({
                email: 'verify-expired@example.test',
                passwordHash: hash,
                status: 'pending_email'
            });
        } catch (_) {
            account3 = await accountRepo.findByEmail('verify-expired@example.test');
        }

        const plainToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(plainToken, 'utf8').digest('hex');

        // Insert a token that expired 1 second ago
        const expiredAt = new Date(Date.now() - 1000).toISOString();
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO email_verification_tokens (id, account_id, token_hash, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [`emv-expired-test`, account3.id, tokenHash, expiredAt],
                (err) => { if (err) return reject(err); resolve(); }
            );
        });

        const res = await request(app)
            .post('/auth/verify')
            .send({ token: plainToken });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_or_expired_token');
    });
});
