# プロジェクト進捗メモ (Meeting Minutes App)

## 1. 初期実装完了 (2026-03-05)
- **MVP機能の実装**:
    - Google Cloud Speech-to-Text を使ったリアルタイム文字起こし。
    - WebSocket による発話イベントの同期。
    - SQLite3 による会話ログの保存。
    - Markdown 形式での議事録ダウンロード。
- **AI要約機能の追加**:
    - Gemini を使って会議要約、決定事項、TODO を生成。
    - 会話ログをコンテキストとして渡し、議論内容を整理できるようにした。
- **ドキュメント整備**:
    - `README.md` の更新と初期ファイル整理。

## 2. ローカル LLM 対応 (Ollama) (2026-03-11)
- **AIプロバイダーの抽象化**:
    - `AIService` を分離し、Gemini と Ollama を切り替えられるようにした。
- **Ollama 接続対応**:
    - `http://localhost:11434/api/generate` を利用する処理を追加。
- **設定の追加**:
    - `.env` で `AI_PROVIDER` を切り替え可能にした。
- **UI改善**:
    - 利用中の AI エンジンを画面上で確認できるようにした。

## 3. リアルタイムトピック解析 (2026-03-14)
- **トピックツリー生成**:
    - `AIService` に `topic_tree` プロンプトを追加。
    - 会話ログから大項目・中項目・小項目のツリーを生成できるようにした。
- **UIの整理**:
    - 会議中にトピックツリー、ログ、メモを並べて確認できる構成にした。
- **操作改善**:
    - 解析結果の再描画や表示切り替えをしやすくした。

## 4. ローカル LLM 利用手順の整理
- **Ollama インストール**: [ollama.com](https://ollama.com/) から導入。
- **モデル取得**:
    ```bash
    ollama pull llama3
    ```
- **起動**:
    ```bash
    ollama serve
    ```
- **設定例**:
    ```env
    AI_PROVIDER=ollama
    OLLAMA_MODEL=llama3
    ```

## 5. 技術メモ
- 音声ファイルの保存や再利用の扱いを今後整理したい。
- UI/UX は会話ログの見返しやすさを最優先で継続改善する。
- Tailwind CSS 導入は未着手。

## 6. 会議ログ外部記憶化と会議後レビュー改善 (2026-03-24)
- **ログ中心UIへの再設計**:
    - プロジェクトツリー表示を外し、会話ログの検索・見返しを主役にしたUIへ変更。
    - PC/スマホの両方で、会話中も会議後も同じ感覚でログを確認できる構成へ整理。
- **外部記憶向けログ機能の追加**:
    - 重要ログの星マーク、メモ、検索、絞り込み、自分の発言のみ表示を追加。
    - 重要ログ一覧から該当発言へジャンプできるようにした。
- **生ログと補正後ログの両保存**:
    - `raw_transcript` と表示用 `transcript` を分離して保存。
    - `transcript_source` と `corrected_at` を保持し、STT生データ・AI補正・手動修正の区別を残すようにした。
    - 会議後レビュー画面では `RAW` / 現在表示 / 差分 を同じログカード内で見られる形にした。
- **一括AI補正の導入**:
    - 個別補正UIは廃止し、会議単位の一括補正のみ残した。
    - 一括補正は要約と同じ AI provider / model 設定を使うように統一した。
- **文字起こし精度向上の実装**:
    - 同一話者の短い連続発話を一定時間内で結合し、細切れログを減らした。
    - 生ログは保持したまま、表示ログのみ育てる設計にしている。
- **編集作業中の自動スクロール抑止**:
    - ログのメモ・編集作業中は自動で最新ログへ飛ばないように修正。
- **バックエンド安定化**:
    - `e2e-audio` / `room-sync` のフレーク原因だった WebSocket 初期化競合を修正。
    - 全テスト通過を確認済み。

## 29. AIモデル選択基準の標準化 (2026-04-19)
- **プロバイダーごとの標準モデルを定義**:
    - **Gemini**: `gemini-2.5-flash` をメインモデルとして利用。
    - **Groq**: `openai/gpt-oss-120b` を標準モデルとして利用。
- **モデル選択ロジックの統一**:
    - ルーム設定やリクエストでモデルが明示されていない場合、上記のプロバイダーごとの標準モデルが自動的に選択されるようにバックエンド (`app.js`, `ai-service.js`) およびフロントエンド (`main.js`, `bindings.js`) を更新した。
    - これにより、プロバイダーを切り替えた際に、そのプロバイダーに最適な標準モデルが即座に適用される。
- **整合性の修正**:
    - 会議中の解析、議事録作成、文字起こし補正など、AIを利用するすべてのエンドポイントでこの標準ロジックが適用されるように修正を完了。

## 30. 現在の課題と次回対応予定
1. **フロントエンドの UI ブラッシュアップ**:
    - Tailwind CSS 4 を利用した、よりモダンでインタラクティブな UI への刷新。
    - 議事録表示のレイアウト調整と読みやすさの向上。
2. **バックエンドのパフォーマンス最適化**:
    - 大規模な会議ログにおける AI 解析のレスポンス速度向上。
    - WebSocket 通信の安定性強化。


## 8. 会議後AI整理タブの表示修正と会議中AI解析追加 (2026-04-02)
- **会議後AI整理タブの根本修正**:
    - `section` セレクタの巻き込みや `modal-open` 残留で結果カードやスクロールが不安定になる経路を整理した。
    - 会議後は `body` 側で自然に縦スクロールする構成へ寄せ、ホイール操作が詰まりにくい形に変更した。
    - AI整理タブの結果エディタは常時見えるカードとして残し、保存・コピー・ダウンロード対象を共通化した。
- **会議中のライブAI解析パネル追加**:
    - 会議中画面に `要約`、`ToDo`、`合意点と未解決課題`、`トークテーマ一覧` の解析ボタンを追加。
    - 解析結果は会議中にその場で見返せる編集可能テキストエリアに表示するようにした。
    - 会議中解析は現在までに蓄積したログを使って手動実行する。
- **表示確認と回帰確認**:
    - 配信 HTML 上で会議後AI結果カードと会議中AI解析パネルが存在することを確認した。
    - `tests/api-insights.test.js` と `tests/api-rooms.test.js` を通過。

## 9. ミュート機能とモバイル向けマイク確認の追加 (2026-04-03)
- **ミュート機能の追加**:
    - 会議中ヘッダに `ミュート` ボタンを追加し、この端末の話者だけ文字起こし送信を止められるようにした。
    - ミュート中は送信処理を止め、トラック状態とUI表示を同期するようにした。
- **モバイル向けマイク確認UI**:
    - 参加前画面に `マイク確認` カードを追加し、許可取得と入力レベルメーターを見ながら確認できるようにした。
    - スマホ利用時に、参加前に入力できているかを目視しやすくした。
- **モバイル安定化のベストエフォート対応**:
    - `visibilitychange` / `pageshow` で AudioContext の再開と録音再開を試すようにした。
    - 画面点灯維持のために Wake Lock を試行するようにした。
    - ただし、モバイルブラウザのバックグラウンド録音はOSとブラウザの制約で保証できないため、完全常駐ではなく復帰時の自動回復を重視している。

## 10. モバイル実機前の事前点検強化 (2026-04-03)
- **モバイルWebで起きやすい失敗への対策追加**:
    - HTTPS / localhost でないとマイクが使えない点をUIに反映した。
    - `getUserMedia` に `echoCancellation` / `noiseSuppression` / `autoGainControl` / `channelCount: 1` を明示して、端末差による入力不安定さを減らすようにした。
    - マイクトラックの `ended` / `mute` / `unmute` を監視し、端末側で止まったときに状態文言へ反映するようにした。
- **権限と復帰の見える化**:
    - Permissions API が使えるブラウザではマイク権限状態を先に表示するようにした。
    - `online` / `offline` / `pageshow` / `visibilitychange` を使って、通信復帰・画面復帰時に状況を分かるようにした。
- **制約の明文化**:
    - モバイルブラウザではバックグラウンド録音の完全保証はできないため、PWA / ネイティブ化なしでの限界を前提に、復帰しやすさと事前確認を優先する方針を継続する。

## 11. スクロール回帰の点検項目化 (2026-04-03)
- **今回の再発原因**:
    - モバイル時にレイアウトを縦積みにしても、会議中画面の `height: 100%` と `overflow: hidden` が残っていて、ページ全体の縦スクロールが死んでいた。
- **修正方針**:
    - モバイルの会議中画面では、固定コンテナ内スクロールではなくページ全体スクロールへ切り替える。
    - `#app > section` に限定すべきスタイルは必ず限定し、内側の要素に波及させない。
- **今後の必須点検項目**:
    - PC会議中: ログ欄がスクロールできるか
    - PC会議後: ページ全体とログ欄の両方が到達不能になっていないか
    - モバイル会議中: 画面全体を上下にスクロールできるか
    - モバイル会議後: AI整理タブとログレビュータブの両方で下まで到達できるか
    - マウスホイール / タッチスクロールの両方で確認すること

- **追加の構成見直し**:
    - `#app` の固定高さを全モード共通にするのをやめ、`setup / meeting / summary` で責務を分離した。
    - 初期画面と会議後画面は自然なページスクロール、会議中デスクトップだけ固定レイアウト、モバイル会議中は再びページスクロールに戻す方針へ整理した。

## 12. 共有URL参加と短いルームID (2026-04-03)
- **短いルームIDに変更**:
    - ルーム生成時のIDを長い `room-...` 形式から、6文字の短い英数字IDへ変更した。
    - 読み間違えやすい文字を避けた文字集合を使い、重複時は再生成するようにしている。
- **共有URLで参加可能に変更**:
    - 会議中の `Share` ボタンで、ルームID単体ではなく `?room=ROOMID` 付きの参加URLをコピーするようにした。
    - 共有されたURLで開くと、初期画面のルームID欄へ自動入力される。

## 13. 入室前プロフィールとAI解析文脈の強化 (2026-04-03)
- **入室前プロフィール入力を追加**:
    - 初期画面に `得意なこと・スキル・担当プロジェクト` の自由記述欄を追加した。
    - 入力内容は `localStorage` に保持し、次回も再入力しやすくした。
- **AI解析への利用**:
    - ユーザープロフィールを `users.profile_text` として保存し、会議ログ解析時に話者ごとの補助コンテクストとして AI へ渡すようにした。
- **Markdown 出力への反映**:
    - 議事録Markdownの先頭に参加者ごとのプロフィール一覧を追加した。
    - 途中参加者は、最初の発言位置にプロフィール注記を差し込むようにした。

## 14. 口元マイク前提の文字起こし精度改善 (2026-04-03)
- **ブラウザ側の音声加工を弱める調整**:
    - 口元マイク利用を前提に、`echoCancellation` / `noiseSuppression` / `autoGainControl` を無効寄りに変更した。
    - `sampleRate: 16000` とモノラル前提を明示し、STT向けの入力条件を揃えた。
- **簡易VADの追加**:
    - クライアント側でRMSベースの簡易音声ゲートを入れ、無音や遠くの漏れ音を送りにくくした。
    - 少しのハングオーバーを持たせ、語尾や短い途切れを切り捨てにくいようにした。
- **STTヒントの追加**:
    - 参加者名とプロフィール文からフレーズヒントを生成し、Google Speech-to-Text へ渡すようにした。
    - 人名、担当、研究テーマなどの固有語の認識改善を狙っている。
- **STT設定の改善**:
    - 自動句読点、`latest_long` モデル、`NEARFIELD` 前提のメタデータを設定した。

## 15. iPhone実機向けサンプリング周波数対策 (2026-04-03)
- **原因仮説**:
    - iPhone / Safari 系では実入力が 48kHz になることがあり、16kHz 前提のまま PCM を送ると STT 側の解釈が崩れる可能性がある。
- **対策**:
    - クライアント送信前に、実際の `AudioContext.sampleRate` を見て 16kHz へリサンプリングする処理を追加した。
    - マイク確認時の文言にも、実入力が 16kHz 以外なら変換して送ることを表示するようにした。

## 16. モバイル会議中の再接続導線と折りたたみUI (2026-04-03)
- **マイク感度の調整追加**:
    - 参加前と会議中の両方に `集音感度` セレクトを追加した。
    - `高め / 標準 / 被り抑制` の3段階で簡易VADのしきい値を切り替えられるようにした。
    - 設定は `localStorage` に保存し、次回参加時にも引き継がれる。
- **会議中のマイクONボタンを追加**:
    - モバイル復帰時に入力処理が止まった場合でも、その場で `マイクON` を押して録音系を再初期化できるようにした。
    - 再接続時は `getUserMedia` と `AudioContext` を再準備し、WebSocket が開いていれば録音も再開する。
- **モバイル縦長対策として折りたたみUIを追加**:
    - 会議中ヘッダにハンバーガメニューを追加した。
    - モバイルでは `会話メモリ` と `会議中AI` を個別に折りたためるようにし、初期状態では両方を閉じてログ中心で見られるようにした。
    - 画面回転やリサイズ時にも折りたたみ状態とメニュー表示を再計算する。
- **文字化けの追加修正**:
    - マイク状態、権限状態、オンライン/オフライン、復帰案内、AI結果ラベルなど、今回の導線で目に入る主要文言を正常な日本語へ戻した。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `npm test -- tests/e2e-audio.test.js tests/ws.test.js tests/stt-service.test.js tests/api-rooms.test.js --runInBand`
    - 配信HTML上で `btn-reconnect-mic`, `mic-sensitivity`, `meeting-mic-sensitivity`, `mobile-meeting-menu` が存在することを確認した。

## 17. 会議後レビュー画面のモバイル折りたたみ対応 (2026-04-03)
- **会議後専用のモバイルメニューを追加**:
    - `ログレビュー` / `AI整理` 共通で使えるハンバーガメニューを追加した。
    - モバイル時のみ `集計`, `絞り込みと重要ログ`, `AI操作` を個別に折りたためる。
- **主操作を大きく表示する初期状態に変更**:
    - 会議後画面へ入った直後、モバイルでは `集計` と `絞り込み・重要ログ` をたたんだ状態で始まる。
    - これにより、まず `会話ログ` を大きく読める。
- **AI整理タブでも結果優先に調整**:
    - 解析ボタン群と自由解析入力を `ai-mobile-controls` としてまとめ、結果エディタを残したまま操作群だけ折りたためるようにした。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - 配信HTML上で `summary-mobile-menu`, `btn-summary-mobile-menu`, `btn-toggle-summary-stats`, `btn-toggle-summary-sidebar`, `btn-toggle-summary-ai-controls`, `ai-mobile-controls` が存在することを確認した。

## 18. 会議後レビュー画面に議事録専用タブを追加 (2026-04-03)
- **議事録専用タブを追加**:
    - 会議終了後の `ログレビュー` / `AI整理` に加えて、`議事録` タブを追加した。
    - タブ内には `自動調整で議事録を生成` ボタン、編集可能な議事録エディタ、`コピー` / `ダウンロード` を配置した。
- **生ログベースの議事録生成**:
    - バックエンドの AI 解析に `minutes` タイプを追加した。
    - `raw_transcript` を優先し、同じ話者の連続発話は AI に渡す前にひとまとまりへマージする。
    - そのうえで、会議でそのまま配れる一歩手前の読みやすい議事録へ整えるプロンプトを追加した。
- **編集しやすい運用に調整**:
    - 生成された議事録は textarea に入り、そのまま手直しできる。
    - 入力した内容は state に同期し、コピーやダウンロードも編集後の内容を使う。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/backend/services/ai-service.js`
    - 配信HTML上で `tab-minutes`, `panel-minutes`, `btn-run-minutes`, `minutes-output-editor`, `btn-minutes-copy`, `btn-minutes-download` が存在することを確認した。

## 19. 会議後レビュー画面のモバイル可読性を追加調整 (2026-04-03)
- **モバイルでの主操作を見やすく調整**:
    - 会議後画面の `レビュー操作`, `タブ列`, `AI整理`, `議事録` の各ボタン列をモバイルで全幅寄りに整えた。
    - `AI整理` と `議事録` のエディタはモバイルで極端に縦長になりすぎない最小高さへ調整した。
- **タブ列の詰まり対策**:
    - `ログレビュー / AI整理 / 議事録` の3タブは、モバイルで横スクロールしながら切り替えられるまま、ボタン内余白を見直して読みやすくした。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/backend/services/ai-service.js`
    - `npm test -- tests/api-rooms.test.js tests/e2e-audio.test.js tests/ws.test.js tests/stt-service.test.js --runInBand`

## 20. 共有AI生成の Phase 1 着手 (2026-04-08)
- **Gemini 2.5 Pro に統一**:
    - AI 設定の既定値を `gemini-2.5-pro` に揃えた。
    - フロントの AI 設定 UI も Gemini 固定表示に寄せた。
- **ホスト限定の共有生成 API を追加**:
    - `POST /rooms/:id/shared-ai/:type` を追加し、`minutes / summary / todo` を room 単位で生成・保存できるようにした。
    - ホスト判定は `room.owner_id` と参加者 `user_id` の一致で行う。
    - 参加 API の返り値に `is_host` を追加した。
- **room 単位の共有保存を追加**:
    - `rooms` に `minutes_text / minutes_updated_at / todo_text / todo_updated_at` を追加した。
    - 既存の `summary_text` とあわせて、会議後の共通成果物を room に保存する形へ寄せた。
- **会議後フロントを共有前提に変更**:
    - ホストは `要約 / TODO / 議事録` を生成、参加者は生成済み結果を表示するだけにした。
    - 共有結果は `GET /rooms/:id/insights` から定期取得し、会議後画面で見えるようにした。
- **今回の確認**:
    - `node --check src/backend/app.js`
    - `node --check src/backend/services/ai-service.js`
    - `node --check src/frontend/main.js`
    - `npm test -- --runInBand`

## 21. 議事録ベースの自由解析と固定ヘッダー化 (2026-04-08)
- **カスタムプロンプトを議事録依存に変更**:
    - `POST /rooms/:id/custom-ai` を追加し、自由解析は保存済み議事録だけをコンテキストに使うようにした。
    - 議事録未生成のまま自由解析を実行しようとした場合は 409 を返す。
    - フロントの `自由解析` ボタンはこの新APIを使うように切り替えた。
- **ヘッダーを固定表示に調整**:
    - 会議中ヘッダーと会議後レビューのヒーロー部を sticky 表示にした。
    - スクロールしても主要操作が上部に残るようにした。
- **会議中の MD ボタンを削除**:
    - 会議中ヘッダーから `MD` ボタンを削除した。
    - 保存導線は会議後側の `Markdownで保存` に寄せる形へ整理した。
- **スクロール補助ボタンを追加**:
    - 右下固定の `↑ / ↓` ボタンを追加した。
    - 現在表示中のタブ領域をスムーズスクロールで上端 / 下端へ移動できる。
- **今回の確認**:
    - `node --check src/backend/app.js`
    - `node --check src/backend/services/ai-service.js`
    - `node --check src/frontend/main.js`
    - `npm test -- --runInBand`

## 22. マイク調整UIをスライダー化 (2026-04-08)
- **最小 / 最大閾値のスライダーを追加**:
    - 参加前のマイク確認カードと会議中メニューに、`最小音量閾値` と `最大音量閾値` のスライダーを追加した。
    - 既存の感度プリセットは後方互換として残しつつ、実際の調整はスライダー優先で反映するようにした。
- **音量メーターに閾値ラインを追加**:
    - メーター上に最小閾値ラインと最大閾値ラインを表示し、現在の入力と比較しやすくした。
    - 大きすぎる入力に達したときはメーターの色が変わる。
- **音声処理へリアルタイム反映**:
    - 最小閾値は VAD の判定に使う。
    - 最大閾値は PCM 送信前のクリップ制御に使う。
    - 設定は `localStorage` に保存し、再訪時も復元する。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/backend/app.js`
    - `npm test -- --runInBand`

## 23. 参加者制御トークンと保守メモの追加 (2026-04-08)
- **参加者制御トークンを追加**:
    - ルーム参加時に `control_token` を発行し、参加者ごとに保持するようにした。
    - `shared-ai`、`custom-ai`、`end` では `participant_id + control_token` の両方で認証するように変更した。
    - ホスト専用処理は、トークン認証に加えて `room.owner_id` と一致する参加者だけ許可する。
- **セキュリティ回帰をテスト追加**:
    - 不正トークンで会議終了できないことを API テストに追加した。
    - `custom-ai` も無効トークンでは拒否されるようにした。
    - 参加者リポジトリに `findByIdAndToken` のテストを追加した。
- **保守メモを追加**:
    - `docs/ARCHITECTURE.md` を追加し、画面モード、共有AIフロー、現状の技術的負債、次の分割方針を整理した。

## 24. main.js の重複関数と文字化けブロック整理 (2026-04-09)
- **重複定義を削減**:
    - `updateMuteButton`、`syncMuteUi`、`runMicCheck`、`syncMicrophonePermissionState`、`prepareAudio`、`createRoom`、`joinRoomProcess`、`toggleMute`、`checkApiStatus` などの古い重複ブロックを整理した。
    - 以前は後勝ちで動いていたが、今は意図した定義だけが残る状態に近づけた。
- **文字化けブロックを正常化**:
    - `renderMinutesWorkspace`、`renderMeetingAnalysis`、共有AIまわり、会議中AIまわりの表示文言を正常な日本語へ戻した。
    - 構文を壊していた文字化け行も除去した。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `npm test -- --runInBand`

## 26. 終了後エディタの自動上書きバグ — 原因究明と対応計画 (2026-04-30)

### 症状
会議終了後の **要約 / 議事録 / カスタムプロンプト** の各エディタに手動入力した内容が、約 5 秒経過すると自動で生成直後の値（または空文字）に戻されてしまう。

### 原因（特定済み）
1. `scheduleInsightsPoll()` が **5 秒ごと** に `loadMeetingInsights({ silent: true })` を発火させる (`src/frontend/main.js:968-975`)。
2. `loadMeetingInsights` がサーバーから `summary / minutes / todo` を取得し、`state.meetingInsights.*` を上書き。
3. その直後 `syncSharedResultsIntoEditors()` (`src/frontend/main.js:977-993`) が
   - `state.minutesWorkspace.result = state.meetingInsights.minutes`
   - `setAiWorkspace('summary', '要約', state.meetingInsights.summary, '')`
   を実行し、ユーザーの編集を破棄してサーバー値で上書き。
4. 第 4 引数 `instruction = ''` のため、`setAiWorkspace` 内 (`main.js:1691-1701`) で `state.aiWorkspace.instruction` も空になる → カスタムプロンプト欄が消える。
5. `renderAiWorkspace` / `renderMinutesWorkspace` が無条件に `textarea.value = state.*` を実行するため、focus 中・編集中でも上書きが発生。

### 設計上の根本問題
クライアントの **textarea が単に `state` の鏡** として扱われており、サーバー値との衝突解決ロジックが存在しない。`render` 関数が「ユーザーの編集」と「サーバーからの新値」の優劣を区別せず、後者が常に勝つ構造。

### 対応計画 (タスク #91-#97)
- **#91 [B1]** dirty タイムスタンプを各エディタに導入し、編集後 N 秒は上書き禁止
- **#92 [B2]** `document.activeElement === editor` のときは render が DOM を触らない (focus / IME 保護)
- **#93 [B3]** 同値ガードで `editor.value !== nextValue` のときだけ代入 (selectionRange 維持)
- **#94 [B4]** `syncSharedResultsIntoEditors` をユーザー編集優先に変更 (dirty なら server 値を取り込まない)
- **#95 [B5]** `setAiWorkspace` の `instruction` 引数を `undefined` のとき維持する仕様に変更
- **#96 [B6]** ポーリングは `status === 'processing'` のときだけ継続、`ready/error/idle` で自動停止
- **#97 [B7]** 議事録・要約・カスタムプロンプトをそれぞれ編集 → 6 秒以上待つ → 内容保持を確認する手動回帰テスト手順を残す

実装順は B1 → B2 → B3 → B5 → B4 → B6 → B7 を想定。B1 が他タスクの前提、B5 は単体で副作用が大きく早期適用が安全。

## 25. フロントエンドの分割第一段 (2026-04-09)
- **`main.js` の責務を分離**:
    - `src/frontend/state.js` を追加し、アプリ状態を `window.AppState.state` に集約した。
    - `src/frontend/dom.js` を追加し、主要DOM参照を `window.AppDom` に集約した。
    - `src/frontend/bindings.js` を追加し、イベント束縛だけを `bindAppEvents()` に分離した。
    - `src/frontend/utils.js` を追加し、ID生成、URL生成、音声制約、リサンプリング、表示整形、テキストダウンロードのような純粋ヘルパーを `window.AppUtils` に切り出した。
- **`main.js` はオーケストレーション中心へ整理**:
    - 画面遷移、音声処理、共有AI、ログ描画、モーダル制御、初期化処理を主責務にした。
    - 復旧時に壊れていた初期化ブロックを修正し、`bootstrap()` とライフサイクルイベントを一本化した。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/frontend/utils.js`
    - `npm test -- --runInBand`

## 26. フロント起動不能の修正と束縛の防御強化 (2026-04-16)
- **起動不能の根本原因を修正**:
    - `src/frontend/debug.js` の `const DebugMonitor` と、`src/frontend/main.js` で追加した同名 `const DebugMonitor` がブラウザで衝突し、`main.js` 全体が実行されない状態になっていた。
    - `main.js` 側は `AppDebug` に改名し、`window.DebugMonitor` への委譲に変更した。
- **イベント束縛を防御的に変更**:
    - `src/frontend/bindings.js` に `bindClick` / `bindEvent` を追加し、要素が存在しない場合でも束縛全体が止まらないようにした。
    - ボタン、スライダー、モーダル、フィルタ、AI入力欄の束縛はすべて null-safe にした。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/frontend/bindings.js`
    - `npm test -- --runInBand`

## 27. Gemini フォールバックと会議終了後の自動議事録生成修正 (2026-04-16)
- **Gemini の自動フォールバックを追加**:
    - `gemini-2.5-pro` が quota / 429 / unsupported で失敗したとき、`gemini-2.5-flash`、`gemini-2.5-flash-lite`、`gemini-2.0-flash` に順次フォールバックするようにした。
    - フロント既定モデルも `gemini-2.5-flash` に変更した。
- **会議終了後の自動共有生成を追加**:
    - 会議終了APIで room を閉じた直後に、バックグラウンドで `議事録 -> 要約 -> TODO` を順に生成するようにした。
    - 既存の `insights_status` とポーリング表示をそのまま利用して、会議後画面で自動生成結果を拾える構成にした。
- **共有AIルートを整理**:
    - `shared-ai` の手動生成経路も内部的に同じ生成関数を使うように統一した。
    - 途中で壊れていた `custom-ai` / `shared-ai` / `end` ルートの並びを復旧した。
- **今回の確認**:
    - `node --check src/backend/app.js`
    - `node --check src/backend/services/ai-service.js`
    - `npm test -- --runInBand`

## 28. 会議後AIの自動表示強化とマイクプリセットUI改善 (2026-04-16)
- **会議後AI結果を見えやすく修正**:
    - `GET /rooms/:id/insights` で取得した共有 `要約 / TODO / 議事録` を、そのまま会議後ワークスペースへ反映するようにした。
    - これにより、会議終了後の自動生成結果が「生成はされたがエディタが空に見える」状態を避けやすくした。
    - 会議後画面を開いたときに、保存済みカスタム結果で共有結果を上書きしないように整理した。
- **Gemini 既定モデルを Flash 前提へ統一**:
    - バックエンドの既定モデルを `gemini-2.5-flash` に変更した。
    - 環境変数で以前の `gemini-2.5-pro` が残っていても、明示指定でない限り `flash` を優先するようにした。
- **マイク確認UIを利用シーンベースへ改善**:
    - `src/frontend/mic-presets.js` を追加し、`スマホ本体 / ピンマイク / 反響のある部屋 / 大人数 / 有線ヘッドセット` のプリセットをアセットとして切り出した。
    - 参加前画面に「利用シーンを選ぶ」「マイクを確認する」「必要なら微調整する」の3ステップを追加した。
    - 各プリセットごとに、推奨環境、設置のコツ、運用上の注意、想定環境チェックを表示するようにした。
- **マイク設定をプリセットと連動**:
    - プリセット選択で `echoCancellation / noiseSuppression / autoGainControl` と `最小 / 最大閾値` をまとめて反映するようにした。
    - 会議中メニューにも現在のプリセット表示と切り替えボタンを追加した。
- **今回の確認**:
    - `node --check src/frontend/main.js`
    - `node --check src/frontend/utils.js`
    - `node --check src/backend/app.js`
    - `node --check src/backend/services/ai-service.js`
    - `npm test -- --runInBand`

## 29. Groq 標準化と文字化け修正 (2026-04-25)
- **Groq を既定の AI / STT プロバイダへ変更**:
    - AI は `GROQ_API_KEY` がある場合に `groq` を既定にし、Gemini は引き続き選択可能な任意プロバイダとして残した。
    - STT は `GROQ_API_KEY` がある場合に `groq` を既定にし、`whisper-large-v3-turbo` を既定モデルにした。
    - `/api/status` も `ai_provider` と `stt_provider` を返すように整えて、フロントで現在の既定プロバイダを見やすくした。
- **Groq 音声文字起こしを追加**:
    - `src/backend/services/stt-service.js` に Groq OpenAI 互換の音声認識経路を追加した。
    - PCM16 音声を WAV に包んで `/openai/v1/audio/transcriptions` へ送る実装にした。
    - Google STT の既存経路はそのまま残し、環境変数で切替できる構成を維持した。
- **文字化けの大きい塊を修正**:
    - `README.md` を全面的に書き直し、現状の Groq 既定構成に合わせて環境変数例を整理した。
    - `package.json` の説明文を正常化した。
    - `src/frontend/auth.js` を全面的に書き直し、ログイン / 新規登録 / 過去会議モーダルの表示文言を正常化した。
    - `src/backend/lib/past-context.js` を全面的に整理し、過去会議サマリ注入用のラベルや stopword 群の壊れた文字列を修正した。
    - `src/backend/server.js` の終了ログに残っていた壊れたメッセージも修正した。
- **今回の確認**:
    - `node --check src/backend/services/stt-service.js`
    - `node --check src/backend/services/ai-service.js`
    - `node --check src/backend/app.js`
    - `node --check src/backend/server.js`
    - `node --check src/frontend/main.js`
    - `node --check src/frontend/auth.js`
    - `npm.cmd test -- --runInBand`

## 30. 会議後AIの loading 表示・過去会議利用設定・プロフィール画面追加 (2026-04-25)
- **会議後AIの進行中表示を改善**:
    - `AI整理` と `議事録` の各ワークスペースに loading インジケータを追加した。
    - 会議終了後の自動生成中や、手動生成中にエディタカードへスピナーと進行中ステータスを表示するようにした。
    - 生成中はエディタ自体も半透明化して、いま処理中であることが視覚的に分かるようにした。
- **setup 画面に「過去の会議の要約を利用する」設定を追加**:
    - ホスト向け AI 設定内にチェックボックスを追加した。
    - 設定は `localStorage` に保持し、ルーム参加時に `ai_config.use_past_meetings` としてバックエンドへ渡すようにした。
    - backend では `rooms.use_past_meetings` を追加し、過去会議コンテキストの注入を room 単位で制御できるようにした。
- **プロフィール画面を追加**:
    - トップバーのアカウント操作に `プロフィール` ボタンを追加し、過去の会議一覧をプロフィール画面側へ移動した。
    - `GET /me/profile` / `PATCH /me/profile` を追加し、表示名と `profile_text` を手動編集できるようにした。
    - プロフィール画面で編集した内容は setup 画面へも反映され、今後の要約 / TODO / 議事録生成時の participant context に使われる。
- **今回の確認**:
    - `node --check src/frontend/profile.js`
    - `node --check src/frontend/auth.js`
    - `node --check src/frontend/main.js`
    - `node --check src/backend/app.js`
    - `node --check src/backend/repo/room-repo.js`
    - `npm.cmd test -- --runInBand`

## 31. エディタ自動上書きバグ修正 B1〜B7 (2026-04-30)

「5 秒ごとのポーリング → `syncSharedResultsIntoEditors` がユーザーの編集を上書き」という問題を根本から修正した。

- **[B1] dirty フラグの導入** (`src/frontend/state.js`, `src/frontend/bindings.js`, `src/frontend/main.js`):
    - `state.editorDirty = { aiResult: 0, aiInstruction: 0, minutes: 0 }` を追加。
    - `bindings.js` の `aiOutputEditor` / `customAiInstruction` / `minutesOutputEditor` input ハンドラで `Date.now()` を立てる。
    - `isEditorDirty(key, withinMs = 30_000)` ヘルパーを `main.js` に追加し、30 秒以内の編集を dirty と判定。
    - `setAiWorkspace` / `runMinutesGeneration` / shared-ai 生成など、サーバー由来の結果を書き込む箇所で dirty を `0` にリセット。

- **[B2] focus 中は render が DOM を触らない** (`src/frontend/main.js`):
    - `renderAiWorkspace` の `customAiInstruction.value` / `aiOutputEditor.value` への代入を `document.activeElement !== editor` ガードで包んだ。
    - `renderMinutesWorkspace` の `minutesOutputEditor.value` も同様にガード。
    - `bootstrap()` 内で blur 時に `renderAiWorkspace` / `renderMinutesWorkspace` を呼ぶリスナーを登録した。

- **[B3] 同値ガード** (`src/frontend/main.js`):
    - B2 のガードに `editor.value !== nextValue` の条件を追加し、同値再代入による selectionRange 破壊を防いだ。

- **[B4] `syncSharedResultsIntoEditors` をユーザー編集優先に** (`src/frontend/main.js`):
    - minutes / aiResult それぞれで `isEditorDirty()` を確認し、dirty なら上書きをスキップ。
    - 同値チェックも追加し、不要な `setAiWorkspace` 呼び出しを排除。
    - スキップ時は `AppDebug.log('info', ...)` でデバッグログを残す。

- **[B5] `setAiWorkspace` の instruction 引数を「未指定なら維持」** (`src/frontend/main.js`):
    - シグネチャを `function setAiWorkspace(mode, title, result, instruction)` に変更 (デフォルト `''` を削除)。
    - `instruction !== undefined` のときだけ `state.aiWorkspace.instruction` を上書きするよう変更。
    - サーバー由来で instruction を維持すべき呼び出し元 (非ホスト表示・shared-ai 生成後) の `''` を削除し、`undefined` 扱い (省略) に統一。

- **[B6] insights ポーリングの停止条件** (`src/frontend/main.js`):
    - `scheduleInsightsPoll` の冒頭に `if (state.meetingInsights.status !== 'processing') return;` を追加。
    - `ready` / `error` / `idle` になったら自動停止。run* 系で processing に変わると再開される。

- **[B7] 手動回帰テスト手順** (`docs/MANUAL_TESTS.md`, `README.md`):
    - `docs/MANUAL_TESTS.md` を新規作成し、5 シナリオを文書化した。
    - `README.md` のセッション開始案内に MANUAL_TESTS.md へのリンクを追記した。

- **再発防止ルール** (`docs/ARCHITECTURE.md` "Editor state ownership" セクションに追記): 後続参照のこと。
- **今回の確認**:
    - Read ツール (Windows ネイティブ) で全変更箇所の構文を目視確認。
    - `node --check` は Linux sandbox の日本語パス truncation 制約で実行不可 (既知の制約)。
    - `npm.cmd test -- --runInBand` を Windows ネイティブで実行して回帰がないことを確認すること (手動)。

## 32. Phase 5 UX 微調整 P5-1〜P5-7 (2026-04-30)

タップ削減フェーズの残課題を一括対応した。

- **[P5-1] meeting footer の「保存」ボタン廃止** (`src/frontend/index.html`, `src/frontend/bindings.js`):
    - `btn-save` を meeting footer から削除。`bindings.js` の bindClick も削除。
    - `btn-memo` のラベルを「全体メモ」→「会議全体のメモを残す」に変更して用途を明確化。

- **[P5-2] 共有 URL 参加者の display_name 自動補完** (`src/frontend/main.js`):
    - `applyParticipantModeFromUrl` 内で `localStorage['display_name']` → `account.display_name` の優先順で display-name 欄に自動入力。

- **[P5-3] PC でもメモ/AI パネルをデフォルト畳む** (`src/frontend/main.js`):
    - `showMeetingScreen` で `isMobileViewport()` 分岐を廃止し、PC/モバイル共通で両パネルを初期閉じ状態に統一。視線をログに集中させる運用へ。

- **[P5-4] welcome の「ゲストで使う」を最も目立つ CTA に** (`src/frontend/index.html`):
    - ボタン順を「ゲスト(primary) → ログイン(secondary) → 新規登録(ghost)」に変更。

- **[P5-5] 「Markdown 保存」を議事録タブ内に移動** (`src/frontend/index.html`):
    - `btn-download-final` を review-actions から削除し、議事録タブの insight-actions 内 (`btn-minutes-copy` / `btn-minutes-download` の隣) に移動。hero がすっきり。

- **[P5-6] ジャンプパレット長押し時間を 320ms に短縮** (`src/frontend/main.js`):
    - `JUMP_PALETTE_LONG_PRESS_MS` を 500 → 320 に変更。

- **[P5-7] welcome のメールアドレスを localStorage に保持** (`src/frontend/main.js`):
    - ログイン/登録成功時に `welcome_last_email` を保存。
    - `setWelcomeFormVisible(true, ...)` でフォームを開いたとき、email 欄が空なら localStorage から prefill。

- **今回の確認**:
    - Read ツール (Windows ネイティブ) で全変更箇所を目視確認。
    - `npm.cmd test -- --runInBand` を Windows ネイティブで実行して回帰がないことを確認すること (手動)。

## 33. ダーク / ライトモード切り替えを有効化 (2026-04-30)

プロフィール画面の「表示テーマ」セレクトが実際に機能するよう CSS を実装した。

- **`src/frontend/style.css`**:
    - `:root {}` の直後にダークモードトークンブロックを追加。
    - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` で OS 設定追従 (system)。
    - `[data-theme="dark"]` で強制ダーク。
    - アクセントカラー (#3db8af) はダーク背景でも視認性が高いためそのまま維持。サーフェス・テキスト・ボーダー・セマンティックカラーをダーク用に再設計。

- **`src/frontend/profile.js`** (`applySettings`):
    - `document.documentElement.style.colorScheme` を theme に合わせて `dark` / `light` / `light dark` に設定。スクロールバー・フォームコントロールなどのネイティブ UI もテーマに追従するようにした。

- **動作フロー**:
    1. ページ読み込み時に `applySettings(loadSettings())` が呼ばれ、保存済みテーマが即座に反映される。
    2. プロフィール画面の「表示テーマ」セレクトを変更すると `persist()` → `saveSettings()` → `applySettings()` の順に呼ばれ、localStorage 保存 + `<html data-theme="...">` 更新がリアルタイムで反映される。

## 34. ElevenLabs Realtime STT 対応 (2026-05-01)

`stt-service.js` に `elevenlabs` プロバイダーを追加した。

- **`src/backend/services/stt-service.js`**:
    - `require('ws')` を追加 (package.json 既存の `ws ^8.19.0` を利用)。
    - コンストラクタに `elevenLabsApiKey` / `elevenLabsModel` を追加。`STT_PROVIDER` 未指定時の自動選択を `elevenlabs → groq → google` の優先順に変更。
    - `createElevenLabsStream(onData, onError)`: WebSocket (`wss://api.elevenlabs.io/v1/speech-to-text/realtime`) に接続し、`speech_started` → `input_audio_chunk` → `speech_ended` の順でメッセージを送信。`transcript_event.type === 'final'` の確定テキストのみ `onData` に渡す。PassThrough を返すため既存のパイプライン互換を維持。
    - `recognizeWithElevenLabs(audioBuffer)`: バッチ REST API (`/v1/speech-to-text`) への fallback 実装。
    - `createStream` / `recognize` に `provider === 'elevenlabs'` の分岐を追加。Google のストリーミング分岐を条件式で整理。

- **`.env`**:
    - 既存の不完全な行 (`=sk_...`) を `ELEVENLABS_API_KEY=sk_...` に修正。
    - `STT_PROVIDER=elevenlabs` と `ELEVENLABS_STT_MODEL=scribe_v2_flash` を追加。

- **モデル**: `scribe_v2_flash` (デフォルト) / `scribe_v2` を `ELEVENLABS_STT_MODEL` で切り替え可能。

## 35. プロフィールから STT プロバイダーを切り替え可能に (2026-05-01)

プロフィール画面の「設定」タブから Google STT と ElevenLabs Scribe を切り替えられるようにした。

- **`src/frontend/profile.js`**:
    - `SETTINGS_DEFAULTS` に `sttProvider: 'google'` を追加。
    - `renderSettingsTab()` に「音声認識エンジン」セレクト (`google` / `elevenlabs`) を追加。
    - `persist()` に `sttProvider` を含め、`applySettings` で `localStorage.setItem('stt_provider', ...)` を書き込み。

- **`src/frontend/main.js`** (`sendMicPresetMetadataToServer`):
    - `mic_preset` メッセージに `stt_provider: localStorage.getItem('stt_provider') || 'google'` を付与。会議接続時およびマイクプリセット変更時に自動送信される。

- **`src/backend/app.js`**:
    - ファイル先頭に `const { STTService } = require('./services/stt-service')` を追加。
    - `mic_preset` ハンドラで `msg.stt_provider` を受け取り、グローバル sttService と異なる場合は `ws.sessionSttService` としてセッション専用 `STTService` を生成。
    - `startSTTStream` と `recognize` 呼び出しを `ws.sessionSttService || sttService`（`activeSttService`）で統一。
    - `/api/status` に `stt_available_providers` フィールドを追加（`ELEVENLABS_API_KEY` が設定されている場合に `elevenlabs` を含む）。
    - `stt_model` / `speech_to_text` フラグの elevenlabs 分岐も追加。

- **`.env`**:
    - `STT_PROVIDER=google`（デフォルト）に戻した（以前 `elevenlabs` に変更していたのを修正）。

- **動作フロー**:
    1. プロフィール → 設定 → 「音声認識エンジン」を「ElevenLabs Scribe」に変更 → 自動保存。
    2. 次の会議接続時、`mic_preset` メッセージに `stt_provider: 'elevenlabs'` が付与される。
    3. バックエンドがセッション専用の `STTService(provider='elevenlabs')` を生成し、以後の文字起こしに使用。
    4. 「Google (デフォルト)」に戻せばグローバルの Google STT サービスに切り替わる。

## 37. ElevenLabs STT プロトコル全面修正・議事録プロンプト変更 (2026-05-01)

以下の4つの課題をまとめて修正した。

### ElevenLabs WebSocket プロトコル修正 (`stt-service.js`)

- フィールド名の誤り (`type` → `message_type`、`audio` → `audio_base_64`) を修正。
- `session_started` を受け取るまで音声チャンクをキューイングするように変更。
- 明示的 commit (`commit: true`) なしでは `committed_transcript` が返らない仕様に対応:
  - `audioSentSinceLastCommit` フラグで空 commit を防止。
  - `passThrough.commit()` メソッドを追加（セッション維持しながらフラッシュ）。
  - WS が閉じたら `passThrough.destroy()` → `sttStream = null` → 次回音声受信時に再接続。

### 無音タイマーによるコミット制御 (`app.js`)

- ElevenLabs バイナリ受信パスに 4 秒無音タイマーを追加。
- 無音 4 秒で `sttStream.commit()` を呼び出し、中間コミットを送信。
- `ws.on('close')` でタイマーをクリア。
- `mic_preset` ハンドラでプロバイダー切り替え前にタイマーをクリア。
- WS 切断後 300ms で pre-warm (次の発話を待たずに新接続を開始)。

### 議事録プロンプトの変更 (`ai-service.js` — `generateMinutesFromTranscript`)

- トピック・セクション・見出しによる分類を廃止し、**時系列の忠実な発言録**スタイルに変更。
- `[SYSTEM]` で「要約ではなく発言録」と明示。
- `[FORBIDDEN EDITS]` に「トピック・セクション・見出しによる分類」「発言順の並び替え」を追加。
- `[FORMAT]` を `発言者A: 内容` の1行形式（見出しなし）に変更。

### STT 再接続の改善 (`stt-service.js`)

- ミュート中の空 commit 問題を `audioSentSinceLastCommit` フラグで解決。
- ミュート解除後に接続が死んでいた問題を `passThrough.destroy() → pre-warm` の連鎖で解決。

---

## 36. ElevenLabs STT バグ修正 (2026-05-01)

文字起こしが動作しなかった原因を3点修正した。

- **言語コード**: `'ja'` (ISO 639-1) → `'jpn'` (ISO 639-3)。ElevenLabs API は3文字コードを要求する。ストリーミング初期化メッセージ・バッチ REST API 両方を修正。
- **モデル名**: `'scribe_v2_flash'`（存在しない）→ `'scribe_v2'`。`stt-service.js` のデフォルト値と `.env` の `ELEVENLABS_STT_MODEL` を修正。
- **処理フロー**: `audioProcessor` が常に介在することで ElevenLabs の WebSocket ストリームにデータが届いていなかった。`app.js` のバイナリデータ処理を修正し、`provider === 'elevenlabs'` の場合は `audioProcessor` バッファをスキップして直接 `sttStream.write(data)` に書き込むよう変更。Google/Groq は従来通り `audioProcessor` 経由のバッチ認識を維持。

## 38. 長時間会議対応チャンキング L1〜L4 (2026-05-02)

1時間超の会議で AI 解析がトークン超過・タイムアウトで失敗するケースに対し、Map-Reduce パイプラインを実装した。

### L1 — チャンキング基盤 (`src/backend/services/chunking.js` 新規)

- `chunkUtterances(utterances, opts)`: 時間窓(10分) + トークン予算(6000) + 30秒オーバーラップで utterances を分割。戻り値 `Array<{ index, startTs, endTs, utterances, estimatedTokens, overlapWith }>`。
- `shouldChunk(utterances, opts)`: 総トークン > 8000 または 総時間 > 25分 で true。
- `estimateTokens(text)`: 日本語 1文字 ≈ 0.6トークンの粗い推定。
- `createSemaphore(concurrency)`: pLimit 相当のシンプルな並列度制御。
- テスト 12件すべて緑。

### L2 — Map 段 (`src/backend/services/ai-service.js`)

- `generateMinutesPerChunk(chunk, totalChunks, roomMeta, participants, userContexts, aiConfig)` を追加。
- プロンプト先頭に `[CHUNK INFO] N/M (startTs〜endTs)` を付与。
- プロンプトスタイルは §37 で変更した「忠実な発言録」スタイルに統一（トピック分類なし）。

### L3 — Reduce 段 (`src/backend/services/ai-service.js`)

- `mergeMinutesChunks(chunkResults, roomMeta)` を追加。LLM呼び出しなし。
- チャンク境界に `--- [チャンク N/M: startTs〜endTs] ---` ヘッダーを挿入して連結。
- 1チャンクのみの場合はヘッダーなしで結果をそのまま返す。

### L4 — 適応トリガー (`src/backend/app.js`)

- `chunking.js` の3関数をインポート。
- `generateSharedAiResult(roomId, 'minutes')` 内で `shouldChunk()` を呼び出し:
  - false → 従来の `generateMinutesFromTranscript` 1パス。
  - true → `chunkUtterances` で分割 → `createSemaphore(2)` で並列度2の Map → `mergeMinutesChunks` でマージ。
- ログ: `[SharedAI] minutes: chunking N utterances into M chunks`。

**設計メモ**: L2 のタスク仕様書に `[REPEAT]` セクション追記が書かれていたが、§37 のプロンプト変更後は `[REPEAT]` セクションが存在しないため未実装。新スタイルプロンプトで同等の効果を得ている。

## 39. 長時間会議対応チャンキング L5〜L8 (2026-05-05)

L1〜L4 で議事録 Map-Reduce を実装した続きとして、要約/ToDo/自由解析への適用・進捗 UI・タイムアウトリトライを追加した。

### L5 — 要約 / ToDo / 自由解析にも Map-Reduce を適用

- **`src/backend/services/chunking.js`** に `shouldChunkText(text)` / `chunkText(text)` を追加。
  - `shouldChunkText`: テキストの推定トークン数 > 8000 で true（議事録テキスト用）。
  - `chunkText`: 最大 6000 トークン / 10 行オーバーラップで行単位分割。
- **`src/backend/services/ai-service.js`** に Map-Reduce メソッドを追加。
  - `generateSummaryPerChunk` / `mergeSummaryChunks` — 部分要約 + LLM 統合マージ。
  - `generateTodoPerChunk` / `mergeTodoChunks` — 部分 ToDo + LLM 統合マージ。
  - `generateCustomPerChunk` — カスタム指示をチャンク単位で適用（マージは単純連結）。
- **`src/backend/app.js`** の `generateSharedAiResult` で `shouldChunkText(minutesText)` を確認し、長い場合は Map-Reduce パスへ。
- `/rooms/:id/custom-ai` エンドポイントにも同様のチャンキングを適用。

### L6 — 進捗イベントをフロントへ送る

- **`src/backend/app.js`** に `broadcastToRoom(roomId, message)` ヘルパーを追加。
  `repositories.wss.rooms` 経由でルームの全 WS クライアントへメッセージを送る。
- 各 Map フェーズ完了ごとに `{ type: 'chunk_progress', analysis_type, completed, total }` をブロードキャスト。
- `/rooms/:id/end` の `client.close()` を削除し、summary 画面でも WS を維持して進捗を受信可能にした。
- **`src/frontend/state.js`** の `minutesWorkspace` / `aiWorkspace` に `progress: null` フィールドを追加。

### L7 — フロント側の進捗 UI

- **`src/frontend/index.html`**: `#ai-output-loading` / `#minutes-output-loading` の両ローディング div 内に進捗バー HTML (`#ai-progress-wrap`, `#ai-progress-bar`, `#minutes-progress-wrap`, `#minutes-progress-bar`) を追加。
- **`src/frontend/style.css`**: `.progress-bar-wrap` (薄いアクセントカラー背景) / `.progress-bar-fill` (transition 付きアクセントカラー) を追加。
- **`src/frontend/main.js`**:
  - WS `onmessage` ハンドラに `chunk_progress` ケースを追加。`analysis_type` に応じて `state.minutesWorkspace.progress` または `state.aiWorkspace.progress` を更新。
  - `renderMinutesWorkspace` / `renderAiWorkspace` に進捗バー更新ロジックを追加。`total > 1` のときのみ進捗バーを表示し、生成完了時は自動リセット。

### L8 — チャンク単位のタイムアウト・リトライ

- **`src/backend/services/ai-service.js`** に `withTimeoutAndRetry(fn, { timeoutMs, retries, placeholder })` を module-level 関数として追加し、`AIService` とともにエクスポート。
  - 60 秒タイムアウト + 指数バックオフ (1s / 2s / 4s) で最大 3 回リトライ。
  - 全失敗時は `placeholder` を返す（null の場合はエラー再スロー）。
- **`src/backend/app.js`** の全チャンクマップ処理 (minutes / summary / todo / custom) を `withTimeoutAndRetry` でラップ。失敗したチャンクは `[このチャンクの解析に失敗しました: 範囲 hh:mm〜hh:mm]` プレースホルダーで埋めて Reduce に渡し、全体として完走させる。

### 今回の確認

- `node --check` で全変更ファイルの構文確認。
- `npm.cmd test -- tests/api-rooms.test.js tests/api-insights.test.js tests/ws.test.js tests/ai-service.test.js --runInBand` — 44 tests 全通過。

## 40. 表示名・アカウント名の分離と同期バグ修正 (2026-05-06)

### 背景

以下の 3 つの「名前」が混在しており、変更が互いに干渉・欠落する問題があった。

| 名前 | 保存先 | 役割 |
|---|---|---|
| アカウント名 | `accounts.display_name` | 本名推奨、プロフィール管理用 |
| 会議用表示名 | localStorage `display_name` | 会議中に参加者リストへ表示 |
| 自己紹介文 | `accounts.profile_text` + localStorage | AI プロンプト補強用 |

### 修正した同期バグ (調査フェーズ)

1. `app:profile-updated` カスタムイベントが `main.js` で受信されているが、`profile.js persist()` から一切 dispatch されていなかった（デッドコードパス）。
2. `showSetupScreenActive()` がセットアップ画面を再表示する際、`hydrateSetupProfile()` を呼ばなかったため、会議終了後に戻ってもアカウント情報が反映されなかった。
3. `applyParticipantModeFromUrl()` が `storedName || accountName` の順で補完していた（localStorage 優先）。

### アカウント名 / 表示名の分離 (今回の主変更)

**`src/frontend/profile.js`**

- プロフィール画面の入力ラベル・プレースホルダーを `"表示名"` → `"アカウント名 (本名推奨)"` に変更。
- 説明文を「アカウント名と表示名は別管理」の旨に更新。
- `hydrateSetupProfile()` からアカウント名 (`display_name`) のセットアップ画面への書き込みブロックを削除し、`profile_text` のみを同期するよう変更。
- `persist()` 成功後に `app:profile-updated` を dispatch するよう追加（`profile_text` 同期パスの完成）。

**`src/frontend/main.js`**

- `app:profile-updated` ハンドラから `#display-name` への書き込みを削除。`profile_text` のみ処理。
- `applyParticipantModeFromUrl()` のフォールバックからアカウント名を除去。localStorage のみ参照。
- 関連コメントを実態に合わせて更新。
- `showSetupScreenActive()` に `hydrateSetupProfile()` の呼び出しを追加（会議終了後の戻りで `profile_text` が反映されるようになった）。

### 分離後の動作

- **アカウント名**: プロフィール画面からのみ変更可能。会議中の表示名には影響しない。
- **表示名**: セットアップ画面の `#display-name` で自由に変更。ログイン・ログアウト・プロフィール変更があっても上書きされない。
- **`profile_text`**: ログイン時・プロフィール保存時・セットアップ画面表示時に自動同期。

### 確認

- `node --check` で `profile.js` / `main.js` の構文確認。

---

## 41. ユーザーフィードバック改善 F1〜F5 (2026-05-07)

### F1 — 生ログ「一番下へ」FAB を常時表示
- `style.css` の `.jump-fab-wrap` を `position: absolute` → `position: fixed` に変更。
  スクロール位置に関わらずビューポート下部中央に常時表示される。
  親 (`#meeting-screen`) が非表示の場合は子も非表示になるため他画面への誤表示はない。

### F2 — 新ログ追加時の自動スクロール抑制 (sticky bottom)
- `state.js` に `logAtBottom: true` フラグを追加。
- `bindings.js` の `updateFabState` がスクロール距離を監視し `state.logAtBottom` を更新。
- `log-ui.js` / `main.js` の `scrollLogToLatest` でユーザーが上スクロール中 (`logAtBottom === false`) は自動スクロールをスキップ。`force: true`（FAB 押下）は無条件スクロール。

### F3 — プロフィール画面からパスワード変更
- `app.js` に `POST /me/password` エンドポイントを追加。現パスワード検証 → scrypt ハッシュ化 → `updatePasswordHash`。
- `profile.js` の `renderProfileTab()` にパスワード変更セクション（現パスワード・新パスワード×2・変更ボタン）を追加。
- `style.css` に `.profile-section-divider` / `.profile-settings-row` / `.profile-settings-status` スタイルを追加。

### F4 — STT プロバイダーをホストが指定し参加者全員に適用
- `db.js` で `rooms.stt_provider` / `rooms.stt_language` カラムを `ensureColumn` でマイグレーション。
- `room-repo.js` の `create()` に `stt_provider` / `stt_language` を追加。
- `app.js` の `POST /rooms` でホストのサーバー STT 設定をルームに保存。
- `app.js` の `sendReady` で `room_stt_provider` / `room_stt_language` を `ready` メッセージに含める。
- `state.js` に `roomSttProvider` / `roomSttLanguage` フィールドを追加。
- `meeting-ui.js` の `ready` ハンドラで受け取った STT 設定を state と localStorage に反映。

### F5 — 共有 URL から入った参加者に「会議に参加する」ボタン表示
- `bindings.js` の `refreshStartCta()` で文字化けしていたボタンラベル (`莨夊ｭｰ縺ｫ蜿ょ刈`) を `'会議に参加する'` に修正。
- participant-mode のときルーム ID 入力欄を `readOnly = true` にして誤編集を防止。

### 確認
- `node --check` で全変更ファイルの構文確認。
- `npm test -- api-rooms / auth-account / room-repo` — 32 tests 全通過。

---

## 42. チャンク結果の DB 保存と部分再生成 L9 (2026-05-07)

### 概要

長時間会議の Map-Reduce 議事録生成において、チャンク単位の中間結果を DB に保存し、
失敗チャンクだけをピンポイントで再生成できる仕組みを実装した。

### バックエンド

- `src/backend/repo/chunk-repo.js` (新規): `ChunkRepository` クラス。`upsert` / `findByRoom` / `findByIndex` / `deleteByRoom` を実装。UNIQUE(room_id, chunk_index, analysis_type) で upsert。
- `src/backend/repo/db.js`: `room_chunks` テーブルを `.then()` チェーンに追加 (UNIQUE 制約 + インデックス付き)。
- `src/backend/server.js`: `ChunkRepository` をインポートし `repos.chunkRepo` を登録。
- `src/backend/app.js`:
  - `generateSharedAiResult` 内の minutes Map フェーズで各チャンク完了後に `chunkRepo.upsert()` を呼び出し、エラーチャンクは `status: 'error'` で保存。
  - `GET /rooms/:id/chunks` (ホスト限定): チャンク一覧 JSON を返す。
  - `POST /rooms/:id/regenerate-chunk/:index` (ホスト限定 + aiLimiter): 指定インデックスのチャンクを単独再生成し、DB 全チャンクを読み直して `mergeMinutesChunks` で議事録全体を再構築・保存する。

### フロントエンド

- `src/frontend/index.html`: 議事録エディター下部に `#chunk-regenerate-panel` を追加 (初期非表示)。
- `src/frontend/shared-ai.js`: `loadChunks()` / `renderChunkList()` / `regenerateChunk()` を追加。議事録生成完了後と `loadMeetingInsights` のホスト + minutes 存在時にパネルを更新。
- `src/frontend/style.css`: `.chunk-regen-panel` / `.chunk-row` / `.chunk-regen-btn` などのスタイルを追加。

### 確認

- `node --check` で全変更ファイルの構文確認。

---

## 43. モバイル会議中レイアウト圧縮 (2026-05-08)

- モバイル (≤1023px) で会議画面のログ領域が画面の 25% 以下になっていた問題を修正。
- `body.meeting-mode` 時に `flow-progress` を非表示、`app-topbar` を 36px に圧縮。
- `meeting-screen header` を 1 行に収め、タイトル入力を `☰` メニュー内の `#mobile-meeting-title-input` に移動 (PC ヘッダーは従来通り)。
- `conversation-panel` に `min-height: 50dvh` を保証 (iOS Safari のアドレスバー伸縮に追従)。
- `@media (max-width: 560px)` で `meeting-ai-panel` / `memory-panel` の余白・フッターを圧縮。
- `getMeetingTitleInputs()` / `syncMeetingTitleInputs()` で主・モバイル両入力を focus-guard 付きで同期。
- `dom.js` に `mobileMeetingTitleInput` を追加。

---

## 44. ElevenLabs 仮カード即時表示・2秒コミット・FAB/パレット修正 (2026-05-08)

### ElevenLabs provisional card (即時表示)

- `stt-service.js`: `createElevenLabsStream` に `onPartial` コールバックを追加。`partial_transcript` メッセージ受信時に `onPartial(msg.text)` を呼ぶ。`createStream()` の第 4 引数として `onPartial` を受け取り ElevenLabs パスへ伝播。
- `app.js`: `broadcastInterim(text)` 関数を追加。`type: 'transcript_interim'` の WS メッセージを同一ルームの全クライアントへブロードキャスト。`startSTTStream()` 内の `createStream` 第 4 引数として渡す。沈黙コミットタイマーを 4000ms → 2000ms に短縮。
- `state.js`: `provisionalCards: {}` を初期ステートに追加。
- `log-ui.js`: `createProvisionalElement(provisional)` / `showProvisional(msg)` / `clearProvisional(participantId)` を追加。`showProvisional` は既存カードがあれば `.text` の内容だけを差し替え (全再描画なし)、なければ新規作成してタイムラインに追記。`renderConversationList` 末尾で provisional カードを追加表示。`window.AppLogUi` にエクスポート。
- `meeting-ui.js`: WS `onmessage` で `transcript_interim` を受け取ったら `showProvisional(msg)` を呼ぶ。確定 `transcript` を受け取ったら先に `clearProvisional(participant_id)` を呼んでから `upsertUtterance` / `renderAllLogs`。
- `style.css`: `.utterance.provisional` に `opacity: 0.55; border-left: 3px solid accent-soft; font-style: italic` スタイルを追加。

### 「最新へ」FAB 表示修正

- `style.css`: `.jump-latest-fab.is-at-bottom` を `opacity: 0.55` (常時薄表示) から `opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%, 15px)` (完全非表示) に変更。手動スクロールで上に移動したときだけボタンが現れるようになった。

### ジャンプパレット items タッチ不能バグ修正

- 根本原因: `#app` が `backdrop-filter: blur(18px)` を持つため独立したスタッキングコンテキスト (z-index: auto = 0) を形成する。スクリムを `document.body` に追加すると z-index 1000 がルートコンテキストで適用され、`#app` 全体を覆ってパレット items のタップを横取りしていた。
- `main.js` `setupJumpPalette()`: スクリムの挿入先を `document.body` → `document.getElementById('app')` に変更。これで `#app` の同一スタッキングコンテキスト内に入り、wrap (z-index 1000) がスクリム (z-index 999) より上に来る。
- `style.css`: `.jump-palette-scrim { z-index: 999 }` (旧 1000)。wrap と同一コンテキスト内で wrap より常に下。
- `main.js` `openJumpPalette()` / `closeJumpPalette()`: `jumpPaletteState.wrap` に `.palette-open` クラスを付け外しして z-index 1002 を確実に適用 (`:has()` 非対応ブラウザへの fallback)。
- `style.css`: `.jump-fab-wrap.palette-open { z-index: 1002 }` を `:has()` ルールと並列追加。

---

## 31. 振り返りを開発ルールとスキルへ反映 (2026-05-05)
- `README.md` を UTF-8 で書き直し、読む順番・既定設定・開発ルールの入口を整理した。
- `docs/ARCHITECTURE.md` の文字化けしていた重要ルールを修正し、現在の past meeting toggle の位置と closeout ルールを追記した。
- `docs/DEVELOPMENT_RULES.md` を追加し、`Closeout Pass` / `UI Regression Pass` / `Doc Sync Pass` をプロジェクトの共通ルールとして明文化した。
- `docs/skills/closeout-pass/SKILL.md`, `docs/skills/ui-regression-pass/SKILL.md`, `docs/skills/doc-sync-pass/SKILL.md` を追加し、次回以降エージェントにそのまま渡せる形にした。
