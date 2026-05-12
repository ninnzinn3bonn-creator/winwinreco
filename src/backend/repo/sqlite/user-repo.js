class UserRepository {
    constructor(db) {
        this.db = db;
    }

    async create(user) {
        return new Promise((resolve, reject) => {
            const { id, name, profile_text = '' } = user;
            this.db.run(
                'INSERT INTO users (id, name, profile_text) VALUES (?, ?, ?)',
                [id, name, profile_text],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async findByName(name) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM users WHERE name = ?', [name], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async deleteById(id) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM users WHERE id = ?',
                [id],
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes || 0);
                }
            );
        });
    }

    async upsert(user) {
        return new Promise((resolve, reject) => {
            const { id, name, profile_text = '' } = user;
            this.db.run(
                `INSERT INTO users (id, name, profile_text)
                 VALUES (?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    profile_text = excluded.profile_text`,
                [id, name, profile_text],
                async (err) => {
                    if (err) return reject(err);
                    try {
                        resolve(await this.findById(id));
                    } catch (findErr) {
                        reject(findErr);
                    }
                }
            );
        });
    }
}

module.exports = { UserRepository };
