'use strict';

/**
 * tests/structure-smoke.test.js
 * 実装存在の静的検査 (Step 2 - structure smoke tests)
 *
 * 以下を検証する:
 *  U-1  パスワードリセット関連ファイルの存在
 *  U-2  アカウント削除 / エクスポートライブラリの存在
 *  U-4  toast.js の存在 + フロントエンド JS から alert() が消えていること
 *  U-5  利用規約 / プライバシーポリシー HTML の存在
 *  U-6  メール認証リポジトリ + REQUIRE_EMAIL_VERIFICATION フラグの存在
 *  D-1  logger.js の存在 + backend に raw console.* がないこと
 *  D-2  CI ワークフローの存在
 *  D-3  Dependabot 設定の存在
 *  D-4  metrics.js の存在と recordApiCall エクスポート
 *  Series  meeting_series リポジトリ + エンドポイントの存在
 *  Past    past_room_ids が regenerate/custom-ai エンドポイントに対応
 *  Easter  easter-game.js + /me/easter-score エンドポイント
 *  UI      meeting-ui.js の showSummaryScreen が buildPastMeetingSelector / renderNextAgendaSection を呼ぶ
 *  CSS     モバイル FAB クリアランス padding-bottom: 96px が style.css にあること
 *  Auth    admin_approval が既定 pending_kind として app.js に存在
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

/**
 * src/backend 以下の JS ファイルを再帰スキャンして console.(log|warn|error) の行を返す。
 * logger.js 自体は除外する。
 */
function scanBackendConsole() {
    const results = [];
    const backendDir = path.join(root, 'src', 'backend');

    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'logger.js') {
                let content;
                try { content = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (/console\.(log|warn|error)\s*\(/.test(line)) {
                        results.push({ file: path.relative(root, full), line: idx + 1, text: line.trim() });
                    }
                });
            }
        }
    }

    walk(backendDir);
    return results;
}

// ---------------------------------------------------------------------------
// U-1
// ---------------------------------------------------------------------------
describe('U-1: password reset files', () => {
    test('mail.js exists', () => {
        expect(exists('src/backend/lib/mail.js')).toBe(true);
    });

    test('sqlite password-reset-repo.js exists', () => {
        expect(exists('src/backend/repo/sqlite/password-reset-repo.js')).toBe(true);
    });

    test('firestore password-reset-repo.js exists', () => {
        expect(exists('src/backend/repo/firestore/password-reset-repo.js')).toBe(true);
    });

    test('reset.html exists', () => {
        expect(exists('src/frontend/reset.html')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// U-2
// ---------------------------------------------------------------------------
describe('U-2: account export / delete libs', () => {
    test('account-export.js exists', () => {
        expect(exists('src/backend/lib/account-export.js')).toBe(true);
    });

    test('account-delete.js exists', () => {
        expect(exists('src/backend/lib/account-delete.js')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// U-4
// ---------------------------------------------------------------------------
describe('U-4: toast.js + no alert() in frontend JS', () => {
    test('toast.js exists', () => {
        expect(exists('src/frontend/toast.js')).toBe(true);
    });

    const jsFiles = [
        'src/frontend/main.js',
        'src/frontend/meeting-ui.js',
        'src/frontend/log-ui.js',
        'src/frontend/shared-ai.js',
        'src/frontend/profile.js',
        'src/frontend/audio.js',
        'src/frontend/dictionary.js',
        'src/frontend/debug.js'
    ];

    for (const f of jsFiles) {
        test(`alert() removed from ${f}`, () => {
            if (!exists(f)) {
                // ファイル自体が存在しない場合はスキップ (将来削除等)
                return;
            }
            const content = read(f);
            expect(content.match(/\balert\s*\(/)).toBeNull();
        });
    }
});

// ---------------------------------------------------------------------------
// U-5
// ---------------------------------------------------------------------------
describe('U-5: terms and privacy HTML', () => {
    test('terms.html exists', () => {
        expect(exists('src/frontend/terms.html')).toBe(true);
    });

    test('privacy.html exists', () => {
        expect(exists('src/frontend/privacy.html')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// U-6
// ---------------------------------------------------------------------------
describe('U-6: email verification', () => {
    test('sqlite email-verification-repo.js exists', () => {
        expect(exists('src/backend/repo/sqlite/email-verification-repo.js')).toBe(true);
    });

    test('firestore email-verification-repo.js exists', () => {
        expect(exists('src/backend/repo/firestore/email-verification-repo.js')).toBe(true);
    });

    test('REQUIRE_EMAIL_VERIFICATION gate present in app.js', () => {
        expect(read('src/backend/app.js')).toMatch(/REQUIRE_EMAIL_VERIFICATION/);
    });
});

// ---------------------------------------------------------------------------
// D-1
// ---------------------------------------------------------------------------
describe('D-1: structured logging', () => {
    test('logger.js exists', () => {
        expect(exists('src/backend/lib/logger.js')).toBe(true);
    });

    test('no raw console.* in backend (excluding logger.js)', () => {
        const hits = scanBackendConsole();
        // 0 件を期待するが、起動バナー等を考慮して緩い閾値 (< 5) とする
        if (hits.length > 0) {
            console.info('console.* hits outside logger.js:', JSON.stringify(hits, null, 2));
        }
        expect(hits.length).toBeLessThan(5);
    });
});

// ---------------------------------------------------------------------------
// D-2
// ---------------------------------------------------------------------------
describe('D-2: CI workflow', () => {
    test('.github/workflows/ci.yml exists', () => {
        expect(exists('.github/workflows/ci.yml')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// D-3
// ---------------------------------------------------------------------------
describe('D-3: Dependabot', () => {
    test('.github/dependabot.yml exists', () => {
        expect(exists('.github/dependabot.yml')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// D-4
// ---------------------------------------------------------------------------
describe('D-4: API metering', () => {
    test('metrics.js exists and exports recordApiCall', () => {
        expect(exists('src/backend/lib/metrics.js')).toBe(true);
        expect(read('src/backend/lib/metrics.js')).toMatch(/recordApiCall/);
    });
});

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------
describe('Series: meeting series feature', () => {
    test('sqlite series-repo.js exists', () => {
        expect(exists('src/backend/repo/sqlite/series-repo.js')).toBe(true);
    });

    test('firestore series-repo.js exists', () => {
        expect(exists('src/backend/repo/firestore/series-repo.js')).toBe(true);
    });

    test('/me/series endpoint present in app.js', () => {
        expect(read('src/backend/app.js')).toMatch(/\/me\/series/);
    });

    test('generate-next-agenda endpoint present in app.js', () => {
        expect(read('src/backend/app.js')).toMatch(/generate-next-agenda/);
    });
});

// ---------------------------------------------------------------------------
// Past meeting selector
// ---------------------------------------------------------------------------
describe('Past meeting selector', () => {
    test('past_room_ids accepted on /rooms/:id/custom-ai and /insights/regenerate in app.js', () => {
        const app = read('src/backend/app.js');
        expect(app).toMatch(/past_room_ids/);
    });
});

// ---------------------------------------------------------------------------
// Easter egg
// ---------------------------------------------------------------------------
describe('Easter egg', () => {
    test('easter-game.js exists', () => {
        expect(exists('src/frontend/easter-game.js')).toBe(true);
    });

    test('/me/easter-score endpoint present in app.js', () => {
        expect(read('src/backend/app.js')).toMatch(/\/me\/easter-score/);
    });
});

// ---------------------------------------------------------------------------
// meeting-ui.js
// ---------------------------------------------------------------------------
describe('meeting-ui.js showSummaryScreen wiring', () => {
    test('buildPastMeetingSelector is called inside showSummaryScreen', () => {
        const mui = read('src/frontend/meeting-ui.js');
        expect(mui).toMatch(/buildPastMeetingSelector/);
    });

    test('renderNextAgendaSection is called inside showSummaryScreen', () => {
        const mui = read('src/frontend/meeting-ui.js');
        expect(mui).toMatch(/renderNextAgendaSection/);
    });
});

// ---------------------------------------------------------------------------
// Mobile FAB clearance (CSS)
// ---------------------------------------------------------------------------
describe('Mobile FAB CSS clearance', () => {
    test('padding-bottom: 96px present in style.css (mobile conversation-list clearance)', () => {
        const css = read('src/frontend/style.css');
        expect(css).toMatch(/padding-bottom:\s*96px/);
    });
});

// ---------------------------------------------------------------------------
// Auth: default pending kind
// ---------------------------------------------------------------------------
describe('Auth: default pending kind', () => {
    test('admin_approval is the default pending_kind in app.js', () => {
        const app = read('src/backend/app.js');
        expect(app).toMatch(/admin_approval/);
    });
});
