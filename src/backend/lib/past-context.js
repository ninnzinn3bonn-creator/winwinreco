/**
 * Builds a short "past meetings" block to inject at the top of AI prompts
 * for logged-in hosts.
 *
 * Design:
 *  - Query up to `limit` of the account's most recent ended rooms whose
 *    summary_text is non-empty, excluding the current room.
 *  - Truncate each summary to `charCap` so one long meeting cannot dominate
 *    the prompt budget.
 *  - Extract a small keyword set per summary so the model sees recurring
 *    themes even when summaries are short.
 *  - Cache results in a bounded in-memory LRU keyed by accountId so repeated
 *    generations within a meeting do not keep hitting SQLite.
 *
 * Trade-offs / non-goals:
 *  - This is not a full RAG pipeline. For a moderate number of past meetings,
 *    recency + whole-summary reuse is already strong enough.
 *  - We never send raw transcripts here; only user-visible summaries.
 */

const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'have',
    'has', 'are', 'was', 'were', 'will', 'been', 'they', 'them', 'their',
    'です', 'して', 'する', 'ある', 'いる', 'こと', 'これ', 'それ', 'ため',
    'から', 'まで', 'など', 'また', 'よう', 'ので', 'もの', 'いう', 'なっ',
    'その', 'この', 'との', 'では', 'には', 'へ'
]);

function extractKeywords(text, limit = 6) {
    if (!text) return [];
    const tokens = String(text)
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && token.length <= 24 && !STOPWORDS.has(token.toLowerCase()));
    const counts = new Map();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([token]) => token);
}

function truncate(text, cap) {
    const trimmed = String(text || '').trim();
    if (trimmed.length <= cap) return trimmed;
    return trimmed.slice(0, cap).replace(/\s+\S*$/, '') + '...';
}

function formatContextBlock(items) {
    if (!items || !items.length) return '';
    const lines = ['[過去関連会議サマリ]'];
    items.forEach((item, idx) => {
        const when = item.endedAt || item.createdAt || '';
        const keywords = item.keywords && item.keywords.length
            ? ` / keywords: ${item.keywords.join(', ')}`
            : '';
        lines.push(`(${idx + 1}) ${when}${keywords}`);
        lines.push(item.summary);
    });
    lines.push('[/過去関連会議サマリ]');
    return lines.join('\n');
}

class LRUCache {
    constructor(maxSize = 50, ttlMs = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return null;
        if (Date.now() - entry.storedAt > this.ttlMs) {
            this.map.delete(key);
            return null;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, { value, storedAt: Date.now() });
        while (this.map.size > this.maxSize) {
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
        }
    }

    clear() {
        this.map.clear();
    }
}

const defaultCache = new LRUCache();

/**
 * @param {Object} roomRepo must expose findEndedRoomsForAccount(accountId, { limit, excludeRoomId })
 * @param {string} accountId
 * @param {Object} [opts]
 * @param {number} [opts.limit=5]
 * @param {number} [opts.charCap=400]
 * @param {string|null} [opts.excludeRoomId]
 * @param {LRUCache} [opts.cache]
 * @param {boolean} [opts.useCache=true]
 * @returns {Promise<{ block: string, items: Array }>}
 */
async function buildPastMeetingContext(roomRepo, accountId, opts = {}) {
    const {
        limit = 5,
        charCap = 400,
        excludeRoomId = null,
        cache = defaultCache,
        useCache = true
    } = opts;
    if (!roomRepo || !accountId || typeof roomRepo.findEndedRoomsForAccount !== 'function') {
        return { block: '', items: [] };
    }

    const cacheKey = `${accountId}|${excludeRoomId || ''}|${limit}|${charCap}`;
    if (useCache) {
        const cached = cache.get(cacheKey);
        if (cached) return cached;
    }

    let rooms = [];
    try {
        rooms = await roomRepo.findEndedRoomsForAccount(accountId, { limit, excludeRoomId });
    } catch (_err) {
        return { block: '', items: [] };
    }

    const items = rooms
        .map((room) => ({
            roomId: room.id,
            endedAt: room.ended_at || room.created_at || '',
            createdAt: room.created_at || '',
            summary: truncate(room.summary_text || '', charCap),
            keywords: extractKeywords(`${room.summary_text || ''} ${room.minutes_text || ''}`)
        }))
        .filter((item) => item.summary.length > 0);

    const result = { block: formatContextBlock(items), items };
    if (useCache) cache.set(cacheKey, result);
    return result;
}

function _resetCache() {
    defaultCache.clear();
}

module.exports = { buildPastMeetingContext, extractKeywords, LRUCache, _resetCache };
