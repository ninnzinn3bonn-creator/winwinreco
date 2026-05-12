const { newId } = require('../../lib/ids');
const { getDb, fromTimestamp, serverTs } = require('./db');

/**
 * Firestore 実装 — SQLite 版 (src/backend/repo/sqlite/user-account-repo.js) と
 * メソッドシグネチャを一致させる。事後承認フロー (status / is_owner) サポート。
 */
class UserAccountRepository {
    constructor() {
        this.col = getDb().collection('user_accounts');
    }

    static normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
    }

    _toDomain(id, d) {
        return {
            id,
            email: d.email,
            password_hash: d.password_hash,
            display_name: d.display_name || '',
            status: d.status || 'approved',
            // Firestore は boolean だが、SQLite との互換のため数値で返す
            is_owner: d.is_owner === true || d.is_owner === 1 ? 1 : 0,
            created_at: fromTimestamp(d.created_at),
            updated_at: fromTimestamp(d.updated_at),
            last_login_at: fromTimestamp(d.last_login_at) || null
        };
    }

    async create({ email, passwordHash, displayName = '', status = 'pending' }) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) throw new Error('email is required');
        if (!passwordHash) throw new Error('passwordHash is required');

        // Check for duplicate email
        const existing = await this.findByEmail(normalized);
        if (existing) {
            const err = new Error('UNIQUE constraint failed: user_accounts.email');
            err.code = 'SQLITE_CONSTRAINT';
            throw err;
        }

        const id = newId('acc');
        await this.col.doc(id).set({
            email: normalized,
            password_hash: passwordHash,
            display_name: displayName,
            status,
            is_owner: false,
            created_at: serverTs(),
            updated_at: serverTs()
        });
        return {
            id,
            email: normalized,
            password_hash: passwordHash,
            display_name: displayName,
            status
        };
    }

    async findByEmail(email) {
        const normalized = UserAccountRepository.normalizeEmail(email);
        if (!normalized) return null;
        const snap = await this.col.where('email', '==', normalized).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return this._toDomain(doc.id, doc.data());
    }

    async findById(id) {
        if (!id) return null;
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return null;
        return this._toDomain(id, snap.data());
    }

    async updateDisplayName(id, displayName) {
        await this.col.doc(id).update({
            display_name: displayName || '',
            updated_at: serverTs()
        });
    }

    async updatePasswordHash(id, passwordHash) {
        await this.col.doc(id).update({
            password_hash: passwordHash,
            updated_at: serverTs()
        });
    }

    // --- 事後承認フロー: 承認待ち管理 -------------------------------------

    /**
     * 保留中 (status='pending') のユーザーを古い順に返す。
     */
    async findPending() {
        const snap = await this.col
            .where('status', '==', 'pending')
            .orderBy('created_at', 'asc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    /**
     * 全ユーザー一覧 (新しい順)。admin の全体ビュー用。
     */
    async findAll() {
        const snap = await this.col.orderBy('created_at', 'desc').get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    /**
     * status を更新。'pending' | 'approved' | 'rejected'。
     */
    async setStatus(id, status) {
        const allowed = new Set(['pending_email', 'pending', 'approved', 'rejected']);
        if (!allowed.has(status)) throw new Error(`invalid status: ${status}`);
        const ref = this.col.doc(id);
        const snap = await ref.get();
        if (!snap.exists) return { changes: 0 };
        await ref.update({ status, updated_at: serverTs() });
        return { changes: 1 };
    }

    /**
     * 承認待ち件数 (バッジ用)。
     */
    async countPending() {
        // Firestore は count() aggregation を使うのが軽量
        try {
            const agg = await this.col.where('status', '==', 'pending').count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            // 古い firebase-admin で count() がない場合のフォールバック
            const snap = await this.col.where('status', '==', 'pending').get();
            return snap.size;
        }
    }

    // --- DB-based ownership -----------------------------------------------

    async findOwners() {
        const snap = await this.col
            .where('is_owner', '==', true)
            .orderBy('created_at', 'asc')
            .get();
        return snap.docs.map((d) => this._toDomain(d.id, d.data()));
    }

    async countOwners() {
        try {
            const agg = await this.col.where('is_owner', '==', true).count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.where('is_owner', '==', true).get();
            return snap.size;
        }
    }

    async setOwner(id, isOwner) {
        const ref = this.col.doc(id);
        const snap = await ref.get();
        if (!snap.exists) return { changes: 0 };
        await ref.update({ is_owner: !!isOwner, updated_at: serverTs() });
        return { changes: 1 };
    }

    // --- §54 利用状況ダッシュボード ----------------------------------------

    /** ログイン成功時に last_login_at を現在時刻に更新する。 */
    async touchLastLogin(id) {
        if (!id) return;
        await this.col.doc(id).update({ last_login_at: serverTs() });
    }

    /** status 別の件数を返す。 */
    async countByStatus(status) {
        try {
            const agg = await this.col.where('status', '==', status).count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.where('status', '==', status).get();
            return snap.size;
        }
    }

    /** last_login_at >= date (Date オブジェクトまたは ISO 文字列) のユーザー数。 */
    async countActiveSince(date) {
        const d = date instanceof Date ? date : new Date(date);
        try {
            const agg = await this.col.where('last_login_at', '>=', d).count().get();
            return Number(agg.data().count || 0);
        } catch (_) {
            const snap = await this.col.where('last_login_at', '>=', d).get();
            return snap.size;
        }
    }

    async deleteById(id) {
        const ref = this.col.doc(id);
        const snap = await ref.get();
        if (!snap.exists) return 0;
        await ref.delete();
        return 1;
    }

    // --- Easter egg ハイスコア --------------------------------------------

    async getGameHighScore(id) {
        if (!id) return 0;
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return 0;
        const d = snap.data() || {};
        return Number(d.game_high_score || 0);
    }

    async updateGameHighScore(id, score) {
        if (!id) return { is_new_high_score: false, high_score: 0, previous: 0 };
        const docRef = this.col.doc(id);
        const snap = await docRef.get();
        const previous = Number((snap.exists && snap.data() && snap.data().game_high_score) || 0);
        const next = Number(score) || 0;
        if (next > previous) {
            await docRef.update({ game_high_score: next, game_updated_at: serverTs() });
            return { is_new_high_score: true, high_score: next, previous };
        }
        return { is_new_high_score: false, high_score: previous, previous };
    }
}

module.exports = { UserAccountRepository };
