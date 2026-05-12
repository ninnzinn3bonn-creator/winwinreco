/**
 * API 使用量メータリング — 構造化ログによる呼び出し記録
 *
 * Cloud Run の stdout JSON が Cloud Logging に自動取り込まれ、
 * BigQuery sink でコスト集計・アラートの起点になる。
 *
 * BigQuery 側は jsonPayload.kind = 'api_call' で絞り込む。
 * 詳細は docs/BACKUP_PLAYBOOK.md「メータリング設定」節を参照。
 *
 * 使い方:
 *   const { recordApiCall } = require('./metrics');
 *   recordApiCall({ provider: 'gemini', operation: 'generate', ... });
 */

const { logger } = require('./logger');

/**
 * 外部 API 呼び出しを構造化ログとして記録する。
 *
 * @param {object} event
 *   provider:    'gemini' | 'groq' | 'ollama' | 'google-stt' | 'elevenlabs-stt' | ...
 *   operation:   'generate' | 'stt-stream-end' | 'stt-batch' | ...
 *   tokens_in?:  number  (推定 input tokens)
 *   tokens_out?: number  (推定 output tokens)
 *   audio_ms?:   number  (STT ストリームの推定発話時間 ms)
 *   duration_ms: number
 *   account_id?: string  (メールアドレス等の PII は含めない — ID のみ)
 *   room_id?:    string
 *   request_id?: string
 *   status:      'ok' | 'error' | 'timeout'
 *   error?:      string  (status='error' のとき。スタックトレースは含めない)
 */
function recordApiCall(event) {
    const entry = {
        kind: 'api_call',
        ...event,
        timestamp: new Date().toISOString()
    };
    logger.info('api_call', entry);
}

module.exports = { recordApiCall };
