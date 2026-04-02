function safeParseArray(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        user_id: row.user_id,
        project_summary: row.project_summary || '',
        current_status: row.current_status || '',
        active_tasks: safeParseArray(row.active_tasks),
        updated_at: row.last_updated || null
    };
}

class UserContextRepository {
    constructor(db) {
        this.db = db;
    }

    async findByUserId(userId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM user_context WHERE user_id = ?', [userId], (err, row) => {
                if (err) return reject(err);
                resolve(normalizeRow(row));
            });
        });
    }

    async findByUserIds(userIds = []) {
        if (!userIds.length) return [];

        return new Promise((resolve, reject) => {
            const placeholders = userIds.map(() => '?').join(', ');
            this.db.all(
                `SELECT * FROM user_context WHERE user_id IN (${placeholders})`,
                userIds,
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows.map(normalizeRow));
                }
            );
        });
    }

    async upsert(context) {
        const payload = {
            user_id: context.user_id,
            project_summary: context.project_summary || '',
            current_status: context.current_status || '',
            active_tasks: JSON.stringify(context.active_tasks || []),
            last_updated: context.last_updated || new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO user_context (user_id, project_summary, current_status, next_actions, active_tasks, past_decisions, issues, last_updated)
                 VALUES (?, ?, ?, '[]', ?, '[]', '[]', ?)
                 ON CONFLICT(user_id) DO UPDATE SET
                    project_summary = excluded.project_summary,
                    current_status = excluded.current_status,
                    active_tasks = excluded.active_tasks,
                    last_updated = excluded.last_updated`,
                [
                    payload.user_id,
                    payload.project_summary,
                    payload.current_status,
                    payload.active_tasks,
                    payload.last_updated
                ],
                async (err) => {
                    if (err) return reject(err);
                    try {
                        resolve(await this.findByUserId(payload.user_id));
                    } catch (findErr) {
                        reject(findErr);
                    }
                }
            );
        });
    }
}

module.exports = { UserContextRepository };
