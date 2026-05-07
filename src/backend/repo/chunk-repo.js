const { newId } = require('../lib/ids');

/**
 * [L9] room_chunks テーブルの CRUD。
 * チャンク単位の議事録中間結果を永続化し、部分再生成を可能にする。
 */
class ChunkRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * チャンク結果を upsert する。
     * UNIQUE(room_id, chunk_index, analysis_type) のコンフリクト時は上書き。
     */
    async upsert({ room_id, chunk_index, analysis_type, start_ts, end_ts, result_text, status }) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            this.db.run(
                `INSERT INTO room_chunks
                     (id, room_id, chunk_index, analysis_type, start_ts, end_ts, result_text, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(room_id, chunk_index, analysis_type) DO UPDATE SET
                     result_text = excluded.result_text,
                     status      = excluded.status,
                     updated_at  = excluded.updated_at`,
                [
                    newId(),
                    room_id,
                    chunk_index,
                    analysis_type || 'minutes',
                    start_ts  || '',
                    end_ts    || '',
                    result_text || '',
                    status    || 'done',
                    now,
                    now
                ],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    /**
     * ルーム + 解析タイプに属する全チャンクを index 順で返す。
     */
    async findByRoom(roomId, analysisType) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM room_chunks WHERE room_id = ? AND analysis_type = ? ORDER BY chunk_index ASC',
                [roomId, analysisType || 'minutes'],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });
    }

    /**
     * 指定インデックスのチャンク 1 件を返す。存在しなければ null。
     */
    async findByIndex(roomId, analysisType, chunkIndex) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM room_chunks WHERE room_id = ? AND analysis_type = ? AND chunk_index = ?',
                [roomId, analysisType || 'minutes', chunkIndex],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row || null);
                }
            );
        });
    }

    /**
     * ルームの全チャンク (analysis_type 問わず) を削除する。
     * ルーム削除時のクリーンアップ用。
     */
    async deleteByRoom(roomId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM room_chunks WHERE room_id = ?',
                [roomId],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }
}

module.exports = { ChunkRepository };
