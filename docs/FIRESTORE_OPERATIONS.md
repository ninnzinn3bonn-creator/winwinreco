# Firestore 運用ノート

本番 (Cloud Run) は `DB_DRIVER=firestore` で稼働中。SQLite はローカル開発と CI でのみ使用。

## 1. データ層を変更したときのチェックリスト

新しいフィールド・メソッド・クエリを追加するときは、**必ず両方** に反映する:

| やったこと | SQLite | Firestore | インデックス |
|---|---|---|---|
| 新しいカラム追加 | `db.js` の `ensureColumn` | `_toDomain` で読む / `create` で書く | — |
| 新メソッド | `sqlite/X-repo.js` | `firestore/X-repo.js` | — |
| `.where()` 単一フィールド (top-level) | — | — | 自動 |
| `.where()` 単一フィールド (sub-collection) | — | — | 自動 |
| **`collectionGroup().where()` 単一フィールド** | — | — | **`fieldOverrides` で `COLLECTION_GROUP` スコープ要明示** |
| `.where(A).orderBy(B)` 異なるフィールド | — | — | **composite index 要追加** |
| `.where(A).where(B)` 複合 | — | — | **composite index 要追加** |
| `.where(A, '<', X)` 不等号 | — | — | 自動 (top-level) / `fieldOverrides` (collection group) |

## 2. Firestore インデックスのデプロイ手順

`firestore.indexes.json` を編集したら必ず:

```bash
npx firebase deploy --only firestore:indexes --project project-54176cf1-4753-464d-869
```

ビルド中の状態確認:

```bash
gcloud firestore indexes fields describe <field-name> --collection-group=<collection>
gcloud firestore indexes composite list
```

インデックスは `CREATING` → `READY` まで数秒〜数分かかる。ビルド完了前にクエリを叩くと `FAILED_PRECONDITION` で 500 が出る。

## 3. 過去にあったハマりポイント

### 2026-05-11: `/me/rooms` が 500 (FAILED_PRECONDITION)

- 原因: `findRoomsForAccount` 内の `collectionGroup('participants').where('user_account_id', '==', X)` が、`COLLECTION_GROUP` スコープのインデックス未設定で実行できなかった。
- 修正: `firestore.indexes.json` の `fieldOverrides` に `participants.user_account_id` (COLLECTION_GROUP) を追加。
- 教訓: **collection group の単一フィールド where でも必ず fieldOverrides が要る**。単一コレクション内の where とは違うルール。

### 2026-05-11: admin 系エンドポイントが 500 (TypeError)

- 原因: SQLite の `UserAccountRepository` に追加した事後承認フロー用メソッド (`findPending` / `setStatus` / `countPending` / `findOwners` / `countOwners` / `setOwner` / `findAll`) が Firestore 側に未実装だった。
- 修正: Firestore 版 `user-account-repo.js` に同じシグネチャで実装。
- 教訓: **SQLite に新メソッドを追加するときは Firestore 側にも必ず同時追加**。テスト coverage で気付けるように Firestore 用テストを書くのが望ましい。

## 4. 既知の挙動差分 (許容範囲)

- `findById(unknown)` の戻り値: SQLite=`null` / Firestore=`undefined`
  - 全コールサイトが `if (!x)` または optional chaining で参照しているため実害なし
- Boolean: Firestore は native boolean (`true/false`)、SQLite は `1/0`
  - `_toDomain` で `1/0` に正規化して返しているため呼び出し側は意識不要
- Timestamp: Firestore は ISO 文字列 (例 `2026-01-15T10:30:00.000Z`)、SQLite は SQL DATETIME (例 `2026-01-15 10:30:00`)
  - 比較は `localeCompare` で行っており実害なし

## 5. 環境変数 (Cloud Run)

| 変数 | 用途 |
|---|---|
| `DB_DRIVER=firestore` | データドライバ切替 |
| `GOOGLE_CLOUD_PROJECT=project-54176cf1-4753-464d-869` | Firestore Admin SDK の接続先 |
| `OWNER_EMAIL=...` | 後方互換のオーナー判定 (DB の `is_owner` が無くてもフォールバック) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `GOOGLE_API_KEY` / `ELEVENLABS_API_KEY` | AI / STT |
| `AI_PROVIDER` / `STT_PROVIDER` / `STT_LANGUAGE` | 固定プロバイダ設定 (Groq / ElevenLabs Scribe) |
| `COOKIE_SECURE=true` | 本番のみ |
| `WS_ALLOWED_ORIGINS` | WebSocket CORS |

## 6. ローカル開発

```bash
# SQLite で開発 (デフォルト)
npm start

# Firestore エミュレータで開発 (Java 必須)
npm run emulators            # 別ターミナル
DB_DRIVER=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 GOOGLE_CLOUD_PROJECT=demo-test npm start

# Firestore テスト実行 (Java 必須)
npm run emulators            # 別ターミナル
npm run test:firestore
```

## 7. デプロイ手順

1. コード変更 → `git push origin main` → Cloud Build が自動デプロイ
2. インデックス変更 → 別途 `npx firebase deploy --only firestore:indexes` が必要
3. Firestore Rules 変更 → `npx firebase deploy --only firestore:rules`

## 8. 緊急時の確認コマンド

```bash
# 直近の Cloud Run エラー
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="winwinreco" AND severity>=ERROR' --limit=20 --freshness=1h

# Cloud Run の env 確認
gcloud run services describe winwinreco --region=asia-northeast1 --format="value(spec.template.spec.containers[0].env)"

# Firestore インデックスの状態
gcloud firestore indexes composite list

# Cloud Build 履歴
gcloud builds list --limit=5
```
