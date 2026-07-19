# Source and license policy

Reviewed: 2026-07-19

## Approved references

The implementation uses the following public documents as design guidance only. Their wording, downloadable UI kits, fonts, symbols, and other assets are not copied into GIJIRO.

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Apple Fonts](https://developer.apple.com/fonts/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [MDN: CSS environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/env)

## Allowed implementation inputs

- Project-owned CSS, HTML, JavaScript, and documentation.
- Existing GIJIRO microphone mark and product name.
- Lucide Static 1.25.0 icons under the ISC license. A verbatim license copy is stored at `src/frontend/vendor/lucide/LICENSE`.
- System fonts already available on the user's device.

## Excluded inputs

- Apple UI kits, templates, downloadable design files, SF Symbols, and SF Pro font files.
- Apple logos, product screenshots, proprietary visual assets, and copied HIG prose.
- Third-party HIG scrapers or MCP packages that proxy undocumented content or transmit project prompts to an unapproved service.

## Dependency controls

- `lucide-static` is version-pinned to `1.25.0` as a development dependency.
- Only reviewed SVG files are vendored under `src/frontend/assets/icons`.
- Vendored icons must keep the license file and should be refreshed only through a reviewed dependency update.
- No runtime CDN or third-party design service is required.

## Product identity

GIJIRO is not represented as an Apple product. “HIG-aligned” means the interface applies broadly useful principles such as clear hierarchy, direct manipulation, safe-area handling, legible type, and predictable navigation.
