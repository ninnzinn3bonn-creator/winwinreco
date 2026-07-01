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
- STT: ElevenLabs Scribe (fixed)
- AI: Groq `openai/gpt-oss-120b` (fixed)

## Setup

### Windows PowerShell encoding

Windows PowerShell 5.1 can display or write UTF-8 files incorrectly unless the
session is pinned to UTF-8. Run this once at the start of a PowerShell session:

```powershell
. .\scripts\Set-Utf8PowerShell.ps1
```

PowerShell 7 is preferred for day-to-day work because it defaults to UTF-8:

```powershell
.\scripts\Install-PowerShell7.ps1 -WhatIfOnly
.\scripts\Install-PowerShell7.ps1
```

Avoid bare `>` redirection in Windows PowerShell 5.1; use `Set-Content` or
`Out-File` after loading `Set-Utf8PowerShell.ps1`.

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
STT_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_STT_REALTIME_MODEL=scribe_v2_realtime

# Optional
# Gemini/Google STT code paths are retained for tests or emergency fallback only.
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

- fixed AI provider: Groq `openai/gpt-oss-120b`
- fixed STT provider: ElevenLabs Scribe `scribe_v2` / realtime `scribe_v2_realtime`
- provider selectors are displayed as read-only; stale localStorage or API `ai_config` values are normalized server-side

## Development Rules

- run `npm run check:encoding` before finishing changes that touch text files
- run `Closeout Pass` after feature work or bugfixes
- run `UI Regression Pass` after UI, mobile, scroll, or layout changes
- run `Doc Sync Pass` after behavior, setup, defaults, or architecture changes
- add intent-focused comments to production code so future AI agents can understand decisions, invariants, and provider contracts

See [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) for details.
