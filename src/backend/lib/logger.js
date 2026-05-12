/**
 * 構造化ログ — Cloud Logging / Cloud Error Reporting 対応
 *
 * Cloud Run 上では stdout の JSON が Cloud Logging に自動取り込まれる。
 * 'severity' は Cloud Logging の予約フィールド。
 * 'message' と 'stack' は Cloud Error Reporting が自動検知するフィールド。
 *
 * 使い方:
 *   const { logger } = require('./lib/logger');
 *   logger.info('ルーム作成', { roomId, accountId });
 *   logger.warn('キャッシュミス', { key });
 *   logger.error(new Error('DB接続失敗'), { route: '/rooms', requestId });
 */

function emit(severity, message, ctx) {
    const entry = Object.assign({ severity, message }, ctx || {});
    const line = JSON.stringify(entry);
    if (severity === 'ERROR' || severity === 'CRITICAL') {
        console.error(line);
    } else if (severity === 'WARNING') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

function buildError(err, ctx) {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack, ...ctx };
    }
    return { message: String(err), ...ctx };
}

const logger = {
    info: (msg, ctx) => emit('INFO', msg, ctx),
    warn: (msg, ctx) => emit('WARNING', msg, ctx),
    error: (err, ctx) => emit('ERROR', String((err && err.message) || err), buildError(err, ctx))
};

module.exports = { logger };
