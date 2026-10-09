# Typography and spacing — how to apply

The one scale for every screen. The tokens live in `src/styles/globals.css` (`--text-*`, `--leading-*`, `--tracking-*`) and are mapped in `tailwind.config.js`; the values come from the design-system handoff (`README.md`, decision #29) with the accessibility adjustments of decision #30. Shared components (`src/shared/ui`, `src/shared/components`) already follow it: **use them before writing classes by hand.**

## 1. Font

- **Inter Variable**, self-hosted (`@fontsource-variable/inter`, decision #25/#29: no Google request, Loi 25). One variable file per subset (weights 100–900 in one file); French text only ever downloads the **latin** subset (~48 kB), which the build preloads (`preloadInterLatin`, `vite.config.ts`). `font-display: swap`.
- Weights used: **400** (body), **500** (labels, emphasis, active tab, buttons), **600** (headings, figures). Never 300 or 700+.
- Rendering: `antialiased` on `body`; figures in tables, amounts, dates and counters are **tabular** (`tabular` utility; `TableCell`, `Input` and `NavTab` counts already have it).
- OpenType features (measured in the browser, 2026-10-09): the self-hosted build has `tnum`, `frac`, `calt`, but **not** the design system's `cv02 cv03 cv04 cv11 ss01` (nor `zero`, `case`): setting them changes nothing, so don't.

## 2. Type scale

Each role is a **recipe**: use exactly these classes. Line-height comes with the size token: never add `leading-*` to a scale size (`leading-none` on a one-line badge or initials is fine). `npm run lint` (`scripts/check-design-tokens.sh`) refuses arbitrary sizes (`text-[13px]`), arbitrary line heights (`leading-[22px]`) and the weights off the scale (`font-bold`, `font-light`…); a deliberate exception carries `design-tokens: allow` and its reason on the same line.

| Role | Size / line-height | Weight | Tracking | Classes | Shared component |
|---|---|---|---|---|---|
| H1 page title | 20 / 28 | 600 | −0.01em | `text-xl font-semibold tracking-tight` | `PageHeader level={1}`, « Paramètres », record header |
| Figure (a number in a stat card) | 20 / 28 | 600 | 0 | `text-xl font-semibold tabular` | — |
| H2 section, dialog and sheet title | 16 / 24 | 600 | 0 | `text-lg font-semibold` | `PageHeader` (level 2: a settings section), `DialogTitle`, `SheetTitle`, `AlertDialogTitle`, `FullPageMessage` |
| H3 card title | 14 / 20 | 600 | −0.01em | `text-base font-semibold tracking-tight` | `CardTitle`, `SettingsCard` |
| H4 group inside a card | 13 / 18 | 600 | 0 | `text-sm font-semibold` | — |
| Body | 13 / 18 | 400 | 0 | `text-sm` (the `body` default: often nothing to add) | `Table`, `Alert`, `EmptyState` |
| Body emphasis, label, button | 13 / 18 | 500 | 0 | `text-sm font-medium` | `Label`, `Button`, `AlertTitle` |
| Small: help, caption, secondary line, description | 12 / 16 | 400 | 0 | `text-xs text-muted-foreground` | `FormField` help, `CardDescription`, `Badge` |
| Overline (table header, menu group) | 11 / 16 | 500 | +0.06em | `text-2xs font-medium uppercase tracking-wide text-muted-foreground` | `TableHead` |

Rules:

- **Tracking** only on H1 and card titles (`tracking-tight`, as the handoff's `--type-page-title` / `--type-card-title`) and on overlines (`tracking-wide`). Not on section, dialog or sheet titles, nor on body text.
- **One exception to the scale**: the initials of a 24 px avatar are 10 px (`Avatar size="sm"`, as the handoff). Nothing else goes under 11 px.
- **Colours of text**: body `text-foreground`; informative secondary text `text-muted-foreground` (#6B6B6E, 5.3:1). `text-subtle` (#8E8E92, 3.3:1) is for placeholders, disabled text, separators and icons only, never for a sentence someone must read (decision #30).
- **Form fields** are 16 px on phones and 13 px from `sm` (decision #30, `fieldClasses`): don't override the size of an `Input`, `Select` or `Textarea`.
- **French typography**: a narrow no-break space (U+202F) before `: ; ? !` and inside « » in `fr-CA.json`; `160,00 $`, `100 %` with a no-break space. Dates and amounts through `@/shared/lib/timezone` and `@/shared/lib/format`.

## 3. Spacing (4 px grid)

| What | Value | Classes |
|---|---|---|
| Page gutter | 16 phone / 24 from `md` | `AppShell` (`p-4 md:p-6`): pages add none |
| Between page sections (header, cards, tables) | 20 | the shell's `gap-5`; inside a page `space-y-5` / `gap-5` |
| Card padding | 16 (12 compact) | `p-4` (`p-3`); `Card` header `p-4 pb-3`, content `p-4 pt-0` |
| Card title → content | 12 | `mb-3` (`SettingsCard` does it) |
| Between fields in a card or a form | 12 | `space-y-3`, grids `gap-3` (two columns: `grid gap-3 sm:grid-cols-2`) |
| Label → control → help/error | 4 | `FormField` (`space-y-1`): always use it |
| Card footer (actions) | 12 above, 8 between buttons | `mt-3 flex justify-end gap-2` (`SettingsCard`, `FormActions`) |
| Buttons side by side | 8 (6 in a page header) | `gap-2` (`PageHeader` actions `gap-1.5`) |
| Icon → text inside a control | 6 | `gap-1.5` (built into `Button`, tabs) |
| Table cell | 8 × 12, rows ≥ 40 | `TableCell` / `TableHead` (`px-3 py-2`, `h-10`) |
| Dialog | padding 20, gap 14, max 512 | `DialogContent` (`p-5 gap-3.5`) |
| Sheet | header 16/20/12, body 0 20 20, footer 12 | `SheetHeader`, `SheetBody`, `SheetFooter` |
| Status list row | 6 vertical | `StatusIndicator` |
| Empty state | 24 vertical, left-aligned | `EmptyState` |
| Readable widths | forms 640, content 1120, prose ~65ch | `max-w-form`, `max-w-content`, `max-w-prose` |

## 4. Controls and icons

| Element | Height | Text | Icon | Classes |
|---|---|---|---|---|
| Button `sm` | 28 | 12 / 500 | 14 | `<Button size="sm">` |
| Button default | 32 | 13 / 500 | 14 | `<Button>` |
| Button `lg` | 36 | 14 / 500 | 14 | `<Button size="lg">` |
| Icon button | 32² / 28² | — | 14 | `size="icon"` / `"icon-sm"` |
| Input, Select | 32 | 16 phone / 13 | 14 chevron | `Input`, `Select` |
| Textarea | ≥ 96 | 16 phone / 13 | — | `Textarea` |
| Checkbox / Switch | 16² / 32×18 | — | — | `Checkbox`, `Switch` |

- **Icon sizes**: 14 (`size-3.5`) in buttons, table cells, tabs and status rows; 16 (`size-4`) in the sidebar, the top bar and dialog close buttons; 12 (`size-3`) inline in 12 px captions. Inside a `Button` the size is set for you: don't add `h-4 w-4` to its icon.
- **Vertical centring**: icon + one line of text → `inline-flex items-center gap-1.5`. Icon + text that may wrap → `flex items-start gap-2` with the icon `mt-0.5` (13/18 text: a 14 px icon centred on the first line).
- **Radii**: `rounded-md` (4) controls, `rounded-lg` (6) cards, menus and alerts, `rounded-2xl` (8) dialogs, `rounded-full` avatars and switches.

## 5. How to apply (screen agents)

| You see | Replace with |
|---|---|
| `text-[13px]`, `text-[13px] leading-5` | `text-sm` |
| `text-[12px]`, `text-[11px]`, `text-[10px]` | `text-xs`, `text-2xs` (10 px is not on the scale) |
| `leading-5`, `leading-6`… next to a scale size | nothing: the size carries its line-height |
| a card title without `tracking-tight`, or in `text-sm`/`text-lg` | `text-base font-semibold tracking-tight` (or use `CardTitle` / `SettingsCard`) |
| a page title not `text-xl font-semibold tracking-tight` | `PageHeader`, or that recipe |
| section title inside a page (`h2` over cards, a questionnaire step) | `text-lg font-semibold`, no tracking |
| help or caption in `text-subtle` | `text-muted-foreground` |
| hand-made label + input + error | `FormField` |
| `space-y-2`/`space-y-4` between form fields | `space-y-3` (or `gap-3`) |
| `p-6`/`p-5` on a card | `p-4` (`Card`/`SettingsCard`) |
| hand-made `h-9`/`h-10` buttons or inputs | `Button` / `Input` sizes |
| amounts, dates, counts in a column without `tabular` | add `tabular` |
| `font-bold` | `font-semibold` |

Not in scope for screens: changing a token, a shared component or the font family. Ask the design-system lead (PR `ui/design-system`).
