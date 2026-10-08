# Clinique MANA — Design System

Design system for **Clinique MANA inc.** (Québec), a *dispatch clinic*: conseillères receive every request, evaluate the need in a free discovery call, and match the client with the right professional from a bank of ~50 independent professionals (psychologues, psychothérapeutes, travailleurs sociaux, sexologues, nutritionnistes…). 100 % online, everywhere in Québec. "MANA" means *power* in Polynesian: « donnez-vous le pouvoir d'agir ».

This system styles **the management platform** being rebuilt in `pergolassignature/Clinique-Mana` — "a GOrendezvous adapted to a dispatch clinic": professional bank (dossiers, documents, contracts, rates), demandes & jumelage, rendez-vous, reçus/facturation, external payers (IVAC, PAE). Clinical notes stay out of the app.

## Sources

- GitHub `pergolassignature/Clinique-Mana` (branch `main`) — https://github.com/pergolassignature/Clinique-Mana. Read: `CLAUDE.md`, `tailwind.config.js`, `src/styles/globals.css`, `src/shared/ui/*` (shadcn component set), `src/app/AppShell.tsx`, `src/core/auth/pages/*`, `src/core/settings/*`, `src/i18n/fr-CA.json`, `docs/standards/business-context.md`, `docs/standards/brand.tokens.md`, `docs/plans/2026-10-07-status.md`, and the legacy app (`_legacy/src/pages/{professionals,dashboard}.tsx`, `_legacy/src/shared/components/*`, screenshots in `_legacy/docs/professional-profile-audit/`). Explore the repo for module specs and data contracts before designing a new module.
- Website https://cliniquemana.com — colours and tone as recorded in `docs/standards/business-context.md §6`.
- Product brief from Jonathan (chat): modules, pages, role → menu matrix, Inter as the font (same as PS Hub), "easy to navigate, easy to read, modern, not AI-ish".

**Visual decision made here (revised after review).** The codebase has two palettes: the legacy app (sage, honey, wine, Inter) and the website (wine `#9B1B3C`, charcoal, teal/mint, Raleway). Jonathan rejected wine as a UI primary and asked for a compact, flat, tool-like look that does not feel generated. This system therefore uses **ink text on white, flat grey panels, one teal action per view, Inter at 13px**. Wine stays the logo colour. Component dimensions were re-derived for density (32px controls, 6/8px radii); the shadcn component inventory from `src/shared/ui` is kept.

## Users and what they see

| Role | Menu |
|---|---|
| Admin (Christine) | Everything + full Paramètres, coordonnées bancaires, journal d'audit |
| Conseillère | Accueil · Demandes · Clients · Professionnels · Rendez-vous |
| Adjointe administrative | Accueil · Clients · Professionnels · Rendez-vous · Facturation · Paramètres (lecture) |
| Professionnel | Mon profil · Mes documents · (later) Mon horaire, Mes clients, Mes reçus |
| Client (portal, later) | Ses rendez-vous, ses reçus |

Flow: Demande entrante → Appel découverte → Jumelage → Rendez-vous → Reçu / facture → (IVAC / PAE), fed by the bank of professionals.

## CONTENT FUNDAMENTALS

- **Language:** fr-CA only in the UI; code identifiers are English (`professionals`), routes and labels French (`/professionnels`, « Professionnels »).
- **Register:** formal **vous**, warm and plain. Short sentences. Invite rather than command: « Connectez-vous pour accéder à votre espace. », « Activez un module lorsqu'il est prêt. »
- **Casing:** phrase case everywhere (« Ajouter un professionnel », « Mot de passe oublié ? »). Overlines (settings group labels) are the only uppercase.
- **French typography:** non-breaking space before `: ; ! ?` and inside « guillemets »; dates « 21 janv. 2026 à 14:30 » (clinic timezone America/Toronto); amounts « 126,00 $ »; « 100 % ».
- **Errors reassure, never blame:** « Un imprévu, ça arrive. », « Le reste de l'application fonctionne toujours. Réessayez ou revenez plus tard. », « Trop de tentatives. Réessayez dans quelques minutes. » Never leak account existence (« Si un compte existe pour ce courriel… »).
- **Non-clinical vocabulary:** motifs are orientation tags, never diagnoses. No medical jargon.
- **Brand lines:** « 100 % en ligne, 100 % humain. » · « Moins d'administratif. Plus de temps pour pratiquer. » · « MANA, c'est d'abord et avant tout des humains. Qui en aident d'autres. »
- **No emoji.** No exclamation-heavy marketing voice inside the app.
- Empty states say what to do next in one sentence; buttons name the outcome (« Créer et inviter », « Envoyer le lien »).

## CONVENTIONS BORROWED (don't reinvent the wheel)

Layout patterns follow what practice-management tools already do — Jane (jane.app), SimplePractice, Owl Practice, Cliniko, GOrendezvous (gorendezvous.com, the reference named in the brief):
- Light left sidebar with the role's modules; 48px top bar with page title, global search, notifications, user.
- Lists are dense tables: filter bar on top (search · status select · filters · result count), overline column headers, 40px rows with hover, pagination footer.
- Inbox-type screens (Demandes, later Rendez-vous) are list + right detail panel (Jane's appointment panel); the panel is sticky, has header / scrolling body / action footer.
- Records (professionnel, client) are full pages: header band (name, status, meta, actions right), horizontal tabs, two-column body (main · side).
- One coloured primary button per view (teal); secondary actions outlined; destructive only inside confirmation.
- Forms: label above field, two-column grid capped at 640px, Save/Cancel right-aligned at the bottom.

## VISUAL FOUNDATIONS

**Anti-generic rules (decided with the client, 7 oct.).** White page, hairline borders, no grey panels, no pastel fills, no shadows on surfaces. Status is a 6px dot + a word, never a pill. Primary action is teal (the convention: every practice tool has one coloured action button); ink for emphasis; wine only in the logo. Radii 4 (controls) · 6 (cards, menus) · 8 (dialogs). Empty states are two lines of text, no box, no icon. Tooltips are 3px-radius ink labels. Alerts are white with a hairline border and a coloured icon.

- **Colour.** White page, flat grey panels `#F2F2F4`, sidebar tint `#F4F4F6`, ink text `#1F1F20`, secondary `#6B6B6E`, muted `#8E8E92`, hairlines `#E6E6E9`. One action colour: teal `#1E837C` (hover 700, active 800) for the single primary button, links, focus, the notification dot. Ink doubles as emphasis (ink button, active tab underline). Wine is the logo only. Status lives in 6px dots (teal success, yellow `#E0B400` warning, red `#B3261E` danger, grey neutral) next to ink text; soft tinted fills appear only in inline alerts and the rare `filled` urgent chip. No pastel pills, no gradients.
- **Type.** Inter. Body 13/18, labels 13 medium, captions 12, overlines 11 uppercase +0.06em, panel titles 14 semibold, section titles 16, page title 20 semibold −0.01em, figures 20 semibold tabular. Weights 400/500/600 only. Features `cv02 cv03 cv04 cv11 ss01`.
- **Spacing.** 4px grid, compact: controls 32 high (28 sm, 36 lg), panel padding 16 (12 compact), list rows 8×12 with 40px min height, page padding 24, section gap 20, sidebar 220 (56 collapsed), top bar 48, settings menu 200, forms max 640, content max 1120.
- **Radii.** 6px controls, nav links and menu items; 8px panels, menus, chips' parents; 10px dialogs; 4px badges; full for avatars and the switch.
- **Borders & shadows.** Surfaces are flat: panels have no border and no shadow; grouping is done by tint and hairline dividers. Shadows exist only on floating layers (menu `0 2px 8px/.08`, dialog/sheet/toast `0 12px 32px/.14`, each with a 1px ring). Inputs and outline buttons use a 1px hairline that darkens on hover.
- **Backgrounds.** Flat. No textures, illustrations or decorative gradients. Empty states are a dashed hairline box with a 1.5-stroke icon.
- **Imagery.** Wordmark only. Initials avatars (24/32/48) in neutral grey or soft teal; professional photos round.
- **Motion.** 120–240ms, `cubic-bezier(.4,0,.2,1)`. Menus/dialogs fade+zoom from 95%; sheets slide from the right 240ms; hover tints 120ms. No bounces, no staggered entrances.
- **Hover.** Buttons darken one step; outline buttons darken the hairline; ghost and rows tint to the panel-hover grey `#EBEBEE`; sidebar links tint 5% ink. **Press:** darken another step. **Focus:** 1px teal border on inputs; 2px teal ring offset 2px elsewhere. **Disabled:** 50% opacity (buttons), grey fill (inputs).
- **Overlays:** ink at 32%, no blur.
- **Layout.** Grey sidebar flush with the white page (no border), flat menu in the role table's order (no group labels — `AppShell.tsx` has none), 48px hairline top bar with breadcrumb/title left and ⌘K, bell, help, avatar right. Content = page title row, toolbar (search 280, filters), then panels. Lists are flat panels with an overline header row and hairline-divided rows, not card grids. Dashboard figures sit inline in one panel separated by hairlines, not as tiles. Records open as right sheets (480–520) or pages with underline tabs; forms are 2-column grids capped at 640.
- **Density.** Tool-like: more rows per screen, less chrome, text does the hierarchy.

## ICONOGRAPHY

- **Lucide** everywhere (the codebase uses `lucide-react`): 14px in buttons, inputs, tabs and table cells; 16px in the sidebar and top bar; 12px inline with captions; 24px at stroke 1.5 in empty states. `currentColor`, muted grey unless it carries a status colour.
- Delivered here as the `Icon` component: load `lucide@0.460.0` UMD before the bundle and it renders inline SVG by kebab-case name (falls back to a `lucide-static` CDN mask). For production, use `lucide-react` directly with the same names.
- The brand's **wordmark** is the only custom graphic: `assets/logo.png` (full lockup with tagline « Ressources en santé mentale et bien-être ») and `assets/logo-header.svg` (header wordmark, 22px tall in the sidebar). `assets/favicon-legacy.svg` is the legacy sage "M" tile, kept for reference only.
- Standard glyph mapping: house Accueil · inbox Demandes · circle-user Clients · users Professionnels · calendar-days Rendez-vous · receipt Facturation · settings Paramètres · file-text documents · tag spécialités · video/phone appointment mode · log-out Se déconnecter. Star (filled amber) = specialisation.
- No emoji. No unicode glyphs as icons (the one exception: `⌘K` and `Esc` in `<kbd>`).

## Components

Reusable React primitives (one `.jsx` + `.d.ts` + `.prompt.md` each; inventory = `src/shared/ui` + `src/shared/components` + legacy shared components).

- `components/forms/` — Button, Input, Textarea, Select, Label, Checkbox, Switch
- `components/display/` — Badge (dot + ink text), Avatar, Card (flat panel / outline), Skeleton, Alert, Tooltip, StarToggle, EmptyState, StatusIndicator, Icon
- `components/navigation/` — SidebarNav, Topbar, SettingsNav, NavTabs, DropdownMenu, CommandPalette, Accordion, PageHeader
- `components/overlays/` — Dialog, AlertDialog, Sheet, Popover, Toast
- `components/layout/` — AuthCard, FullPageMessage

**Intentional additions** (no 1:1 source file): `Icon` (wrapper for the lucide set); `SidebarNav`/`Topbar` merge the new `AppShell` with the legacy sidebar/topbar; `StatusIndicator`, `EmptyState`, `PageHeader` come from the legacy app and are kept because the UI kit screens need them. Not rebuilt: `ErrorBoundary`, `RouteBoundary` (behavioural, no visual), `Toast` stands in for `sonner`.

## UI kits

- `ui_kits/clinique-mana-app/` — the management app: Connexion, Accueil (dashboard by role), Professionnels (list, add dialog, fiche with tabs), Demandes (inbox + discovery-call sheet with matching suggestions), Paramètres (grouped menu, Modules). Role switch Admin / Conseillère / Adjointe. See its README.

## Index

- `styles.css` — entry; imports `tokens/{fonts,colors,typography,spacing,effects,base}.css`
- `tokens/` — colour scales + semantic aliases, type roles, spacing/layout, radii/shadows/motion, body reset + keyframes
- `guidelines/` — specimen cards: Colors (wine, teal & mint, neutrals, semantic, surfaces), Type (family, scale, roles), Spacing (scale, in use, radii, shadows, layout), Brand (logo, voice)
- `components/` — see above; each folder has a `*.card.html` specimen
- `ui_kits/clinique-mana-app/` — interactive app recreation
- `assets/` — logo.png, logo-header.svg, favicon-legacy.svg
- `reference/` — two legacy screenshots (professionals list, profil tab) for layout reference
- `thumbnail.html`, `SKILL.md`, `github.md`

## Caveats

- Inter is loaded from Google Fonts; Loi 25 suggests self-hosting (the team flagged the same for Raleway). Drop woff2 files in `assets/fonts/` and replace `tokens/fonts.css`.
- Teal is the working action colour; the current code ships sage and the website uses wine for CTAs. Switch `--primary*` aliases in `tokens/colors.css` if the team decides otherwise.
- Clients, Rendez-vous, Facturation screens have no source UI yet; the kit leaves them as placeholders.
