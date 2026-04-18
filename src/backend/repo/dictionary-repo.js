class DictionaryRepo {
    constructor(db) {
        this.db = db;
    }

    async findAll() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM dictionary ORDER BY created_at DESC', (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    async add({ id, label, term, reading }) {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO dictionary (id, label, term, reading) VALUES (?, ?, ?, ?)';
            this.db.run(sql, [id, label, term, reading], function(err) {
                if (err) return reject(err);
                resolve({ id, label, term, reading });
            });
        });
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM dictionary WHERE id = ?', [id], function(err) {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async update(id, { label, term, reading }) {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE dictionary SET label = ?, term = ?, reading = ? WHERE id = ?';
            this.db.run(sql, [label, term, reading, id], function(err) {
                if (err) return reject(err);
                resolve({ id, label, term, reading });
            });
        });
    }
}

module.exports = { DictionaryRepo };
