'use strict';

/**
 * 長時間会議の Map-Reduce パイプライン向けチャンキングユーティリティ。
 *
 * chunkUtterances()  — utterances 配列を「時間窓 + トークン予算」で分割
 * shouldChunk()      — 閾値チェック（短い会議は従来 1 パスで十分）
 * createSemaphore()  — 並列度制御（pLimit 相当のシンプル実装）
 */

// 日本語 1 文字 ≈ 0.5〜0.6 トークン。粗い推定で十分。
const CHARS_PER_TOKEN = 0.6;

/**
 * テキストのトークン数を推定する。
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    return Math.ceil((text || '').length * CHARS_PER_TOKEN);
}

/**
 * utterances 配列を時間窓 + トークン予算で分割する。
 *
 * @param {Array<{id:string, started_at:string, transcript:string, display_name?:string}>} utterances
 * @param {object} [opts]
 * @param {number} [opts.windowMs=600000]    チャンクの最大時間幅 (ms)。デフォルト 10 分。
 * @param {number} [opts.maxTokens=6000]     チャンクの最大推定トークン数。
 * @param {number} [opts.overlapMs=30000]    前チャンクとの重複時間 (ms)。デフォルト 30 秒。
 * @returns {Array<{
 *   index: number,
 *   startTs: string,
 *   endTs: string,
 *   utterances: Array,
 *   estimatedTokens: number,
 *   overlapWith: string[]   // 前チャンクと共有する utterance ID
 * }>}
 */
function chunkUtterances(utterances, opts = {}) {
    const {
        windowMs = 10 * 60 * 1000,
        maxTokens = 6000,
        overlapMs = 30 * 1000,
    } = opts;

    if (!utterances || utterances.length === 0) return [];

    const chunks = [];
    let chunkStart = 0; // utterances 配列内のインデックス

    while (chunkStart < utterances.length) {
        const firstUtt = utterances[chunkStart];
        const windowStartMs = new Date(firstUtt.started_at).getTime();
        const windowEndMs = windowStartMs + windowMs;

        let tokenAccum = 0;
        let chunkEnd = chunkStart; // exclusive end index

        while (chunkEnd < utterances.length) {
            const utt = utterances[chunkEnd];
            const uttMs = new Date(utt.started_at).getTime();

            // 時間窓オーバー
            if (uttMs >= windowEndMs) break;

            const uttTokens = estimateTokens(`${utt.display_name || ''}: ${utt.transcript || ''}`);

            // トークン予算オーバー（すでに 1 件以上入っていれば切る）
            if (tokenAccum + uttTokens > maxTokens && chunkEnd > chunkStart) break;

            tokenAccum += uttTokens;
            chunkEnd++;
        }

        // 少なくとも 1 件は入れる
        if (chunkEnd === chunkStart) chunkEnd = chunkStart + 1;

        const chunkUtts = utterances.slice(chunkStart, chunkEnd);

        // 前チャンクとの重複 ID を収集（オーバーラップ範囲）
        const overlapWith = [];
        if (chunks.length > 0 && overlapMs > 0) {
            const prevChunk = chunks[chunks.length - 1];
            const overlapCutMs = new Date(chunkUtts[0].started_at).getTime() + overlapMs;
            for (const u of prevChunk.utterances) {
                if (new Date(u.started_at).getTime() < overlapCutMs) {
                    overlapWith.push(u.id);
                }
            }
        }

        chunks.push({
            index: chunks.length,
            startTs: chunkUtts[0].started_at,
            endTs: chunkUtts[chunkUtts.length - 1].started_at,
            utterances: chunkUtts,
            estimatedTokens: tokenAccum,
            overlapWith,
        });

        // 次チャンクの開始位置: オーバーラップ分だけ巻き戻す
        if (overlapMs > 0 && chunkEnd < utterances.length) {
            const overlapCutMs =
                new Date(utterances[chunkEnd - 1].started_at).getTime() - overlapMs;
            let overlapStart = chunkEnd - 1;
            while (overlapStart > chunkStart &&
                   new Date(utterances[overlapStart - 1].started_at).getTime() >= overlapCutMs) {
                overlapStart--;
            }
            chunkStart = overlapStart;
        } else {
            chunkStart = chunkEnd;
        }
    }

    return chunks;
}

/**
 * utterances 配列がチャンク分割を必要とする規模か判定する。
 *
 * @param {Array} utterances
 * @param {object} [opts]
 * @param {number} [opts.tokenThreshold=8000]  推定トークン数の閾値
 * @param {number} [opts.durationThresholdMs]  会議時間の閾値 (ms)。デフォルト 25 分。
 * @returns {boolean}
 */
function shouldChunk(utterances, opts = {}) {
    const {
        tokenThreshold = 8000,
        durationThresholdMs = 25 * 60 * 1000,
    } = opts;

    if (!utterances || utterances.length === 0) return false;

    const totalTokens = utterances.reduce(
        (acc, u) => acc + estimateTokens(`${u.display_name || ''}: ${u.transcript || ''}`),
        0,
    );
    if (totalTokens > tokenThreshold) return true;

    const firstMs = new Date(utterances[0].started_at).getTime();
    const lastMs = new Date(utterances[utterances.length - 1].started_at).getTime();
    if (lastMs - firstMs > durationThresholdMs) return true;

    return false;
}

/**
 * 並列度を制限するシンプルなセマフォ（pLimit 相当）。
 *
 * @param {number} concurrency
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 *
 * @example
 * const limit = createSemaphore(2);
 * await Promise.all(chunks.map(c => limit(() => processChunk(c))));
 */
function createSemaphore(concurrency) {
    let active = 0;
    const queue = [];

    const next = () => {
        if (queue.length === 0 || active >= concurrency) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
                active--;
                next();
            });
    };

    return (fn) =>
        new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            next();
        });
}

/**
 * テキスト文字列がチャンク分割を必要とする規模か判定する。
 * summary / todo / custom の議事録入力が長すぎる場合の検出に使う。
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.tokenThreshold=8000]
 * @returns {boolean}
 */
function shouldChunkText(text, opts = {}) {
    const { tokenThreshold = 8000 } = opts;
    return estimateTokens(text || '') > tokenThreshold;
}

/**
 * 長いテキストを行単位でチャンク分割する。
 * summary / todo / custom の Map-Reduce 向け。
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=6000]  チャンクあたりの最大推定トークン数
 * @param {number} [opts.overlapLines=10] 前チャンクとの重複行数
 * @returns {Array<{ index: number, text: string, estimatedTokens: number }>}
 */
function chunkText(text, opts = {}) {
    const { maxTokens = 6000, overlapLines = 10 } = opts;
    const lines = (text || '').split('\n');
    const chunks = [];
    let start = 0;

    while (start < lines.length) {
        let tokenAccum = 0;
        let end = start;

        while (end < lines.length) {
            const lineTokens = estimateTokens(lines[end]);
            if (tokenAccum + lineTokens > maxTokens && end > start) break;
            tokenAccum += lineTokens;
            end++;
        }
        // 少なくとも 1 行は入れる
        if (end === start) end = start + 1;

        chunks.push({
            index: chunks.length,
            text: lines.slice(start, end).join('\n'),
            estimatedTokens: tokenAccum,
        });

        // 次の開始位置: オーバーラップ分巻き戻す
        const step = Math.max(1, end - start - overlapLines);
        start = start + step;
    }

    return chunks;
}

module.exports = { chunkUtterances, shouldChunk, estimateTokens, createSemaphore, shouldChunkText, chunkText };
