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
| `--teal` | `#249D95` | accents, success icons |
| `--teal-dark` | `#1B7A73` | teal text on white (AA) |
| `--mint` | `#E2F1EB` | calm surfaces, hover |
| `--offwhite` | `#F8F8F9` | page background |
| `--line` | `#E5E5E8` | borders |
| `--danger` | `#B42318` | destructive actions, errors |

Use the semantic Tailwind names, never the raw variables:

| Tailwind name | Maps to |
|---|---|
| `background` | offwhite |
| `foreground` (`secondary`, `muted`) | charcoal (charcoal-soft) |
| `border` | line |
| `card` / `card-foreground` | white / charcoal |
| `primary` / `primary-hover` / `primary-foreground` | wine / wine-dark / white |
| `muted` / `muted-foreground` | offwhite / charcoal-soft |
| `accent` / `accent-foreground` | mint / charcoal |
| `success` | teal-dark |
| `destructive` / `destructive-foreground` | danger / white |
| `ring` | wine |

Rules:
- Text on mint stays charcoal (`accent-foreground`): teal-dark on mint is 4.4:1, under AA.
- Floating surfaces (cards, dialogs, menus, popovers) and inputs are `bg-card` (white) on the off-white page.
- Focus: `ring-primary/30` (or the `.focus-ring` utility).
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
