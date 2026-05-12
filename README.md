# GIJIRO

[![CI](https://github.com/ninnzinn3bonn-creator/winwinreco/actions/workflows/ci.yml/badge.svg)](https://github.com/ninnzinn3bonn-creator/winwinreco/actions/workflows/ci.yml)

GIJIRO is a web app for real-time meeting transcription, post-meeting review,
minutes generation, summaries, and action items.

Hosts and participants join the same room from their browsers and accumulate
meeting logs in real time.

## Read These First

If you are new to this project, read these files in this order:

1. [docs/TASKS.md](docs/TASKS.md)
   - open work, backlog items, and priorities
2. [PROGRESS.md](PROGRESS.md)
   - chronological implementation log and verification notes
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
   - current design rules, responsibility boundaries, and technical debt
4. [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md)
   - closeout, regression, and documentation sync rules

When UI, scroll behavior, or mobile layouts change, also review
[docs/MANUAL_TESTS.md](docs/MANUAL_TESTS.md).

## Main Features

- real-time transcription
- post-meeting log review
- auto-generated minutes
- summaries and todo generation
- shared room URLs
- microphone checks and sensitivity tuning
- profile context for better AI output

## Stack

- Backend: Node.js + Express
- Frontend: Vanilla JavaScript + CSS
- Database: SQLite3 (local dev / CI) または Firestore (Cloud Run 本番)。`DB_DRIVER` env で切替
- Communication: WebSocket
- STT: Groq Whisper or Google Speech-to-Text
- AI: Groq or Gemini

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment Variables

Create `.env`:

```env
PORT=3000
DB_PATH=./db/meeting.db

# AI
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here

# STT
STT_PROVIDER=groq
GROQ_STT_MODEL=whisper-large-v3-turbo

# Optional
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=your_google_speech_api_key_here
```

### 3. Start

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

### Firestore モードでローカル開発する

1. 別ターミナルで Firestore Emulator を起動:
   ```bash
   npm run emulators
   ```
2. `.env` に以下を追加 (または `.env.local` に):
   ```env
   DB_DRIVER=firestore
   FIRESTORE_EMULATOR_HOST=localhost:8080
   GOOGLE_CLOUD_PROJECT=demo-test
   ```
3. `npm start`

Firestore モードのテストを単体で実行する場合:
```bash
# Emulator 起動中に
npm run test:firestore
```

両モードを一括テスト:
```bash
npm run test:all
```

## Default Providers

- default AI provider: Groq
- default STT provider: Groq Whisper
- Gemini and Google Speech-to-Text remain selectable when needed

## Development Rules

- run `Closeout Pass` after feature work or bugfixes
- run `UI Regression Pass` after UI, mobile, scroll, or layout changes
- run `Doc Sync Pass` after behavior, setup, defaults, or architecture changes

See [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) for details.
