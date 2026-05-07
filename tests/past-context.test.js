const { buildPastMeetingContext, extractKeywords, LRUCache } = require('../src/backend/lib/past-context');

/**
 * Unit tests for the past-meeting context builder. Uses a stub roomRepo so
 * the test is independent of SQLite.
 */
describe('past-context', () => {
    function makeRepo(rooms) {
        let calls = 0;
        return {
            calls: () => calls,
            async findEndedRoomsForAccount(accountId, { limit, excludeRoomId } = {}) {
                calls += 1;
                return rooms
                    .filter((r) => r.owner_account_id === accountId)
                    .filter((r) => !excludeRoomId || r.id !== excludeRoomId)
                    .slice(0, limit || 5);
            }
        };
    }

    test('returns empty block when repo has no ended rooms', async () => {
        const repo = makeRepo([]);
        const { block, items } = await buildPastMeetingContext(repo, 'acc-1');
        expect(block).toBe('');
        expect(items).toEqual([]);
    });

    test('formats block with numbered items and keyword hints', async () => {
        const repo = makeRepo([
            {
                id: 'r1',
                owner_account_id: 'acc-1',
                status: 'ended',
                summary_text: 'The project kickoff kickoff discussed milestones milestones and staffing',
                minutes_text: 'milestones staffing budget budget'
            },
            {
                id: 'r2',
                owner_account_id: 'acc-1',
                status: 'ended',
                summary_text: 'Weekly sync covered deployment deployment blockers'
            }
        ]);
        const { block, items } = await buildPastMeetingContext(repo, 'acc-1', { useCache: false });
        expect(items).toHaveLength(2);
        expect(block).toMatch(/\[過去関連会議サマリ\]/);
        expect(block).toMatch(/\(1\)/);
        expect(block).toMatch(/\(2\)/);
        expect(block).toMatch(/\[\/過去関連会議サマリ\]/);
    });

    test('excludes the current room', async () => {
        const repo = makeRepo([
            { id: 'cur', owner_account_id: 'acc-1', status: 'ended', summary_text: 'current summary' },
            { id: 'past', owner_account_id: 'acc-1', status: 'ended', summary_text: 'past summary' }
        ]);
        const { items } = await buildPastMeetingContext(repo, 'acc-1', {
            useCache: false, excludeRoomId: 'cur'
        });
        expect(items.map((i) => i.roomId)).toEqual(['past']);
    });

    test('caches results per (account, excludeRoomId) key', async () => {
        const repo = makeRepo([
            { id: 'r1', owner_account_id: 'acc-2', status: 'ended', summary_text: 'x' }
        ]);
        const cache = new LRUCache(5, 60_000);
        const a = await buildPastMeetingContext(repo, 'acc-2', { cache });
        const b = await buildPastMeetingContext(repo, 'acc-2', { cache });
        expect(a).toBe(b);
        expect(repo.calls()).toBe(1);
    });

    test('truncates long summaries to the char cap', async () => {
        const long = 'あ'.repeat(2000);
        const repo = makeRepo([
            { id: 'r1', owner_account_id: 'acc-3', status: 'ended', summary_text: long }
        ]);
        const { items } = await buildPastMeetingContext(repo, 'acc-3', {
            useCache: false, charCap: 100
        });
        expect(items[0].summary.length).toBeLessThanOrEqual(105);
    });

    test('extractKeywords picks repeat tokens, ignores stopwords', () => {
        const kws = extractKeywords('plan plan budget budget with the team and the team');
        expect(kws).toContain('plan');
        expect(kws).toContain('budget');
        expect(kws).toContain('team');
        expect(kws).not.toContain('the');
    });

    test('returns empty block when roomRepo lacks the helper', async () => {
        const { block, items } = await buildPastMeetingContext({}, 'acc-1');
        expect(block).toBe('');
        expect(items).toEqual([]);
    });
});
