# CLAUDE.md — GIJIRO セッション開始ガイド

> このファイルは Claude Code (`claude` CLI) がリポジトリルートから起動された時に **自動で読み込まれる** プロジェクト指示書です。前回までの全文脈と未完タスクをここから辿れるようにしています。

---

## 0. プロジェクト一行説明

**GIJIRO** — 会議音声をリアルタイムに文字起こしし、終了後に議事録 / 要約 / ToDo を自動生成する Web アプリ。Node.js + Express + SQLite3 + WebSocket、Vanilla JS フロントエンド (バンドラー無し)。

---

## 1. 最初に読むべきファイル (順番厳守)

セッション開始時、ユーザーから具体的な指示がない場合は **まず以下を Read してください**。

| 順 | ファイル | 目的 |
|---|---|---|
| 1 | **[`docs/TASKS.md`](docs/TASKS.md)** | 未完タスクのバックログ。今日着手すべき作業がここにある |
| 2 | **[`PROGRESS.md`](PROGRESS.md)** | 完了済み作業の時系列ログ。直近セクション (`## 31` `## 32` …) から逆方向に読むと「最近何が起きたか」が分かる |
| 3 | **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** | 設計規約と再発防止ルール。新コード追加時はここの「Editor state ownership」「Past-meeting context isolation」「Mic preset → STT metadata」3 規約を守る |

3 ファイルを読み終えたら、ユーザーに「現状を把握しました。Section C の L シリーズが最優先で残っています。どれから着手しますか？」と短く確認してから動き出してください。

---

## 2. 現状サマリ (2026-05-09 時点)

### 本番稼働状況
- **本番 URL**: `https://winwinreco-227823039350.asia-northeast1.run.app`
- **DB**: Cloud Firestore (Native mode, `asia-northeast1`)
- **デプロイ**: Cloud Build 経由で main push → 自動 deploy
- **オーナーアカウント**: `ninnzinn.3bonn@gmail.com` (allowlist bypass)
- **シークレット**: GCP Secret Manager (`gemini-api-key` / `google-api-key` / `groq-api-key` / `elevenlabs-api-key`)

### 完了済みのフェーズ (主要なもの)
- セキュリティ強化 / DB / アカウント / セッション (タスク #1〜#20)
- UI 大刷新・GIJIRO リブランド・プロフィール画面 (タスク #21〜#76)
- レビュー対応 R1〜R14 / B1〜B7 / Phase5 UX
- L1〜L10: 長時間会議チャンキング (時間窓 10 分 / Map-Reduce / 並列度 2 / タイムアウト+リトライ / 部分再生成)
- F1〜F5: ユーザーフィードバック改善
- DB-Phase0〜6: SQLite ↔ Firestore 抽象化 → 本番 Cloud Run 起動完了
- collectionGroup → findInRoom パターン統一 (`docs/ARCHITECTURE.md` に規約あり)
- STT プロバイダー別 議事録プロンプト (ElevenLabs ↔ Google)
- チャンキング無限ループバグ修正 + 47 テスト追加 (`tests/chunking.test.js`)
- イースターエッグ ミニゲーム (赤テーマ + 「血まみれの目」)

### 残タスク (`docs/TASKS.md`)
- **L11** (low): 会議中ストリーミング議事録生成 (将来検討、計測してから判断)
- **OPS-1** (medium): Cloud Billing Budget Alert ($5/$10/$20) の手動設定
- **OPS-2** (medium): API キーローテーション (§48 のトラブルシュート時に平文露出あり)

---

## 3. 設計規約 (新コード追加時に必ず守る)

`docs/ARCHITECTURE.md` の主要 3 規約だけここに転記しておきます。詳細は本体を参照。

### 3.1 Editor state ownership
**state 由来の表示と入力先を兼ねる UI は、必ず以下を実装する**:
- dirty タイムスタンプ (最終手動編集時刻)
- focus ガード (`document.activeElement === editor` のとき DOM を触らない)
- 同値ガード (`editor.value !== nextValue` のときだけ代入)
- ユーザー編集優先の sync ロジック

→ 新規エディタを追加するときも同じパターンを踏襲。ポーリングがエディタを上書きするバグの再発を防ぐため。

### 3.2 Past-meeting context isolation
- **議事録**生成は **過去会議のコンテクストを絶対に混ぜない** (`generateMinutesFromTranscript` は `pastContextBlock` を意図的に無視)
- **要約 / ToDo / 自由解析** だけがユーザートグル (AI 解析パネルの `#use-past-meetings`) で過去会議を参照可能
- 議事録は **当該会議のみ** で完結する verbatim record として扱う

### 3.3 Mic preset → STT metadata
`src/frontend/mic-presets.js` がマイクプリセットの **唯一の真実源**。プリセット切替時には次の 3 層を必ず同時更新:
1. `getUserMedia` 制約 (`echoCancellation` / `noiseSuppression` / `autoGainControl`)
2. フロント VAD パラメータ (`attackFrames` / `minActiveFrames` / `crestMin/Max`)
3. Google STT メタデータ (`microphoneDistance` / `recordingDeviceType`) — WebSocket `mic_preset` メッセージで backend へ通知

どれか 1 つを忘れると遠距離マイクで認識精度が静かに落ちるなどのサイレントリグレッションが起きる。

---

## 4. 作業の進め方 (ワークフロー)

新しいタスクに着手する基本フロー:

1. `docs/TASKS.md` から着手するタスク (例: L1) を選ぶ
2. **TaskCreate** ツールで該当タスクを登録 → `in_progress` に
3. タスク本体に書かれた「対象ファイル」「実装ステップ」に従って実装
4. 「検証手順」を実行 (`npm test` / 手動確認 / 該当する jest ファイル単独実行)
5. 完了したら:
   - **TaskUpdate** で `completed` に
   - `docs/TASKS.md` から該当タスクのブロックを削除
   - `PROGRESS.md` に新節 (`## NN. xxx (YYYY-MM-DD)` 形式) として転記
   - 再発防止ルールが導出できるなら `docs/ARCHITECTURE.md` に追記

**複数タスクを並行で進める場合**は、依存関係 (TASKS.md に書いてある実装順) を尊重。L1 を飛ばして L4 から着手しない。

---

## 5. よく使うコマンド

| 用途 | コマンド |
|---|---|
| 開発サーバー起動 | `npm start` |
| 全テスト実行 | `npm test` |
| 特定テストだけ実行 | `npm test -- tests/me-rooms.test.js` |
| 並列実行を避ける | `npm test -- --runInBand` |
| Node 構文チェック (Linux 系) | `node --check src/backend/app.js` |

---

## 6. 環境メモ

- **Node.js + Express + SQLite3 / Firestore + WebSocket** が backend (`DB_DRIVER` で切替)。
- **Vanilla JS + CSS** が frontend。バンドラー無し。`<script src="...">` で順次読み込み。
- **主要グローバル**: `window.AppState.state` / `window.AppDom` / `window.AppAuth` / `window.AppProfile` / `window.AppMicPresets` / `window.AppEasterGame`
- `src/frontend/main.js` は **2900 行超** あるので、頭から読まず **関数名 grep** で目的箇所を特定するのが速い。
- **WSL / Linux サンドボックスで日本語パス (`gpt - コピー`) を扱うとファイル切り捨て** が起きるケースあり (PROGRESS.md §43 の前後参照)。**Windows ネイティブの Read/Edit ツールを優先**。
- **既定の AI プロバイダ / モデル**: 本番 (`cloudbuild.yaml`) は `AI_PROVIDER=gemini` (`gemini-2.5-flash`)、`STT_PROVIDER=google`。プロバイダ切替は環境変数または `aiConfig` 経由。
- **STT 別の議事録プロンプト**: `AIService._isHighAccuracyStt(roomMeta)` が `elevenlabs` のとき体裁整形のみのプロンプトに切替。詳細は `docs/ARCHITECTURE.md` の「STT プロバイダー別 議事録プロンプト」節。
- **collectionGroup を避ける**: Firestore で room scope のクエリは必ず `findInRoom(id, roomId)` などサブコレクション直接アクセスを使う (規約は `docs/ARCHITECTURE.md` 参照)。

---

## 7. やってはいけないこと

- **`PROGRESS.md` の過去節を書き換えない** (履歴は不可逆)
- **テスト用 SQLite DB (`tests/tmp/*.db`) 以外の DB ファイルを消さない**
- **`.env` をリポジトリにコミットしない** (API キーが入っている可能性)
- **`docs/TASKS.md` で完了済み Section の見出しを消さない** (運用ルールの一部)
- **`CLAUDE.md` (このファイル) の構造を勝手に変えない** — Claude Code が自動で読む契約ファイルなので、変更時はユーザーに先に相談

---

## 8. このファイルがあれば再開できること

- 別マシン・別ターミナル・別 OS でも `claude` をリポジトリルートで起動するだけで、本ガイドが自動で context に乗ります
- 過去のチャット履歴は無くても OK。`docs/TASKS.md` と `PROGRESS.md` と `docs/ARCHITECTURE.md` を読めば直近の意思決定の理由まで辿れる作りになっています
- もし上記 3 ファイルにも書かれていない情報が必要になったら、ユーザーに直接訊いてください。憶測で進めない
