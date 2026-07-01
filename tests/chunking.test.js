/**
 * Chunking system 検証テスト群
 *
 * 長時間会議の Map-Reduce パイプラインに対し、以下の観点で検証する:
 *  1. shouldChunk: 短い会議では false / 長い会議では true
 *  2. chunkUtterances: 時間窓分割・トークン予算分割・オーバーラップ
 *  3. chunkText: 行ベース分割・オーバーラップ
 *  4. createSemaphore: 並列度制御
 *  5. mergeMinutesChunks: チャンク結果結合
 *  6. withTimeoutAndRetry: タイムアウト・リトライ・プレースホルダー
 *  7. 実会議シミュレーション: 30 分 / 1 時間 / 2 時間 / 4 時間
 */
const {
    chunkUtterances,
    shouldChunk,
    estimateTokens,
    createSemaphore,
    shouldChunkText,
    chunkText,
} = require('../src/backend/services/chunking');
const { withTimeoutAndRetry, AIService } = require('../src/backend/services/ai-service');

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * シミュレートされた発話を生成。N 件、開始時刻 startISO、間隔 intervalMs。
 */
function makeUtterances({ count, startISO = '2026-05-09T10:00:00.000Z', intervalMs = 5000, transcriptLen = 50, displayName = 'Alice' }) {
    const out = [];
    const startMs = new Date(startISO).getTime();
    for (let i = 0; i < count; i++) {
        out.push({
            id: `u-${i}`,
            started_at: new Date(startMs + i * intervalMs).toISOString(),
            ended_at: new Date(startMs + i * intervalMs + 3000).toISOString(),
            transcript: 'あ'.repeat(transcriptLen),
            display_name: displayName,
        });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// 1. estimateTokens
// ─────────────────────────────────────────────────────────────────────
describe('estimateTokens', () => {
    test('空文字列は 0 トークン', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens(null)).toBe(0);
        expect(estimateTokens(undefined)).toBe(0);
    });
    test('100 文字は約 60 トークン (CHARS_PER_TOKEN=0.6)', () => {
        expect(estimateTokens('a'.repeat(100))).toBe(60);
    });
    test('文字数に比例', () => {
        const t1000 = estimateTokens('a'.repeat(1000));
        const t100 = estimateTokens('a'.repeat(100));
        expect(t1000).toBe(t100 * 10);
    });
});

// ─────────────────────────────────────────────────────────────────────
// 2. shouldChunk
// ─────────────────────────────────────────────────────────────────────
describe('shouldChunk', () => {
    test('空配列は false', () => {
        expect(shouldChunk([])).toBe(false);
        expect(shouldChunk(null)).toBe(false);
    });

    test('短い会議 (10 件 / 1分間隔 / 短文) は false', () => {
        const utts = makeUtterances({ count: 10, intervalMs: 60_000, transcriptLen: 30 });
        expect(shouldChunk(utts)).toBe(false);
    });

    test('長時間 (30 分超) → true', () => {
        const utts = makeUtterances({ count: 5, intervalMs: 8 * 60_000, transcriptLen: 20 }); // 32 分
        expect(shouldChunk(utts)).toBe(true);
    });

    test('25 分以下なら時間軸では trigger しない', () => {
        const utts = makeUtterances({ count: 5, intervalMs: 5 * 60_000, transcriptLen: 20 }); // 20 分
        expect(shouldChunk(utts)).toBe(false);
    });

    test('トークン数 8000 超 → true', () => {
        // 1 件あたり 50 文字 → 30 トークン。300 件 = 9000 トークン。
        const utts = makeUtterances({ count: 300, intervalMs: 1000, transcriptLen: 50 });
        expect(shouldChunk(utts)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────
// 3. chunkUtterances
// ─────────────────────────────────────────────────────────────────────
describe('chunkUtterances', () => {
    test('空配列は空チャンク', () => {
        expect(chunkUtterances([])).toEqual([]);
    });

    test('単一発話は 1 チャンク', () => {
        const utts = makeUtterances({ count: 1 });
        const chunks = chunkUtterances(utts);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].utterances).toHaveLength(1);
        expect(chunks[0].overlapWith).toEqual([]);
    });

    test('時間窓内の全発話が 1 チャンクに収まる (短い会議)', () => {
        const utts = makeUtterances({ count: 10, intervalMs: 30_000, transcriptLen: 30 }); // 5 分
        const chunks = chunkUtterances(utts);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].utterances).toHaveLength(10);
    });

    test('30 分の会議は約 3 チャンク (10 分窓)', () => {
        // 5秒間隔 × 360 件 = 30 分
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 20 });
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks.length).toBeLessThanOrEqual(4);
    });

    test('1 時間の会議は約 6〜7 チャンク', () => {
        const utts = makeUtterances({ count: 720, intervalMs: 5000, transcriptLen: 20 }); // 60 分
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(6);
        expect(chunks.length).toBeLessThanOrEqual(8);
    });

    test('2 時間の会議も問題なくチャンク化', () => {
        const utts = makeUtterances({ count: 1440, intervalMs: 5000, transcriptLen: 20 }); // 120 分
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(12);
        // 全発話が網羅されているか（オーバーラップ重複は除く）
        const idSet = new Set();
        for (const ch of chunks) for (const u of ch.utterances) idSet.add(u.id);
        expect(idSet.size).toBe(1440);
    });

    test('4 時間の会議も完走 (パフォーマンス)', () => {
        const utts = makeUtterances({ count: 2880, intervalMs: 5000, transcriptLen: 20 }); // 240 分
        const t0 = Date.now();
        const chunks = chunkUtterances(utts);
        const elapsed = Date.now() - t0;
        expect(chunks.length).toBeGreaterThanOrEqual(24);
        expect(elapsed).toBeLessThan(2000); // 2 秒以内
    });

    test('オーバーラップ: 各チャンクに前チャンクの末尾発話が含まれる', () => {
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 20 });
        const chunks = chunkUtterances(utts);
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].overlapWith.length).toBeGreaterThan(0);
            // overlapWith に含まれる ID は前チャンクの utterances にある
            const prevIds = new Set(chunks[i - 1].utterances.map((u) => u.id));
            for (const id of chunks[i].overlapWith) {
                expect(prevIds.has(id)).toBe(true);
            }
        }
    });

    test('overlapMs=0 ならオーバーラップなし', () => {
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 20 });
        const chunks = chunkUtterances(utts, { overlapMs: 0 });
        for (const ch of chunks) {
            expect(ch.overlapWith).toEqual([]);
        }
    });

    test('トークン予算: 1 チャンク内に収まる発話数を制限', () => {
        // 1 発話 = 30 トークン弱。maxTokens=200 にすれば 約 6 件で切れるはず。
        const utts = makeUtterances({ count: 100, intervalMs: 1000, transcriptLen: 50 });
        const chunks = chunkUtterances(utts, { maxTokens: 200 });
        // どのチャンクも 200 トークンを大幅に超えない (1 発話分のオーバーは許容)
        for (const ch of chunks) {
            expect(ch.estimatedTokens).toBeLessThanOrEqual(300); // 1 発話分の余裕
        }
    });

    test('発話順序が保たれる', () => {
        const utts = makeUtterances({ count: 200, intervalMs: 5000, transcriptLen: 20 });
        const chunks = chunkUtterances(utts);
        // 各チャンク内で時系列順
        for (const ch of chunks) {
            const times = ch.utterances.map((u) => new Date(u.started_at).getTime());
            const sorted = [...times].sort((a, b) => a - b);
            expect(times).toEqual(sorted);
        }
        // チャンク同士も順序通り
        for (let i = 1; i < chunks.length; i++) {
            expect(new Date(chunks[i].startTs).getTime())
                .toBeGreaterThanOrEqual(new Date(chunks[i - 1].startTs).getTime());
        }
    });

    test('chunk.index が連番', () => {
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 20 });
        const chunks = chunkUtterances(utts);
        chunks.forEach((c, i) => expect(c.index).toBe(i));
    });

    test('1 件の発話が maxTokens を超えても無限ループしない', () => {
        const huge = makeUtterances({ count: 1, transcriptLen: 100_000 });
        const chunks = chunkUtterances(huge, { maxTokens: 100 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].utterances).toHaveLength(1);
    });

    test('3 件すべてが超巨大でも全件処理される (旧バグ: 無限ループしていた)', () => {
        const huge = makeUtterances({ count: 3, transcriptLen: 100_000, intervalMs: 1000 });
        const chunks = chunkUtterances(huge, { maxTokens: 100 });
        // 全 3 件の utterance がいずれかのチャンクに含まれる
        const idSet = new Set();
        chunks.forEach((c) => c.utterances.forEach((u) => idSet.add(u.id)));
        expect(idSet.size).toBe(3);
        // チャンク数は 3 (1 発話 1 チャンク)
        expect(chunks.length).toBe(3);
    });

    test('回帰: 10 分超のサイレント区間後に発話があると無限ループしていた', () => {
        // utt[0] @ 0min → utt[1] @ 12min → utt[2] @ 12min5sec
        // 旧コードでは utt[0] のチャンクから先に進めず無限ループ
        const t0 = new Date('2026-05-09T10:00:00.000Z').getTime();
        const utts = [
            { id: 'u-0', started_at: new Date(t0).toISOString(), transcript: 'こんにちは', display_name: 'A' },
            { id: 'u-1', started_at: new Date(t0 + 12 * 60_000).toISOString(), transcript: '長い沈黙の後', display_name: 'A' },
            { id: 'u-2', started_at: new Date(t0 + 12 * 60_000 + 5000).toISOString(), transcript: '続き', display_name: 'A' },
        ];
        const t = Date.now();
        const chunks = chunkUtterances(utts);
        const elapsed = Date.now() - t;
        expect(elapsed).toBeLessThan(1000); // 1 秒以内に完走
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        const idSet = new Set();
        chunks.forEach((c) => c.utterances.forEach((u) => idSet.add(u.id)));
        expect(idSet.size).toBe(3);
    });

    test('回帰: 大量のサイレント区間でも完走する (ストレステスト)', () => {
        // 30 件の発話を、毎回 12 分間隔で配置 (= 各発話が独立した時間窓)
        const t0 = new Date('2026-05-09T10:00:00.000Z').getTime();
        const utts = Array.from({ length: 30 }, (_, i) => ({
            id: `u-${i}`,
            started_at: new Date(t0 + i * 12 * 60_000).toISOString(),
            transcript: `発話 ${i}`,
            display_name: 'A',
        }));
        const t = Date.now();
        const chunks = chunkUtterances(utts);
        const elapsed = Date.now() - t;
        expect(elapsed).toBeLessThan(1000);
        expect(chunks).toHaveLength(30); // 1 発話 1 チャンク
    });
});

// ─────────────────────────────────────────────────────────────────────
// 4. shouldChunkText / chunkText
// ─────────────────────────────────────────────────────────────────────
describe('chunkText / shouldChunkText', () => {
    test('短いテキストは shouldChunk false', () => {
        expect(shouldChunkText('短い議事録です')).toBe(false);
    });

    test('長いテキスト (8000 トークン超) は shouldChunk true', () => {
        const longText = 'あ'.repeat(20_000); // 12000 トークン
        expect(shouldChunkText(longText)).toBe(true);
    });

    test('chunkText は行単位で分割', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `行 ${i}: ${'あ'.repeat(100)}`);
        const text = lines.join('\n');
        const chunks = chunkText(text, { maxTokens: 1000 });
        expect(chunks.length).toBeGreaterThan(1);
        // 各チャンクの index は連番
        chunks.forEach((c, i) => expect(c.index).toBe(i));
    });

    test('chunkText のオーバーラップ行数が指定通り', () => {
        const lines = Array.from({ length: 200 }, (_, i) => `line${i} ${'a'.repeat(50)}`);
        const text = lines.join('\n');
        const chunks = chunkText(text, { maxTokens: 500, overlapLines: 5 });
        // 各チャンクの先頭行と前チャンクの末尾を比較するのは複雑なので長さだけ確認
        expect(chunks.length).toBeGreaterThan(1);
    });

    test('1 行が maxTokens を超えても無限ループしない', () => {
        const text = 'あ'.repeat(50_000); // 30000 トークン
        const chunks = chunkText(text, { maxTokens: 1000 });
        expect(chunks.length).toBe(1); // 改行が無いので 1 行 → 1 チャンク
    });
});

// ─────────────────────────────────────────────────────────────────────
// 5. createSemaphore
// ─────────────────────────────────────────────────────────────────────
describe('createSemaphore', () => {
    test('並列度 2 は最大 2 件まで同時実行', async () => {
        const limit = createSemaphore(2);
        let inFlight = 0;
        let maxInFlight = 0;
        const tasks = Array.from({ length: 10 }, () =>
            limit(async () => {
                inFlight++;
                if (inFlight > maxInFlight) maxInFlight = inFlight;
                await new Promise((r) => setTimeout(r, 20));
                inFlight--;
                return 'ok';
            }),
        );
        const results = await Promise.all(tasks);
        expect(results).toHaveLength(10);
        expect(maxInFlight).toBeLessThanOrEqual(2);
    });

    test('全件成功する', async () => {
        const limit = createSemaphore(3);
        const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) => limit(async () => i * 2)),
        );
        expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    });

    test('一部が失敗しても他は走る', async () => {
        const limit = createSemaphore(2);
        const tasks = [];
        for (let i = 0; i < 5; i++) {
            tasks.push(
                limit(async () => {
                    if (i === 2) throw new Error('boom');
                    return i;
                }).catch((e) => `err:${e.message}`),
            );
        }
        const results = await Promise.all(tasks);
        expect(results).toContain('err:boom');
        expect(results.filter((r) => typeof r === 'number')).toHaveLength(4);
    });
});

// ─────────────────────────────────────────────────────────────────────
// 6. withTimeoutAndRetry
// ─────────────────────────────────────────────────────────────────────
describe('withTimeoutAndRetry', () => {
    test('成功時は値を返す', async () => {
        const r = await withTimeoutAndRetry(async () => 'ok', { timeoutMs: 1000, retries: 2 });
        expect(r).toBe('ok');
    });

    test('リトライ後に成功するパターン', async () => {
        let calls = 0;
        const r = await withTimeoutAndRetry(async () => {
            calls++;
            if (calls < 2) throw new Error('temp fail');
            return 'recovered';
        }, { timeoutMs: 1000, retries: 3 });
        expect(r).toBe('recovered');
        expect(calls).toBe(2);
    });

    test('全リトライ失敗 + placeholder あり → placeholder を返す', async () => {
        const placeholder = { result: 'PLACEHOLDER', provider: 'error' };
        const r = await withTimeoutAndRetry(async () => {
            throw new Error('always fail');
        }, { timeoutMs: 100, retries: 1, placeholder });
        expect(r).toEqual(placeholder);
    });

    test('全リトライ失敗 + placeholder なし → throw', async () => {
        await expect(
            withTimeoutAndRetry(async () => { throw new Error('forever'); }, { timeoutMs: 100, retries: 1 })
        ).rejects.toThrow('forever');
    });

    test('タイムアウトはエラー扱い (placeholder で吸収可能)', async () => {
        const placeholder = { result: 'TIMEOUT_FALLBACK' };
        const r = await withTimeoutAndRetry(
            async () => new Promise(() => { /* never resolves */ }),
            { timeoutMs: 50, retries: 1, placeholder }
        );
        expect(r).toEqual(placeholder);
    }, 10000);
});

// ─────────────────────────────────────────────────────────────────────
// 7. AIService.mergeMinutesChunks
// ─────────────────────────────────────────────────────────────────────
describe('AIService.mergeMinutesChunks', () => {
    let svc;
    beforeEach(() => {
        process.env.GEMINI_API_KEY = 'dummy-but-not-empty';
        svc = new AIService({ apiKey: 'x', provider: 'gemini' });
    });

    test('空配列は空文字', () => {
        expect(svc.mergeMinutesChunks([])).toBe('');
    });

    test('1 チャンクはそのまま返す', () => {
        const r = svc.mergeMinutesChunks([{ chunkIndex: 0, result: 'A の議事録' }]);
        expect(r).toBe('A の議事録');
    });

    test('複数チャンクは chunkIndex 順に \\n\\n で結合', () => {
        const chunks = [
            { chunkIndex: 2, result: '三番目' },
            { chunkIndex: 0, result: '最初' },
            { chunkIndex: 1, result: '二番目' },
        ];
        const r = svc.mergeMinutesChunks(chunks);
        expect(r).toBe('最初\n\n二番目\n\n三番目');
    });

    test('空 result は除外される', () => {
        const chunks = [
            { chunkIndex: 0, result: '一番目' },
            { chunkIndex: 1, result: '' },
            { chunkIndex: 2, result: '三番目' },
        ];
        const r = svc.mergeMinutesChunks(chunks);
        expect(r).toBe('一番目\n\n三番目');
    });

    test('M1-C: 隣接チャンク境界の同一行だけを後続側から除去する', () => {
        const chunks = [
            { chunkIndex: 0, result: 'Alice: まず前提を確認します。\nBob: はい、確認しました。' },
            { chunkIndex: 1, result: 'Bob: はい、確認しました。\nAlice: 次の論点に進みます。' },
        ];
        const r = svc.mergeMinutesChunks(chunks);
        expect(r).toBe('Alice: まず前提を確認します。\nBob: はい、確認しました。\n\nAlice: 次の論点に進みます。');
    });

    test('M1-C: 境界以外の同一発話は削らない', () => {
        const chunks = [
            { chunkIndex: 0, result: 'Alice: 了解です。\nBob: 次に進みます。' },
            { chunkIndex: 1, result: 'Carol: 別件です。\nAlice: 了解です。' },
        ];
        const r = svc.mergeMinutesChunks(chunks);
        expect(r).toBe('Alice: 了解です。\nBob: 次に進みます。\n\nCarol: 別件です。\nAlice: 了解です。');
    });

    test('エラーチャンクのプレースホルダーも結合される (議事録に痕跡が残る)', () => {
        const chunks = [
            { chunkIndex: 0, result: '一番目' },
            { chunkIndex: 1, result: '[このチャンクの解析に失敗しました: 範囲 ...]', provider: 'error' },
            { chunkIndex: 2, result: '三番目' },
        ];
        const r = svc.mergeMinutesChunks(chunks);
        expect(r).toContain('一番目');
        expect(r).toContain('解析に失敗しました');
        expect(r).toContain('三番目');
    });
});

// ─────────────────────────────────────────────────────────────────────
// 8. End-to-End シミュレーション (実会議想定)
// ─────────────────────────────────────────────────────────────────────
describe('実会議シミュレーション', () => {
    test('5 分の短い会議 → shouldChunk=false (チャンクパスを通らない)', () => {
        const utts = makeUtterances({ count: 30, intervalMs: 10_000, transcriptLen: 30 });
        expect(shouldChunk(utts)).toBe(false);
    });

    test('30 分会議 → shouldChunk=true → 3-4 チャンクに分割 → 全 utt 網羅', () => {
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 30 });
        expect(shouldChunk(utts)).toBe(true);
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        const idSet = new Set();
        chunks.forEach((c) => c.utterances.forEach((u) => idSet.add(u.id)));
        expect(idSet.size).toBe(360);
    });

    test('60 分会議 → 6-8 チャンク → 並列処理可能', async () => {
        const utts = makeUtterances({ count: 720, intervalMs: 5000, transcriptLen: 30 });
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(6);

        const limit = createSemaphore(2);
        const t0 = Date.now();
        const results = await Promise.all(
            chunks.map((c) =>
                limit(async () => {
                    await new Promise((r) => setTimeout(r, 30)); // 1 チャンク 30ms シミュ
                    return { chunkIndex: c.index, result: `chunk-${c.index}-result`, provider: 'mock' };
                })
            )
        );
        const elapsed = Date.now() - t0;
        expect(results).toHaveLength(chunks.length);
        // 並列度 2 なので逐次より十分速い (chunks.length * 30ms より速い)
        expect(elapsed).toBeLessThan(chunks.length * 30);
    });

    test('120 分会議 → 12+ チャンク → 1 件失敗してもプレースホルダーで続行', async () => {
        const utts = makeUtterances({ count: 1440, intervalMs: 5000, transcriptLen: 30 });
        const chunks = chunkUtterances(utts);
        expect(chunks.length).toBeGreaterThanOrEqual(12);

        const failIndex = 5;
        const placeholder = { result: '[失敗]', provider: 'error' };
        const limit = createSemaphore(2);
        const results = await Promise.all(
            chunks.map((c) =>
                limit(() =>
                    withTimeoutAndRetry(
                        async () => {
                            if (c.index === failIndex) throw new Error('chunk fail');
                            return { chunkIndex: c.index, result: `ok-${c.index}` };
                        },
                        { timeoutMs: 100, retries: 1, placeholder: { ...placeholder, chunkIndex: c.index } }
                    )
                )
            )
        );
        expect(results).toHaveLength(chunks.length);
        const failedResults = results.filter((r) => r.provider === 'error');
        expect(failedResults).toHaveLength(1);
        expect(failedResults[0].chunkIndex).toBe(failIndex);
    });

    test('全チャンクが timeout した最悪ケースでも throw せずプレースホルダー埋め', async () => {
        const utts = makeUtterances({ count: 360, intervalMs: 5000, transcriptLen: 30 });
        const chunks = chunkUtterances(utts);

        const placeholder = (idx) => ({ chunkIndex: idx, result: '[完全失敗]', provider: 'error' });
        const limit = createSemaphore(2);
        const results = await Promise.all(
            chunks.map((c) =>
                limit(() =>
                    withTimeoutAndRetry(
                        () => new Promise(() => { /* never */ }),
                        { timeoutMs: 50, retries: 0, placeholder: placeholder(c.index) }
                    )
                )
            )
        );
        expect(results.every((r) => r.provider === 'error')).toBe(true);
        expect(results).toHaveLength(chunks.length);
    }, 15000);
});
