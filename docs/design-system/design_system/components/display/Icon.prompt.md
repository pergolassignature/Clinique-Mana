Lucide icon drawn in currentColor; use for every glyph in the UI (never emoji, never hand-drawn SVG).
```jsx
<Icon name="users" size={16} />
<Icon name="calendar-days" size={20} style={{ color: 'var(--text-muted)' }} />
```
Load `<script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>` before the bundle so icons render as inline SVG (falls back to a CDN mask otherwise). Sizes: 14 inline with xs text, 16 in buttons/nav/inputs (default), 20 in stat cards and sidebar. Names: any lucide icon in kebab-case.
