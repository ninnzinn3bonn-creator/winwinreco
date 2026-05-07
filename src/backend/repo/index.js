/**
 * DB ドライバスイッチ。
 * DB_DRIVER=sqlite (既定) → SQLite 実装
 * DB_DRIVER=firestore      → Firestore 実装 (Phase 2 で完成)
 */
async function createRepos() {
    const driver = process.env.DB_DRIVER || 'sqlite';
    if (driver === 'sqlite') return require('./sqlite').createRepos();
    if (driver === 'firestore') return require('./firestore').createRepos();
    throw new Error(`Unknown DB_DRIVER: "${driver}" (valid values: sqlite, firestore)`);
}

module.exports = { createRepos };
