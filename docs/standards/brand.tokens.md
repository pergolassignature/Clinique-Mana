# Clinique MANA — Design system → Tailwind

The visual reference is the **Clinique MANA design system** in [`docs/design-system/`](../design-system/README.md) (decisions #29–30). Its values are final; this page only says where they live in the code and which Tailwind names to use.

## Where the values live

- `src/styles/globals.css`: every token from `design_system/tokens/*.css`, as CSS variables with the design system's names (`--primary`, `--text-secondary`, `--radius-lg`, `--shadow-medium`…). Colours are RGB channels (`--border: 228 228 231`) so opacity modifiers work (`bg-ink/5`).
- `tailwind.config.js`: maps the variables to the shadcn semantic names below. Never use a raw variable or a hex value in a component.
- `src/shared/lib/utils.ts`: tailwind-merge learns the custom keys (shadows `soft`/`medium`/`large`/`focus`/`focus-inset`, font size `2xs`). **A new shadow or font-size key must be registered there, with a test.**
- Font: Inter Variable, self-hosted through `@fontsource-variable/inter` (imported first in `src/main.tsx`). No request to Google (Loi 25); `dist/` must never mention `googleapis` or `gstatic`.

## Colours

| Tailwind | Design system | Value | Use |
|---|---|---|---|
| `background` | `--bg` | #FFFFFF | page |
| `foreground` | `--text-body` | #1F1F20 | text |
| `muted-foreground` | `--text-secondary` | #6B6B6E | **all** informative secondary text (captions, hints, descriptions, table headers) |
| `subtle` | `--text-muted` | #8E8E92 | placeholders, disabled text, separators, icons only (3.3:1); also the switch's off track |
| `link` | `--text-link` | #1A6B66 | text links |
| `border` / `border-light` / `border-strong` | `--border*` | #E4E4E7 / #EFEFF1 / #CFCFD4 | hairlines; strong = control hover |
| `input` / `input-hover` | `--border` / `--border-strong` | | form-control borders (own token, hairline as designed) |
| `card` / `card-hover` | `--surface-card` / `--surface-panel-hover` | #FFFFFF / #FAFAFA | cards; row and interactive-card hover |
| `muted` / `muted-strong` | `--bg-secondary` / `--bg-tertiary` | #F4F4F5 / #E9E9EB | disabled fill, ghost/menu hover; secondary hover, selected command item |
| `sidebar` | `--surface-sidebar` | #F7F7F8 | app sidebar |
| `overlay` | `--surface-overlay` | ink 32 % | dialog and sheet backdrop (no blur) |
| `primary` (+ `hover`, `active`, `foreground`) | `--primary*` | teal #1E837C / #1A6B66 / #175551 | the single coloured action per screen, checked controls |
| `primary-soft` / `primary-soft-foreground` | `--primary-soft*` | #EEF8F7 / #175551 | selected row |
| `ink` (+ `hover`, `foreground`) | `--ink*` | #1F1F20 | ink button, active tab underline, tooltip, toast |
| `destructive` (+ `hover`, `foreground`) | `--danger*` | #B3261E | errors; destructive button only inside a confirmation |
| `success` / `warning` / `info` / `neutral` | status tokens | #249D95 / #E0B400 / #46ACA5 / #A8A8AD | status dots and icons only, never text or fills. The « info » status dot (`StatusDot`, Badge `info`) is drawn in teal-500 (#249D95, `bg-success`) as the handoff specifies, not in `--info` |
| `ring` | `--focus-ring` | #1E837C | focus |
| `gray-50` … `gray-900` | `--gray-*` | | the neutral scale, for the rare exact value (outline hover `gray-50`, avatar text `gray-700`) |

Wine (`--wine-*`) is the logo colour only: it is defined but not mapped. Brand scales (teal, mint, pink, yellow) are defined for exact values (toast icons) and not mapped.

## Type, radii, shadows, motion

- Font sizes (size/line height): `text-2xs` 11/16 (overlines: `uppercase tracking-wide font-medium`), `text-xs` 12/16 captions, `text-sm` 13/18 body and labels (the `body` default), `text-base` 14/20 card titles, `text-lg` 16/24 section titles, `text-xl` 20/28 page titles (`tracking-tight`), `text-2xl` 24/32, `text-3xl` 30/36. Weights 400/500/600.
- `tracking-tight` −0.01em, `tracking-wide` +0.06em (the design system's values replace Tailwind's).
- Body: `font-feature-settings: "cv02","cv03","cv04","cv11","ss01"`, antialiased. Figures: `.tabular` (tables, amounts, inputs).
- Radii: `rounded-sm` 3 (badge, tooltip, checkbox) · `rounded-md` 4 (buttons, fields, nav links) · `rounded-lg` 6 (cards, menus, alerts, toasts) · `rounded-2xl` 8 (dialogs) · `rounded-full` (avatars, switch).
- Shadows: `shadow-soft` is `none` (surfaces never cast one); `shadow-medium` menus and popovers; `shadow-large` dialogs, sheets, toasts; `shadow-focus` / `shadow-focus-inset` focus; `shadow-highlight` the menu highlight bar (below).
- Motion: `duration-120` hovers, `duration-160` (default) menus and dialogs, `duration-240` sheets; easing `cubic-bezier(.4,0,.2,1)` (Tailwind's default). Animations: `animate-fade-in`, `animate-dialog-in` (fade + zoom 95 %), `animate-zoom-in`, `animate-slide-in-right`; always with `motion-reduce:animate-none`.
- Layout: `max-w-form` 640, `max-w-content` 1120; spacing is Tailwind's 4px scale, which matches the design system's.

## Accessibility rules (decision #30)

1. Informative text uses `text-muted-foreground` (#6B6B6E, 5.3:1 on white, 4.8:1 on `muted`). `text-subtle` (#8E8E92, 3.3:1) is for placeholders, disabled text, separators and icons.
2. Keyboard focus is a solid teal ring: `focus-visible:shadow-focus focus-visible:outline-none` on buttons and controls (2px white gap + 2px #1E837C, 4.6:1); fields add `focus-visible:border-primary focus-visible:shadow-focus-inset` (teal border + 1px teal ring). Links get the same ring from `globals.css`. `.focus-ring` applies `shadow-focus`.
3. Required fields (`FormField required`): a teal `*` (`aria-hidden`) and an `sr-only` « (requis) ».
4. Highlighted menu and command items (arrow keys) keep the design-system fill (#F4F4F5 / #E9E9EB, ~1.1:1) plus a 2px teal bar on the left: `data-[highlighted]:shadow-highlight` (`--highlight-bar`). Native `<select>` lists are drawn by the operating system.
5. The switch's off track is `bg-subtle` (#8E8E92, 3.3:1) instead of #D4D4D8 (1.5:1), so its state is visible.

(4) and (5) were added to decision #30 after the Task 2.2b review. Hairline control borders (#E4E4E7, 1.3:1) are kept as designed.

## Component rules

- One `default` (teal) button per screen; secondary actions `outline`; `ink` for a main action when teal is already used; `destructive` only in an AlertDialog with an explicit verb (« Désactiver »).
- Status is `Badge`: a 6px `StatusDot` + a word. `filled` only for « Urgent ». Checklists use `StatusIndicator` (icon + label; the status is also read as words).
- Alerts are white with a hairline; only the icon is coloured. Tooltips are ink, 12px, radius 3.
- Empty states are two lines of text and an optional action: no icon, no box (`EmptyState`).
- Toasts (`sonner.tsx`): ink background, white text, light coloured icon (success teal-300, error pink-300, warning yellow-300), bottom-right, 20px from the edges; styled through sonner's variables and inline styles, focus ring in `globals.css`.
