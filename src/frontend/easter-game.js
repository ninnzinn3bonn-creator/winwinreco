/**
 * Easter Egg Mini Game: 「血まみれの目」
 *
 * Trigger: プロフィール → 設定 → 表示テーマ → "レッド" を選択
 *          → 画面が赤いホラー仕様になり、「新しい会議を始める」ボタンを
 *            押すとミニゲームが起動する。
 *
 * Game: 5分間で赤い目をタップして得点を稼ぐ。
 *   通常 (赤):     +10 + コンボボーナス (最大 +9)
 *   呪い (紫):     -50, コンボリセット
 *   黄金 (金):     +50 + コンボボーナス。30 秒以降にレア出現 (~3%)、ライフ短め
 *   時間 (シアン): +10 秒 + コンボ加算。60 秒以降にレア出現 (~2%)
 *
 * 後半ほど呪い目の確率が上がり、スポーン間隔とライフタイムが短くなる。
 * 10 コンボ毎にマイルストーン演出。ヒット時はパーティクル + Web Audio 効果音。
 *
 * スコアは /me/easter-score へ送信。失敗時は localStorage に退避。
 *
 * 本仕様への影響を避けるため:
 *  - 本ファイルは window.AppEasterGame として隔離 (IIFE)
 *  - 外部アセットは一切ロードしない (CSS は style.css 内で .easter-* に限定)
 *  - bindings.js の startBtn 委譲は AppEasterGame.shouldIntercept() のみ判定
 *  - 失敗しても黙って通常フローへ戻る
 */
(function initEasterGame() {
    const GAME_DURATION_MS = 5 * 60 * 1000;
    // スポーン間隔は徐々に短く: 700ms → 350ms
    const SPAWN_INTERVAL_START_MS = 700;
    const SPAWN_INTERVAL_END_MS = 350;
    // ライフタイムも徐々に短く: 2200ms → 1300ms
    const EYE_LIFETIME_START_MS = 2200;
    const EYE_LIFETIME_END_MS = 1300;
    // 特殊目の出現確率と解禁タイミング
    const GOLDEN_UNLOCK_MS = 30 * 1000;
    const GOLDEN_PROBABILITY = 0.03;
    const TIME_UNLOCK_MS = 60 * 1000;
    const TIME_PROBABILITY = 0.02;
    const TIME_BONUS_MS = 10 * 1000;
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

    // --- 軽量サウンド (Web Audio API。アセットロード無し) -------------------
    // ユーザー操作 (ボタンクリックでゲーム起動) 後に作るため AutoplayPolicy OK。
    let audioCtx = null;
    function ensureAudio() {
        if (audioCtx) return audioCtx;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            audioCtx = new Ctx();
        } catch (_) { audioCtx = null; }
        return audioCtx;
    }
    function tone(freq, durationMs, { type = 'sine', volume = 0.08, slideTo = null } = {}) {
        const ctx = ensureAudio();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            if (slideTo) {
                osc.frequency.exponentialRampToValueAtTime(
                    Math.max(40, slideTo),
                    ctx.currentTime + durationMs / 1000
                );
            }
            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
        } catch (_) { /* ignore */ }
    }
    function sfxHit(combo)  { tone(440 + Math.min(combo, 12) * 15, 80,  { type: 'triangle', volume: 0.06 }); }
    function sfxCurse()     { tone(220, 180, { type: 'sawtooth', volume: 0.10, slideTo: 80 }); }
    function sfxGolden()    { tone(660, 120, { type: 'triangle', volume: 0.10, slideTo: 1320 }); setTimeout(() => tone(990, 140, { type: 'triangle', volume: 0.10 }), 110); }
    function sfxTime()      { tone(880, 80, { type: 'sine', volume: 0.10 }); setTimeout(() => tone(1320, 120, { type: 'sine', volume: 0.10 }), 70); }
    function sfxMilestone() { tone(523, 100, { type: 'triangle', volume: 0.08 }); setTimeout(() => tone(659, 100, { type: 'triangle', volume: 0.08 }), 100); setTimeout(() => tone(784, 140, { type: 'triangle', volume: 0.08 }), 200); }

    async function saveScore(score) {
        let prev = 0;
        try { prev = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0; } catch (_) { /* ignore */ }
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
        if (score > prev) {
            try { localStorage.setItem(STORAGE_KEY, String(score)); } catch (_) { /* ignore */ }
            return { is_new_high_score: true, high_score: score, previous: prev };
        }
        return { is_new_high_score: false, high_score: prev, previous: prev };
    }

    function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

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
            // 時間ボーナスで増えた合計 ms。tick の残り計算で使う。
            bonusTimeMs: 0,
            spawnTimer: null, tickTimer: null,
            overlay, arena, ended: false,
            // ヒット数の内訳 (リザルトで自慢用)
            golden: 0, time: 0, missed: 0
        };

        setTimeout(() => { if (banner) banner.classList.add('fade'); }, 1500);

        function updateHUD() {
            if (!gameState) return;
            scoreEl.textContent = gameState.score;
            comboEl.textContent = gameState.combo;
            if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
            // コンボに応じてアリーナのフチがゆっくり赤くなる
            const intensity = Math.min(1, gameState.combo / 20);
            arena.style.boxShadow = intensity > 0
                ? `inset 0 0 ${20 + intensity * 60}px rgba(255, ${50 - intensity * 40}, ${50 - intensity * 40}, ${0.3 + intensity * 0.5})`
                : '';
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

        // パーティクルを 6 個放射状に飛ばす。CSS の easter-particle-* で動かす。
        function burst(x, y, color) {
            for (let i = 0; i < 6; i += 1) {
                const p = document.createElement('div');
                p.className = 'easter-particle';
                p.style.left = x + 'px';
                p.style.top = y + 'px';
                p.style.background = color;
                const angle = (Math.PI * 2 * i) / 6 + (Math.random() - 0.5) * 0.4;
                const dist = 40 + Math.random() * 30;
                p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
                p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
                arena.appendChild(p);
                setTimeout(() => { if (p.parentNode) p.remove(); }, 700);
            }
        }

        function showMilestone(text) {
            const el = document.createElement('div');
            el.className = 'easter-milestone';
            el.textContent = text;
            arena.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.remove(); }, 1000);
        }

        function getProgress() {
            const elapsed = Date.now() - gameState.startedAt;
            return Math.min(1, elapsed / GAME_DURATION_MS);
        }

        function spawnEye() {
            if (!gameState || gameState.ended) return;
            const progress = getProgress();
            const elapsed = Date.now() - gameState.startedAt;
            const arenaRect = arena.getBoundingClientRect();

            // 種別判定: 時間 > 黄金 > 呪い > 通常 の優先順で確率を引く
            let kind = 'normal';
            const roll = Math.random();
            if (elapsed >= TIME_UNLOCK_MS && roll < TIME_PROBABILITY) {
                kind = 'time';
            } else if (elapsed >= GOLDEN_UNLOCK_MS && roll < TIME_PROBABILITY + GOLDEN_PROBABILITY) {
                kind = 'golden';
            } else {
                // 後半ほど呪い目の確率が上がる (12% → 30%)
                const cursedProb = 0.12 + progress * 0.18;
                if (Math.random() < cursedProb) kind = 'cursed';
            }

            const baseSize = kind === 'golden' ? 56 : 50;
            const size = baseSize + Math.random() * 30;
            const eye = document.createElement('div');
            eye.className = `easter-eye ${kind}`;
            eye.style.width = size + 'px';
            eye.style.height = size + 'px';
            const x = Math.random() * Math.max(0, arenaRect.width - size);
            const y = Math.random() * Math.max(0, arenaRect.height - size);
            eye.style.left = x + 'px';
            eye.style.top = y + 'px';

            // ライフタイムを進行度で短縮
            const baseLifetime = lerp(EYE_LIFETIME_START_MS, EYE_LIFETIME_END_MS, progress);
            // 黄金は短め、時間は普通
            const lifetime = kind === 'golden' ? baseLifetime * 0.7 : baseLifetime;

            const onHit = (ev) => {
                if (ev) ev.stopPropagation();
                if (!eye.parentNode || !gameState) return;
                const cx = parseFloat(eye.style.left) + size / 2;
                const cy = parseFloat(eye.style.top) + size / 2;
                let prevCombo = gameState.combo;
                if (kind === 'cursed') {
                    gameState.score = Math.max(0, gameState.score - 50);
                    gameState.combo = 0;
                    showFloatingText(cx, cy, '-50 呪われた', 'curse');
                    burst(cx, cy, '#cc00ff');
                    flash('curse');
                    sfxCurse();
                } else if (kind === 'golden') {
                    const bonus = Math.min(gameState.combo, 9);
                    const points = 50 + bonus;
                    gameState.score += points;
                    gameState.combo += 1;
                    gameState.golden += 1;
                    showFloatingText(cx, cy, `+${points} 黄金`, 'golden');
                    burst(cx, cy, '#ffd700');
                    flash('golden');
                    sfxGolden();
                } else if (kind === 'time') {
                    gameState.bonusTimeMs += TIME_BONUS_MS;
                    gameState.combo += 1;
                    gameState.time += 1;
                    showFloatingText(cx, cy, `+10秒`, 'time');
                    burst(cx, cy, '#66e8ff');
                    flash('time');
                    sfxTime();
                } else {
                    const bonus = Math.min(gameState.combo, 9);
                    const points = 10 + bonus;
                    gameState.score += points;
                    gameState.combo += 1;
                    showFloatingText(cx, cy, `+${points}${bonus > 0 ? ` (×${gameState.combo})` : ''}`, 'hit');
                    burst(cx, cy, '#ff3333');
                    sfxHit(gameState.combo);
                }
                // コンボ 10 ごとのマイルストーン
                if (gameState.combo > 0 && gameState.combo % 10 === 0 && gameState.combo > prevCombo) {
                    showMilestone(`COMBO × ${gameState.combo} !`);
                    sfxMilestone();
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
                    if (kind === 'normal' && gameState && !gameState.ended) {
                        // 通常の目を見逃したらコンボリセット
                        if (gameState.combo > 0) gameState.missed += 1;
                        gameState.combo = 0;
                        updateHUD();
                    }
                }
            }, lifetime);
        }

        function tick() {
            if (!gameState || gameState.ended) return;
            const elapsed = Date.now() - gameState.startedAt;
            const remaining = Math.max(0, GAME_DURATION_MS + gameState.bonusTimeMs - elapsed);
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
            // 残り 30 秒以下で時間表示を赤く点滅
            if (remaining < 30000) timeEl.classList.add('low');
            else timeEl.classList.remove('low');
            if (remaining <= 0) endGame();
        }

        // スポーン間隔を進行度に応じて再スケジューリングするタイマー
        function scheduleSpawnTimer() {
            if (gameState.spawnTimer) clearTimeout(gameState.spawnTimer);
            if (!gameState || gameState.ended) return;
            const progress = getProgress();
            const interval = lerp(SPAWN_INTERVAL_START_MS, SPAWN_INTERVAL_END_MS, progress);
            gameState.spawnTimer = setTimeout(() => {
                spawnEye();
                scheduleSpawnTimer();
            }, interval);
        }

        async function endGame() {
            if (!gameState || gameState.ended) return;
            gameState.ended = true;
            if (gameState.spawnTimer) clearTimeout(gameState.spawnTimer);
            if (gameState.tickTimer) clearInterval(gameState.tickTimer);
            const finalScore = gameState.score;
            arena.querySelectorAll('.easter-eye').forEach((e) => e.remove());
            overlay.querySelector('#easter-final-score').textContent = finalScore;
            const highMsg = overlay.querySelector('#easter-high-score-msg');
            const stats = `最大コンボ: ${gameState.maxCombo} / 黄金: ${gameState.golden} / 時間: ${gameState.time}`;
            highMsg.textContent = '記録を送信中... ' + stats;
            endPanel.classList.remove('hidden');
            try {
                const result = await saveScore(finalScore);
                if (result.is_new_high_score) {
                    highMsg.innerHTML = `🩸 <strong>ハイスコア更新！</strong> (前: ${result.previous || 0})<br><span class="easter-stats">${stats}</span>`;
                } else {
                    highMsg.innerHTML = `現在のハイスコア: ${result.high_score}<br><span class="easter-stats">${stats}</span>`;
                }
            } catch (_) {
                highMsg.textContent = '記録の送信に失敗しました。 ' + stats;
            }
        }

        function quitGame() {
            if (!gameState) return;
            if (gameState.spawnTimer) clearTimeout(gameState.spawnTimer);
            if (gameState.tickTimer) clearInterval(gameState.tickTimer);
            if (gameState.overlay && gameState.overlay.parentNode) gameState.overlay.remove();
            document.body.classList.remove('easter-game-active');
            try { if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); } catch (_) { /* ignore */ }
            audioCtx = null;
            gameState = null;
        }

        overlay.querySelector('.easter-game-quit').addEventListener('click', () => {
            if (confirm('ゲームを中断しますか？スコアは保存されません。')) quitGame();
        });
        overlay.querySelector('.easter-game-close').addEventListener('click', quitGame);

        gameState.tickTimer = setInterval(tick, 250);
        scheduleSpawnTimer();
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
