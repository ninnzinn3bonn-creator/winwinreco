module.exports = {
    testEnvironment: 'node',
    testTimeout: 15000,
    // .claude/worktrees 内のテストは別ワークツリーのもので実行しない
    // e2e / room-sync はサーバー起動が必要なため jest 対象外 (playwright や手動実行)
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.claude/',
        '/e2e/',
        'e2e-audio\\.test\\.js',
        'room-sync\\.test\\.js'
    ]
};
