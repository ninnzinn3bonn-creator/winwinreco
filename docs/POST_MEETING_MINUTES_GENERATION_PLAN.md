# 会議終了後の議事録生成ロジック監査・改善計画

作成日: 2026-06-30

## 確定事項

- 会議中ストリーミング議事録生成は実装しない。
- 表面上の AI provider は Groq `openai/gpt-oss-120b` 固定。
- Groq の長文・rate limit などに対する Gemini fallback は仕様として維持する。
- 議事録は当該会議だけから作る。過去会議コンテキストは要約 / ToDo / カスタム解析では使えるが、議事録生成には混ぜない。
- STT は ElevenLabs Scribe 固定なので、議事録 prompt は高精度 STT 前提の「内容改変を抑える」方針を維持する。

## 現行フロー監査

| 段階 | 実装箇所 | 現行動作 | 監査メモ |
|---|---|---|---|
| UI 起点 | `src/frontend/shared-ai.js` `runMinutesGeneration()` | ホストが `/rooms/:id/shared-ai/minutes` に POST。生成中は `state.minutesWorkspace.loading` を true にし、chunk 進捗を表示する。 | editor dirty / focus ガードは render 側にある。生成完了直後に直接 textarea へ代入し、その後 `loadMeetingInsights()` と `loadChunks()` を呼ぶ。 |
| API 起点 | `src/backend/app.js` `POST /rooms/:id/shared-ai/:type` | `type='minutes'` で `generateSharedAiResult()` を呼ぶ。 | `requireHost` と AI limiter を通るため、権限と過剰実行は一応守られている。 |
| 入力収集 | `generateSharedAiResult(roomId, 'minutes')` | room、utterances、participants、userContexts を取得。 | 議事録では `pastContextBlock` を削除し、`minutesUserContexts = []` にするため、過去会議・ユーザー文脈の混入は抑止されている。 |
| 分岐 | `shouldChunk(utterances)` | 推定 8000 token 超または 25 分超でチャンク化。 | token 見積もりは文字数ベース。安全側だが、話題境界は見ない。 |
| チャンク分割 | `src/backend/services/chunking.js` `chunkUtterances()` | 10 分窓、最大 6000 token、30 秒 overlap。 | 長時間会議の TPM 回避として実用的。話題戻り、短文連発、話者交代は時間・token だけでは最適化できない。 |
| チャンク生成 | `AIService.generateMinutesPerChunk()` | 前チャンク末尾を context として渡し、対象 chunk だけを議事録化。 | context は参照用で出力対象外と prompt に書いている。overlap 重複を完全に防ぐ保証はない。 |
| 並列・再試行 | `createSemaphore(2)` + `withTimeoutAndRetry()` | 並列度 2、60 秒 timeout、最大 3 retry。失敗時は placeholder を返す。 | 失敗しても全体生成は完了扱いにできる。一方で placeholder が最終議事録に混ざるため、UI 側で partial failure を明示したい。 |
| 永続化 | `chunkRepo.upsert()` / `roomRepo.updateInsights()` | 各 chunk を `done` または `error` で保存し、merge 結果を room の `minutes_text` に保存。 | chunk 単位再生成の土台はある。room 側に「一部失敗あり」の明示状態はない。 |
| merge | `AIService.mergeMinutesChunks()` | chunk 結果を index 順に trim し、隣接 chunk 境界の同一行だけを除去して空行 2 つで連結。 | deterministic で安定。semantic merge はしないため、内容改変リスクを増やさない。 |
| 短時間生成 | `AIService.generateMinutesFromTranscript()` | チャンクなしで全文 prompt を投げる。ElevenLabs Scribe の場合は reconstruct を省略。 | 高精度 STT 前提として妥当。短時間会議でも prompt 品質テストは必要。 |
| 表示 | `shared-ai.js` `renderMinutesWorkspace()` / `loadChunks()` | 生成結果を editor に表示し、chunk があれば再生成パネルを出す。失敗 chunk がある場合は警告帯を表示する。 | 本文を保持したまま、部分失敗と復旧導線を別 UI で明示する。 |

## リスクと改善余地

1. **部分失敗が最終議事録に自然に混ざる**
   - placeholder は可用性を高めるが、最終議事録本文に混ざるとユーザーが見落としやすい。
   - chunkRepo には `status='error'` が残るため、UI と response に partial failure を明示できる。

2. **merge が単純連結**
   - 安定性は高いが、30 秒 overlap や話題の戻りで重複が残る可能性がある。
   - LLM merge を入れると品質は上がるが、コスト・失敗点・内容改変リスクが増える。
   - まずは deterministic な overlap 重複検出、または prompt 側の境界指示強化を優先する。

3. **chunk 境界が時間と token だけ**
   - 10 分窓は扱いやすいが、議題の途中で切れることがある。
   - いきなり semantic splitter を入れるより、発話間隔、話者交代、短文連発の簡易ヒューリスティックを検証するのが安全。

4. **回帰 fixture が不足**
   - `tests/chunking.test.js` は分割ロジックを広く見ているが、終了後生成の API 全体として partial failure / fallback / 表示まで固定する fixture が足りない。
   - 実 API を叩かず、fake AIService で deterministic に検証する必要がある。

5. **provider fallback の観測性**
   - Gemini fallback は仕様として残すが、ユーザー表示は Groq 固定のままにする。
   - 内部ログ・metrics では fallback 発生が分かる必要がある。既存 `recordApiCall` の provider/status 記録を確認対象にする。

## 次の実装単位

### M1-A: 終了後議事録生成の回帰 harness

Status: implemented on 2026-06-30. Covered by `tests/api-insights.test.js` and `tests/fixtures/minutes/scenarios.json`.

目的: 現行挙動を壊さずに改善できる土台を作る。

実装内容:

- `tests/fixtures/minutes/` に短時間会議、90 分級会議、話題戻り、専門用語多め、発話欠損、AI 一部失敗の fixture を追加する。
- `tests/api-insights.test.js` に fake AIService を使った `shared-ai/minutes` の API レベルテストを追加する。
- 以下を固定する:
  - 議事録生成に past meeting context が混ざらない。
  - ElevenLabs Scribe の `stt_provider` が prompt rule に渡る。
  - chunk 数と `chunk_progress` の完了数が一致する。
  - chunk 失敗時に `chunkRepo` に `status='error'` が残る。

完了条件:

- 外部 AI API に依存しない自動テストで、終了後議事録生成の主要分岐を再現できる。

### M1-B: 部分失敗の可視化と復旧導線

Status: implemented on 2026-06-30. Covered by `tests/api-insights.test.js`, `src/frontend/shared-ai.js`, and `src/frontend/index.html`.

目的: 一部 chunk 失敗時に、ユーザーが本文だけを見て完了と誤認しないようにする。

実装内容:

- `generateSharedAiResult()` の返却値に `chunk_total`, `chunk_failed`, `chunk_status` のようなメタ情報を含める。
- frontend の議事録 workspace に「一部チャンクの生成に失敗しました。該当チャンクを再生成してください。」を表示する。
- 失敗 chunk がある場合、chunk 再生成パネルを自動表示する。
- room 全体の `minutes_text` は従来どおり保存し、ユーザーの作業を止めない。

完了条件:

- 失敗 chunk が 1 件ある fixture で、本文表示、警告表示、chunk 再生成導線が確認できる。

### M1-C: chunk 境界と merge 品質の小改善

Status: implemented on 2026-06-30 for the confirmed low-risk scope. Covered by `tests/chunking.test.js` and `tests/ai-elevenlabs-prompt.test.js`.

目的: LLM merge を増やさず、終了後生成の品質を上げる。

実装内容:

- chunk prompt に「前 chunk context と重複する発話は出力しない」指示をより明確に追加する。
- `mergeMinutesChunks()` に deterministic な簡易重複除去を入れるか検証する。例: 連続 chunk の先頭・末尾で同一話者 + 同一文に近い行を削る。
- `chunkUtterances()` の境界候補変更は未確定の品質チューニングなので今回は変更しない。必要な場合は、長い無音間隔 / 話者交代 / 議題区切りのどれを優先するかを確認してから別タスク化する。

完了条件:

- 既存 `tests/chunking.test.js` を壊さず、話題戻り / overlap あり fixture の重複が減る。
- 内容改変リスクがある LLM merge は採用しない、または明示 opt-in として扱う。

## 実装しない範囲

- 会議中ストリーミング議事録生成。
- 生成済み議事録を過去会議コンテキストで補完すること。
- provider をユーザーが選択できる UI の復活。
- Gemini を表面上の選択肢として表示すること。
- LLM による全面 merge を無条件で追加すること。

## 現在の状態

M1-A / M1-B / M1-C の確定済み範囲は実装済み。追加で chunk 境界 heuristic を変える場合は、会議の自然な切れ目を何で判定するかが品質仕様になるため、事前確認してから新規タスク化する。
