const { getDb, fromTimestamp, toTimestamp, serverTs } = require('./db');

class UserContextRepository {
    constructor() {
        this.col = getDb().collection('user_context');
    }

    _toDomain(id, d) {
        if (!d) return null;
        return {
            user_id: id,
            project_summary: d.project_summary || '',
            current_status: d.current_status || '',
            active_tasks: Array.isArray(d.active_tasks) ? d.active_tasks : [],
            updated_at: fromTimestamp(d.last_updated) || null
        };
    }

    async findByUserId(userId) {
        const snap = await this.col.doc(userId).get();
        if (!snap.exists) return null;
        return this._toDomain(userId, snap.data());
    }

    async findByUserIds(userIds = []) {
        if (!userIds.length) return [];
        const results = [];
        // Firestore batch get (up to 500)
        const refs = userIds.map((id) => this.col.doc(id));
        const snaps = await getDb().getAll(...refs);
        for (const snap of snaps) {
            if (snap.exists) {
                results.push(this._toDomain(snap.id, snap.data()));
            }
        }
        return results;
    }

    async upsert(context) {
        const {
            user_id,
            project_summary = '',
            current_status = '',
            active_tasks = [],
            last_updated
        } = context;

        const now = last_updated
            ? toTimestamp(last_updated)
            : serverTs();

        await this.col.doc(user_id).set(
            {
                project_summary,
                current_status,
                active_tasks: Array.isArray(active_tasks) ? active_tasks : [],
                last_updated: now
            },
            { merge: true }
        );
        return this.findByUserId(user_id);
    }
}

module.exports = { UserContextRepository };
