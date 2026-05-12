/**
 * Easter Egg Mini Game: 「祓いの儀」 (Banishment Rite)
 *
 * Trigger: プロフィール → 設定 → 表示テーマ → "レッド" を選択
 *          → 画面が赤いホラー仕様になり、「新しい会議を始める」ボタンを
 *            押すとミニゲームが起動する。
 *
 * ジャンル: マウス追従ドッジ系シューターのミニチュア。
 *   - プレイヤーは小さな白い光。マウス / 指を追って滑らかに動く。
 *   - 画面端から呪われた目が湧き、プレイヤー狙いに弾を撃つ。
 *   - 凶悪な目 (チェイサー) は本体ごと体当たりしてくる。
 *   - 撃たれる、または触れられると HP -1。HP 0 で即死、90 秒生き残るとクリア。
 *   - 赤い魂のオーブ (+100点)、ハート (+1HP)、凍結 (敵 2 秒停止) を拾う。
 *   - スコア = 生存ボーナス + オーブ + 最大コンボ。連続で被弾せずオーブを
 *     取り続けるとコンボが伸びる。
 *
 * スコアは /me/easter-score へ送信 (失敗時は localStorage に退避)。
 *
 * 本仕様への影響を避けるため:
 *  - 本ファイルは window.AppEasterGame として IIFE で完全に隔離
 *  - 外部アセットは一切ロードしない (DOM + CSS + Web Audio で完結)
 *  - bindings.js の startBtn 委譲は AppEasterGame.shouldIntercept() のみ判定
 */
(function initEasterGame() {
    // --- ゲーム設定 -------------------------------------------------------
    const GAME_DURATION_MS  = 90 * 1000;         // 90 秒一本勝負
    const PLAYER_RADIUS     = 10;                // 当たり判定半径
    const PLAYER_LERP       = 0.18;              // カーソル追従の追いつき係数
    const ENEMY_RADIUS      = 22;                // 敵 目 半径
    const CHASER_SPEED_START = 60;               // px/sec (序盤)
    const CHASER_SPEED_END   = 130;              // px/sec (終盤)
    const PROJECTILE_SPEED_START = 220;          // px/sec
    const PROJECTILE_SPEED_END   = 420;          // px/sec
    const PROJECTILE_RADIUS = 6;
    const ORB_RADIUS        = 14;
    const FIRE_INTERVAL_MS  = 1800;              // 各シューターの発射間隔
    const ENEMY_SPAWN_START_MS = 1500;
    const ENEMY_SPAWN_END_MS   = 500;
    const ORB_SPAWN_MS      = 3500;
    const HEART_CHANCE      = 0.10;              // 通常 orb のうちハートになる確率
    const FREEZE_CHANCE     = 0.08;              // 同 凍結 orb
    const FREEZE_DURATION_MS = 2000;
    const MAX_HP            = 3;
    const INVULN_MS         = 800;               // 被弾後の無敵時間
    const STORAGE_KEY       = 'gijiro:easter_high_score';

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

    // --- 軽量サウンド (Web Audio API, アセット無し) -------------------------
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
                    Math.max(40, slideTo), ctx.currentTime + durationMs / 1000
                );
            }
            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
        } catch (_) { /* ignore */ }
    }
    const sfx = {
        orb:    () => tone(660, 120, { type: 'triangle', volume: 0.08, slideTo: 990 }),
        heart:  () => { tone(523, 100, { type: 'sine', volume: 0.10 }); setTimeout(() => tone(784, 200, { type: 'sine', volume: 0.10 }), 100); },
        freeze: () => { tone(880, 60, { type: 'sine', volume: 0.10 }); setTimeout(() => tone(660, 60, { type: 'sine', volume: 0.10 }), 60); setTimeout(() => tone(440, 200, { type: 'sine', volume: 0.10 }), 120); },
        hit:    () => tone(180, 200, { type: 'sawtooth', volume: 0.12, slideTo: 60 }),
        fire:   () => tone(140, 60, { type: 'square', volume: 0.04 }),
        gameover: () => { tone(220, 300, { type: 'sawtooth', volume: 0.12, slideTo: 80 }); setTimeout(() => tone(110, 600, { type: 'sawtooth', volume: 0.10, slideTo: 55 }), 250); },
        clear:  () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 180, { type: 'triangle', volume: 0.10 }), i * 120)); }
    };

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
    function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

    function startGame() {
        if (gameState) return;
        const overlay = document.createElement('div');
        overlay.className = 'easter-game-overlay rite';
        overlay.innerHTML = `
            <div class="easter-game-hud">
                <div class="easter-game-stat"><span class="easter-game-label">HP</span><span class="easter-game-value" id="rite-hp">❤❤❤</span></div>
                <div class="easter-game-stat"><span class="easter-game-label">SCORE</span><span class="easter-game-value" id="rite-score">0</span></div>
                <div class="easter-game-stat"><span class="easter-game-label">COMBO</span><span class="easter-game-value" id="rite-combo">0</span></div>
                <div class="easter-game-stat"><span class="easter-game-label">TIME</span><span class="easter-game-value" id="rite-time">1:30</span></div>
                <button class="easter-game-quit" type="button">中断</button>
            </div>
            <div class="easter-game-arena" id="rite-arena">
                <div class="rite-player" id="rite-player"></div>
            </div>
            <div class="easter-game-banner" id="rite-banner">祓いの儀。生き残れ。</div>
            <div class="easter-game-end hidden" id="rite-end">
                <h2 id="rite-end-title">FINAL</h2>
                <p class="easter-game-final-score">最終スコア: <span id="rite-final-score">0</span></p>
                <p class="easter-game-high-msg" id="rite-high-score-msg"></p>
                <div class="rite-end-actions">
                    <button class="easter-game-close" id="rite-retry" type="button">もう一度</button>
                    <button class="easter-game-close" id="rite-quit" type="button">閉じる</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.classList.add('easter-game-active');

        const arena    = overlay.querySelector('#rite-arena');
        const playerEl = overlay.querySelector('#rite-player');
        const scoreEl  = overlay.querySelector('#rite-score');
        const comboEl  = overlay.querySelector('#rite-combo');
        const timeEl   = overlay.querySelector('#rite-time');
        const hpEl     = overlay.querySelector('#rite-hp');
        const banner   = overlay.querySelector('#rite-banner');
        const endPanel = overlay.querySelector('#rite-end');

        // 初期サイズ取得 (リサイズ追随も)
        let arenaRect = arena.getBoundingClientRect();
        const onResize = () => { arenaRect = arena.getBoundingClientRect(); };
        window.addEventListener('resize', onResize);

        gameState = {
            startedAt: Date.now(),
            lastFrame: performance.now(),
            ended: false,
            hp: MAX_HP,
            score: 0,
            combo: 0,
            maxCombo: 0,
            orbsCollected: 0,
            invulnUntil: 0,
            freezeUntil: 0,
            // entities
            player: { x: 0, y: 0, tx: 0, ty: 0 },
            enemies: [], projectiles: [], orbs: [],
            // timers
            nextEnemySpawn: 0,
            nextOrbSpawn: 1200,
            rafId: 0,
            overlay,
            // listeners we'll remove on quit
            _onResize: onResize,
            _onPointer: null
        };

        // プレイヤー初期位置 = アリーナ中央下
        gameState.player.x = arenaRect.width / 2;
        gameState.player.y = arenaRect.height * 0.75;
        gameState.player.tx = gameState.player.x;
        gameState.player.ty = gameState.player.y;

        setTimeout(() => { if (banner) banner.classList.add('fade'); }, 1600);

        // --- 入力 ---------------------------------------------------------
        const setTargetFromEvent = (clientX, clientY) => {
            const r = arena.getBoundingClientRect();
            const x = Math.max(PLAYER_RADIUS, Math.min(r.width - PLAYER_RADIUS, clientX - r.left));
            const y = Math.max(PLAYER_RADIUS, Math.min(r.height - PLAYER_RADIUS, clientY - r.top));
            gameState.player.tx = x;
            gameState.player.ty = y;
        };
        const onPointer = (ev) => {
            if (!gameState || gameState.ended) return;
            if (ev.touches && ev.touches.length > 0) {
                ev.preventDefault();
                setTargetFromEvent(ev.touches[0].clientX, ev.touches[0].clientY);
            } else {
                setTargetFromEvent(ev.clientX, ev.clientY);
            }
        };
        arena.addEventListener('mousemove', onPointer);
        arena.addEventListener('touchstart', onPointer, { passive: false });
        arena.addEventListener('touchmove', onPointer, { passive: false });
        gameState._onPointer = onPointer;

        // --- HUD 更新 -----------------------------------------------------
        function updateHUD() {
            scoreEl.textContent = gameState.score;
            comboEl.textContent = gameState.combo;
            if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
            hpEl.textContent = '❤'.repeat(Math.max(0, gameState.hp)) + '🖤'.repeat(MAX_HP - Math.max(0, gameState.hp));
        }
        updateHUD();

        // --- スポーン -----------------------------------------------------
        function getProgress() {
            return Math.min(1, (Date.now() - gameState.startedAt) / GAME_DURATION_MS);
        }

        function spawnEnemy() {
            const r = arenaRect;
            // 4 辺のどこかから出現
            const side = Math.floor(Math.random() * 4);
            let x = 0, y = 0;
            if (side === 0)      { x = Math.random() * r.width;  y = -ENEMY_RADIUS; }
            else if (side === 1) { x = Math.random() * r.width;  y = r.height + ENEMY_RADIUS; }
            else if (side === 2) { x = -ENEMY_RADIUS;            y = Math.random() * r.height; }
            else                  { x = r.width + ENEMY_RADIUS;  y = Math.random() * r.height; }

            // 30% で chaser、それ以外は shooter (端付近に居座って撃つ)
            const isChaser = Math.random() < 0.30 + getProgress() * 0.15;
            const el = document.createElement('div');
            el.className = `rite-enemy ${isChaser ? 'chaser' : 'shooter'}`;
            // 瞳孔エフェクト用に追加要素
            el.innerHTML = '<span class="rite-enemy-pupil"></span>';
            arena.appendChild(el);

            const enemy = {
                x, y, el,
                kind: isChaser ? 'chaser' : 'shooter',
                // shooter は外側からアリーナ内へ少しだけ入り、止まる位置を持つ
                targetX: side === 2 ? 30 + Math.random() * 60 :
                         side === 3 ? r.width - 30 - Math.random() * 60 :
                         x,
                targetY: side === 0 ? 30 + Math.random() * 60 :
                         side === 1 ? r.height - 30 - Math.random() * 60 :
                         y,
                nextFire: performance.now() + 800 + Math.random() * 800,
                hp: isChaser ? 1 : 1
            };
            gameState.enemies.push(enemy);
        }

        function spawnOrb() {
            const r = arenaRect;
            const margin = 40;
            const x = margin + Math.random() * Math.max(0, r.width - margin * 2);
            const y = margin + Math.random() * Math.max(0, r.height - margin * 2);
            const roll = Math.random();
            let kind = 'soul';
            if (roll < HEART_CHANCE)          kind = 'heart';
            else if (roll < HEART_CHANCE + FREEZE_CHANCE) kind = 'freeze';
            const el = document.createElement('div');
            el.className = `rite-orb ${kind}`;
            arena.appendChild(el);
            gameState.orbs.push({ x, y, el, kind, expiresAt: performance.now() + 7000 });
        }

        function spawnProjectile(fromX, fromY, toX, toY) {
            const dx = toX - fromX, dy = toY - fromY;
            const mag = Math.max(0.0001, Math.hypot(dx, dy));
            const speed = lerp(PROJECTILE_SPEED_START, PROJECTILE_SPEED_END, getProgress());
            const el = document.createElement('div');
            el.className = 'rite-bullet';
            arena.appendChild(el);
            gameState.projectiles.push({
                x: fromX, y: fromY,
                vx: dx / mag * speed,
                vy: dy / mag * speed,
                el
            });
            sfx.fire();
        }

        // --- エフェクト ---------------------------------------------------
        function burst(x, y, color, count = 8) {
            for (let i = 0; i < count; i += 1) {
                const p = document.createElement('div');
                p.className = 'easter-particle';
                p.style.left = x + 'px';
                p.style.top = y + 'px';
                p.style.background = color;
                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
                const d = 30 + Math.random() * 40;
                p.style.setProperty('--dx', `${Math.cos(angle) * d}px`);
                p.style.setProperty('--dy', `${Math.sin(angle) * d}px`);
                arena.appendChild(p);
                setTimeout(() => { if (p.parentNode) p.remove(); }, 700);
            }
        }
        function flash(kind) {
            document.body.classList.add(`easter-flash-${kind}`);
            setTimeout(() => document.body.classList.remove(`easter-flash-${kind}`), 280);
        }
        function shake() {
            arena.classList.add('shake');
            setTimeout(() => arena.classList.remove('shake'), 240);
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

        // --- 当たり判定 ---------------------------------------------------
        function tryDamagePlayer() {
            const now = performance.now();
            if (now < gameState.invulnUntil) return;
            gameState.hp -= 1;
            gameState.combo = 0;
            gameState.invulnUntil = now + INVULN_MS;
            playerEl.classList.add('hurt');
            setTimeout(() => playerEl.classList.remove('hurt'), INVULN_MS);
            flash('curse');
            shake();
            sfx.hit();
            updateHUD();
            if (gameState.hp <= 0) endGame(false);
        }

        function collectOrb(orb) {
            const p = gameState.player;
            if (orb.kind === 'heart') {
                if (gameState.hp < MAX_HP) gameState.hp += 1;
                showFloatingText(p.x, p.y, '+1 HP', 'heart');
                burst(orb.x, orb.y, '#ff4080', 10);
                flash('golden');
                sfx.heart();
            } else if (orb.kind === 'freeze') {
                gameState.freezeUntil = performance.now() + FREEZE_DURATION_MS;
                showFloatingText(p.x, p.y, 'FREEZE!', 'time');
                burst(orb.x, orb.y, '#66e8ff', 12);
                flash('time');
                sfx.freeze();
            } else {
                gameState.combo += 1;
                const bonus = Math.min(gameState.combo - 1, 19) * 5;
                const points = 100 + bonus;
                gameState.score += points;
                gameState.orbsCollected += 1;
                showFloatingText(p.x, p.y, `+${points}${bonus > 0 ? ` (×${gameState.combo})` : ''}`, 'hit');
                burst(orb.x, orb.y, '#ff3333', 8);
                sfx.orb();
            }
            updateHUD();
        }

        // --- メインループ -------------------------------------------------
        function frame(now) {
            if (!gameState || gameState.ended) return;
            const dt = Math.min(0.05, (now - gameState.lastFrame) / 1000); // sec, clamp 50ms
            gameState.lastFrame = now;

            // 時間切れ
            const elapsed = Date.now() - gameState.startedAt;
            const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
            if (remaining <= 0) { endGame(true); return; }
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
            if (remaining < 15000) timeEl.classList.add('low'); else timeEl.classList.remove('low');

            const progress = getProgress();
            const frozen = now < gameState.freezeUntil;

            // プレイヤー追従 (lerp)
            const p = gameState.player;
            p.x = lerp(p.x, p.tx, PLAYER_LERP);
            p.y = lerp(p.y, p.ty, PLAYER_LERP);
            playerEl.style.transform = `translate(${p.x - PLAYER_RADIUS}px, ${p.y - PLAYER_RADIUS}px)`;
            playerEl.classList.toggle('invuln', now < gameState.invulnUntil);

            // 敵処理
            const chaserSpeed = lerp(CHASER_SPEED_START, CHASER_SPEED_END, progress);
            for (let i = gameState.enemies.length - 1; i >= 0; i -= 1) {
                const e = gameState.enemies[i];
                if (frozen) {
                    e.el.classList.add('frozen');
                } else {
                    e.el.classList.remove('frozen');
                    if (e.kind === 'chaser') {
                        const dx = p.x - e.x, dy = p.y - e.y;
                        const mag = Math.hypot(dx, dy) || 0.001;
                        e.x += (dx / mag) * chaserSpeed * dt;
                        e.y += (dy / mag) * chaserSpeed * dt;
                    } else {
                        // 端から内側へ滑り込んで止まる
                        e.x = lerp(e.x, e.targetX, 0.05);
                        e.y = lerp(e.y, e.targetY, 0.05);
                        if (now >= e.nextFire) {
                            spawnProjectile(e.x, e.y, p.x, p.y);
                            e.nextFire = now + FIRE_INTERVAL_MS;
                        }
                    }
                }
                // 瞳孔をプレイヤー方向へ
                const dx = p.x - e.x, dy = p.y - e.y;
                const mag = Math.hypot(dx, dy) || 0.001;
                const px = (dx / mag) * 6;
                const py = (dy / mag) * 6;
                e.el.style.setProperty('--px', `${px}px`);
                e.el.style.setProperty('--py', `${py}px`);
                e.el.style.transform = `translate(${e.x - ENEMY_RADIUS}px, ${e.y - ENEMY_RADIUS}px)`;

                // プレイヤー衝突 (chaser)
                if (e.kind === 'chaser') {
                    const sumR = PLAYER_RADIUS + ENEMY_RADIUS;
                    if (dist2(p, e) < sumR * sumR) tryDamagePlayer();
                }
            }

            // 弾の更新
            for (let i = gameState.projectiles.length - 1; i >= 0; i -= 1) {
                const b = gameState.projectiles[i];
                if (!frozen) {
                    b.x += b.vx * dt;
                    b.y += b.vy * dt;
                }
                b.el.style.transform = `translate(${b.x - PROJECTILE_RADIUS}px, ${b.y - PROJECTILE_RADIUS}px)`;
                // アリーナ外に出たら除去
                if (b.x < -20 || b.y < -20 || b.x > arenaRect.width + 20 || b.y > arenaRect.height + 20) {
                    b.el.remove();
                    gameState.projectiles.splice(i, 1);
                    continue;
                }
                // プレイヤー衝突
                const sumR = PLAYER_RADIUS + PROJECTILE_RADIUS;
                if (dist2(p, b) < sumR * sumR) {
                    b.el.remove();
                    gameState.projectiles.splice(i, 1);
                    tryDamagePlayer();
                }
            }

            // オーブ
            for (let i = gameState.orbs.length - 1; i >= 0; i -= 1) {
                const o = gameState.orbs[i];
                o.el.style.transform = `translate(${o.x - ORB_RADIUS}px, ${o.y - ORB_RADIUS}px)`;
                const sumR = PLAYER_RADIUS + ORB_RADIUS;
                if (dist2(p, o) < sumR * sumR) {
                    o.el.remove();
                    gameState.orbs.splice(i, 1);
                    collectOrb(o);
                    continue;
                }
                if (now >= o.expiresAt) {
                    o.el.classList.add('fade');
                    setTimeout(() => { if (o.el.parentNode) o.el.remove(); }, 300);
                    gameState.orbs.splice(i, 1);
                }
            }

            // スポーン
            if (now >= gameState.nextEnemySpawn) {
                spawnEnemy();
                const interval = lerp(ENEMY_SPAWN_START_MS, ENEMY_SPAWN_END_MS, progress);
                gameState.nextEnemySpawn = now + interval + (Math.random() * 400 - 200);
            }
            if (now >= gameState.nextOrbSpawn) {
                spawnOrb();
                gameState.nextOrbSpawn = now + ORB_SPAWN_MS + (Math.random() * 1500);
            }

            gameState.rafId = requestAnimationFrame(frame);
        }

        async function endGame(cleared) {
            if (!gameState || gameState.ended) return;
            gameState.ended = true;
            if (gameState.rafId) cancelAnimationFrame(gameState.rafId);
            // 残った弾と敵を消す
            [...gameState.projectiles, ...gameState.enemies, ...gameState.orbs].forEach((x) => x.el.remove());
            gameState.projectiles = [];
            gameState.enemies = [];
            gameState.orbs = [];

            const survivedMs = Math.min(GAME_DURATION_MS, Date.now() - gameState.startedAt);
            const survivalBonus = Math.floor(survivedMs / 1000) * 10;
            const clearBonus = cleared ? 500 : 0;
            const finalScore = gameState.score + survivalBonus + clearBonus;

            overlay.querySelector('#rite-end-title').textContent = cleared ? 'SURVIVED' : 'DEFEATED';
            overlay.querySelector('#rite-final-score').textContent = finalScore;
            const highMsg = overlay.querySelector('#rite-high-score-msg');
            const stats = `生存ボーナス +${survivalBonus} / オーブ ${gameState.orbsCollected} / 最大コンボ ${gameState.maxCombo}${cleared ? ' / クリア +500' : ''}`;
            highMsg.textContent = '記録を送信中... ' + stats;
            endPanel.classList.remove('hidden');
            if (cleared) sfx.clear(); else sfx.gameover();

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

        function cleanupGame() {
            if (!gameState) return;
            if (gameState.rafId) cancelAnimationFrame(gameState.rafId);
            window.removeEventListener('resize', gameState._onResize);
            if (gameState.overlay && gameState.overlay.parentNode) gameState.overlay.remove();
            document.body.classList.remove('easter-game-active');
            try { if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); } catch (_) { /* ignore */ }
            audioCtx = null;
            gameState = null;
        }

        overlay.querySelector('.easter-game-quit').addEventListener('click', () => {
            if (confirm('儀式を中断しますか？スコアは保存されません。')) cleanupGame();
        });
        overlay.querySelector('#rite-quit').addEventListener('click', cleanupGame);
        overlay.querySelector('#rite-retry').addEventListener('click', () => {
            cleanupGame();
            // 同期的に再起動
            setTimeout(startGame, 50);
        });

        gameState.nextEnemySpawn = performance.now() + 700;
        gameState.rafId = requestAnimationFrame(frame);
    }

    window.AppEasterGame = {
        startGame,
        shouldIntercept,
        isRedThemeActive,
        isAuthenticated
    };
})();
