# Clinique MANA — Brand Tokens

> **Status:** the sage/honey/Inter tokens at the bottom of this page are **legacy**. Since Phase 2 (Task 2.2) the app follows the website identity described in [business context §6](business-context.md#6-brand--tone): Raleway, charcoal text, wine for primary actions, mint/teal for calm surfaces and states. Principle unchanged: calm, human, low contrast — while text still meets WCAG AA.

## Current tokens

Defined as RGB channels on `:root` in `src/styles/globals.css` and mapped in `tailwind.config.js` (`rgb(var(--x) / <alpha-value>)`, so `bg-primary/10` works).

| Variable | Value | Use |
|---|---|---|
| `--wine` | `#9B1B3C` | primary actions, focus ring |
| `--wine-dark` | `#821633` | primary hover |
| `--charcoal` | `#4D4D4F` | text |
| `--charcoal-soft` | `#6B6B6E` | secondary text |
| `--teal-dark` | `#1B7A73` | teal text on white (AA) |
| `--mint` | `#E2F1EB` | calm, success and selected surfaces |
| `--offwhite` | `#F8F8F9` | page background |
| `--muted-bg` | `#EFEFF2` | neutral fills and hovers |
| `--line` | `#E5E5E8` | dividers, card outlines (decorative) |
| `--input` | `#8F8F95` | form-control borders (3.22:1 on white, 3.03:1 on off-white) |
| `--danger` | `#B42318` | destructive actions, errors |

`--teal` (`#249D95`) is also defined but deliberately not mapped: it is 3.3:1 on white, so never text; keep it for future decorative accents.

Use the semantic Tailwind names, never the raw variables:

| Tailwind name | Maps to |
|---|---|
| `background` | offwhite |
| `foreground` | charcoal |
| `border` | line |
| `input` | input |
| `card` / `card-foreground` | white / charcoal |
| `primary` / `primary-hover` / `primary-foreground` | wine / wine-dark / white |
| `muted` / `muted-hover` / `muted-foreground` | muted-bg / line / charcoal-soft |
| `accent` / `accent-foreground` | mint / charcoal |
| `success` | teal-dark |
| `destructive` / `destructive-foreground` | danger / white |
| `ring` | wine |

Rules:
- Text on mint stays charcoal (`accent-foreground`): teal-dark on mint is 4.4:1, under AA.
- Floating surfaces (cards, dialogs, menus, popovers) and inputs are `bg-card` (white) on the off-white page.
- Form controls (input, textarea, select, checkbox, switch off-track) use `border-input` / `bg-input`: WCAG 1.4.11 asks 3:1 for the parts that identify a control. `border` stays for decorative lines.
- Destructive buttons are the soft variant (red text and border on a 10 % red tint) so they differ from the solid wine primary by fill, not only by hue; they always carry an explicit verb (« Supprimer », « Désactiver »).
- Focus: `focus-visible:ring-2 focus-visible:ring-ring` at full strength (8.0:1 on white, 7.6:1 on off-white), with `ring-offset-2` where the control itself is wine (button, checkbox). No `ring-offset-background`: it draws an off-white halo on white surfaces. Text fields keep their wine border as the cue, plus a soft `ring-ring/30` halo. The `.focus-ring` utility applies the full ring.
- Hover: neutral hovers use `bg-muted` (ghost/outline buttons, nav items, menu items). Mint (`accent`) is for calm, success and selected surfaces, not generic hover. A control already filled with `bg-muted` (secondary button) hovers one step darker, `bg-muted-hover`.
- Highlighted menu and command items: `bg-muted` plus an inset 2px wine bar on the left (7.0:1 on muted), so the highlight does not rely on a faint fill.
- Shadows: the custom scale only (`shadow-soft` cards, `shadow-medium` menus/popovers, `shadow-large` dialogs/sheets; toasts keep sonner's own shadow).
- Toasts (`sonner.tsx`): styled through sonner's CSS variables, no class overrides. Every toast is a white card with a line border and Raleway; default text charcoal, success text and icon dark teal (5.2:1), error text and icon danger (6.6:1). Keyboard focus on a toast, its close or action button shows the wine ring (rule in `globals.css`).
- Search fields inside menus (`CommandInput`): the bottom border turns wine on focus.
- Font: Raleway Variable, self-hosted through `@fontsource-variable/raleway` (no Google request, Loi 25). Figures are lining everywhere (`body`); use `.tabular` for tables, amounts and inputs.

## Legacy (before Phase 2, kept for history)

Principles:
Calm, human, premium. Avoid harsh contrast.

Tokens (names only; values may evolve):
- --bg: warm off-white / cream
- --surface: white
- --text: soft charcoal
- --muted: warm gray
- --border: light gray
- --accent-primary: sage/mint
- --accent-secondary: muted warm yellow (sparingly)
- --accent-tertiary: muted burgundy/wine (very sparingly)

Usage:
- Primary actions: accent-primary
- Active navigation: accent-primary
- Callouts: accent-secondary (rare)
- Badges: accent-tertiary (rare)
