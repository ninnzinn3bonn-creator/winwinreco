/**
 * account-export.js — ユーザーデータエクスポート (Stored ZIP 生成)
 *
 * 新規 npm 依存なし。CRC-32 (IEEE 802.3) + Stored (無圧縮) ZIP を
 * Buffer 操作のみで自前生成する。
 *
 * ZIP 構造:
 *   README.txt
 *   account.json
 *   profile.json
 *   rooms/<roomId>.json  (ホストしたルームのみ)
 *   participated.csv     (このバージョンでは空 — 将来実装予定)
 */

'use strict';

// ── CRC-32 (IEEE 802.3 polynomial 0xEDB88320) ────────────────────────────────

const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP builder (Stored / 無圧縮) ─────────────────────────────────────────────

/**
 * @param {Array<{name: string, data: Buffer}>} files
 * @returns {Buffer} 完成した ZIP バイナリ
 */
function buildZip(files) {
    const localHeaders = [];    // ローカルファイルヘッダ + データ のバッファ列
    const centralDirs = [];     // セントラルディレクトリエントリ列
    let offset = 0;

    for (const { name, data } of files) {
        const nameBytes = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const size = data.length;

        // ローカルファイルヘッダ (30 + nameBytes.length バイト)
        const lh = Buffer.alloc(30 + nameBytes.length);
        lh.writeUInt32LE(0x04034B50, 0);  // signature
        lh.writeUInt16LE(20, 4);           // version needed (2.0)
        lh.writeUInt16LE(0x0800, 6);       // general purpose: UTF-8 flag
        lh.writeUInt16LE(0, 8);            // compression method: stored
        lh.writeUInt16LE(0, 10);           // last mod time
        lh.writeUInt16LE(0, 12);           // last mod date
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(size, 18);        // compressed size
        lh.writeUInt32LE(size, 22);        // uncompressed size
        lh.writeUInt16LE(nameBytes.length, 26);
        lh.writeUInt16LE(0, 28);           // extra field length
        nameBytes.copy(lh, 30);

        localHeaders.push(lh, data);

        // セントラルディレクトリエントリ (46 + nameBytes.length バイト)
        const cd = Buffer.alloc(46 + nameBytes.length);
        cd.writeUInt32LE(0x02014B50, 0);   // signature
        cd.writeUInt16LE(20, 4);            // version made by
        cd.writeUInt16LE(20, 6);            // version needed
        cd.writeUInt16LE(0x0800, 8);        // general purpose: UTF-8 flag
        cd.writeUInt16LE(0, 10);            // compression: stored
        cd.writeUInt16LE(0, 12);            // last mod time
        cd.writeUInt16LE(0, 14);            // last mod date
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(size, 20);         // compressed size
        cd.writeUInt32LE(size, 24);         // uncompressed size
        cd.writeUInt16LE(nameBytes.length, 28);
        cd.writeUInt16LE(0, 30);            // extra field length
        cd.writeUInt16LE(0, 32);            // file comment length
        cd.writeUInt16LE(0, 34);            // disk number start
        cd.writeUInt16LE(0, 36);            // internal attributes
        cd.writeUInt32LE(0, 38);            // external attributes
        cd.writeUInt32LE(offset, 42);       // relative offset of local header
        nameBytes.copy(cd, 46);

        centralDirs.push(cd);
        offset += lh.length + data.length;
    }

    const cdBuf = Buffer.concat(centralDirs);
    const cdOffset = offset;
    const cdSize = cdBuf.length;

    // エンドオブセントラルディレクトリレコード (22 バイト)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);    // signature
    eocd.writeUInt16LE(0, 4);              // disk number
    eocd.writeUInt16LE(0, 6);              // disk with start of CD
    eocd.writeUInt16LE(files.length, 8);   // entries on disk
    eocd.writeUInt16LE(files.length, 10);  // total entries
    eocd.writeUInt32LE(cdSize, 12);        // CD size
    eocd.writeUInt32LE(cdOffset, 16);      // CD offset
    eocd.writeUInt16LE(0, 20);             // comment length

    return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

// ── ZIP ファイル名のサニタイズ ─────────────────────────────────────────────────

function safeFilename(name) {
    return String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
}

// ── エクスポート本体 ───────────────────────────────────────────────────────────

/**
 * accountId のデータを ZIP Buffer として返す。
 *
 * @param {object} repos  { accountRepo, userRepo, roomRepo, utteranceRepo, participantRepo }
 * @param {string} accountId
 * @returns {Promise<Buffer>}
 */
async function exportAccountToZip(repos, accountId) {
    const { accountRepo, userRepo, roomRepo, utteranceRepo, participantRepo } = repos;

    // 1. アカウント情報
    const account = accountRepo ? await accountRepo.findById(accountId) : null;
    if (!account) throw new Error('Account not found');

    // 2. プロフィール (users テーブル)
    const user = userRepo ? await userRepo.findById(accountId) : null;
    const profileText = user?.profile_text || '';

    // 3. ホストしたルーム
    const ownRooms = roomRepo
        ? (await roomRepo.findRoomsForAccount(accountId, { limit: 1000 }))
            .filter((r) => r.owner_account_id === accountId)
        : [];

    // ── README.txt ──────────────────────────────────────────────────────────
    const exportedAt = new Date().toISOString();
    const readme = [
        'GIJIRO データエクスポート',
        '========================',
        '',
        `エクスポート日時: ${exportedAt}`,
        `アカウント ID:   ${account.id}`,
        `メールアドレス:  ${account.email}`,
        '',
        '含まれるデータ:',
        '  account.json   — アカウント情報',
        '  profile.json   — プロフィールテキスト',
        `  rooms/         — ホストした会議 (${ownRooms.length} 件)`,
        '  participated.csv — ゲスト参加会議 (このバージョンではホストした会議のみ収録)',
        '',
        '注意事項:',
        '  - このバージョンではホストした会議のデータのみエクスポートされます。',
        '  - ゲストとして参加した会議は将来のバージョンで対応予定です。',
        '  - ZIP 内の JSON ファイルは UTF-8 エンコードです。',
    ].join('\n');

    const files = [
        { name: 'README.txt', data: Buffer.from(readme, 'utf8') },
        {
            name: 'account.json',
            data: Buffer.from(JSON.stringify({
                id: account.id,
                email: account.email,
                display_name: account.display_name || '',
                status: account.status || '',
                created_at: account.created_at || null
            }, null, 2), 'utf8')
        },
        {
            name: 'profile.json',
            data: Buffer.from(JSON.stringify({ profile_text: profileText }, null, 2), 'utf8')
        }
    ];

    // ── ルームデータ ─────────────────────────────────────────────────────────
    for (const room of ownRooms) {
        const [utterances, participants, meetingMemos] = await Promise.all([
            utteranceRepo ? utteranceRepo.findByRoomId(room.id) : [],
            participantRepo ? participantRepo.findByRoomId(room.id) : [],
            roomRepo && typeof roomRepo.findMeetingMemosByRoomId === 'function'
                ? roomRepo.findMeetingMemosByRoomId(room.id)
                : []
        ]);

        const roomData = {
            id: room.id,
            title: room.title || '',
            status: room.status || '',
            created_at: room.created_at || null,
            ended_at: room.ended_at || null,
            summary: room.summary_text || '',
            minutes: room.minutes_text || '',
            todo: room.todo_text || '',
            meeting_memos: meetingMemos.map((memo) => ({
                id: memo.id,
                display_name: memo.display_name || '',
                memo_text: memo.memo_text || '',
                created_at: memo.created_at || null
            })),
            ai_workspace: room.ai_workspace_json
                ? (() => { try { return JSON.parse(room.ai_workspace_json); } catch (_) { return null; } })()
                : null,
            participants: participants.map((p) => ({
                id: p.id,
                display_name: p.display_name || '',
                user_id: p.user_id || null,
                joined_at: p.joined_at || p.created_at || null
            })),
            utterances: utterances.map((u) => ({
                id: u.id,
                started_at: u.started_at || null,
                ended_at: u.ended_at || null,
                display_name: u.display_name || '',
                transcript: u.transcript || '',
                raw_transcript: u.raw_transcript || '',
                is_starred: !!u.is_starred,
                memo_text: u.memo_text || u.memory_note || ''
            }))
        };

        files.push({
            name: `rooms/${safeFilename(room.id)}.json`,
            data: Buffer.from(JSON.stringify(roomData, null, 2), 'utf8')
        });
    }

    // ── participated.csv (このバージョンでは空) ───────────────────────────────
    files.push({
        name: 'participated.csv',
        data: Buffer.from(
            'room_id,room_title,joined_at,ended_at\n' +
            '# このバージョンではホストした会議のみエクスポートされます\n',
            'utf8'
        )
    });

    return buildZip(files);
}

module.exports = { buildZip, crc32, exportAccountToZip };
