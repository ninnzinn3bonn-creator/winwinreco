---
name: doc-sync-pass
description: Sync README, PROGRESS, and ARCHITECTURE with the current implementation and remove broken text or contradictions.
---

# Doc Sync Pass

Use this after behavior, defaults, or architecture changes to keep project
documentation trustworthy.

## When to Use

- behavior changes
- default provider/model changes
- setup-flow changes
- architecture boundary changes
- new operational rules
- major wording or navigation changes

## Document Roles

- `README.md`
  - first-touch guide
  - setup, defaults, and reading order
- `PROGRESS.md`
  - chronological fact log
  - what changed and how it was verified
- `docs/ARCHITECTURE.md`
  - current source of truth for design rules
  - module boundaries, important behaviors, and technical debt

## What to Do

1. Find drift between implementation and docs.
2. Fix mojibake and broken headings.
3. Remove stale explanations and stale flows.
4. Add new defaults, new boundaries, and new rules.
5. Remove contradictions across docs.

## Watch Closely in This Project

- fixed AI provider and fixed STT provider
- setup screen options
- post-meeting tab structure
- host-only generation rules
- profile and past-meeting context usage

## Finish Condition

After the update:

- README should be readable for a newcomer
- PROGRESS should still read chronologically
- ARCHITECTURE should match the code
