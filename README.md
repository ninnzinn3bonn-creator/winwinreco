# Meeting Minutes App (MVP)

対面会議において「誰が・いつ・何を話したか」を自動でログ化する、シンプルかつ強力な議事録作成支援アプリです。

## 主な機能
- **リアルタイム文字起こし**: Google Cloud Speech-to-Text API を活用した高精度な認識。
- **マルチデバイス対応**: 最大5名まで、各参加者のブラウザから音声を送信可能。
- **過去ログ同期**: 途中参加者も過去の発言を即座に確認できます。
- **議事録ダウンロード**: 会議終了後、Markdown形式で全発言ログを保存可能。
- **話者色分け**: 参加者ごとに視覚的にわかりやすくタイムラインを表示。

## 技術スタック
- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript + CSS (Vanilla)
- **Database**: SQLite3
- **Communication**: WebSocket (ws)
- **External API**: Google Cloud Speech-to-Text API

## 実行方法

### 1. 環境構築
```bash
npm install
```

### 2. 環境変数の設定
`.env` ファイルを作成し、Google Cloud APIキー等の必要な情報を設定してください。
```env
PORT=3000
DB_PATH=./db/meeting.db
GOOGLE_API_KEY=your_google_api_key_here
```

### 3. サーバー起動
```bash
npm start
```
ブラウザで `http://localhost:3000` にアクセスしてください。

## 開発状況
MVPフェーズが完了し、現在「AIサポート機能（要約・アジェンダ生成）」の追加を計画中です。
