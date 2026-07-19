# GIJIRO design system

Status: implementation baseline for the mobile refresh

## Visual direction

The approved 390 x 844 reference is `selected-mobile-direction.png`. It defines a bright neutral canvas, teal GIJIRO accent, large live-transcript focus, compact chronological history, a three-way view selector, and a safe-area meeting dock.

## Tokens

### Color

| Role | Token | Light value |
| --- | --- | --- |
| Page | `--g-bg` | `#f5f5f7` |
| Surface | `--g-surface` | `#ffffff` |
| Subtle surface | `--g-surface-subtle` | `#f2f2f7` |
| Primary text | `--g-text` | `#1d1d1f` |
| Secondary text | `--g-text-secondary` | `#6e6e73` |
| Separator | `--g-separator` | `#d2d2d7` |
| Accent | `--g-accent` | `#148f86` |
| Accent pressed | `--g-accent-pressed` | `#0d6f68` |
| Destructive | `--g-danger` | `#d92d3a` |
| Warning/star | `--g-warning` | `#a86500` |

Dark values are defined alongside the light tokens and preserve semantic roles rather than inverting colors.

### Type

- Stack: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, Japanese system sans-serif fallbacks.
- Body: 16px / 1.55.
- Compact metadata: 12–13px / 1.4.
- Section title: 20px / 1.3.
- Screen title: 28px / 1.2. No viewport-based font scaling.

### Geometry

- Spacing unit: 4px; common gaps 8, 12, 16, 24, 32px.
- Radius: 4px for compact controls, 8px for grouped sections and dialogs.
- Target size: minimum 44 x 44px.
- Content measure: 720px for reading/form screens; operational desktop screens may be wider.

## Components

### Top bar

Compact product identity and account state. It remains sticky where page navigation benefits from persistence. It is not a marketing hero.

### Grouped section

One surface with internal row separators. Use for forms, settings, legal content, and administrative records. Do not nest cards.

### Buttons

- Primary: filled accent, one dominant command per region.
- Secondary: neutral filled or bordered control.
- Destructive: red only for irreversible or meeting-ending commands.
- Icon: 44px square, Lucide asset, accessible name, tooltip.

### Segmented control

Used for mutually exclusive views such as Live, Important, and AI. The selected segment uses a surface plus border; the group itself uses the subtle surface.

### Meeting dock

Fixed only on narrow screens. Uses safe-area bottom padding and a stable 72px control row. The microphone remains central; end meeting remains explicitly labeled.

### Transcript row

Edge-to-edge within the conversation surface. Speaker, timestamp, transcript, source, star, memo, and edit actions remain available. The latest provisional utterance also updates the live focus region.

## Screen contracts

| Screen | Primary task | Mobile behavior |
| --- | --- | --- |
| Welcome/auth | Choose create, join, or sign in | One column; form replaces actions in place |
| Setup | Confirm identity, room, microphone | Required fields first; sticky CTA; advanced tuning collapsible |
| Meeting | Follow and capture conversation | Live focus, transcript list, segmented tools, fixed dock |
| Summary | Review and produce outputs | Segmented tabs, reading-first content, actions remain reachable |
| Admin | Approve and inspect users | Tables become labeled stacked rows |
| Progress | Scan project status | Dense list and metrics reflow without horizontal overflow |
| Verify/reset | Resolve one account task | Centered single-task form, no decorative hero |
| Terms/privacy | Read policy | Narrow reading measure, sticky compact header |

## Implementation layers

1. `style.css`: legacy behavior and compatibility.
2. `styles/apple-tokens.css`: owned semantic tokens and base accessibility rules.
3. `styles/apple-components.css`: shared controls, grouped sections, icons, top bars, and mobile tables.
4. `styles/apple-screens.css`: screen-specific responsive layouts.

New UI work should use the `--g-*` tokens. Legacy tokens are remapped in the token layer so existing behavior can migrate incrementally without a visual split.
