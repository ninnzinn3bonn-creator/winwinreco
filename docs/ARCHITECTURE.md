# Architecture Notes

## Frontend modes

- `setup-mode`
  - room creation / join and microphone checks
- `meeting-mode`
  - live transcription and in-meeting controls
- `summary-mode`
  - post-meeting review, shared AI, and minutes

## Frontend module split

The frontend is split into browser globals with a clearer responsibility boundary:

- `src/frontend/state.js`
  - shared mutable app state
- `src/frontend/dom.js`
  - cached DOM references
- `src/frontend/bindings.js`
  - event wiring from DOM to `window.AppMain`
- `src/frontend/utils.js`
  - pure helpers for IDs, URLs, audio constraints, formatting, downloads, and response parsing
- `src/frontend/dictionary.js`
  - domain dictionary CRUD and extraction UI
- `src/frontend/audio.js`
  - microphone presets, permission flow, recording, mute, wake lock, and VAD pipeline
- `src/frontend/log-ui.js`
  - utterance normalization, log rendering, filters, and read-only/review interactions
- `src/frontend/shared-ai.js`
  - shared AI generation, live analysis, minutes workspace, and custom AI workspace
- `src/frontend/meeting-ui.js`
  - room join/create/end flow, mobile controls, summary controls, and WebSocket lifecycle
- `src/frontend/auth.js`
  - auth modal, auth badge, session state
- `src/frontend/profile.js`
  - profile modal and past meeting history
- `src/frontend/main.js`
  - bootstrap and orchestration across modules

Dependency direction is intentionally one-way:

`main -> meeting-ui -> { audio, log-ui, shared-ai, dictionary, auth, profile }`

Rules:

- cross-module calls happen through `window.AppXxx` namespaces only
- DOM access should go through `window.AppDom`
- shared mutable state should go through `window.AppState.state`
- `bindings.js` should call `window.AppMain` handlers, not file-local functions

## Shared AI flow

1. Live transcript is stored as utterances.
2. After the meeting, the host can generate shared outputs:
   - minutes
   - summary
   - todo
3. Shared outputs are persisted on the `rooms` table.
4. All participants fetch shared outputs from `GET /rooms/:id/insights`.
5. Custom AI uses saved minutes as its only context.

## Past-meeting context flow

- A room stores `use_past_meetings` as a room-level toggle.
- The toggle is configured from the setup screen before creating or joining.
- Past meeting context may be injected into summary, todo, and custom analysis.
- Minutes generation must never use past meeting context.

This rule exists to keep minutes grounded in the current meeting only.

## Security model

- Each participant receives a random `control_token` when joining a room.
- Privileged routes require `participant_id + control_token`.
- Host-only routes also validate that the participant belongs to the room owner.

Routes currently protected this way:

- `POST /rooms/:id/shared-ai/:type`
- `POST /rooms/:id/custom-ai`
- `POST /rooms/:id/end`

## Editor state ownership

The post-meeting screen has three editable surfaces:

- AI result: `#ai-output-editor`
- minutes: `#minutes-output-editor`
- custom prompt: `#custom-ai-instruction`

They share state with periodic polling and background refreshes.
Without safeguards, a user who is typing can lose edits when remote state arrives.

Required pattern for any editor mixed with periodic remote refresh:

1. **dirty flag**
   - set `state.editorDirty[key] = Date.now()` on every `input`
   - reset it when a server-derived value is written
2. **focus guard**
   - never overwrite `editor.value` while the editor is focused
3. **same-value guard**
   - skip assignments when the value is already the same
4. **user-edit wins**
   - dirty editors should not be overwritten by poll results
5. **instruction preservation**
   - preserve existing custom instruction unless an explicit clear is requested
6. **poll stop condition**
   - polling should stop when processing is not active
7. **blur re-render**
   - when focus leaves the field, re-render deferred state

Manual regression scenarios: see `docs/MANUAL_TESTS.md`.

## Mic preset to STT metadata rule

The mic preset in `src/frontend/mic-presets.js` is the single source of truth for three correlated layers:

- `getUserMedia` constraints
- front-end VAD parameters
- backend STT metadata

Whenever the user changes the preset, the frontend must:

1. call `track.applyConstraints`
2. reload the VAD constants on the next processing frame
3. emit a `mic_preset` WebSocket message so the backend can rebuild recognizer config

Forgetting any one of these causes silent quality regressions.

## 名前の二層管理 (アカウント名 / 表示名)

GIJIROでは「名前」を意図的に二層に分けて管理する。

| 層 | フィールド | 保存先 | 変更場所 |
|---|---|---|---|
| アカウント名 | `accounts.display_name` | DB | プロフィール画面のみ |
| 表示名 (会議用) | `display_name` | localStorage | セットアップ画面 |

### ルール

- **アカウント名** は本名推奨。会議中の表示名には自動反映しない。
- **表示名** はログイン・ログアウト・プロフィール変更で上書きしない。
  ユーザーがセットアップ画面で入力した値を最後まで保持する。
- `profile_text` (自己紹介) は `hydrateSetupProfile()` によりログイン時・
  プロフィール保存時・セットアップ画面表示時に localStorage と `#profile-text` へ同期する。
- `app:profile-updated` カスタムイベントは `profile_text` のみを通知する。
  `display_name` は含めない（誤って表示名を上書きしないための防衛）。

## 長時間会議のチャンキング戦略 (L1〜L9)

### 概要

発話数や議事録テキストが閾値を超えた場合、Map-Reduce パイプラインで処理する。

### 既定パラメータ (src/backend/services/chunking.js)

| パラメータ | 値 |
|---|---|
| チャンク窓 | 10 分 |
| 適応トリガー | 8000 トークン or 25 分 |
| オーバーラップ | 30 秒 |
| 並列度 | 2 (semaphore) |
| タイムアウト | 60 秒/チャンク (L8) |
| リトライ | 最大 3 回・指数バックオフ (L8) |

### Map フェーズ (utterance ベース)

`shouldChunk(utterances)` が true の場合、`chunkUtterances()` で 10 分窓に分割し、
各チャンクを `aiService.generateMinutesPerChunk()` に渡す。
L9 からチャンク結果を `room_chunks` テーブルに upsert する。

### Map フェーズ (テキストベース)

`shouldChunkText(minutesText)` が true の場合、`chunkText()` で分割し、
summary / todo を並列生成してから `mergeSummaryChunks()` / `mergeTodoChunks()` で統合する。

### Reduce フェーズ

`aiService.mergeMinutesChunks(chunkResults, roomMeta)` で全チャンクを 1 本の議事録に統合。

### チャンク結果の永続化 (L9)

- テーブル: `room_chunks` (`room_id`, `chunk_index`, `analysis_type`, `start_ts`, `end_ts`, `result_text`, `status`)
- 失敗チャンクは `status = 'error'` で保存される。
- `GET /rooms/:id/chunks` でホストがチャンク一覧を取得できる。
- `POST /rooms/:id/regenerate-chunk/:index` で失敗チャンクだけを再生成し、議事録全体を再マージして保存する。
- フロントの「チャンク別再生成」パネル (議事録タブ下部) からホストが操作できる。

### 実装上の注意

- `hydrateSetupProfile()` は `profile_text` のみを扱う。`#display-name` に触れてはならない。
- `applyParticipantModeFromUrl()` は localStorage のみを参照して `#display-name` を補完する。
- `showSetupScreenActive()` は表示のたびに `hydrateSetupProfile()` を呼び `profile_text` を更新する。

## Persistence Layer

DB ドライバーは `DB_DRIVER` 環境変数で切り替える。

| 値 | 説明 | 用途 |
|---|---|---|
| `sqlite` (既定) | `db/meeting.db` へのローカルファイル | ローカル開発 |
| `firestore` | firebase-admin 経由の Cloud Firestore | 本番 (Cloud Run) |

両ドライバーは `src/backend/repo/{sqlite,firestore}/*-repo.js` に同一インターフェースで実装されている。
ファクトリは `src/backend/repo/index.js` にあり、適切なセットを返す。

### コレクション設計 (Firestore)

| コレクション | 説明 |
|---|---|
| `rooms/{roomId}` | ルーム本体 |
| `rooms/{roomId}/participants` | 参加者 (サブコレクション) |
| `rooms/{roomId}/utterances` | 発話 (サブコレクション) |
| `rooms/{roomId}/analyses` | AI 解析結果 (サブコレクション) |
| `rooms/{roomId}/actions` | アクションアイテム (サブコレクション) |
| `rooms/{roomId}/chunks` | チャンク中間結果 (サブコレクション, L9) |
| `users/{userId}` | 端末ローカルユーザー |
| `user_context/{userId}` | ユーザーコンテキスト (project_summary 等) |
| `user_accounts/{accountId}` | ホストログインアカウント |
| `sessions/{sessionId}` | cookie session (sha256 token_hash 保存) |
| `dictionary/{termId}` | グローバル辞書 |
| `host_allowlist/{emailLowercased}` | サインアップ allowlist (Phase 3) |

### ドライバー切替ルール

- SQLite モード: `repos._raw.close()` が必要 (シャットダウン時)。
- Firestore モード: `_raw` は存在しない。`FIRESTORE_EMULATOR_HOST` 環境変数でエミュレーターへ接続。
- テスト: `NODE_ENV=test` で allowlist チェック・レート制限が自動 OFF。

### ホストアカウント管理

- `OWNER_EMAIL` 環境変数でオーナーを特定。allowlist 不要で常にサインアップ可能。
- `SIGNUP_ALLOWLIST_DISABLED=false` を明示するとテスト時でも allowlist が有効になる。
- `/admin/hosts` (GET/POST/PATCH/DELETE) でオーナーが他のホストを管理。`requireOwner` ミドルウェアで保護。

### collectionGroup を避ける `findInRoom` パターン (重要)

Firestore の `collectionGroup` クエリは、**`where + where` などの複合条件で必ず明示的な COLLECTION_GROUP インデックスが必要**。
登録漏れがあると本番で `FAILED_PRECONDITION (code 9)` 500 エラーになり、検証に時間がかかる。

そのため、本プロジェクトでは「**room_id が分かっているコールサイトでは collectionGroup を使わない**」を規約として運用する。

- `participantRepo.findInRoom(id, roomId)` / `utteranceRepo.findInRoom(id, roomId)` で
  サブコレクション `rooms/{roomId}/{participants|utterances}/{id}` を直接ドキュメント取得する。
- `updateMemory(id, updates, roomId?)` / `mergeTranscript(id, ..., roomId?)` のように、
  既存 API には `roomId` をオプション引数として渡せるようにし、与えられたら findInRoom 経由に切り替える。
- `requireParticipant` / `validateWsCredentials` (auth.js) も `findInRoom` 経由を優先する。
  フロント側で WebSocket URL に `?roomId=` を含めるのは、サーバー側で collectionGroup を回避するため。

`collectionGroup` を使ってよいケース:
- アカウント横断の backfill (`backfillAccountByUserId` のように `room_id` を持たない検索)
- どうしても roomId が無い保守用ジョブ

`collectionGroup` を使う場合は **必ず `firestore.indexes.json` にインデックスを登録** すること。
レビュー時の必須チェック項目とする。

### Firestore 複合インデックス一覧 (現状)

| コレクション | スコープ | フィールド | 用途 |
|---|---|---|---|
| `utterances` | COLLECTION | `is_starred ASC, started_at ASC` | スター済み発話の時系列取得 |
| `utterances` | COLLECTION | `participant_id ASC, ended_at DESC` | `findLatestByParticipant` |
| `rooms` | COLLECTION | `owner_account_id ASC, created_at DESC` | `findRoomsForAccount` |
| `chunks` | COLLECTION | `analysis_type ASC, chunk_index ASC` | `chunkRepo.findByRoom` |
| `participants` | COLLECTION_GROUP | `id ASC, control_token ASC` | `findByIdAndToken` (レガシー経路用) |
| `participants` | COLLECTION_GROUP | `user_id ASC, user_account_id ASC` | `backfillAccountByUserId` |

単一フィールドは Firestore が自動生成するため `indexes` に追加すると `400 "not necessary"` エラーになる。

---

## STT プロバイダー別 議事録プロンプト

`AIService` は議事録生成時に `roomMeta.stt_provider` または `aiConfig.stt_provider` を読み、編集ルールを切り替える。

| STT | reconstructSentences | 誤認識修正 | フィラー削除 / 段落統合 |
|---|---|---|---|
| `google` (default) | 実行する | 許可 | 許可 |
| `elevenlabs` | スキップ | 禁止 | 許可 |

切替の唯一の真実源は `AIService._isHighAccuracyStt(roomMeta)` と `_buildMinutesEditingRules(roomMeta)`。
影響を受けるメソッド:
- `analyzeMeeting(type='minutes')`
- `generateMinutesFromTranscript`
- `generateMinutesPerChunk`

`aiConfig.stt_provider` は `app.js` の `/rooms/:id/insights/regenerate` ルートで `room.stt_provider` から派生して渡す。
`roomMeta.stt_provider` は `generateSharedAiResult` / `regenerate-chunk` で渡す。

---

## チャンキングシステム規約 (重要)

### 必ず守る

1. `chunkUtterances` で `chunkStart` が前進しないケースを潰す保護コードを残す:
   `chunkEnd > chunkStart + 1` のときのみ overlap rewind、それ以外は強制 `chunkStart = chunkEnd`。
   過去にこの保護が無く、10 分超のサイレント区間や巨大発話 1 件で無限ループ → OOM が発生した。
2. `chunkRepo.upsert` は fire-and-forget で呼び出してよいが、`findByRoom` の `where + orderBy` 複合クエリには
   Firestore 複合インデックス `chunks: [analysis_type, chunk_index]` が必須。
3. 失敗チャンクは `withTimeoutAndRetry({ placeholder })` でプレースホルダーに退避し、議事録は必ず最後まで完走させる。
   ユーザーが部分再生成パネルで失敗箇所だけ作り直せるよう、`chunks.status = 'error'` で保存する。

### テスト

長時間会議のシミュレーションは `tests/chunking.test.js` で 47 ケースカバー済み。
- 30 分 / 1 時間 / 2 時間 / 4 時間会議の分割正しさ・全 utterance 網羅・パフォーマンス (4 時間で < 2 秒)
- 1 件失敗 / 全件タイムアウト時のプレースホルダー fallback
- 上記 1 の無限ループ回帰テスト

---

## Easter egg theme + game (実装上の隔離)

`src/frontend/easter-game.js` に隔離された `window.AppEasterGame` モジュール。本仕様には一切影響させない設計。

- トリガー: `data-theme="red"` (プロフィール → 設定 → 表示テーマ → "レッド"。ログイン中のみ選択肢が表示される) かつ認証済み。
- セットアップ画面の「会議を始める」ボタン click 時、`AppEasterGame.shouldIntercept()` が true ならゲーム起動、それ以外は従来の `createRoom` / `joinRoom`。
- ハイスコアは `user_accounts.game_high_score` フィールドに保存 (`POST /me/easter-score`)。Firestore はスキーマレスで追記、SQLite は `ensureColumn('user_accounts', 'game_high_score', 'INTEGER DEFAULT 0')`。
- バックエンド送信失敗時は localStorage `gijiro:easter_high_score` に退避。

CSS は `:root[data-theme="red"]` セレクタ配下にのみ書く。`body.easter-game-active` クラスでオーバーレイ表示中の `overflow: hidden`。
通常テーマ (system / light / dark) には一切影響しない。

---

## Current technical debt

- `src/frontend/main.js` still contains orchestration that can be split further.
- Review routes such as `/rooms/:id/logs` and `/rooms/:id/insights` are still room-id based.
- Manual test coverage is stronger than browser automation coverage.

## Recommended next refactor

1. Continue trimming legacy logic from `src/frontend/main.js`
2. Add lightweight browser-level smoke coverage for setup / meeting / summary transitions
3. Expand module-level tests around auth, profile, and shared AI orchestration

## Closeout and maintenance rules

This project treats "closing work cleanly" as part of the implementation itself.
Reusable maintenance skills live under `docs/skills/`:

- `docs/skills/closeout-pass/SKILL.md`
- `docs/skills/ui-regression-pass/SKILL.md`
- `docs/skills/doc-sync-pass/SKILL.md`

Use them as follows:

- `closeout-pass`
  - after any feature or bugfix
- `ui-regression-pass`
  - after layout, interaction, mobile, modal, scroll, or sticky-header changes
- `doc-sync-pass`
  - after behavior, defaults, architecture, auth, AI, or setup-flow changes

---

## Mobile meeting layout

On screens ≤ 1023px, `body.meeting-mode` applies the following compaction:
- `#flow-progress` is hidden (step progress is self-evident during a live meeting)
- `.app-topbar` is reduced to 36px height (logo + auth-badge only)
- `#meeting-screen > header` keeps only mic / ⚙ settings / ☰ / end; title input moves into ☰ menu
- `#meeting-title-input` and `#meeting-title-readonly` are hidden via CSS; the mobile copy is `#mobile-meeting-title-input` inside the drawer
- `mobileMemoryCollapsed` and `mobileAiCollapsed` are forced `true` in `showMeetingScreen()` so the conversation log is the first visible panel
- `.conversation-panel` guarantees `min-height: 50dvh` (uses `dvh` for iOS Safari address-bar tracking, `vh` as fallback)

Title sync between the two inputs is handled by `getMeetingTitleInputs()` + `syncMeetingTitleInputs()` in `main.js`, with a focus guard so the active input is never overwritten mid-type.

PC (≥ 1024px) layout is entirely unaffected: all new rules live inside `@media (max-width: 1023px)` or `@media (max-width: 560px)` blocks.
