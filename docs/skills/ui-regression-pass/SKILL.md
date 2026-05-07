---
name: ui-regression-pass
description: Check PC/mobile, setup/meeting/post-meeting, and scroll/fixed-header/modal/loading regressions after UI changes.
---

# UI Regression Pass

Use this after UI work to make sure layout and interaction changes did not
re-break known fragile areas.

## When to Use

- layout changes
- style changes
- fixed / sticky / overflow changes
- modal changes
- tab changes
- mobile-specific changes

## Coverage Matrix

### Devices

- PC
- mobile

### Screens

- setup
- meeting
- post-meeting

### Checks

- can the user scroll?
- does the fixed header leave the content usable?
- do tabs switch correctly?
- do modals open and close correctly?
- are loading indicators visible?
- can the user type without remote refresh overwriting the editor?

## Watch Closely in This Project

- `#app` height and overflow rules
- `body.*-mode` transitions
- post-meeting tabs: log review / AI / minutes
- mobile collapse menus
- fixed buttons versus page scroll

## Output Format

- areas checked with no problems
- regressions fixed
- anything that still needs manual device confirmation
