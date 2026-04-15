# Architecture Notes

## Frontend modes

- `setup-mode`: room creation / join and microphone checks
- `meeting-mode`: live transcription and in-meeting controls
- `summary-mode`: post-meeting review, shared AI, and minutes

## Frontend module split

The frontend is now split into a small set of browser globals:

- `src/frontend/state.js`
  - owns the shared mutable app state
- `src/frontend/dom.js`
  - caches frequently used DOM nodes
- `src/frontend/bindings.js`
  - wires button/input events to handlers provided by `main.js`
- `src/frontend/utils.js`
  - pure helpers for IDs, URLs, audio constraints, resampling, formatting, and downloads
- `src/frontend/main.js`
  - orchestrates UI flow, audio capture, log rendering, and AI interactions

This is intentionally a first-stage split. It keeps the current non-bundled browser setup while making future extraction safer.

## Shared AI flow

1. Live transcript is stored as utterances.
2. After the meeting, the host generates shared outputs:
   - minutes
   - summary
   - todo
3. Shared outputs are persisted on the `rooms` table.
4. All participants fetch shared outputs from `GET /rooms/:id/insights`.
5. Custom AI uses the saved minutes as its only context.

## Security model

- Each participant receives a random `control_token` when joining a room.
- Privileged routes require `participant_id + control_token`.
- Host-only routes also validate that the authenticated participant belongs to the room owner.

Routes currently protected this way:

- `POST /rooms/:id/shared-ai/:type`
- `POST /rooms/:id/custom-ai`
- `POST /rooms/:id/end`

## Current technical debt

- `src/frontend/main.js` is still too large, even after the first split.
- Some UI rendering and modal logic are still coupled to application state and should become dedicated modules.
- Read-only review routes (`/rooms/:id/logs`, `/rooms/:id/insights`) are room-id based and do not yet require participant authentication.

## Recommended next refactor

1. Split `main.js` into:
   - `audio.js`
   - `log-ui.js`
   - `meeting-ui.js`
   - `summary-ui.js`
   - `shared-ai.js`
2. Move modal and log-card rendering behind one UI module boundary.
3. Add route-level auth middleware for read-only room resources if stronger access control becomes necessary.
