# Development Rules

This project treats cleanup and closure as part of implementation, not as an
optional follow-up step.

## Core Principles

- Keep each change focused on one or two major axes whenever possible.
- If UI and AI/STT both move in the same change, increase regression coverage.
- Treat mojibake and broken text as real bugs.
- Remove stale UI, stale branches, and stale wording unless there is a clear reason to keep them.

## Three Required Passes

### 1. Closeout Pass

Use after:

- any feature work
- any bugfix

Must include:

- mojibake check in touched files
- syntax checks
- representative or full test runs
- review for dead code, duplicate branches, and stale UI remnants
- README / PROGRESS / ARCHITECTURE update decision
- at least one new regression-prevention rule if the work exposed a repeat failure mode

### 2. UI Regression Pass

Use after:

- layout changes
- modal changes
- accordion/collapse changes
- scroll changes
- sticky/fixed header changes
- mobile-specific changes

Must include:

- PC and mobile
- setup, meeting, and post-meeting screens
- scrollability
- header/body layout interaction
- tab switching
- modal open/close behavior
- loading visibility
- protection against editor overwrites while typing

### 3. Doc Sync Pass

Use after:

- behavior changes
- default changes
- new operational rules
- architecture responsibility changes

Must include:

- `README.md` still works for a first-time reader
- `PROGRESS.md` still reads as chronological fact log
- `docs/ARCHITECTURE.md` still matches the current implementation
- no contradictions across docs
- no mojibake or broken headings

## High-Risk Regression Areas

Treat these as high-risk areas in this project:

- broken scrolling
- fixed header vs content scroll conflicts
- post-meeting AI result visibility
- editor overwrites while typing
- mobile microphone permission and resume flow
- room create / join / end transitions

## Definition of Done

Work is complete only when all of the following are true:

1. the implementation is in place
2. verification or tests have been run
3. cleanup and dead-code review are complete
4. documentation is synced
5. remaining risks are clearly stated
