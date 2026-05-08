/**
 * Easter Egg Mini Game: 「血まみれの目」
 *
 * Trigger: プロフィール → 設定 → 表示テーマ → "レッド" を選択
 *          → 画面が赤いホラー仕様になり、「新しい会議を始める」ボタンを
 *            押すとミニゲームが起動する。
 *
 * Game: 5分間で赤い目をタップして得点を稼ぐ。
 *       - 通常の目 (赤): +10点 / コンボボーナス (連続ヒットで最大 +9)
 *       - 呪い目 (紫):  -50点 / コンボリセット
 *       - スコアは /me/easter-score へ送信。失敗時は localStorage に退避。
 *
 * 本仕様への影響を避けるため:
 *  - 本ファイルは window.AppEasterGame として隔離
 *  - bindings.js の startBtn 委譲は AppEasterGame.shouldIntercept() のみ判定
 *  - 失敗しても黙って通常フローへ戻る
 */
(function initEasterGame() {
    const GAME_DURATION_MS = 5 * 60 * 1000;
    const SPAWN_INTERVAL_MS = 700;
    const EYE_LIFETIME_MS = 2200;
    const STORAGE_KEY = 'gijiro:easter_high_score';

    function isRedThemeActive() {
        try { return document.documentElement.getAttribute('data-theme') === 'red'; }
        catch (_) { return false; }
    }
    function isAuthenticated() {
        return !!(window.AppAuth && window.AppAuth.state && window.AppAuth.state.account);
    }
    function shouldIntercept() {
        return isRedThemeActive() && isAuthenticated() && !gameState;
    }

    let gameState = null;

    async function saveScore(score) {
        let prev = 0;
        try { prev = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0; } catch (_) { /* ignore */ }
        // Try backend first (best-effort)
        try {
            const res = await fetch('/me/easter-score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ score })
            });
            if (res.ok) {
                const data = await res.json();
                try { localStorage.setItem(STORAGE_KEY, String(data.high_score || 0)); } catch (_) { /* ignore */ }
                return data;
            }
        } catch (_) { /* fall through to localStorage */ }
        // Local fallback
        if (score > prev) {
            try { localStorage.setItem(STORAGE_KEY, String(score)); } catch (_) { /* ignore */ }
            return { is_new_high_score: true, high_score: score, previous: prev };
        }
        return { is_new_high_score: false, high_score: prev, previous: prev };
    }

    function startGame() {
        if (gameState) return;
        const overlay = document.createElement('div');
        overlay.className = 'easter-game-overlay';
        overlay.innerHTML = `
            <div class="easter-game-hud">
                <div class="easter-game-stat"><span class="easter-game-label">SCORE</span><span class="easter-game-value" id="easter-score">0</span></div>
                <div class="easter-game-stat"><span class="easter-game-label">COMBO</span><span class="easter-game-value" id="easter-combo">0</span></div>
                <div class="easter-game-stat"><span class="easter-game-label">TIME</span><span class="easter-game-value" id="easter-time">5:00</span></div>
                <button class="easter-game-quit" type="button">中断</button>
            </div>
            <div class="easter-game-arena" id="easter-arena"></div>
            <div class="easter-game-banner" id="easter-banner">血まみれの目を狩れ…</div>
            <div class="easter-game-end hidden" id="easter-end">
                <h2>FINAL</h2>
                <p class="easter-game-final-score">最終スコア: <span id="easter-final-score">0</span></p>
                <p class="easter-game-high-msg" id="easter-high-score-msg"></p>
                <button class="easter-game-close" type="button">閉じる</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.classList.add('easter-game-active');

        const arena    = overlay.querySelector('#easter-arena');
        const scoreEl  = overlay.querySelector('#easter-score');
        const comboEl  = overlay.querySelector('#easter-combo');
        const timeEl   = overlay.querySelector('#easter-time');
        const banner   = overlay.querySelector('#easter-banner');
        const endPanel = overlay.querySelector('#easter-end');

        gameState = {
            score: 0, combo: 0, maxCombo: 0,
            startedAt: Date.now(),
            spawnTimer: null, tickTimer: null,
            overlay, arena, ended: false
        };

        // Banner fade-out
        setTimeout(() => { if (banner) banner.classList.add('fade'); }, 1500);

        function updateHUD() {
            if (!gameState) return;
            scoreEl.textContent = gameState.score;
            comboEl.textContent = gameState.combo;
            if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
        }

        function showFloatingText(x, y, text, kind) {
            const t = document.createElement('div');
            t.className = `easter-floating ${kind}`;
            t.textContent = text;
            t.style.left = x + 'px';
            t.style.top = y + 'px';
            arena.appendChild(t);
            setTimeout(() => { if (t.parentNode) t.remove(); }, 800);
        }

        function flash(kind) {
            document.body.classList.add(`easter-flash-${kind}`);
            setTimeout(() => document.body.classList.remove(`easter-flash-${kind}`), 280);
        }

        function spawnEye() {
            if (!gameState || gameState.ended) return;
            const elapsed = Date.now() - gameState.startedAt;
            const progress = Math.min(1, elapsed / GAME_DURATION_MS);
            // 後半ほど呪い目の確率が上がる (12% → 30%)
            const cursedProb = 0.12 + progress * 0.18;
            const isCursed = Math.random() < cursedProb;
            const arenaRect = arena.getBoundingClientRect();
            const baseSize = 50;
            const size = baseSize + Math.random() * 30;
            const eye = document.createElement('div');
            eye.className = `easter-eye ${isCursed ? 'cursed' : 'normal'}`;
            eye.style.width = size + 'px';
            eye.style.height = size + 'px';
            const x = Math.random() * Math.max(0, arenaRect.width - size);
            const y = Math.random() * Math.max(0, arenaRect.height - size);
            eye.style.left = x + 'px';
            eye.style.top = y + 'px';

            const onHit = (ev) => {
                if (ev) ev.stopPropagation();
                if (!eye.parentNode || !gameState) return;
                const cx = parseFloat(eye.style.left) + size / 2;
                const cy = parseFloat(eye.style.top) + size / 2;
                if (isCursed) {
                    gameState.score = Math.max(0, gameState.score - 50);
                    gameState.combo = 0;
                    showFloatingText(cx, cy, '-50 呪われた', 'curse');
                    flash('curse');
                } else {
                    const bonus = Math.min(gameState.combo, 9);
                    const points = 10 + bonus;
                    gameState.score += points;
                    gameState.combo += 1;
                    showFloatingText(cx, cy, `+${points}${bonus > 0 ? ` (×${gameState.combo})` : ''}`, 'hit');
                }
                eye.classList.add('popped');
                setTimeout(() => { if (eye.parentNode) eye.remove(); }, 150);
                updateHUD();
            };
            eye.addEventListener('mousedown', onHit);
            eye.addEventListener('touchstart', (e) => { e.preventDefault(); onHit(e); }, { passive: false });
            arena.appendChild(eye);

            setTimeout(() => {
                if (eye.parentNode) {
                    eye.remove();
                    if (!isCursed && gameState && !gameState.ended) {
                        // 通常の目を見逃したらコンボリセット
                        gameState.combo = 0;
                        updateHUD();
                    }
                }
            }, EYE_LIFETIME_MS);
        }

        function tick() {
            if (!gameState || gameState.ended) return;
            const elapsed = Date.now() - gameState.startedAt;
            const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
            // 後半は出現間隔を短縮
            if (remaining <= 0) endGame();
        }

        async function endGame() {
            if (!gameState || gameState.ended) return;
            gameState.ended = true;
            clearInterval(gameState.spawnTimer);
            clearInterval(gameState.tickTimer);
            const finalScore = gameState.score;
            // Clear remaining eyes
            arena.querySelectorAll('.easter-eye').forEach((e) => e.remove());
            overlay.querySelector('#easter-final-score').textContent = finalScore;
            const highMsg = overlay.querySelector('#easter-high-score-msg');
            highMsg.textContent = '記録を送信中...';
            endPanel.classList.remove('hidden');
            try {
                const result = await saveScore(finalScore);
                if (result.is_new_high_score) {
                    highMsg.innerHTML = `🩸 <strong>ハイスコア更新！</strong> (前: ${result.previous || 0})`;
                } else {
                    highMsg.textContent = `現在のハイスコア: ${result.high_score} / 最大コンボ: ${gameState.maxCombo}`;
                }
            } catch (_) {
                highMsg.textContent = '記録の送信に失敗しました。';
            }
        }

        function quitGame() {
            if (!gameState) return;
            clearInterval(gameState.spawnTimer);
            clearInterval(gameState.tickTimer);
            if (gameState.overlay && gameState.overlay.parentNode) gameState.overlay.remove();
            document.body.classList.remove('easter-game-active');
            gameState = null;
        }

        overlay.querySelector('.easter-game-quit').addEventListener('click', () => {
            if (confirm('ゲームを中断しますか？スコアは保存されません。')) quitGame();
        });
        overlay.querySelector('.easter-game-close').addEventListener('click', quitGame);

        gameState.spawnTimer = setInterval(spawnEye, SPAWN_INTERVAL_MS);
        gameState.tickTimer = setInterval(tick, 250);
        spawnEye();
        tick();
    }

    window.AppEasterGame = {
        startGame,
        shouldIntercept,
        isRedThemeActive,
        isAuthenticated
    };
})();
