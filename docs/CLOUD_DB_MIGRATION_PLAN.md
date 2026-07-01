# Cloud Run 公開向け DB 移行プラン (SQLite → Firestore)

> Current provider note (2026-06-29): this migration plan contains historical examples from the selectable-provider phase. The current production contract is fixed to `AI_PROVIDER=groq` with Groq `openai/gpt-oss-120b` and `STT_PROVIDER=elevenlabs` with ElevenLabs Scribe `scribe_v2` / `scribe_v2_realtime`. Use `cloudbuild.yaml` and `.env.example` for current provider values.

ローカル SQLite で動いている GIJIRO を、Cloud Run で公開した状態でも DB が動作するよう Firestore へ移行する設計・タスク計画書。

担当エージェントが本ドキュメント単体で迷わず作業着手できるよう、**確定値・正確なコマンド・既存実装との整合・機械検証可能な受け入れ条件のみ**で構成している。

スコープは **個人利用 (ホスト最大 5 名・ゲスト無制限・月間ルーム数 < 数百)**。

---

## 0. 決定事項レジストリ (Decisions Registry)

エージェントが解釈で迷う可能性のある値はすべてここで確定する。

### 0.1 確定値

| キー | 値 | 補足 |
|---|---|---|
| `D-REGION` | `asia-northeast1` | Firestore / Cloud Run / Artifact Registry すべて東京 |
| `D-FIRESTORE-MODE` | `Native` | Datastore モードでなく Native |
| `D-DB-DRIVER-DEFAULT` | `sqlite` | `DB_DRIVER` 環境変数の既定値 |
| `D-CLOUD-RUN-SERVICE-NAME` | `winwinreco` | 既存 `cloudbuild.yaml` で確定済み |
| `D-CLOUD-RUN-MIN-INST` | `0` | コールドスタート許容 |
| `D-CLOUD-RUN-MAX-INST` | `2` | コスト爆発防止 |
| `D-CLOUD-RUN-CONCURRENCY` | `80` | Cloud Run デフォルト |
| `D-MIGRATION-SCRIPT` | **作らない** | Firestore は新規開始。既存 SQLite データは移さない |
| `D-TEST-STRATEGY` | **両 driver で同じ Jest スイートを通す** | `DB_DRIVER` 環境変数で切替 |
| `D-AUTH-SYSTEM` | **既存の email/password + cookie session を維持** | Firebase Auth は導入しない (`lib/auth.js` `lib/passwords.js` `repo/session-repo.js` は既に存在) |
| `D-HOST-PROVISIONING` | **`host_allowlist` テーブルでサインアップを制限** | オーナーが allowlist に追加 → 該当メールでサインアップ可能 |
| `D-OWNER-IDENTIFICATION` | **`OWNER_EMAIL` 環境変数 (単一メール)** | `user_accounts` のメールが一致するアカウントを owner と判定 |
| `D-CONTROL-TOKEN-STRATEGY` | **既存の participant_id + control_token をそのまま Firestore に保存** | DB 漏洩リスクは Firestore Security Rules で対応 |
| `D-AUDIT-LOG-RETENTION` | Cloud Logging デフォルト (30 日) | 拡張不要 |
| `D-BACKUP-FREQUENCY` | 月 1 回手動 (`gcloud firestore export`) | 自動バックアップ不採用 |
| `D-BUDGET-ALERT` | $5 / $10 / $20 の 3 段階 | Cloud Billing の Budget |

### 0.2 環境変数一覧 (確定)

実装上既に使用されているもの + 本プランで追加するもの。新規追加禁止 (必要なら本表を更新する PR を先に出す)。

| 環境変数 | 必須 | 値の例 | 用途 | 配置 | 出典 |
|---|---|---|---|---|---|
| `PORT` | ◯ | `3000` (local), `8080` (Cloud Run) | サーバーポート | env | 既存 |
| `DB_PATH` | △ | `./db/meeting.db` | SQLite モード時のみ | env | 既存 |
| `DB_DRIVER` | ◯ | `sqlite` または `firestore` | DB 切替 | env | **本プランで追加** |
| `GOOGLE_CLOUD_PROJECT` | ◯ (firestore) | プロジェクト ID | Firestore Admin SDK | env | **本プランで追加** |
| `FIRESTORE_EMULATOR_HOST` | △ | `localhost:8080` | ローカル開発時のみ | env | **本プランで追加** |
| `AI_PROVIDER` | △ | `gemini` または `groq` | AI 切替 | env | 既存 |
| `GEMINI_API_KEY` | △ | (キー) | Gemini 利用時 | secret | 既存 |
| `GEMINI_MODEL` | △ | `gemini-2.5-flash` | Gemini モデル指定 | env | 既存 |
| `GROQ_API_KEY` | △ | (キー) | Groq 利用時 | secret | 既存 |
| `GROQ_STT_MODEL` | △ | `whisper-large-v3-turbo` | Groq STT モデル | env | 既存 |
| `STT_PROVIDER` | △ | `google` (既定) | STT 切替 | env | 既存 |
| `STT_LANGUAGE` | △ | `ja` | STT 言語 | env | 既存 |
| `GOOGLE_API_KEY` | △ | (キー) | Google STT 利用時 | secret | 既存 |
| `ELEVENLABS_API_KEY` | △ | (キー) | ElevenLabs STT 利用時 | secret | 既存 |
| `ELEVENLABS_STT_MODEL` | △ | (モデル名) | ElevenLabs STT モデル | env | 既存 |
| `ELEVENLABS_STT_REALTIME_MODEL` | △ | (モデル名) | ElevenLabs Realtime | env | 既存 |
| `COOKIE_SECURE` | △ | `true` (Cloud Run), `false` (local) | session cookie の Secure 属性 | env | 既存 |
| `WS_ALLOWED_ORIGINS` | △ | `https://winwinreco-xxx.run.app` | WS Origin 検証 | env | 既存 |
| `NODE_ENV` | △ | `test` でレート制限 OFF | テスト時のみ | env | 既存 |
| `OWNER_EMAIL` | ◯ (Phase 3) | `you@example.com` | owner 識別 | env | **本プランで追加** |

### 0.3 GCP プロジェクト前提

- **既存 Cloud Run (`winwinreco`) を再利用**。新規プロジェクト作成しない。
- リージョンは `D-REGION` で固定。
- `cloudbuild.yaml` は既にコミット済み。Cloud Build トリガが GitHub main へ push を検知して自動デプロイする。
- 本プラン中の `<PROJECT_ID>` は `gcloud config get-value project` で得られる現行プロジェクト ID。

---

## 1. なぜ移行が必要か

### 1.1 Cloud Run × SQLite の致命的問題

| 問題 | 影響 |
|---|---|
| コンテナはステートレス | コールドスタート / 再デプロイで `db/meeting.db` 消滅 |
| 複数インスタンス間でファイル非共有 | スケールアウトで整合性破綻 |
| WAL モードは単一プロセス前提 | 同時アクセスで破損 |

→ **本番では SQLite が成立しない**。

### 1.2 Firestore 採用根拠

候補比較は省略 (Cloud SQL は最低稼働コスト $7-10/月 で個人利用には重い)。`Firestore Native` で確定 (`D-FIRESTORE-MODE`)。

---

## 2. アーキテクチャ

**採用: Option A (バックエンド経由)**

```
Browser ─[WebSocket/HTTP]→ Express on Cloud Run (winwinreco) ─[Admin SDK]→ Firestore
                                ↓
                         Google STT / Gemini / Groq
```

- フロントエンドは Firestore SDK を含まない
- バックエンドの Repository インターフェースを保ったまま実装だけ差し替え
- 既存の `lib/auth.js` `lib/security.js` `repo/session-repo.js` 等の認証層は維持
- Admin SDK は Firestore Security Rules をバイパス → 認可は Express 層で完結

---

## 3. 現状の DB 構造と Firestore マッピング

### 3.1 現状 (SQLite, `src/backend/repo/db.js` より)

11 テーブル:
- `rooms`
- `user_accounts` ← 既にホスト認証用に存在
- `sessions` ← cookie session 用
- `participants`
- `users`
- `user_context`
- `utterances`
- `dictionary`
- `room_analyses`
- `actions`
- `room_chunks` ← L9 でチャンク永続化用に追加

11 個の Repository が `src/backend/repo/*-repo.js` に存在 (`db.js` は除く)。

### 3.2 Firestore コレクション設計

#### `rooms/{roomId}`
```
{
  owner_id: string,                       // users.id (端末ローカル ID)
  owner_account_id: string | null,        // user_accounts.id (ログイン中なら設定)
  status: "active" | "ended" | "processing",
  created_at: Timestamp,
  ended_at: Timestamp | null,
  title: string,                          // ホストが設定する人間向けタイトル
  title_updated_at: Timestamp | null,
  summary_text: string,
  summary_updated_at: Timestamp | null,
  minutes_text: string,
  minutes_updated_at: Timestamp | null,
  todo_text: string,
  todo_updated_at: Timestamp | null,
  insights_status: "idle" | "processing" | "done" | "error",
  insights_dirty: boolean,
  material_summary: string,
  ai_provider: string | null,
  ai_model: string | null,
  use_past_meetings: boolean,
  ai_workspace_json: string,              // JSON 文字列 (カスタム解析の永続化)
  ai_workspace_updated_at: Timestamp | null,
  stt_provider: string,                   // F4 でホストが指定
  stt_language: string                    // F4 でホストが指定
}
```

#### `rooms/{roomId}/participants/{participantId}` (サブコレクション)
```
{
  user_id: string,
  user_account_id: string | null,         // ログイン参加者の場合
  display_name: string,
  control_token: string,                  // D-CONTROL-TOKEN-STRATEGY によりそのまま保存
  location_id: string | null,
  joined_at: Timestamp,
  left_at: Timestamp | null
}
```

#### `rooms/{roomId}/utterances/{utteranceId}` (サブコレクション)
```
{
  participant_id: string,
  user_id: string,
  started_at: Timestamp,
  ended_at: Timestamp | null,
  created_at: Timestamp,
  transcript: string,
  raw_transcript: string,
  transcript_source: "stt" | "ai" | "manual",
  corrected_at: Timestamp | null,
  is_starred: boolean,
  starred_at: Timestamp | null,
  memory_note: string,
  memo_text: string,
  memo_updated_at: Timestamp | null
}
```

#### `rooms/{roomId}/analyses/{analysisId}` (サブコレクション)
```
{
  type: "summary" | "todo" | "minutes" | "topic_tree" | "custom",
  input_prompt: string,
  result_text: string,
  created_at: Timestamp
}
```

#### `rooms/{roomId}/actions/{actionId}` (サブコレクション)
```
{
  speaker_id: string | null,
  speaker_name: string,
  action_text: string,
  created_at: Timestamp
}
```

#### `rooms/{roomId}/chunks/{chunkId}` (サブコレクション, L9)
```
{
  chunk_index: number,
  analysis_type: string,        // "minutes" 等
  start_ts: string,
  end_ts: string,
  result_text: string,
  status: "pending" | "running" | "done" | "error",
  created_at: Timestamp,
  updated_at: Timestamp
}
```

#### `users/{userId}` (端末ローカル ID)
```
{
  name: string,
  profile_text: string,
  account_id: string | null,    // ログイン参加者なら user_accounts.id
  created_at: Timestamp,
  context: {                    // user_context をネスト埋め込み
    project_summary: string,
    current_status: string,
    next_actions: string[],
    active_tasks: string[],
    past_decisions: string[],
    issues: string[],
    last_updated: Timestamp | null
  }
}
```

#### `user_accounts/{accountId}` (ホストアカウント)
```
{
  email: string,                // lowercased、検索用に冗長保存
  password_hash: string,        // scrypt 形式 (lib/passwords.js の出力)
  display_name: string,
  created_at: Timestamp,
  updated_at: Timestamp
}
```

#### `sessions/{sessionId}`
```
{
  account_id: string,
  token_hash: string,           // sha256(token), 元 token は cookie のみ
  expires_at: Timestamp,
  created_at: Timestamp,
  last_used_at: Timestamp
}
```

#### `dictionary/{termId}` (グローバル辞書)
```
{
  label: string,
  term: string,
  reading: string,
  created_at: Timestamp
}
```

#### `host_allowlist/{emailLowercased}` (Phase 3 で追加)
```
{
  email: string,                // ドキュメント ID と同じ
  display_name: string,
  added_by: string,             // 追加した owner の email
  added_at: Timestamp,
  note: string,
  disabled: boolean             // true ならサインアップ拒否
}
```

### 3.3 複合インデックス

`firestore.indexes.json`:
```json
{
  "indexes": [
    {
      "collectionGroup": "utterances",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "is_starred", "order": "ASCENDING" },
        { "fieldPath": "started_at", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rooms",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "owner_account_id", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "expires_at", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

`expires_at` の単一フィールドインデックスは自動だが、`pruneExpired` の整合性のため明示。

---

## 4. Phase 別タスク

各 Phase テンプレート: **Inputs → Steps → Deliverables → Acceptance**。

---

### Phase 0: 開発環境整備

#### Inputs
- 最新 `main`、`npm install && npm test` グリーン
- `gcloud` / `firebase` CLI ログイン済み

#### Steps

**S0-1. 依存追加**
```bash
npm install firebase-admin@^12
npm install --save-dev firebase-tools@^13
```

**S0-2. `firebase.json` を新規作成**
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

**S0-3. `firestore.rules` を新規作成 (Phase 4 までの仮置き)**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**S0-4. `firestore.indexes.json` を新規作成** (§3.3 を貼り付け)

**S0-5. `package.json` の `scripts` に追加**
```json
{
  "scripts": {
    "emulators": "firebase emulators:start --only firestore --project demo-test",
    "test:firestore": "cross-env DB_DRIVER=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 GOOGLE_CLOUD_PROJECT=demo-test NODE_ENV=test jest --runInBand"
  }
}
```
※ `cross-env` が devDependencies に無ければ追加: `npm install --save-dev cross-env`

**S0-6. GCP プロジェクトに Firestore を有効化 (1 回限り、手動)**
```bash
gcloud config set project <PROJECT_ID>
gcloud services enable firestore.googleapis.com
gcloud firestore databases create --location=asia-northeast1 --type=firestore-native
```
既に有効化済みの場合 3 行目はエラーになるが続行可。

**S0-7. `.gitignore` に追記**
```
.firebase/
firebase-debug.log
firestore-debug.log
.runtimeconfig.json
```

**S0-8. `README.md` の「実行方法」セクションに追記**
```markdown
### Firestore モードでローカル開発する
1. 別ターミナルで `npm run emulators`
2. `.env.local` に以下を設定:
   ```
   DB_DRIVER=firestore
   FIRESTORE_EMULATOR_HOST=localhost:8080
   GOOGLE_CLOUD_PROJECT=demo-test
   ```
3. `npm start`
```

#### Deliverables
- `firebase.json` (新規)
- `firestore.rules` (新規)
- `firestore.indexes.json` (新規)
- `package.json` (scripts + 依存追加)
- `.gitignore` (更新)
- `README.md` (更新)

#### Acceptance
- `npm run emulators` 起動状態で `firebase emulators:exec --only firestore "exit 0"` が exit 0
- `npm test` グリーン (SQLite 動作維持)

---

### Phase 1: DataStore 抽象化

#### Inputs
- Phase 0 完了
- 現状の `src/backend/server.js` (DI 部) と 11 個の Repository

#### 現状リポジトリ (移動対象、すべて `src/backend/repo/` 直下)
```
db.js (SQLite 初期化)
room-repo.js, participant-repo.js, utterance-repo.js, analysis-repo.js,
action-repo.js, user-repo.js, user-context-repo.js, dictionary-repo.js,
user-account-repo.js, session-repo.js, chunk-repo.js
```

#### Steps

**S1-1. `git mv` で sqlite/ 配下へ移動**
```bash
mkdir -p src/backend/repo/sqlite src/backend/repo/firestore
git mv src/backend/repo/db.js               src/backend/repo/sqlite/db.js
git mv src/backend/repo/room-repo.js        src/backend/repo/sqlite/room-repo.js
git mv src/backend/repo/participant-repo.js src/backend/repo/sqlite/participant-repo.js
git mv src/backend/repo/utterance-repo.js   src/backend/repo/sqlite/utterance-repo.js
git mv src/backend/repo/analysis-repo.js    src/backend/repo/sqlite/analysis-repo.js
git mv src/backend/repo/action-repo.js      src/backend/repo/sqlite/action-repo.js
git mv src/backend/repo/user-repo.js        src/backend/repo/sqlite/user-repo.js
git mv src/backend/repo/user-context-repo.js src/backend/repo/sqlite/user-context-repo.js
git mv src/backend/repo/dictionary-repo.js  src/backend/repo/sqlite/dictionary-repo.js
git mv src/backend/repo/user-account-repo.js src/backend/repo/sqlite/user-account-repo.js
git mv src/backend/repo/session-repo.js     src/backend/repo/sqlite/session-repo.js
git mv src/backend/repo/chunk-repo.js       src/backend/repo/sqlite/chunk-repo.js
```

**S1-2. `src/backend/repo/sqlite/index.js` を新規作成**
```js
const { initDB } = require('./db');
const { RoomRepository } = require('./room-repo');
const { ParticipantRepository } = require('./participant-repo');
const { UtteranceRepository } = require('./utterance-repo');
const { AnalysisRepository } = require('./analysis-repo');
const { ActionRepository } = require('./action-repo');
const { UserRepository } = require('./user-repo');
const { UserContextRepository } = require('./user-context-repo');
const { DictionaryRepo } = require('./dictionary-repo');
const { UserAccountRepository } = require('./user-account-repo');
const { SessionRepository } = require('./session-repo');
const { ChunkRepository } = require('./chunk-repo');

async function createRepos() {
    const dbPath = process.env.DB_PATH || './db/meeting.db';
    const db = await initDB(dbPath);
    return {
        roomRepo: new RoomRepository(db),
        participantRepo: new ParticipantRepository(db),
        utteranceRepo: new UtteranceRepository(db),
        analysisRepo: new AnalysisRepository(db),
        actionRepo: new ActionRepository(db),
        userRepo: new UserRepository(db),
        userContextRepo: new UserContextRepository(db),
        dictionaryRepo: new DictionaryRepo(db),
        accountRepo: new UserAccountRepository(db),
        sessionRepo: new SessionRepository(db),
        chunkRepo: new ChunkRepository(db),
        _raw: db
    };
}

module.exports = { createRepos };
```

**S1-3. `src/backend/repo/firestore/index.js` を新規作成 (スタブ)**
```js
async function createRepos() {
    throw new Error('Firestore driver not implemented yet (Phase 2)');
}
module.exports = { createRepos };
```

**S1-4. `src/backend/repo/index.js` を新規作成 (driver スイッチ)**
```js
async function createRepos() {
    const driver = process.env.DB_DRIVER || 'sqlite';
    if (driver === 'sqlite') return require('./sqlite').createRepos();
    if (driver === 'firestore') return require('./firestore').createRepos();
    throw new Error(`Unknown DB_DRIVER: ${driver}`);
}
module.exports = { createRepos };
```

**S1-5. `src/backend/server.js` を書き換え**
```js
require('dotenv').config();
const http = require('http');
const { createApp, setupWebSocket } = require('./app');
const { createRepos } = require('./repo');
const { AudioProcessor } = require('./services/audio-processor');
const { STTService } = require('./services/stt-service');
const { AIService } = require('./services/ai-service');

async function start() {
    const repos = await createRepos();

    try {
        const pruned = await repos.sessionRepo.pruneExpired();
        if (pruned > 0) console.log(`[startup] Pruned ${pruned} expired session(s).`);
    } catch (error) {
        console.error('[startup] Session prune failed:', error);
    }

    try {
        const swept = await repos.roomRepo.resetStuckProcessing();
        if (swept > 0) console.log(`[startup] Reset ${swept} room(s) from 'processing' to 'error'.`);
    } catch (error) {
        console.error('[startup] Failed to reset stuck insights_status:', error);
    }

    const audioProcessor = new AudioProcessor({ chunkLimit: 10 });
    const sttService = new STTService({
        provider: process.env.STT_PROVIDER || 'google',
        groqApiKey: process.env.GROQ_API_KEY,
        groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
        googleApiKey: process.env.GOOGLE_API_KEY,
        language: process.env.STT_LANGUAGE || 'ja'
    });
    const aiService = new AIService({
        provider: process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : 'gemini'),
        apiKey: process.env.GEMINI_API_KEY,
        groqApiKey: process.env.GROQ_API_KEY
    });
    repos.aiService = aiService;

    const app = createApp(repos);
    const server = http.createServer(app);

    const allowedOrigins = (process.env.WS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const wss = setupWebSocket(server, { ...repos, audioProcessor, sttService, allowedOrigins });
    repos.wss = wss;

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT} (driver=${process.env.DB_DRIVER || 'sqlite'})`);
    });
}

start().catch(console.error);
```

**S1-6. テスト側の import パス修正**

以下のテストファイルが直接 repo を import している:
- `tests/db.test.js` → `require('../src/backend/repo/sqlite/db')`
- `tests/room-repo.test.js` → `require('../src/backend/repo/sqlite/room-repo')`
- `tests/participant-repo.test.js` → 同様
- `tests/utterance-repo.test.js` → 同様
- `tests/user-context-repo.test.js` → 同様
- `tests/auth-account.test.js` → 同様 (UserAccountRepository, SessionRepository)
- `tests/_sync_check.js` → 同様

これらすべての `require` パスを `sqlite/` 経由に書き換える。

#### Deliverables
- `src/backend/repo/sqlite/` 12 ファイル
- `src/backend/repo/firestore/index.js` (スタブ)
- `src/backend/repo/index.js` (driver スイッチ)
- `src/backend/server.js` (書き換え)
- 影響を受けたテストの import 修正

#### Acceptance
- `npm test` (= sqlite モード) グリーン
- `DB_DRIVER=firestore npm start` を実行すると即座に `Firestore driver not implemented yet (Phase 2)` でクラッシュする (= スイッチが効いている証拠)

---

### Phase 2: Firestore Repository 実装

#### Inputs
- Phase 1 完了
- Firestore Emulator 起動可能

#### Steps

**S2-1. Firestore 初期化 + 共通ユーティリティ**

`src/backend/repo/firestore/db.js`
```js
const admin = require('firebase-admin');

let _db = null;

function getDb() {
    if (_db) return _db;
    if (!admin.apps.length) {
        admin.initializeApp({
            projectId: process.env.GOOGLE_CLOUD_PROJECT
        });
    }
    _db = admin.firestore();
    return _db;
}

function fromTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    return ts;
}

function toTimestamp(value) {
    if (value == null) return null;
    if (typeof value === 'string') return admin.firestore.Timestamp.fromDate(new Date(value));
    if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
    return value;
}

const serverTs = () => admin.firestore.FieldValue.serverTimestamp();

module.exports = { getDb, fromTimestamp, toTimestamp, serverTs, admin };
```

**S2-2. 11 個の Repository を Firestore 実装で作る**

**実装規則 (全 Repository に厳守)**:
1. SQLite 版 (`src/backend/repo/sqlite/<name>.js`) のメソッド名・引数・戻り値の形を変えない
2. SQLite で `boolean` フィールドが INTEGER 0/1 で返るところは Firestore でも `boolean` で揃え、Repository 層で必ず `!!` キャスト
3. Timestamp は出力時に `fromTimestamp()` で ISO 8601 文字列化、入力時は `serverTs()` または `toTimestamp()`
4. `undefined` は Firestore に書けない → `null` に変換
5. SQLite で `findById` が見つからない場合に `undefined` を返していたら Firestore も `undefined` を返す
6. SQLite で `db.run(... function(err){ this.changes })` を使っていた箇所 (= 削除件数取得) は Firestore では明示的にカウントを返す

**1 PR = 1 Repository** で進める。順序:
1. `room-repo.js` (リファレンス実装、§S2-3 参照)
2. `user-account-repo.js`
3. `session-repo.js` (テスト依存のため早めに)
4. `participant-repo.js`
5. `utterance-repo.js`
6. `analysis-repo.js`
7. `action-repo.js`
8. `user-repo.js`
9. `user-context-repo.js`
10. `dictionary-repo.js`
11. `chunk-repo.js`

**S2-3. リファレンス実装: `room-repo.js`**

SQLite 版 (`src/backend/repo/sqlite/room-repo.js`) が公開している全メソッド:
- `create(room)`
- `findById(id)`
- `findRoomsForAccount(accountId, opts)`
- `findEndedRoomsForAccount(accountId, opts)`
- `endRoom(id)`
- `updateAiConfig(id, provider, model, usePastMeetings)`
- `resetStuckProcessing()` → 件数を返す
- `updateInsights(roomId, updates)`
- `deleteCascade(roomId)` → 削除件数を返す

Firestore 版 (`src/backend/repo/firestore/room-repo.js`):
```js
const { getDb, fromTimestamp, serverTs, admin } = require('./db');

class RoomRepository {
    constructor() {
        this.col = getDb().collection('rooms');
    }

    _toDomain(id, d) {
        return {
            id,
            owner_id: d.owner_id,
            owner_account_id: d.owner_account_id || null,
            status: d.status,
            material_summary: d.material_summary || '',
            title: d.title || '',
            created_at: fromTimestamp(d.created_at),
            ended_at: fromTimestamp(d.ended_at),
            title_updated_at: fromTimestamp(d.title_updated_at),
            summary_text: d.summary_text || '',
            summary_updated_at: fromTimestamp(d.summary_updated_at),
            minutes_text: d.minutes_text || '',
            minutes_updated_at: fromTimestamp(d.minutes_updated_at),
            todo_text: d.todo_text || '',
            todo_updated_at: fromTimestamp(d.todo_updated_at),
            insights_status: d.insights_status || 'idle',
            insights_dirty: !!d.insights_dirty ? 1 : 0,  // SQLite 互換 (INTEGER)
            ai_provider: d.ai_provider || null,
            ai_model: d.ai_model || null,
            use_past_meetings: !!d.use_past_meetings ? 1 : 0,
            ai_workspace_json: d.ai_workspace_json || '',
            ai_workspace_updated_at: fromTimestamp(d.ai_workspace_updated_at),
            stt_provider: d.stt_provider || '',
            stt_language: d.stt_language || ''
        };
    }

    async create(room) {
        const {
            id, owner_id, material_summary,
            owner_account_id = null,
            use_past_meetings = true,
            stt_provider = '',
            stt_language = ''
        } = room;
        await this.col.doc(id).set({
            owner_id,
            owner_account_id,
            status: 'active',
            material_summary: material_summary || '',
            use_past_meetings: !!use_past_meetings,
            stt_provider,
            stt_language,
            created_at: serverTs(),
            ended_at: null,
            title: '',
            title_updated_at: null,
            summary_text: '',
            summary_updated_at: null,
            minutes_text: '',
            minutes_updated_at: null,
            todo_text: '',
            todo_updated_at: null,
            insights_status: 'idle',
            insights_dirty: false,
            ai_provider: null,
            ai_model: null,
            ai_workspace_json: '',
            ai_workspace_updated_at: null
        });
    }

    async findById(id) {
        const snap = await this.col.doc(id).get();
        if (!snap.exists) return undefined;
        return this._toDomain(id, snap.data());
    }

    async findRoomsForAccount(accountId, { limit = 50 } = {}) {
        if (!accountId) return [];
        // owner として所有しているルーム
        const ownerSnap = await this.col
            .where('owner_account_id', '==', accountId)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .get();
        const ownerRooms = ownerSnap.docs.map((d) => this._toDomain(d.id, d.data()));

        // participant として参加したルームは collectionGroup で逆引き
        const partSnap = await getDb().collectionGroup('participants')
            .where('user_account_id', '==', accountId)
            .get();
        const roomIds = new Set(partSnap.docs.map((d) => d.ref.parent.parent.id));
        for (const r of ownerRooms) roomIds.delete(r.id); // 重複排除

        const joined = [];
        for (const rid of roomIds) {
            const r = await this.findById(rid);
            if (r) joined.push(r);
        }
        const all = [...ownerRooms, ...joined];
        all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return all.slice(0, limit);
    }

    async findEndedRoomsForAccount(accountId, { limit = 5, excludeRoomId = null } = {}) {
        const all = await this.findRoomsForAccount(accountId, { limit: 200 });
        return all
            .filter((r) => r.status === 'ended' && r.summary_text && r.summary_text.trim() !== '')
            .filter((r) => !excludeRoomId || r.id !== excludeRoomId)
            .sort((a, b) => (b.ended_at || b.created_at || '').localeCompare(a.ended_at || a.created_at || ''))
            .slice(0, limit);
    }

    async endRoom(id) {
        await this.col.doc(id).update({ status: 'ended', ended_at: serverTs() });
    }

    async updateAiConfig(id, provider, model, usePastMeetings = null) {
        const fields = { ai_provider: provider, ai_model: model };
        if (typeof usePastMeetings === 'boolean') fields.use_past_meetings = usePastMeetings;
        await this.col.doc(id).update(fields);
    }

    async resetStuckProcessing() {
        const snap = await this.col.where('insights_status', '==', 'processing').get();
        const batch = getDb().batch();
        snap.docs.forEach((d) => batch.update(d.ref, { insights_status: 'error' }));
        if (snap.size > 0) await batch.commit();
        return snap.size;
    }

    async updateInsights(roomId, updates = {}) {
        const fields = {};
        const now = serverTs();
        if (typeof updates.summary_text === 'string') { fields.summary_text = updates.summary_text; fields.summary_updated_at = now; }
        if (typeof updates.minutes_text === 'string') { fields.minutes_text = updates.minutes_text; fields.minutes_updated_at = now; }
        if (typeof updates.todo_text === 'string')    { fields.todo_text = updates.todo_text; fields.todo_updated_at = now; }
        if (typeof updates.material_summary === 'string') fields.material_summary = updates.material_summary;
        if (typeof updates.title === 'string') { fields.title = updates.title; fields.title_updated_at = now; }
        if (typeof updates.ai_workspace_json === 'string') { fields.ai_workspace_json = updates.ai_workspace_json; fields.ai_workspace_updated_at = now; }
        if (typeof updates.insights_status === 'string') fields.insights_status = updates.insights_status;
        if (typeof updates.insights_dirty === 'boolean') fields.insights_dirty = updates.insights_dirty;
        if (typeof updates.use_past_meetings === 'boolean') fields.use_past_meetings = updates.use_past_meetings;

        if (Object.keys(fields).length === 0) return this.findById(roomId);
        await this.col.doc(roomId).update(fields);
        return this.findById(roomId);
    }

    async deleteCascade(roomId) {
        const subs = ['participants', 'utterances', 'analyses', 'actions', 'chunks'];
        const docRef = this.col.doc(roomId);
        for (const sub of subs) {
            const snap = await docRef.collection(sub).get();
            const batch = getDb().batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            if (snap.size > 0) await batch.commit();
        }
        const exists = (await docRef.get()).exists;
        if (exists) await docRef.delete();
        return exists ? 1 : 0;
    }
}

module.exports = { RoomRepository };
```

他 10 個の Repository も同パターン。SQLite 版のメソッドシグネチャを忠実にコピーする。

**S2-4. `firestore/index.js` の `createRepos` 実装**
```js
const { RoomRepository } = require('./room-repo');
const { ParticipantRepository } = require('./participant-repo');
const { UtteranceRepository } = require('./utterance-repo');
const { AnalysisRepository } = require('./analysis-repo');
const { ActionRepository } = require('./action-repo');
const { UserRepository } = require('./user-repo');
const { UserContextRepository } = require('./user-context-repo');
const { DictionaryRepo } = require('./dictionary-repo');
const { UserAccountRepository } = require('./user-account-repo');
const { SessionRepository } = require('./session-repo');
const { ChunkRepository } = require('./chunk-repo');

async function createRepos() {
    return {
        roomRepo: new RoomRepository(),
        participantRepo: new ParticipantRepository(),
        utteranceRepo: new UtteranceRepository(),
        analysisRepo: new AnalysisRepository(),
        actionRepo: new ActionRepository(),
        userRepo: new UserRepository(),
        userContextRepo: new UserContextRepository(),
        dictionaryRepo: new DictionaryRepo(),
        accountRepo: new UserAccountRepository(),
        sessionRepo: new SessionRepository(),
        chunkRepo: new ChunkRepository()
    };
}

module.exports = { createRepos };
```

**S2-5. テスト戦略**

`tests/setup.js` を新規作成:
```js
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
```

`jest.config.js` を新規作成:
```js
module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    testTimeout: 15000
};
```

既存の repo 直接 import テスト (Phase 1 で sqlite/ 経由に書き換え済み) は SQLite モードのみで通る。それは想定通り。Firestore 側は app.js 経由の API テスト (`api-rooms.test.js`, `auth-account.test.js`, `me-rooms.test.js` 等) で `DB_DRIVER=firestore` を効かせて両モードを通す。

**S2-6. 疎通スクリプト** `scripts/smoke-firestore.sh`
```bash
#!/usr/bin/env bash
set -e
DB_DRIVER=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 \
GOOGLE_CLOUD_PROJECT=demo-test PORT=3001 \
node src/backend/server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
sleep 2
EMAIL="smoke-$(date +%s)@example.com"
curl -s -X POST http://localhost:3001/auth/signup -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\",\"display_name\":\"smoke\"}" | grep -q '"id"' || exit 1
echo "smoke OK"
```
※ Phase 3 でサインアップが allowlist 制限されたら、このスクリプトは事前に `host_allowlist` に該当メールを追加する必要あり。

#### Deliverables
- `src/backend/repo/firestore/db.js`
- `src/backend/repo/firestore/*-repo.js` × 11
- `src/backend/repo/firestore/index.js`
- `tests/setup.js` (新規)
- `jest.config.js` (新規)
- `scripts/smoke-firestore.sh` (新規)
- `package.json` の `pretest` を Windows 互換にしたい場合は確認 (現状 `npm.cmd run` なので Linux CI 必要なら別途)

#### Acceptance
1. `npm test` グリーン (sqlite)
2. 別ターミナルで `npm run emulators` → `npm run test:firestore` グリーン
3. `npm run emulators` 起動状態で `bash scripts/smoke-firestore.sh` exit 0

---

### Phase 3: ホストアカウント管理 (allowlist + admin UI)

**目的**: 既存 email/password 認証をベースに、サインアップを allowlist で制限し、オーナーがホストを管理できるようにする。

**前提**:
- 既に `lib/auth.js` `repo/user-account-repo.js` `repo/session-repo.js` `lib/passwords.js` が存在
- 既に `/auth/signup` `/auth/login` `/auth/logout` `/auth/me` 等が動作している
- 本 Phase は **これらを破壊せず拡張する**

#### Sub-Phase 3a: host_allowlist と signup ゲート

**Inputs**: Phase 2 完了

**Steps**:

**S3a-1. SQLite と Firestore 両方に `host_allowlist` 追加**

SQLite (`src/backend/repo/sqlite/db.js`) に CREATE TABLE 追加:
```sql
CREATE TABLE IF NOT EXISTS host_allowlist (
    email TEXT PRIMARY KEY,
    display_name TEXT DEFAULT '',
    added_by TEXT DEFAULT '',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT DEFAULT '',
    disabled INTEGER DEFAULT 0
);
```

**S3a-2. `host-allowlist-repo.js` を両 driver で実装**

`src/backend/repo/sqlite/host-allowlist-repo.js`:
```js
class HostAllowlistRepository {
    constructor(db) { this.db = db; }

    async findByEmail(email) {
        const lower = (email || '').toLowerCase();
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM host_allowlist WHERE email = ?', [lower], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async list() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM host_allowlist ORDER BY added_at DESC', (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    async add({ email, display_name = '', note = '', added_by = '' }) {
        const lower = email.toLowerCase();
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO host_allowlist (email, display_name, note, added_by) VALUES (?, ?, ?, ?)`,
                [lower, display_name, note, added_by],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async remove(email) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM host_allowlist WHERE email = ?', [email.toLowerCase()], (err) => err ? reject(err) : resolve());
        });
    }

    async setDisabled(email, disabled) {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE host_allowlist SET disabled = ? WHERE email = ?', [disabled ? 1 : 0, email.toLowerCase()], (err) => err ? reject(err) : resolve());
        });
    }
}
module.exports = { HostAllowlistRepository };
```

`src/backend/repo/firestore/host-allowlist-repo.js`:
```js
const { getDb, fromTimestamp, serverTs } = require('./db');

class HostAllowlistRepository {
    constructor() { this.col = getDb().collection('host_allowlist'); }

    async findByEmail(email) {
        const lower = (email || '').toLowerCase();
        const snap = await this.col.doc(lower).get();
        if (!snap.exists) return null;
        const d = snap.data();
        return {
            email: d.email,
            display_name: d.display_name || '',
            added_by: d.added_by || '',
            added_at: fromTimestamp(d.added_at),
            note: d.note || '',
            disabled: !!d.disabled ? 1 : 0
        };
    }

    async list() {
        const snap = await this.col.orderBy('added_at', 'desc').get();
        return snap.docs.map((doc) => {
            const d = doc.data();
            return {
                email: d.email,
                display_name: d.display_name || '',
                added_by: d.added_by || '',
                added_at: fromTimestamp(d.added_at),
                note: d.note || '',
                disabled: !!d.disabled ? 1 : 0
            };
        });
    }

    async add({ email, display_name = '', note = '', added_by = '' }) {
        const lower = email.toLowerCase();
        await this.col.doc(lower).set({
            email: lower, display_name, note, added_by,
            added_at: serverTs(), disabled: false
        }, { merge: true });
    }

    async remove(email) { await this.col.doc(email.toLowerCase()).delete(); }

    async setDisabled(email, disabled) {
        await this.col.doc(email.toLowerCase()).update({ disabled: !!disabled });
    }
}
module.exports = { HostAllowlistRepository };
```

両 driver の `index.js` に `hostAllowlistRepo` を追加。

**S3a-3. `/auth/signup` を allowlist で制限**

`src/backend/app.js` の `/auth/signup` ハンドラ冒頭に追加:
```js
app.post('/auth/signup', authLimiter, async (req, res) => {
    try {
        const { email, password, display_name } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email/password required' });

        const lower = email.toLowerCase();
        const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();

        // OWNER_EMAIL 一致なら無条件でサインアップ可
        if (lower !== ownerEmail) {
            // それ以外は allowlist 必須
            const entry = await repos.hostAllowlistRepo.findByEmail(lower);
            if (!entry || entry.disabled) {
                return res.status(403).json({ error: 'signup not allowed for this email' });
            }
        }

        // 以下、既存のサインアップ処理 (passwords.hashPassword + accountRepo.create + sessionRepo.create + cookie)
        // ...
    } catch (err) { ... }
});
```

**S3a-4. テスト時のバイパス**

既存の `securityHeaders` / `createRateLimiter` は `NODE_ENV=test` で挙動が変わる。allowlist は明示的に env で制御:

`src/backend/app.js`:
```js
const SIGNUP_ALLOWLIST_DISABLED = process.env.SIGNUP_ALLOWLIST_DISABLED === 'true' || process.env.NODE_ENV === 'test';
```
ハンドラ内で `if (!SIGNUP_ALLOWLIST_DISABLED)` でガード。

**Deliverables**:
- `src/backend/repo/sqlite/host-allowlist-repo.js`
- `src/backend/repo/firestore/host-allowlist-repo.js`
- `src/backend/repo/sqlite/db.js` (CREATE TABLE 追加)
- `src/backend/repo/sqlite/index.js` (`hostAllowlistRepo` 追加)
- `src/backend/repo/firestore/index.js` (同上)
- `src/backend/app.js` (`/auth/signup` のゲート追加)

**Acceptance**:
- `npm run test:all` グリーン (allowlist がテストでバイパスされる)
- `tests/auth-allowlist.test.js` 新規: `SIGNUP_ALLOWLIST_DISABLED=false` 環境で `/auth/signup` が allowlist 未登録メールに 403 を返す

---

#### Sub-Phase 3b: /admin ホスト管理 UI

**Inputs**: 3a 完了

**Steps**:

**S3b-1. 認可ヘルパーを追加**

`src/backend/lib/auth.js` の `createAuth({...})` 内に追加:
```js
async function requireOwner(req, res, next) {
    await requireSession(req, res, async () => {
        const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
        if (!ownerEmail) return res.status(500).json({ error: 'OWNER_EMAIL not configured' });
        if ((req.account.email || '').toLowerCase() !== ownerEmail) {
            return res.status(403).json({ error: 'owner only' });
        }
        next();
    });
}
```

返り値オブジェクトに `requireOwner` を追加。`createApp` 側で `auth.requireOwner` として参照。

**S3b-2. admin ルートを追加**

`src/backend/app.js`:
```js
app.get('/admin/hosts', requireOwner, async (req, res) => {
    const hosts = await repos.hostAllowlistRepo.list();
    res.json({ hosts });
});

app.post('/admin/hosts', requireOwner, async (req, res) => {
    const { email, display_name, note } = req.body || {};
    if (!email || !display_name) return res.status(400).json({ error: 'email and display_name required' });
    if (email.toLowerCase() === (process.env.OWNER_EMAIL || '').toLowerCase()) {
        return res.status(400).json({ error: 'cannot add owner to allowlist' });
    }
    await repos.hostAllowlistRepo.add({
        email, display_name, note: note || '',
        added_by: req.account.email
    });
    res.json({ ok: true });
});

app.delete('/admin/hosts/:email', requireOwner, async (req, res) => {
    if (req.params.email.toLowerCase() === (process.env.OWNER_EMAIL || '').toLowerCase()) {
        return res.status(400).json({ error: 'cannot remove owner' });
    }
    await repos.hostAllowlistRepo.remove(req.params.email);
    res.json({ ok: true });
});

app.patch('/admin/hosts/:email', requireOwner, async (req, res) => {
    const { disabled } = req.body || {};
    if (typeof disabled !== 'boolean') return res.status(400).json({ error: 'disabled must be boolean' });
    await repos.hostAllowlistRepo.setDisabled(req.params.email, disabled);
    res.json({ ok: true });
});
```

**S3b-3. /admin ページ追加**

`src/frontend/admin.html` 新規:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Admin - ホスト管理</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="admin-app">
        <div id="login-section">
            <h1>管理画面 (オーナー専用)</h1>
            <p>オーナーのアカウントでログインしてください。</p>
            <p><a href="/">トップへ戻る</a></p>
        </div>
        <div id="admin-section" hidden>
            <h1>ホスト管理</h1>
            <p>あなた: <span id="current-user-email"></span></p>
            <h2>登録済みホスト</h2>
            <table id="host-table">
                <thead><tr><th>Email</th><th>名前</th><th>追加日</th><th>状態</th><th>操作</th></tr></thead>
                <tbody id="host-tbody"></tbody>
            </table>
            <h2>ホスト追加</h2>
            <form id="add-host-form">
                <input name="email" type="email" placeholder="email@example.com" required>
                <input name="display_name" placeholder="表示名" required>
                <input name="note" placeholder="メモ (任意)">
                <button type="submit">追加</button>
            </form>
            <pre id="error-output"></pre>
        </div>
    </div>
    <script src="admin.js"></script>
</body>
</html>
```

`src/frontend/admin.js` 新規:
```js
async function api(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

async function init() {
    try {
        const me = await api('GET', '/auth/me');
        if (!me || !me.account) {
            // 未ログイン
            return;
        }
        // オーナーかどうかは GET /admin/hosts のレスポンスで判定 (403 なら非オーナー)
        try {
            const { hosts } = await api('GET', '/admin/hosts');
            document.getElementById('login-section').hidden = true;
            document.getElementById('admin-section').hidden = false;
            document.getElementById('current-user-email').textContent = me.account.email;
            renderHosts(hosts);
        } catch (e) {
            document.getElementById('login-section').innerHTML = '<h1>権限がありません</h1>';
        }
    } catch (e) {
        // 未ログイン → デフォルト画面のまま
    }
}

function renderHosts(hosts) {
    const tbody = document.getElementById('host-tbody');
    tbody.innerHTML = '';
    for (const h of hosts) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${h.email}</td>
            <td>${h.display_name || ''}</td>
            <td>${h.added_at || '-'}</td>
            <td>${h.disabled ? '無効' : '有効'}</td>
            <td>
                <button data-action="toggle" data-email="${h.email}" data-disabled="${h.disabled}">${h.disabled ? '有効化' : '無効化'}</button>
                <button data-action="remove" data-email="${h.email}">削除</button>
            </td>`;
        tbody.appendChild(tr);
    }
}

document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('#host-tbody button');
    if (!btn) return;
    const { action, email, disabled } = btn.dataset;
    try {
        if (action === 'remove' && confirm(`${email} を削除しますか？`)) {
            await api('DELETE', `/admin/hosts/${encodeURIComponent(email)}`);
        } else if (action === 'toggle') {
            await api('PATCH', `/admin/hosts/${encodeURIComponent(email)}`, { disabled: disabled !== 'true' });
        }
        const { hosts } = await api('GET', '/admin/hosts');
        renderHosts(hosts);
    } catch (e) {
        document.getElementById('error-output').textContent = e.message;
    }
});

document.getElementById('add-host-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
        await api('POST', '/admin/hosts', {
            email: fd.get('email'),
            display_name: fd.get('display_name'),
            note: fd.get('note')
        });
        ev.target.reset();
        const { hosts } = await api('GET', '/admin/hosts');
        renderHosts(hosts);
    } catch (e) {
        document.getElementById('error-output').textContent = e.message;
    }
});

init();
```

**S3b-4. Express で `/admin` を `admin.html` にルーティング**

既存の静的配信 `app.use(express.static(path.join(__dirname, '../frontend')))` で `admin.html` `admin.js` が自動配信される。明示ルートは不要。

ただし `/admin` で `admin.html` を返したい場合のみ:
```js
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../frontend/admin.html')));
```

**Deliverables**:
- `src/backend/lib/auth.js` (`requireOwner` 追加)
- `src/backend/app.js` (admin ルート 4 本)
- `src/frontend/admin.html`
- `src/frontend/admin.js`
- `package.json` の `check:frontend` に `node --check src/frontend/admin.js` を追加

**Acceptance**:
- `tests/admin-routes.test.js` 新規:
  - 未ログインで `GET /admin/hosts` → 401
  - オーナー以外でログイン中 `GET /admin/hosts` → 403
  - オーナーでログイン中 → 200 + 配列
  - 同様に POST/DELETE/PATCH も検証
- 手動: `OWNER_EMAIL=you@example.com npm start` 起動 → ブラウザで `/admin` 開く → ログイン後にホスト追加・削除・無効化が動く

---

#### Sub-Phase 3c: control_token の取り扱い (任意、現状維持で可)

**判断**: `D-CONTROL-TOKEN-STRATEGY` により **現状の participant_id + control_token を Firestore にそのまま保存**。HMAC 化はしない。

**根拠**:
- Firestore Security Rules (Phase 4) で全 deny にするため、Admin SDK 経由以外で読まれない
- Cloud Logging には participant_id/control_token は出さない既存実装 (URL クエリで渡さず Body で渡す経路あり、確認のこと)
- バックアップエクスポート時の漏洩リスクはあるが、個人利用規模では受容範囲

**Steps (確認のみ)**:

**S3c-1. URL クエリでの control_token 受け渡しを停止**

`lib/auth.js` の `extractCreds` は body と query 両対応だが、フロント側からは body のみ送るように統一:
- `src/frontend/auth.js` `meeting-ui.js` `shared-ai.js` 等で `?control_token=...` 形式の fetch がないか grep
- 残っていれば body or `Authorization` ヘッダ経由に置換

**S3c-2. テスト追加**

`tests/control-token.test.js` 新規: control_token を URL クエリに乗せずに参加 → 200。乗せると Cloud Logging に出る危険性を README に注記。

**Deliverables**:
- フロントの fetch 呼び出しの修正 (該当があれば)
- `tests/control-token.test.js`

**Acceptance**:
- `grep -rn "control_token=" src/frontend/` の出力が空、または body 内 (POST data) のみ

---

#### Sub-Phase 3d: 本番向けの追加レート制限

既存の `lib/security.js` に `generalLimiter (120/min)` `aiLimiter (20/min)` `authLimiter (8/min)` がある。本番投入時にもう 1 段増やす:

**S3d-1. 既存の制限を見直し**

ホスト操作の上限を絞る:
- `app.use('/admin', generalLimiter)` で十分 (admin は IP 当たり 120/min)
- 必要なら `adminLimiter (windowMs=60_000, max=30)` を追加して `/admin` に適用

**S3d-2. ルーム作成だけ別制限**
```js
const roomCreateLimiter = createRateLimiter({ windowMs: 60_000, max: 5, key: 'room-create' });
app.post('/rooms', roomCreateLimiter, requireSession, async (req, res) => { ... });
```

**Deliverables**:
- `src/backend/app.js` に追加 limiter

**Acceptance**:
- `tests/rate-limit.test.js` で `NODE_ENV=production` を一時的にエミュレートして 429 が返ることを確認 (`createRateLimiter` のテストモードバイパスを上書きする方法を検討)

---

### Phase 4: Firestore Security Rules

#### Inputs
- Phase 3 完了
- `firebase login` 済み

#### Steps

**S4-1. `firestore.rules` を本番用に確定** (Phase 0 の仮置きと同一)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**S4-2. デプロイ**
```bash
firebase use <PROJECT_ID>
firebase deploy --only firestore:rules,firestore:indexes
```

#### Acceptance
- `firebase firestore:rules:get` の出力が S4-1 と一致
- 手動: ブラウザの DevTools コンソールで `fetch('https://firestore.googleapis.com/v1/projects/<PROJECT_ID>/databases/(default)/documents/rooms')` を試して 403 (Permission denied) が返ること

---

### Phase 5: Cloud Run 環境設定 (既存 cloudbuild.yaml を活用)

#### Inputs
- Phase 0-4 すべて完了
- ローカルで `DB_DRIVER=firestore npm start` が完走

#### 既存の状態
- `cloudbuild.yaml` で `winwinreco` サービスへの自動デプロイが設定済み
- Cloud Build トリガが GitHub main への push を検知してビルド+デプロイする

#### Steps

**S5-1. Secret Manager にシークレット登録 (1 回限り、手動)**
```bash
PROJECT_ID=$(gcloud config get-value project)

# シークレット作成
echo -n "$GEMINI_API_KEY_VALUE" | gcloud secrets create gemini-api-key --data-file=-
echo -n "$GOOGLE_API_KEY_VALUE" | gcloud secrets create google-api-key --data-file=-
echo -n "$GROQ_API_KEY_VALUE"   | gcloud secrets create groq-api-key   --data-file=-

# Cloud Run のサービスアカウントを取得
SA=$(gcloud run services describe winwinreco --region=asia-northeast1 --format='value(spec.template.spec.serviceAccountName)')
if [ -z "$SA" ]; then
    SA="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi

# 各シークレットの読み取り権限を付与
for SECRET in gemini-api-key google-api-key groq-api-key; do
    gcloud secrets add-iam-policy-binding $SECRET \
        --member="serviceAccount:$SA" \
        --role="roles/secretmanager.secretAccessor"
done

# Firestore アクセス権限を付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA" \
    --role="roles/datastore.user"
```

**S5-2. `cloudbuild.yaml` に環境変数とシークレット設定を追加**

現状の `cloudbuild.yaml` のデプロイステップ (3 番目) に `--set-env-vars` と `--set-secrets` を追加:
```yaml
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - winwinreco
      - '--image=asia-northeast1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/winwinreco:$COMMIT_SHA'
      - '--region=asia-northeast1'
      - '--platform=managed'
      - '--quiet'
      - '--min-instances=0'
      - '--max-instances=2'
      - '--concurrency=80'
      - '--memory=512Mi'
      - '--set-env-vars=DB_DRIVER=firestore,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,AI_PROVIDER=gemini,STT_PROVIDER=google,STT_LANGUAGE=ja,COOKIE_SECURE=true,WS_ALLOWED_ORIGINS=https://winwinreco-XXXXXXXX-an.a.run.app,OWNER_EMAIL=you@example.com'
      - '--set-secrets=GEMINI_API_KEY=gemini-api-key:latest,GOOGLE_API_KEY=google-api-key:latest,GROQ_API_KEY=groq-api-key:latest'
```

**注意**:
- `WS_ALLOWED_ORIGINS` の値は実際の Cloud Run URL に置換 (初回デプロイ後に取得)
- `OWNER_EMAIL` は実値に置換
- 値はソース管理されるので、ホスト名変更時は `cloudbuild.yaml` を更新する形。「秘匿したい設定」だけは Secret Manager に逃がす

**S5-3. 初回デプロイ後の Cloud Run URL 取得と `WS_ALLOWED_ORIGINS` 反映**
```bash
URL=$(gcloud run services describe winwinreco --region=asia-northeast1 --format='value(status.url)')
echo "Cloud Run URL: $URL"
# cloudbuild.yaml の WS_ALLOWED_ORIGINS を $URL に書き換えてコミット → 再デプロイ
```

**S5-4. オーナーアカウントの初回登録**

allowlist の存在によりオーナー以外はサインアップできない。**オーナーの初回サインアップは `OWNER_EMAIL` で自動許可される** (S3a-3 の実装) のでブラウザから普通に `/auth/signup` する:
1. デプロイ後、`<URL>/` を開く
2. アカウント作成 → email = `OWNER_EMAIL` の値、任意のパスワード
3. ログイン → `<URL>/admin` で他のホストを追加できる状態

**S5-5. Budget Alert 設定 (1 回限り、手動)**

Cloud Console > Billing > Budgets & alerts > CREATE BUDGET:
- 予算名: `winwinreco-personal`
- 金額: $20/月
- アラート閾値: 25% / 50% / 100% ($5 / $10 / $20)
- アラート送信先: 自分の Gmail

#### Deliverables
- `cloudbuild.yaml` (env vars + secrets 追加)
- Secret Manager に登録済みのシークレット (手動)

#### Acceptance
- 本番 URL で `/auth/signup` (オーナーメール) → ログイン → ルーム作成 → 録音 → 議事録生成が完走
- Firestore Console で `rooms`, `user_accounts`, `sessions` ドキュメントが生成されている
- Cloud Logging に `permission-denied` `auth required` のエラーが多発していない
- Budget Alert が設定済み (Cloud Console で確認)
- `<URL>/admin` でホスト追加可能、追加された人がサインアップ可能

---

### Phase 6: 仕上げ

#### Steps

**S6-1. `docs/ARCHITECTURE.md` の `Persistence Layer` セクション追加**

```markdown
## Persistence Layer

DB driver is selected via `DB_DRIVER` environment variable:
- `sqlite` (default): local file `db/meeting.db` for development
- `firestore`: Cloud Firestore via firebase-admin SDK

Both drivers expose identical Repository interfaces from `src/backend/repo/{sqlite,firestore}/*-repo.js`. The factory in `src/backend/repo/index.js` returns the appropriate set.

Production (Cloud Run) always runs `DB_DRIVER=firestore`.
Development can use either; CI runs both via `npm test` and `npm run test:firestore`.
```

**S6-2. `PROGRESS.md` に新節**
```markdown
## NN. Firestore 移行と公開時セキュリティ強化 (YYYY-MM-DD)
- DataStore 抽象化レイヤーを追加 (`DB_DRIVER` で sqlite/firestore 切替)
- 11 個の Repository を Firestore 実装で並走化
- ホスト allowlist + /admin 管理画面を追加
- Cloud Run + Firestore で本番稼働開始
- Firestore Security Rules を全 deny で確定
```

**S6-3. `docs/BACKUP_PLAYBOOK.md` 新規**
```markdown
# Firestore バックアップ運用 (月次手動)

## 手順 (毎月 1 日に実行)
1. `gcloud config set project <PROJECT_ID>`
2. バケット未作成なら: `gsutil mb -l asia-northeast1 gs://<PROJECT_ID>-firestore-backup`
3. `gcloud firestore export gs://<PROJECT_ID>-firestore-backup/$(date +%Y%m%d)`
4. 古いエクスポート (3 ヶ月超) を削除: `gsutil -m rm -r gs://<PROJECT_ID>-firestore-backup/<old-date>`

## 復旧
`gcloud firestore import gs://<PROJECT_ID>-firestore-backup/<DATE>`
```

**S6-4. `.env.example` を新規作成**
```
PORT=3000
DB_DRIVER=sqlite
DB_PATH=./db/meeting.db

# Firestore (DB_DRIVER=firestore のとき必須)
GOOGLE_CLOUD_PROJECT=
FIRESTORE_EMULATOR_HOST=

# AI
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=
GROQ_API_KEY=
GROQ_STT_MODEL=

# STT
STT_PROVIDER=google
STT_LANGUAGE=ja
GOOGLE_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_STT_MODEL=
ELEVENLABS_STT_REALTIME_MODEL=

# Auth / Cookie
COOKIE_SECURE=false
OWNER_EMAIL=
SIGNUP_ALLOWLIST_DISABLED=

# WebSocket
WS_ALLOWED_ORIGINS=
```

#### Deliverables
- `docs/ARCHITECTURE.md` 更新
- `PROGRESS.md` 更新
- `docs/BACKUP_PLAYBOOK.md` 新規
- `.env.example` 新規

#### Acceptance
- `git status` で上記ファイルが追跡されている
- README → ARCHITECTURE → BACKUP_PLAYBOOK の順に読めば運用に必要な情報が揃う

---

## 5. セキュリティ設計詳細

### 5.1 既存実装の活用 (再確認)

| 既存機能 | 場所 | Phase で触るか |
|---|---|---|
| email/password サインアップ | `lib/passwords.js` (scrypt) + `repo/user-account-repo.js` | 3a で allowlist 追加のみ |
| cookie session | `lib/cookies.js` + `repo/session-repo.js` | そのまま流用 |
| `requireParticipant` / `requireHost` / `requireSession` | `lib/auth.js` | 3b で `requireOwner` 追加のみ |
| レート制限 | `lib/security.js` `createRateLimiter` | 3d で見直し |
| セキュリティヘッダ (CSP 等) | `lib/security.js` `securityHeaders` | そのまま流用 |
| WS Origin 検証 | `lib/security.js` `isAllowedOrigin` | `WS_ALLOWED_ORIGINS` を本番値に設定 |

### 5.2 脅威モデル

| 脅威 | 対策 |
|---|---|
| ルーム ID 総当たり | 既存 `generalLimiter` (120/min) + Firestore Security Rules |
| API キー流出 | Phase 5 Secret Manager + Phase 5 Budget Alert |
| Firestore 直接アクセス | Phase 4 Security Rules 全 deny |
| 不要な人によるサインアップ | Phase 3a allowlist |
| ホストの乱用 | 既存 `aiLimiter` (20/min) + `/admin` で `disabled=true` 即無効化 |
| オーナー乗っ取り | Gmail の 2FA を必ず有効化 + `OWNER_EMAIL` を環境変数固定 |
| Cloud Run DDoS | `max-instances=2` + Budget Alert |

### 5.3 やってはいけないこと

| 禁止 | 理由 |
|---|---|
| フロントに API キーを埋め込む | 課金爆発 |
| `control_token` を URL クエリに乗せる | Cloud Logging に残る |
| `firestore.rules` を `if true` にする | 直接アクセス可能 |
| サービスアカウント JSON キーをコミット | ADC で十分、JSON 不要 |
| `/admin` をフロントだけで隠す | バックエンドで `requireOwner` 必須 |
| メールを大文字小文字混在で保存 | 必ず lowercased で正規化 (既存実装そう) |
| オーナーを `host_allowlist` に追加 | OWNER_EMAIL は env 固定で allowlist 不要 |
| `OWNER_EMAIL` を Firestore に置く | 自爆防止のため env 固定 |

---

## 6. コスト見積もり (個人利用)

月間想定: ルーム 30 個 / 1 ルーム 200 utterances / 議事録 30 回

| 項目 | 想定使用量 | 無料枠 | 想定コスト |
|---|---|---|---|
| Firestore 書き込み | ~7,000/月 | 20,000/日 | $0 |
| Firestore 読み取り | ~30,000/月 | 50,000/日 | $0 |
| Firestore ストレージ | < 100MB | 1GB | $0 |
| Cloud Run | min=0 | 月 200 万リクエスト | $0 |
| Cloud Build | 月数十回 | 120 分/日無料 | $0 |
| Artifact Registry | < 1GB | 0.5GB 無料 | < $1 |
| Gemini API | 議事録 30 回 | (枠あり) | $0〜数 $ |
| Google STT | 録音時間 × 単価 | 60 分/月無料 | 数 $〜 |
| Secret Manager | 3 シークレット | 6 個無料 | $0 |

**合計**: $5〜15/月

防御:
- `max-instances=2`
- 既存レート制限 (120/min, 20/min, 8/min)
- Budget Alert ($5/$10/$20)

---

## 7. 共通作業フロー

各 Phase 着手時:

1. **開始前**:
   - 最新 `main` から作業ブランチ (命名: `feat/firestore-phase-<番号>-<内容>`)
   - `npm install && npm test` グリーン確認
   - 該当 Phase の `Inputs` を満たしているか確認
2. **作業中**:
   - SQLite モード (`DB_DRIVER=sqlite`) で従来動作維持を必ず保つ
   - 1 ファイル単位でコミット推奨
   - `docs/DEVELOPMENT_RULES.md` の 3 つのパス (closeout / UI regression / doc sync) を実行
3. **完了前**:
   - 該当 Phase の `Acceptance` をすべて満たすことを確認
   - `npm run check:frontend && npm run check:duplicates && npm test`
   - Phase 2 以降は加えて `npm run test:firestore`
4. **PR**:
   - タイトル: `feat(db): Phase X - <内容>`
   - 本文: Phase 番号、Acceptance を満たしたエビデンス、本ドキュメント該当 Phase へのリンク

---

## 8. 引き継ぎ時の確認事項

新エージェントは以下を順に確認:

- [ ] 本ドキュメント §0「決定事項レジストリ」を一読
- [ ] `git log --grep="Firestore\|Phase\|firestore" --oneline` で完了済み Phase を把握
- [ ] `gcloud firestore databases describe --database='(default)'` で Firestore 状態確認
- [ ] `gcloud run services describe winwinreco --region=asia-northeast1` で Cloud Run 設定確認
- [ ] `gcloud secrets list` で Secret Manager のシークレット確認
- [ ] `firebase firestore:rules:get` で現行 Rules 確認
- [ ] `cat .env.example` で環境変数の形を把握
- [ ] `cat cloudbuild.yaml` で現行デプロイ設定を把握
- [ ] 直前 PR のレビューコメントを確認

---

## 9. ロールバック手順

| Phase | ロールバック手段 |
|---|---|
| 0 | `npm uninstall firebase-admin firebase-tools cross-env` + `firebase.json` 等を削除 |
| 1 | `git revert <commit>` (ディレクトリ移動と DI 変更) |
| 2 | `DB_DRIVER=sqlite` に戻すだけで SQLite 動作 |
| 3a | `app.js` の signup ゲートを削除 (allowlist 無視) |
| 3b | `app.js` の admin ルートと `admin.html`/`admin.js` を削除 |
| 3c | (現状維持なので戻しなし) |
| 3d | `app.js` の追加 limiter を削除 |
| 4 | `firebase deploy --only firestore:rules` で前 Rules に上書き |
| 5 | `gcloud run services update-traffic winwinreco --region=asia-northeast1 --to-revisions=PREV=100` で前リビジョンに戻す |
| 6 | ドキュメントの `git revert` |

---

## 10. 参考資料

- `docs/ARCHITECTURE.md` - 現状のシステム構造
- `docs/DEVELOPMENT_RULES.md` - closeout / UI regression / doc sync の 3 パス
- `docs/TASKS.md` - 進行中タスク
- `docs/MAIN_SPLIT_PLAN.md` - フロント分割 (完了済み、参照のみ)
- `docs/MAIN_SPLIT_INVENTORY.md` - フロント分割インベントリ
- `docs/UX_IMPROVEMENT_PLAN.md` - UX 改善 (Phase 5 完了後の検討)
- `cloudbuild.yaml` - 既存 CI/CD 設定
- Firestore データモデル: https://firebase.google.com/docs/firestore/data-model
- Cloud Run 環境変数とシークレット: https://cloud.google.com/run/docs/configuring/environment-variables
- Firestore Security Rules: https://firebase.google.com/docs/firestore/security/get-started
