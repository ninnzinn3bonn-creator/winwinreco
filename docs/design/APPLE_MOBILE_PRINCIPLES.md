# GIJIRO mobile interface principles

This is a project-owned interpretation of mobile interaction principles relevant to GIJIRO. It is not a reproduction of Apple documentation.

## 1. Put the current conversation first

During a meeting, the current or provisional utterance is the dominant content. Previous utterances become a compact chronological list. Secondary tools open only when requested.

## 2. Preserve spatial predictability

Primary meeting actions stay in a fixed bottom dock on narrow screens. Navigation and dismissal controls keep stable positions. Dynamic text must not resize fixed-format controls.

## 3. Design for a thumb and a glance

- Interactive targets are at least 44 x 44 CSS pixels.
- The primary action is visually and spatially distinct.
- Frequent actions use familiar icons with accessible names and tooltips.
- Destructive actions use explicit labels and confirmation where already required by the product.

## 4. Prefer content over chrome

Pages use flat grouped sections, separators, and restrained surfaces. Shadows are rare. Cards are reserved for repeated records, dialogs, and genuinely bounded tools. Corner radius is 8px or less.

## 5. Use system capabilities

The font stack prefers the operating system UI font without distributing proprietary font files. Insets use `env(safe-area-inset-*)` with fallbacks. Motion respects `prefers-reduced-motion`.

## 6. Make state visible without color alone

Recording, muted, active, selected, loading, error, and success states use text or icons in addition to color. Focus rings remain visible. Status content uses live regions only when announcements are useful.

## 7. Reveal complexity progressively

Setup shows the minimum required identity, room, and microphone decisions first. Fine-grained microphone thresholds remain available as advanced controls. Meeting AI and memory tools use tabs, sheets, or secondary panels.

## 8. Adapt instead of enlarging

- Mobile: one reading column, safe-area dock, optional panels shown on demand.
- Tablet: conversation remains primary; secondary tools can share the viewport.
- Desktop: three operational columns are allowed when enough width exists.

## Accessibility baseline

- WCAG 2.2 AA contrast targets.
- Visible keyboard focus.
- Logical heading order and landmarks.
- Form labels remain visible.
- Touch targets at least 44 x 44 CSS pixels.
- No required gesture without a button alternative.
- Layout remains usable at 200% zoom and narrow widths.
