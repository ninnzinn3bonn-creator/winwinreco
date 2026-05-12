# 本番運用準備チェックリスト (Production Readiness)

> 製品としての完成度を一段上げるための未対応項目を、ユーザー視点と保守視点で洗い出し、
> 「**必須 (MUST)**」項目には実装直前まで詰めた設計を添える。
> 着手前に必ず `docs/TASKS.md` の運用ルールに合わせて TASKS.md に該当タスクを追加してから取り掛かること。
>
> 作成日: 2026-05-12 (§54 完了直後)

---

## 0. 全体観 (executive summary)

| 区分 | 個数 | 状態 |
|---|---|---|
| 🔴 MUST (本番運用で詰まる / 法的に必要) | 10 | U-1 完了 (2026-05-13) / U-3 完了 (2026-05-13) / U-4 完了 (2026-05-13) / 残 7 未着手 |
| 🟡 HIGH (UX や保守を一段上げる) | 9 | 未着手 |
| 🟢 MEDIUM (差別化 / 利便性) | 8 | 未着手 |
| 🔵 LOW (将来検討) | 5 | 未着手 |

「§n.m」表記は本書の節番号。「[ID]」は新規に振った作業ID (TASKS.md 追記時に流用する)。

---

## 1. ユーザー視点インベントリ

### 1.1 MUST 🔴 (これがないと "ふつう" の SaaS として成立しない)

| ID | 項目 | 一言 | 詳細設計節 |
|---|---|---|---|
| U-1 | **パスワードリセット** | 忘れたら詰む | §3.1 |
| U-2 | **アカウント削除 & データエクスポート** | GDPR / 個人情報保護法、信頼の前提 | §3.2 |
| U-3 | **WebSocket 再接続の堅牢化 + ログ復元** | モバイル切替・トンネルで頻発 | §3.3 |
| U-4 | **エラー表示の統一 (alert 廃止)** | UX 品質。現状 `alert()` 多用 | §3.4 |
| U-5 | **利用規約 / プライバシーポリシー / 録音同意表示** | 法務上の前提 | §3.5 |
| U-6 | **メール認証 (確認リンク)** | 偽メール登録阻止 | §3.6 |

### 1.2 HIGH 🟡

| ID | 項目 | 内容 |
|---|---|---|
| U-7 | PDF / Word エクスポート | 会議参加者へ配布する現実的フォーマット |
| U-8 | PWA 化 (manifest.json + Service Worker) | 「ホーム画面に追加」で起動性向上、オフラインキャッシュ |
| U-9 | 議事録の閲覧専用 URL (read-only share link) | 参加してない人にも結果だけ見せたい場面 |
| U-10 | 過去会議横断検索 | キーワードで横断、結果ヒットへジャンプ |
| U-11 | 通知 (メール / ブラウザ push) | 議事録生成完了通知 |
| U-12 | キーボードショートカット (mute / 終了 / スター) | 慣れた人の生産性 |

### 1.3 MEDIUM 🟢

| ID | 項目 | 内容 |
|---|---|---|
| U-13 | 多言語 UI (まず EN) | グローバル展開可能性 |
| U-14 | カレンダー連携 (Google Calendar) | 予定から自動でルーム作成 |
| U-15 | タグ / フォルダ分け | 会議の整理 |
| U-16 | テンプレート (定例会議用の初期辞書 + 過去サマリ自動投入) | 反復会議の効率化 |
| U-17 | 共同ホスト (co-host) | 1 会議に複数管理者 |
| U-18 | 利用量 / コスト見える化 (host 自身) | プロフィール画面に「今月の AI 利用」 |

### 1.4 LOW 🔵

| ID | 項目 | 内容 |
|---|---|---|
| U-19 | ライブキャプション (会議中の大きい文字表示) | アクセシビリティ |
| U-20 | 話者ラベルの手動修正 UI (混線時の救済) | 精度補完 |
| U-21 | 議事録テンプレート選択 (フォーマル / 箇条書きのみ など) | 文体カスタム |

---

## 2. 開発者 / 運用視点インベントリ

### 2.1 MUST 🔴

| ID | 項目 | 一言 | 詳細設計節 |
|---|---|---|---|
| D-1 | **構造化ログ + Cloud Error Reporting 連携** | 本番で何が壊れているか分からない | §3.7 |
| D-2 | **CI (GitHub Actions): push で全テスト + lint** | 今は手元で `npm test` を回すしかない | §3.8 |
| D-3 | **依存脆弱性自動スキャン (Dependabot + npm audit)** | サプライチェーン攻撃面 | §3.9 |
| D-4 | **コスト / API 使用量モニタリング** | 暴走時の早期検知。$20 月予算アラートだけでは足りない | §3.10 |

### 2.2 HIGH 🟡

| ID | 項目 | 内容 |
|---|---|---|
| D-5 | ステージング環境 (Cloud Run 別サービス) | 本番投入前検証 |
| D-6 | ESLint + Prettier 導入 | コードベース統一 |
| D-7 | OpenAPI 仕様の自動生成 | クライアント開発・テスト容易化 |

### 2.3 MEDIUM 🟢

| ID | 項目 | 内容 |
|---|---|---|
| D-8 | TypeScript 化 (まず types のみ JSDoc → 段階的に .ts へ) | リファクタ安全性 |
| D-9 | E2E テスト (Playwright) の充実 | UI 回帰防止 |
| D-10 | Firestore 自動バックアップ (Cloud Scheduler) | 月次手動運用を自動化 |

### 2.4 LOW 🔵

| ID | 項目 | 内容 |
|---|---|---|
| D-11 | `main.js` 完全分割 (まだ 2900+ 行) | 既存 TASKS.md にも記載あり |
| D-12 | 性能改善: Cloud Run 冷起動最適化 | min-instances 検討 |

---

## 3. MUST 項目の詳細設計 (実装直前まで)

> ここから先は「pull-request にそのまま落ちる粒度」。
> 影響範囲・テストケース・受け入れ条件まで明示。

### 3.1 [U-1] パスワードリセット

✅ 完了 (2026-05-13) — PROGRESS.md §55 参照

#### ユーザーフロー
1. ログイン画面の「パスワードを忘れた方」リンクをクリック
2. メール入力 → 送信
3. (アカウントが存在しなくても同じレスポンスを返す。enumeration 防止)
4. 該当アカウントがあれば、`password_reset_tokens` にトークンを保存しメール送信
5. メール内リンク `https://<HOST>/auth/reset?token=<TOKEN>` をクリック
6. 新パスワード入力 → 確定
7. 既存セッション全消し + ログイン画面へ

#### スキーマ (両 driver)
新コレクション / テーブル `password_reset_tokens`:
- `id` (PK)
- `account_id` (FK)
- `token_hash` (SHA-256 of opaque 32-byte token)
- `expires_at` (`now + 1 hour`)
- `used_at` (null until consumed)
- `created_at`

#### エンドポイント
- `POST /auth/forgot-password` body `{ email }` — 常に 200 を返す
  - rate limit: `authLimiter` (1分間8回)
- `POST /auth/reset-password` body `{ token, new_password }`
  - 8文字以上、現存トークン、未使用、未期限切れ
- (frontend 用) `GET /auth/reset?token=` は HTML を返す

#### メール送信
- 本番は Cloud Run から SMTP 直接は推奨されないので **SendGrid** または **Resend** を使う
- 環境変数 `MAIL_PROVIDER=sendgrid` / `SENDGRID_API_KEY`
- 開発時は `MAIL_PROVIDER=console` でログ出力のみ
- メールテンプレートは `src/backend/lib/mail-templates.js` に置く

#### タスク分解
1. `src/backend/lib/mail.js` を新規作成 (provider 抽象化)
2. `src/backend/repo/{sqlite,firestore}/password-reset-repo.js` を作成
3. `src/backend/repo/sqlite/db.js` に `password_reset_tokens` テーブル追加
4. `src/backend/app.js` に `/auth/forgot-password` / `/auth/reset-password` ルート追加
5. `src/frontend/auth.js` のログインモーダルに「パスワードを忘れた方」リンクを追加
6. リセット画面 (新規 `reset.html` または既存モーダル拡張)
7. `tests/auth-reset.test.js` を作成 (主要 6 ケース)
8. ARCHITECTURE.md の Security model 節に追記

#### 受け入れ条件
- 存在しないメールで `/auth/forgot-password` を叩いても 200 (enumeration 防止)
- 有効トークンで /auth/reset-password を叩くと:
  - パスワードが更新される
  - 既存セッションが全消去される (該当 account の sessions を delete all)
  - 同じトークンは 2 回目は 400
- トークン有効期限後は 400
- メールが console / SendGrid 両プロバイダで配信できる

---

### 3.2 [U-2] アカウント削除 & データエクスポート

#### ユーザーフロー
- プロフィール画面 → 「データ管理」セクション (新規) → 2 つのボタン
  - **「全データをエクスポート」**: ZIP ダウンロード
  - **「アカウントを削除」**: 確認モーダル → パスワード再入力 → 実行

#### エクスポート内容 (ZIP)
```
account.json         アカウント情報 (email / created_at)
rooms/<roomId>.json  ホストした全ルームの会議データ
  - title, created_at, ended_at
  - utterances: [{started_at, display_name, transcript}]
  - minutes, summary, todo, ai_workspace
participants.csv     参加者として参加した会議一覧
profile.json         profile_text
README.txt           内容の説明
```

#### 削除挙動
- ホストとして所有するルームは **削除する** (utterances, analyses, chunks 含めて cascade)
- ゲスト参加履歴は **unlink** のみ (他参加者のために残す。utterance の participant_id は維持)
- account_id を `sessions` から全削除
- `user_accounts` ドキュメント自体を削除
- (Firestore) batch delete でアトミック性を担保 (失敗時のリトライ)

#### エンドポイント
- `GET /me/export` → `Content-Type: application/zip` をストリーミング
- `POST /me/delete` body `{ password }` — パスワード再確認 + cascade delete

#### タスク分解
1. `src/backend/lib/account-export.js` 新規 (ZIP 生成、`archiver` 依存追加)
2. `src/backend/lib/account-delete.js` 新規 (cascade ロジック)
3. `src/backend/app.js` にエンドポイント 2 本追加
4. `src/frontend/profile.js` の設定タブに「データ管理」セクション追加
5. テスト `tests/account-data.test.js` (export / delete / passwords mismatch)
6. ARCHITECTURE.md に削除 cascade 仕様を追記

#### 受け入れ条件
- export ZIP を解凍して JSON 整合性を確認 (空のフィールドは null)
- 削除後、同じメールで再サインアップ可能
- 削除後、他参加者から見える utterance は残るが display_name は `(削除済みユーザー)` に置換 (将来検討、Phase 2)
- パスワード再入力が間違っていれば 401

---

### 3.3 [U-3] WebSocket 再接続の堅牢化 + ログ復元

✅ 完了 (2026-05-13) — PROGRESS.md §57 参照

#### 現状の問題
`meeting-ui.js:393-398` の `state.ws.onclose` は 3 秒固定で `initWebSocket()` を再呼び出ししているだけ。
- 再接続中の VAD バッファが消える
- 復帰時に発話差分の取り直しがない
- バックオフ無しで失敗ループに入る可能性
- ユーザーへの状態フィードバックが弱い (システムメッセージ 1 行のみ)

#### 設計
1. **指数バックオフ + 上限**
   - 試行間隔: 1s → 2s → 4s → 8s → 16s (max 30s)
   - 試行回数 10 で諦め、UI に「再接続失敗。手動で再読み込みしてください」表示
2. **再接続後の発話復元**
   - 再接続成功時に `GET /rooms/:id/utterances?since=<last_utterance_id>` で差分取得
   - WS の `hello` メッセージで `last_seen_utterance_id` を返してサーバー側で再送 (現状の `history` 機構を拡張)
3. **接続状態の可視化**
   - 接続済み / 切断中 / 再接続中 を `#ws-status-badge` (新規) で表示
4. **音声バッファのバッファリング**
   - 切断中の PCM チャンクを `state.pendingAudioBuffer` に最大 30 秒分溜める
   - 再接続後にまとめて送信
   - 30 秒超えたら最古から捨てる

#### スキーマ変更
- なし (`utterances.id` が既にユニーク)

#### 影響ファイル
- `src/frontend/meeting-ui.js` (再接続ロジック)
- `src/frontend/audio.js` (バッファリング層)
- `src/backend/app.js` の WS 接続ハンドラ (`hello` で `last_seen_utterance_id` を受け取り `history` を絞る)
- `src/frontend/index.html` (`#ws-status-badge` 追加)
- `src/frontend/style.css` (badge スタイル)

#### タスク分解
1. `state.wsReconnect = { attempt, backoffMs, status }` の state 追加
2. `initWebSocket()` を `connectWs()` / `scheduleReconnect()` に分離
3. `state.ws.onclose` でステータスを `reconnecting` にし、`scheduleReconnect()` 呼び出し
4. `onopen` で `attempt` をリセット
5. 接続成功時に `GET /rooms/:id/utterances?since=<id>` で差分取得 (新規エンドポイントが必要なら追加)
6. `audio.js` で `state.ws.readyState !== OPEN` のときに PCM をバッファ
7. badge の表示制御
8. テスト: `tests/ws-reconnect.test.js` (mock close → 再接続 → history 取得)

#### 受け入れ条件
- 強制 `state.ws.close()` 後、3 秒以内に reconnecting 表示、最終的に再接続
- 切断 30 秒後に復帰 → 切断中の発話が UI に表示される (サーバー側に届いていれば)
- 試行 10 回失敗 → 「ページを再読み込み」ボタン表示
- 既存テストが全て pass

---

### 3.4 [U-4] エラー表示の統一 (alert 廃止)

✅ 完了 (2026-05-13) — PROGRESS.md §56 参照

#### 現状
- `alert('参加に失敗しました')` 等が約 20 箇所 (frontend のあちこち)
- ブロッキングダイアログが UX を壊す
- ログ収集もできない

#### 設計
- `window.AppToast` を導入: 右下に積み上がるトースト
  - `AppToast.error(msg, { detail })` / `AppToast.success(msg)` / `AppToast.info(msg)`
  - 自動消滅 (info=3s, success=4s, error=8s)
  - `detail` クリックで詳細スタック表示 (折りたたみ)
- 致命的なエラーは赤バナーを画面上部に固定 (例: WS 完全切断)
- 既存 `alert()` を一括置換

#### 影響ファイル
- 新規 `src/frontend/toast.js`
- `src/frontend/style.css` にトースト用 CSS
- `src/frontend/index.html` で `<script src="toast.js">` 追加
- `meeting-ui.js` / `main.js` / `profile.js` / `auth.js` 等の `alert()` 呼び出しを置換

#### タスク分解
1. `toast.js` を実装 (DOM 操作 + キュー管理)
2. `index.html` に script 追加 + `<div id="app-toast-container">` を `body` 末尾に
3. CSS (position: fixed; bottom; right; gap; transition)
4. `grep -rn "alert(" src/frontend` で機械的に対象抽出
5. それぞれ `AppToast.error('...')` に置換 (確認系 `confirm()` は除く、または `AppToast.confirm()` を追加)
6. `tests/toast.test.js` で DOM レベル動作確認

#### 受け入れ条件
- `grep -rn "alert(" src/frontend --include='*.js' | wc -l` が 0 (`confirm()` は別途)
- ログイン失敗時にトーストで表示される
- 同時に複数エラーが出ても積み上がって全部見える

---

### 3.5 [U-5] 利用規約 / プライバシーポリシー / 録音同意表示

#### 必要な静的ページ
- `/terms` — 利用規約
- `/privacy` — プライバシーポリシー
- フッターに常時リンク表示
- サインアップフォームに「規約に同意する」チェックボックス
- 会議参加時 (`joinRoomProcess`) に「この会議は録音され、AI で解析されます」モーダル → OK で参加

#### 内容ガイドライン (法務確認推奨)
- データの保存場所 (Cloud Firestore, asia-northeast1)
- 利用される外部 API (Google STT, ElevenLabs, Gemini)
- 第三者へのデータ提供有無
- 削除権 / エクスポート権 (U-2 と接続)
- お問い合わせ窓口 (`OWNER_EMAIL` を使う、または別アドレス)
- 改訂時の通知方法

#### タスク分解
1. `src/frontend/terms.html` / `src/frontend/privacy.html` 新規 (静的)
2. `src/backend/app.js` で `/terms` `/privacy` を Express static で serve
3. `index.html` のフッターにリンク追加
4. `auth.js` のサインアップフォームに `<input type="checkbox" required>` 「規約に同意する」を追加。チェックなしで `submit` 阻止
5. `meeting-ui.js` の `joinRoom()` 冒頭に「録音同意モーダル」を挿入 (localStorage に `recording_consent: true` を保存して 2 回目以降スキップ)
6. ARCHITECTURE.md の Security model 節に "Consent & legal" 小節を追記

#### 受け入れ条件
- フッターから規約 / プライバシーへ遷移
- 同意なしでサインアップ完了不可
- 初回参加時のみ録音同意モーダルが表示される

---

### 3.6 [U-6] メール認証 (確認リンク)

#### 設計
- サインアップ → アカウント作成 (`status='pending_email'`) → 確認メール送信
- メール内リンク `/auth/verify?token=<...>` をクリック → `status='pending'` (オーナー承認待ち) へ昇格
- 24 時間以内に確認しないとアカウント削除 (Cloud Scheduler で日次クリーンアップ)

#### スキーマ
- `user_accounts.status` に `'pending_email'` を追加 (既存: `pending` / `approved` / `rejected`)
- `email_verification_tokens` 新規:
  - `id`, `account_id`, `token_hash`, `expires_at`, `used_at`, `created_at`

#### エンドポイント
- `POST /auth/signup` 内で `mail.sendVerification(account, token)` を呼ぶ
- `POST /auth/verify` body `{ token }` — `status` を `pending` に進める

#### タスク分解
1. U-1 のメール基盤 (`lib/mail.js`) を流用
2. `email_verification_tokens` repo を両 driver で作成
3. `app.js` の `/auth/signup` でトークン生成 + メール送信を追加
4. `/auth/verify` ルート追加 (HTML フォーム + POST 処理)
5. `auth.js` のサインアップ成功画面に「確認メールを送信しました」表示
6. 既存の admin UI で `status='pending_email'` のユーザーを (空欄ではなく) "確認待ち" として区別表示
7. テスト `tests/auth-verify.test.js`

#### 受け入れ条件
- サインアップ後、メールが来る (本番は SendGrid)
- 確認リンク前にログインしようとすると 403 (`email not verified`)
- 確認後、`status='pending'` に進む → オーナー承認 → ログイン可能

---

### 3.7 [D-1] 構造化ログ + Cloud Error Reporting 連携

#### 現状
- `console.log(...)` / `console.error(...)` が散在
- 構造化されていない (検索性ゼロ)
- Cloud Logging には残るが、ロード時間とコストが嵩む

#### 設計
- `src/backend/lib/logger.js` を新規:
  ```js
  const logger = {
    info: (msg, ctx) => console.log(JSON.stringify({severity: 'INFO', message: msg, ...ctx})),
    warn: (msg, ctx) => console.warn(JSON.stringify({severity: 'WARNING', message: msg, ...ctx})),
    error: (err, ctx) => console.error(JSON.stringify({
      severity: 'ERROR',
      message: err.message,
      stack: err.stack,
      ...ctx
    }))
  };
  ```
- 全 `console.*` を `logger.*` に機械置換 (`scripts/replace-console.js` を 1 回限り使う)
- リクエスト ID をミドルウェアで生成 (`req.requestId = crypto.randomUUID()`)、各ログに付与
- Cloud Run なら **構造化 JSON ログがそのまま Cloud Logging で検索可能**
- Cloud Error Reporting は `severity: ERROR` + `stack_trace` を含む JSON を自動検知

#### タスク分解
1. `lib/logger.js` 作成
2. `app.js` に `requestId` ミドルウェア追加
3. console.* を logger.* に一括置換 (PR を分けるとレビューしやすい)
4. ARCHITECTURE.md に "Logging convention" 節追加
5. Cloud Error Reporting の通知先メールを GCP Console で設定 (手動)

#### 受け入れ条件
- Cloud Logging で `severity=ERROR AND jsonPayload.message:"..."` で検索可能
- リクエスト 1 つを全ログから `requestId` で追跡可能
- Error Reporting にエラーが集約されてダッシュボードで見られる

---

### 3.8 [D-2] CI (GitHub Actions): push で全テスト + lint

#### 設計
`.github/workflows/ci.yml` を新規:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
on:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run check:frontend
      - run: npm run check:duplicates

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx eslint src/  # D-6 で導入

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high
```

#### タスク分解
1. `.github/workflows/ci.yml` 作成
2. README にバッジ追加
3. main ブランチ保護を GitHub UI で有効化 (CI 通過必須)

#### 受け入れ条件
- main への push / PR で自動的にテストが走る
- 失敗時に PR にコメントされる
- 失敗した PR は merge できない

---

### 3.9 [D-3] 依存脆弱性自動スキャン

#### 設計
- GitHub の **Dependabot** を有効化
  - `.github/dependabot.yml` で週次スキャン設定
  - npm + GitHub Actions 両方を対象
- CI で `npm audit --audit-level=high` を実行 (上の D-2 内)
- `package.json` の `engines` ノードバージョンを固定 (現状未設定)

#### タスク分解
1. `.github/dependabot.yml` 作成
2. `package.json` に `"engines": { "node": ">=20" }` 追加
3. CI で高重度の脆弱性が出たら fail
4. ARCHITECTURE.md に "Dependency policy" 節追加

#### 受け入れ条件
- Dependabot からの自動 PR が出る (週次)
- npm audit で high 以上が出ると CI fail

---

### 3.10 [D-4] コスト / API 使用量モニタリング

#### 現状
- Cloud Billing Budget Alert ($5/$10/$20) のみ — 「使いすぎてから気付く」レベル
- Gemini / Google STT / ElevenLabs の API 個別の使用量は不可視

#### 設計
1. **アプリ側でメータリング**
   - `lib/metrics.js`: API 呼び出しごとに `{provider, type, tokens_estimate, duration_ms, account_id, room_id}` をログ
   - Cloud Logging に構造化 JSON で残るので BigQuery (Cloud Logging sink) で集計可能
2. **管理ダッシュボード `/admin/usage`**
   - 日次 / 月次の API 呼び出し回数 / 推定コスト
   - account 別の使用上位
   - 暴走検知 (1 時間で N 回超え → アラート)
3. **アラート**
   - Cloud Monitoring で BigQuery クエリベースのアラート設定

#### タスク分解
1. `lib/metrics.js` 作成、`AIService` / `STTService` の呼び出し箇所に挿入
2. Cloud Logging → BigQuery sink を GCP Console で作成 (手動)
3. BigQuery で集計ビューを作成 (例: `daily_ai_usage`)
4. `/admin/usage` エンドポイント + 画面 (Phase 2 で OK)
5. ARCHITECTURE.md に "Observability & cost" 節追加

#### 受け入れ条件
- BigQuery に 1 日分のログが流入する
- account 別のサマリが取れる
- 1 時間で 1000 呼び出しを超えるとメール通知

---

## 4. 推奨着手順

> 「ユーザーがすぐ詰む」 → 「法的に必要」 → 「保守ループを回すための土台」 の順。

| 週 | 着手項目 | 工数目安 |
|---|---|---|
| 1 週目 | U-1 (パスワードリセット) + 関連 mail.js 基盤 | 3 日 |
| 2 週目 | U-3 (WS 再接続) + U-4 (Toast) | 3 日 |
| 3 週目 | D-1 (構造化ログ) + D-2 (CI) + D-3 (Dependabot) | 2 日 |
| 4 週目 | U-5 (規約 / 同意) + U-6 (メール認証、U-1 の基盤に乗る) | 2 日 |
| 5 週目 | U-2 (削除 / エクスポート) | 3 日 |
| 6 週目 | D-4 (コストメータリング基礎) | 2 日 |

すべて完了で MUST が消化される。その後 HIGH (U-7 PDF / U-8 PWA / U-9 共有 URL / D-5 ステージング) へ。

---

## 5. 着手前のチェックリスト

- [ ] 対象タスクを `docs/TASKS.md` の Section C に追記 (この PRODUCTION_READINESS.md の ID を流用)
- [ ] 関連する既存テストが green であることを確認
- [ ] スキーマ変更がある場合は SQLite と Firestore の両 driver を同時更新
- [ ] `collectionGroup` を使う場合は `firestore.indexes.json` への複合インデックス登録を忘れない
- [ ] 完了後は `PROGRESS.md` に新節 (`## NN. ...`)、再発防止規約があれば `docs/ARCHITECTURE.md` に追記

---

## 6. 補遺: HIGH / MEDIUM 項目の簡易設計メモ

> MUST が片付いた後に手をつける項目。詳細設計はそのとき改めて起こす。

### U-7 PDF / Word エクスポート
- `puppeteer-core` + Chromium headless (Cloud Run には別途設定要)
- もしくはサーバー側でテンプレート HTML を組んで PDF 出力
- Word は `docx` ライブラリ
- まずは Markdown / PDF を優先

### U-8 PWA 化
- `manifest.json` 作成
- `service-worker.js` でアプリシェルをキャッシュ
- offline 表示は最低限 (会議は online 必須)
- iOS Safari の Add to Home Screen 対応

### U-9 閲覧専用 URL
- `rooms.public_view_token` (任意有効化)
- `/view/<token>` で minutes / summary / todo のみ表示
- 発話ログは含めない (プライバシー配慮)

### U-10 横断検索
- Firestore は全文検索が弱いので、`utterances.transcript` に索引を貼るより
  Algolia / Typesense などの外部 search service を導入するのが現実的
- もしくは GCP の Vertex AI Search

### D-5 ステージング環境
- Cloud Run に `winwinreco-staging` サービスを追加
- 別 Firestore プロジェクト (or 同プロジェクトの別 database name)
- main → staging → 手動承認 → prod の Cloud Build trigger 分離

### D-6 ESLint + Prettier
- `.eslintrc.json` (vanilla JS なので軽量設定)
- `prettier --check` を CI に組み込み
- 既存コードを `--write` で一括フォーマット
