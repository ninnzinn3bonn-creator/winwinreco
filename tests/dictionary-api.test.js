const request = require('supertest');
const path = require('path');
const fs = require('fs');

const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/sqlite/db');
const { DictionaryRepo } = require('../src/backend/repo/sqlite/dictionary-repo');

describe('Dictionary API', () => {
    let app;
    let db;
    const dbPath = path.resolve(__dirname, './tmp/test_dictionary_api.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        app = createApp({
            dictionaryRepo: new DictionaryRepo(db)
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    test('can add, list, and delete dictionary terms without setup-screen UI', async () => {
        const term = `専門用語${Date.now()}`;
        const reading = 'センモンヨウゴ';

        const addRes = await request(app)
            .post('/api/dictionary')
            .send({ term, reading });

        expect(addRes.status).toBe(201);
        expect(addRes.body).toMatchObject({ term, reading });
        expect(addRes.body.id).toBeTruthy();

        const listRes = await request(app).get('/api/dictionary');
        expect(listRes.status).toBe(200);
        expect(listRes.body).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: addRes.body.id, term, reading })
        ]));

        const deleteRes = await request(app).delete(`/api/dictionary/${addRes.body.id}`);
        expect(deleteRes.status).toBe(200);

        const afterDeleteRes = await request(app).get('/api/dictionary');
        expect(afterDeleteRes.status).toBe(200);
        expect(afterDeleteRes.body).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: addRes.body.id })
        ]));
    });
});
