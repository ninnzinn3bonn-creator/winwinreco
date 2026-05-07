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
