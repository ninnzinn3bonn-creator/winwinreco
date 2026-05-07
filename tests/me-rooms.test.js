const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/backend/app');
const { initDB } = require('../src/backend/repo/db');
const { RoomRepository } = require('../src/backend/repo/room-repo');
const { ParticipantRepository } = require('../src/backend/repo/participant-repo');
const { UserRepository } = require('../src/backend/repo/user-repo');
const { UserAccountRepository } = require('../src/backend/repo/user-account-repo');
const { SessionRepository } = require('../src/backend/repo/session-repo');

/**
 * /me/rooms and /me/rooms/:id — covers ownership, participation, and
 * third-party isolation.
 */
describe('Account history endpoints', () => {
    let app;
    let db;
    const dbPath = path.resolve(__dirname, './tmp/test_me_rooms.db');

    beforeAll(async () => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        db = await initDB(dbPath);
        app = createApp({
            roomRepo: new RoomRepository(db),
            participantRepo: new ParticipantRepository(db),
            userRepo: new UserRepository(db),
            accountRepo: new UserAccountRepository(db),
            sessionRepo: new SessionRepository(db)
        });
    });

    afterAll(async () => {
        await new Promise((resolve) => db.close(resolve));
    });

    async function signupFresh(label) {
        const agent = request.agent(app);
        const email = `${label}+${Date.now()}@example.test`;
        const signup = await agent
            .post('/auth/signup')
            .send({ email, password: 'correcthorse', display_name: label });
        return { agent, account: signup.body.account };
    }

    test('/me/rooms requires login', async () => {
        const res = await request(app).get('/me/rooms');
        expect(res.status).toBe(401);
    });

    test('owner sees their own rooms', async () => {
        const { agent } = await signupFresh('owner');
        const r1 = await agent.post('/rooms').send({});
        const r2 = await agent.post('/rooms').send({});
        const res = await agent.get('/me/rooms');
        expect(res.status).toBe(200);
        const ids = res.body.rooms.map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining([r1.body.id, r2.body.id]));
        const ownerRow = res.body.rooms.find((r) => r.id === r1.body.id);
        expect(ownerRow.is_owner).toBe(true);
    });

    test('logged-in participant sees rooms they joined', async () => {
        const { agent: host } = await signupFresh('host2');
        const room = await host.post('/rooms').send({});

        const { agent: guest, account: guestAccount } = await signupFresh('guest2');
        await guest
            .post(`/rooms/${room.body.id}/join`)
            .send({
                user_id: guestAccount.id,
                display_name: 'Guest',
                location_id: 'web-browser'
            });

        const res = await guest.get('/me/rooms');
        expect(res.status).toBe(200);
        const ids = res.body.rooms.map((r) => r.id);
        expect(ids).toContain(room.body.id);
        const row = res.body.rooms.find((r) => r.id === room.body.id);
        expect(row.is_owner).toBe(false);
    });

    test('other users cannot fetch a room they never touched', async () => {
        const { agent: host } = await signupFresh('host3');
        const room = await host.post('/rooms').send({});

        const { agent: stranger } = await signupFresh('stranger');
        const res = await stranger.get(`/me/rooms/${room.body.id}`);
        expect(res.status).toBe(403);
    });

    test('owner can fetch room archive detail', async () => {
        const { agent } = await signupFresh('host4');
        const room = await agent.post('/rooms').send({});
        const res = await agent.get(`/me/rooms/${room.body.id}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(room.body.id);
        expect(res.body.is_owner).toBe(true);
        expect(res.body).toHaveProperty('title');
        expect(res.body).toHaveProperty('ai_workspace');
    });

    test('/me/backfill links anonymous participations to the new account', async () => {
        // 1. host creates a room
        const { agent: host } = await signupFresh('host5');
        const room = await host.post('/rooms').send({});
        const roomId = room.body.id;

        // 2. anonymous browser (stable local user_id) joins the room
        const localUserId = 'local-anon-xyz';
        const anon = request.agent(app); // no session cookie
        const joinRes = await anon
            .post(`/rooms/${roomId}/join`)
            .send({
                user_id: localUserId,
                display_name: 'AnonGuest',
                location_id: 'web-browser'
            });
        expect(joinRes.status).toBeLessThan(400);

        // 3. that browser later signs up — backfill request links their join
        const { agent: signedIn } = await signupFresh('lateguest');
        const beforeRes = await signedIn.get('/me/rooms');
        const beforeIds = beforeRes.body.rooms.map((r) => r.id);
        expect(beforeIds).not.toContain(roomId);

        const backfill = await signedIn
            .post('/me/backfill')
            .send({ user_id: localUserId });
        expect(backfill.status).toBe(200);
        expect(backfill.body.linked).toBeGreaterThanOrEqual(1);

        const afterRes = await signedIn.get('/me/rooms');
        const afterIds = afterRes.body.rooms.map((r) => r.id);
        expect(afterIds).toContain(roomId);
    });

    test('/me/backfill rejects missing user_id', async () => {
        const { agent } = await signupFresh('backfill-bad');
        const res = await agent.post('/me/backfill').send({});
        expect(res.status).toBe(400);
    });

    test('host can DELETE /me/rooms/:id and the room disappears', async () => {
        const { agent } = await signupFresh('host-del');
        const room = await agent.post('/rooms').send({});
        const del = await agent.delete(`/me/rooms/${room.body.id}`);
        expect(del.status).toBe(200);
        expect(del.body.deleted).toBe(true);
        expect(del.body.scope).toBe('room');
        const after = await agent.get(`/me/rooms/${room.body.id}`);
        expect(after.status).toBe(404);
    });

    test('non-host DELETE /me/rooms/:id only unlinks the participant', async () => {
        const { agent: host } = await signupFresh('host-del2');
        const room = await host.post('/rooms').send({});
        const { agent: guest, account: guestAcct } = await signupFresh('guest-del');
        await guest
            .post(`/rooms/${room.body.id}/join`)
            .send({ user_id: guestAcct.id, display_name: 'Guest', location_id: 'web-browser' });

        const del = await guest.delete(`/me/rooms/${room.body.id}`);
        expect(del.status).toBe(200);
        expect(del.body.scope).toBe('participant');

        // Host still sees the room.
        const hostList = await host.get('/me/rooms');
        expect(hostList.body.rooms.map((r) => r.id)).toContain(room.body.id);

        // Guest no longer sees it.
        const guestList = await guest.get('/me/rooms');
        expect(guestList.body.rooms.map((r) => r.id)).not.toContain(room.body.id);
    });

    test('host can PATCH /me/rooms/:id to update the title', async () => {
        const { agent } = await signupFresh('host-patch');
        const room = await agent.post('/rooms').send({});
        const patch = await agent
            .patch(`/me/rooms/${room.body.id}`)
            .send({ title: '週次定例' });
        expect(patch.status).toBe(200);
        expect(patch.body.title).toBe('週次定例');
        const detail = await agent.get(`/me/rooms/${room.body.id}`);
        expect(detail.body.title).toBe('週次定例');
    });

    test('non-host cannot PATCH /me/rooms/:id', async () => {
        const { agent: host } = await signupFresh('host-patch2');
        const room = await host.post('/rooms').send({});
        const { agent: guest, account: guestAcct } = await signupFresh('guest-patch');
        await guest
            .post(`/rooms/${room.body.id}/join`)
            .send({ user_id: guestAcct.id, display_name: 'Guest', location_id: 'web-browser' });

        const res = await guest.patch(`/me/rooms/${room.body.id}`).send({ title: '勝手に編集' });
        expect(res.status).toBe(403);
    });
});
