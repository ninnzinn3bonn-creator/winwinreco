---
name: closeout-pass
description: Finish implementation work by checking regressions, cleaning stale code, syncing docs, and extracting prevention rules.
---

# Closeout Pass

Use this after feature work or bugfixes to properly close the work instead of
stopping at "it compiles".

## When to Use

- after feature work
- after bugfixes
- after AI, STT, UI, auth, or setup-flow changes

## What to Do

1. Review the changed surface area.
2. Look for mojibake, duplicate logic, dead code, and stale branches.
3. Run syntax checks for touched files.
4. Run representative tests or the full suite.
5. Decide whether README, PROGRESS, or ARCHITECTURE need updates.
6. Extract at least one regression-prevention rule from the work.
7. Summarize:
   - what was added
   - what was removed or cleaned up
   - what risks remain

## Watch Closely in This Project

- scroll regressions
- AI editor overwrite regressions
- mobile microphone resume regressions
- broken post-meeting AI generation flow
