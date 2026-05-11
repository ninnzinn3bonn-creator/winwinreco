/**
 * Firestore 版 UserAccountRepository のスモークテスト。
 * Firestore エミュレータで実行:
 *   npm run emulators            (別ターミナル)
 *   npm run test:firestore -- tests/firestore-user-account.test.js
 *
 * もしくは: cross-env DB_DRIVER=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *           GOOGLE_CLOUD_PROJECT=demo-test jest tests/firestore-user-account.test.js
 *
 * 通常の npm test では FIRESTORE_EMULATOR_HOST が無いためスキップされる。
 */

const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const describeFn = skip ? describe.skip : describe;

describeFn('Firestore UserAccountRepository', () => {
    let repo;

    beforeAll(async () => {
        // 各テストで独立した collection を使うために projectId を変える方法もあるが、
        // ここでは beforeEach で全削除する方針。
        const { UserAccountRepository } = require('../src/backend/repo/firestore/user-account-repo');
        repo = new UserAccountRepository();
    });

    // 各テスト前に user_accounts コレクションをクリア
    beforeEach(async () => {
        const { getDb } = require('../src/backend/repo/firestore/db');
        const snap = await getDb().collection('user_accounts').get();
        const batch = getDb().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        if (snap.size > 0) await batch.commit();
    });

    test('create with default status pending', async () => {
        const acc = await repo.create({
            email: 'alice@example.test',
            passwordHash: 'hash$abc',
            displayName: 'Alice'
        });
        expect(acc.email).toBe('alice@example.test');
        expect(acc.status).toBe('pending');

        const fetched = await repo.findByEmail('alice@example.test');
        expect(fetched.status).toBe('pending');
        expect(fetched.is_owner).toBe(0);
    });

    test('create with explicit status approved', async () => {
        await repo.create({
            email: 'bob@example.test',
            passwordHash: 'hash$def',
            status: 'approved'
        });
        const fetched = await repo.findByEmail('bob@example.test');
        expect(fetched.status).toBe('approved');
    });

    test('setStatus changes status', async () => {
        const acc = await repo.create({
            email: 'carol@example.test',
            passwordHash: 'h',
            displayName: 'C'
        });
        const result = await repo.setStatus(acc.id, 'approved');
        expect(result.changes).toBe(1);
        const fetched = await repo.findById(acc.id);
        expect(fetched.status).toBe('approved');
    });

    test('setStatus rejects invalid value', async () => {
        const acc = await repo.create({ email: 'd@example.test', passwordHash: 'h' });
        await expect(repo.setStatus(acc.id, 'bogus')).rejects.toThrow(/invalid status/);
    });

    test('findPending returns pending users in created order', async () => {
        await repo.create({ email: 'p1@example.test', passwordHash: 'h' });
        // Firestore serverTimestamp はナノ秒精度なので少し待つ
        await new Promise((r) => setTimeout(r, 50));
        await repo.create({ email: 'p2@example.test', passwordHash: 'h' });
        await new Promise((r) => setTimeout(r, 50));
        const approved = await repo.create({ email: 'p3@example.test', passwordHash: 'h' });
        await repo.setStatus(approved.id, 'approved');

        const pending = await repo.findPending();
        expect(pending.length).toBe(2);
        expect(pending[0].email).toBe('p1@example.test');
        expect(pending[1].email).toBe('p2@example.test');
    });

    test('countPending counts only pending', async () => {
        const a = await repo.create({ email: 'q1@example.test', passwordHash: 'h' });
        await repo.create({ email: 'q2@example.test', passwordHash: 'h' });
        await repo.setStatus(a.id, 'approved');
        expect(await repo.countPending()).toBe(1);
    });

    test('findAll returns all users in created_desc order', async () => {
        await repo.create({ email: 'a1@example.test', passwordHash: 'h' });
        await new Promise((r) => setTimeout(r, 50));
        await repo.create({ email: 'a2@example.test', passwordHash: 'h' });
        const all = await repo.findAll();
        expect(all.length).toBe(2);
        // newest first
        expect(all[0].email).toBe('a2@example.test');
    });

    test('setOwner / countOwners / findOwners', async () => {
        const a = await repo.create({ email: 'owner1@example.test', passwordHash: 'h' });
        await repo.create({ email: 'owner2@example.test', passwordHash: 'h' });
        expect(await repo.countOwners()).toBe(0);
        await repo.setOwner(a.id, true);
        expect(await repo.countOwners()).toBe(1);
        const owners = await repo.findOwners();
        expect(owners.length).toBe(1);
        expect(owners[0].email).toBe('owner1@example.test');
        expect(owners[0].is_owner).toBe(1);

        // 解除も動く
        await repo.setOwner(a.id, false);
        expect(await repo.countOwners()).toBe(0);
    });

    test('duplicate email throws SQLITE_CONSTRAINT-shaped error', async () => {
        await repo.create({ email: 'dup@example.test', passwordHash: 'h' });
        await expect(
            repo.create({ email: 'dup@example.test', passwordHash: 'h' })
        ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT' });
    });
});
