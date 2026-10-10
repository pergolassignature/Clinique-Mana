# Desktop layout audit (2026-10-09)

Jonathan: « I still feel the UX/UI on desktop can be further analysed. The font Inter is good, but the way space and layout are used can be improved », then « aussi the weight of the fonts maybe etc? ». The earlier UI pass fixed sizes and alignment (`docs/design-system/typography-and-spacing.md`). This pass is about **desktop layout** (use of width, spacing rhythm, density, hierarchy, grouping) and **type weight and hierarchy**. Nothing is implemented here: Jonathan picks what to build from §4.

## Method

- Local stack only, seed logins (admin, conseillère, professionnel), app on its own Vite server. The shared local database was 24 migrations behind `main` (the list failed to load); they were applied with `supabase migration up --local` under `scripts/with-db-lock.sh`.
- Every screen captured at **1280 × 800, 1440 × 900 and 1920 × 1080** with Playwright (full page), 144 captures plus dialogs, and measured in the page with `getComputedStyle` / `getBoundingClientRect`: frame and content widths, card paddings and gaps, field widths, row heights, and the computed size, line height, weight, letter spacing and colour of every heading, label, cell, button, tab and nav item. Spot checks in the built-in browser.
- Screens: Accueil (3 roles), Professionnels list, a record on every tab (an active, an « À réviser » and an « À inviter » file), Révision mensuelle, the create, invitation, activation, upload and staff-invite dialogs, ⌘K, all 23 Paramètres sections, Mon compte, the professionnel's Mon profil, Mes documents and an open « Mettre mon profil à jour » questionnaire (opened, captured and closed again through « Fermer la demande »), and the login page.
- The worst cases are saved under [`screenshots/desktop/`](screenshots/desktop/) (local seed data only). In full-page captures the sidebar stops at the viewport height: it is `sticky` and `h-dvh`, which is correct in the browser; it is not a finding.

### What already works

The shell chrome is sound: sidebar 220 px (56 collapsed), top bar 48 px, both sticky; dialogs are one width (512 px, padding 20, gap 14) and one title recipe (16/24, 600); ⌘K is 600 px with 46 px rows; the login card is 360 px and calm. Inter Variable is self-hosted as **one latin file covering weights 100–900**, so no weight is ever synthesised (faux bold is impossible), and the app uses only **400, 500 and 600** (measured on every screen). The questionnaire is the best desktop page in the app (sticky step list, 640 px form, a 160 px « Code postal », pinned footer): several proposals below generalise what it already does.

## 1. Top 10 findings, ranked by impact

Ranked by how often a conseillère or an admin meets the problem in a day, times how much it costs them.

### 1. Record tabs leave a third of the screen empty, and each tab has a different shape

**Screens:** the professional record, every tab ([1920](screenshots/desktop/admin-professionnels_p01_identite-1920.jpg), [Aperçu 1920](screenshots/desktop/admin-professionnels_p01_apercu-1920.jpg)).

**Measured.** The shell frame is `max-w-content` = 1120 px, centred. Inside it the tabs use three different widths:

| Tab | Content width | Empty to the right of the content at 1440 | at 1920 |
|---|---|---|---|
| Aperçu, Jumelage | grid 733 + 367 (1100 px breakpoint) | 50 | 290 |
| Profil public, Identité et permis, Documents, Rémunération et fiscalité | `max-w-form` 640, left-aligned | **480** | **770** |
| Historique | 1120 | 50 | 290 |

At 1920 the record starts 290 px right of the sidebar and the form tabs stop at x = 1150 of 1920. Switching from Aperçu to Identité, the right column (« Dossier », « À surveiller », « Prochaine action ») disappears and the content shrinks from 1120 to 640 px.

**Why it matters.** The record is the conseillère's main screen. The summary she needs while editing (is the file ready? what is missing? what is next?) is only on Aperçu, so she flips tabs to check it, and every tab change re-lays the page.

**Proposal.** One record layout for every tab (§2.7): a compact sticky header and tab strip, then a **main column plus a 320 px summary rail at ≥ 1280** that keeps « Dossier », « À surveiller », « Prochaine action » and a few key facts on every tab. Tab content fills the main column (828 px at 1440, 936 px at 1920 with the wider frame of finding 2); forms use the section layout of finding 3. Mockups [1](mockups/01-record-identite.html) and [3](mockups/03-record-documents.html).

### 2. Narrow columns pinned to the left of a centred wide frame; the top bar does not share the frame

**Screens:** Mon compte ([1920](screenshots/desktop/admin-mon-compte-1920.jpg)), Mon profil ([1920](screenshots/desktop/provider-mon-profil-1920.jpg)), Mes documents, the questionnaire, Paramètres form sections ([1920](screenshots/desktop/admin-parametres_identite-1920.jpg)), the record form tabs.

**Measured.** `AppShell` centres a 1120 px frame (`mx-auto max-w-content`), then most pages put a 640 px `max-w-form` column at its left edge:

| Page | 1280 | 1440 | 1920 |
|---|---|---|---|
| Mon compte, Mon profil, Mes documents: content ends at | x 884 (396 px empty) | x 910 (530 empty) | x 1150 (**770 empty**) |
| Questionnaire (step list 240 + 640 form) | 124 empty | 258 | 498 |
| Paramètres, form sections: menu 212 + form 640 | — | 245 px empty right of the form | 245, plus 290 px between sidebar and menu |

The top bar's content is not in the frame: at 1920 the breadcrumb starts at x = 280 and the page title at x = 510 (230 px apart); « Rechercher » ends at x = 1828, the content at 1630.

**Why it matters.** On the 1920 screens the clinic uses, the page looks off-centre and unfinished: a column, then a void. Two horizontal starting lines (breadcrumb, title) make the eye re-anchor on every page.

**Proposal.** One frame rule (§2.1): the frame grows to **1280 px** and the top bar's content uses the same frame, so the breadcrumb, the title and the right edges line up. **No page leaves a narrow column against the left of the frame**: a page either fills the frame (lists, records, settings) or lays its cards out in a two-column grid at ≥ 1280 (Mon compte: « Nom affiché » | « Courriel », « Mot de passe » | « Sessions »; Mon profil: the six read-only cards in two columns). Form fields keep their reading width through field widths (finding 4), not through a narrow page.

### 3. Every group of fields is its own card with its own two buttons

**Screens:** record « Identité et permis » ([1920](screenshots/desktop/admin-professionnels_p01_identite-1920.jpg)), « Profil public », « Rémunération et fiscalité » ([1440](screenshots/desktop/admin-professionnels_p01_remuneration-1440.jpg)), Paramètres sections, Mon compte.

**Measured.**

| Screen | Cards | Buttons « Annuler / Enregistrer » (or equivalent) visible at rest | Page height (all widths) |
|---|---|---|---|
| Identité et permis | 5 | **10** | 1 672 px |
| Paramètres → Identité légale | 4 | 6 | 1 406 px |
| Mon compte | 4 | 7 | 938 px |
| Paramètres → Courriels (Réglages) | 2 | 3, one « Enregistrer » in the middle of a card | 1 210 px |

The inactive buttons are outline buttons in grey text (`aria-disabled`), one pair per card, aligned right under each card: the same pair repeats down the page. Each card also repeats 16 px padding, a border and a 12 px title gap, so a 2-field group like « Expérience » costs 164 px of height.

**Why it matters.** Ten equal buttons on one screen hide the one that matters, and the page is twice as tall as its content. The per-card form itself is a good rule (one save per group, nothing saved by surprise); the noise is the repetition.

**Proposal.** Keep one form per group, change how the groups are drawn (§2.4, §2.5): **sections of one surface**, separated by a hairline, each with its **title and description in a 220 px aside** and its fields beside it (at ≥ 720 px of surface width, a container query; stacked below that). Show a section's « Annuler / Enregistrer » **only while that section is dirty or saving**, with a « Modifications non enregistrées » mark in the aside. Identité et permis drops from 1 672 px to about 950 px. Mockups [1](mockups/01-record-identite.html) and [2](mockups/02-settings-section.html). Needs Jonathan's OK: it changes the FormActions rule « outline until dirty » to « hidden until dirty ».

### 4. Field widths do not follow their content

**Screens:** record Identité, Rémunération (Fiscalité), Paramètres Identité légale, Fiscalité, Signataire, Confidentialité, Mon compte.

**Measured.** On the record and in Paramètres there are only two field widths: **297 px** (half) and **606 px** (full). « Code postal » (7 characters) is 297 px; « Années d'expérience » (2 digits) 297; « NEQ » (10 digits) 297; « Numéro de TPS / TVQ » 297; « Téléphone personnel » 297. Meanwhile other screens already size fields: the questionnaire's « Code postal » is **160 px**, Jumelage's « Âge minimum des clients » and « Nombre de places » **96 px**, Paramètres → Invitations' delays **64 px**. The same field (« Code postal ») is 297 px on the record and 160 px in the questionnaire.

**Why it matters.** A box's width tells the reader what goes in it; uniform half-width boxes make a 2-digit field look like a name. Content-sized fields also let related fields share a row (Ville | Province | Code postal), which shortens forms.

**Proposal.** Four field widths (§2.5): `xs` 96 (1–3 digits), `sm` 160 (postal code, dates, NEQ, licence and IVAC numbers), `md` 264 (names, phone, city, short selects, tax numbers), `full` (address, email, URL, text). A `width` prop on `FormField`, applied everywhere a field is declared.

### 5. Hierarchy is compressed: card title, label and body are one pixel apart

**Screens:** everywhere; worst on Paramètres and the record forms. [Mockup 4](mockups/04-type-scale.html) shows the measurements side by side.

**Measured (computed styles).**

| Role | Today | Note |
|---|---|---|
| Page title H1 | 20/28, 600, −0.2 px | fine |
| Settings section title (PageHeader level 2) | 16/24, 600 | under a second H1 « Paramètres » |
| Card title H3 | **14/20, 600**, −0.14 px | |
| Field label | **13/18, 500** | 1 px and one weight step under the card title |
| Body, value | 13/18, 400 | same size as the label |
| In-page group heading (« Documents requis ») | 16/24, 600 (H3) | bigger than the card titles under it, same tag |
| Motif category rows (Aperçu, Jumelage) | 13/18, **600**, 13 lines | a bold wall on the landing tab |
| Read-only label | « Mon compte » dt 13/**500** foreground; record dt 13/**400** secondary | two styles for the same thing |
| Table headers | `TableHead` 11/500 caps +0.66 px; Révision mensuelle 12/500 sentence case; Rétention table 12/400 secondary; group rows 12/**600** caps +0.72 px, darker than the column headers | four styles |
| Buttons | default 13/500 (32 px) and `sm` 12/500 (28 px) side by side in the same areas: « Fiche PDF » (32) vs « Envoyer l'invitation », « Préparer le contrat », « Modifier » (28) | |

On Paramètres the eye meets four levels in 7 px: « Paramètres » 20, « Identité légale » 16, « Clinique » 14, « Nom affiché » 13. On a record form, « Identité » (14/600) and « Prénom » (13/500) read as the same level.

**Why it matters.** When titles and labels look alike, a long form reads as one undifferentiated list; scanning for « where is the address? » takes longer. Weight is the one lever that does not cost width.

**Proposal.** The type scale of §2.2 (and mockup 4): **card, dialog and sheet titles 16/24 600** (one « panel title »), the Paramètres section title becomes the page's **H1** (the breadcrumb and the menu already say « Paramètres »), in-page group headings become the existing **overline** (11/16, 500, caps), motif categories **500**, one read-only label style (400 secondary), one table-header style, `sm` buttons only inside table rows and dense lists. Weights stay 400/500/600; no new size token.

### 6. Read-only views are forms of grey boxes

**Screens:** the record as a conseillère ([Identité 1440](screenshots/desktop/counselor-professionnels_p01_identite-1440.jpg)), every read-only settings section.

**Measured.** The conseillère's « Identité et permis » shows 14 `readOnly` inputs on the grey fill (`bg-muted`, #F4F4F5), 1 373 px tall; empty values (« Téléphone personnel », « Adresse », « Code postal ») are blank grey boxes. The same data on the professionnel's « Mon profil » and on Aperçu is a description list (label 400 secondary, value 400 foreground, « Non indiqué » for empty) at half the height.

**Why it matters.** The conseillère reads files all day and edits few of them; grey boxes read as « disabled », empty boxes say nothing, and the page is twice as long as the information.

**Proposal.** One read-only pattern: a `DescriptionList` (§2.6) for a tab the user can never edit (no edit permission for the whole tab), two columns at ≥ 1280, « Non indiqué » for empty values. Keep `readOnly` inputs where they are a moment of a form (the « Courriel de connexion » next to « Modifier », settings sections read-only by role inside an editable page). Needs Jonathan's OK: CLAUDE.md §8 says read-only fields are `readOnly`, never `disabled`; a description list respects the intent (full contrast, copyable) without looking like a form.

### 7. Long pages lose their header and their menu

**Screens:** record Jumelage ([1440](screenshots/desktop/admin-professionnels_p01_jumelage-1440.jpg), 3 330 px), Documents (1 241 px), Paramètres Journal d'audit ([1440](screenshots/desktop/admin-parametres_journal-1440.jpg), 2 429 px), Tâches planifiées (2 747 px), Motifs (5 805 px), Professions et ordres (1 747 px).

**Measured.** Only the top bar (48 px) and the sidebar are sticky. The record header (name, status, « Activer », « Fiche PDF », « ⋯ ») and the tab strip are `position: static`; the settings menu (`xl:w-[212px]`) is static; no table header is sticky. The questionnaire is the only page that pins its step list and its footer.

**Why it matters.** Halfway down Jumelage, the conseillère no longer sees whose file she is in, cannot switch tab, and must scroll back up to reach « Activer ». In Paramètres the menu is gone after one screen.

**Proposal.** Sticky compact record header plus tabs under the top bar (about 120 px, shrinking the meta line on scroll); sticky settings menu (`top: topbar + 24`, own scroll when taller than the window); sticky `thead` on tables over about 15 rows (Journal d'audit, Motifs, Tâches planifiées); the rail of finding 1 sticky too. The topbar breadcrumb keeps naming the record, so the compact header can drop the meta line.

### 8. Spacing does not separate groups, and empty states add their own padding inside cards

**Screens:** record Documents ([1440](screenshots/desktop/admin-professionnels_p09_documents-1440.jpg)), Rémunération et fiscalité, Mes documents, Aperçu.

**Measured.**

- Every vertical gap between blocks is 20 px (`gap-5`), whether the next block is a sibling card or a new group: the « Documents requis » heading sits 20 px under the questionnaire card, exactly like card to card, so groups do not read as groups.
- The three required documents are three cards **12 px** apart (the only 12 px card gap in the app; elsewhere 20).
- `EmptyState` without `inCard` inside a card adds 24 px above and below: the « Banque » card's last line sits **41 px** from its bottom border, against 17 px in every other card; same in « Questionnaire et mises à jour ».
- Aperçu's main card stretches to the rail's height (grid `align-items: stretch`): on « À réviser » files it ends with an empty band (Olivier Bergeron, 1440: about 160 px).
- Page header → content: 20 px; settings section header → first card: 20 px; card title → content: 12 px. The header-to-content gap equals the card-to-card gap.

**Why it matters.** Rhythm is how a page says « these belong together »; when every gap is the same, the reader must read titles to find structure.

**Proposal.** The spacing scale of §2.3: 20 px between cards of a group, **32 px between groups** (with an overline heading 8 px above the group), 24 px page header → content. Required documents become rows of one list card. `EmptyState` reads its card context (`inCard` by default inside `SettingsCard` and `Card`). The record grid uses `align-items: start`. Mockup [3](mockups/03-record-documents.html).

### 9. Tables: narrow text columns, rows of equal buttons, one header style missing

**Screens:** Paramètres Tâches planifiées ([1440](screenshots/desktop/admin-parametres_taches-planifiees-1440.jpg)), Rémunération ([1440](screenshots/desktop/admin-parametres_remuneration-1440.jpg)), Contrats et formulaires ([1440](screenshots/desktop/admin-parametres_contrats-1440.jpg)), Révision mensuelle, Utilisateurs et accès.

**Measured.**

- Tâches planifiées: the « Tâche » column (name + description) gets 290 px of the 882 px table at 1440 (the four other columns take 592), so descriptions wrap to up to 12 lines and rows reach **261 px**; the table ends with **15 outline « Exécuter maintenant »** buttons.
- Paramètres → Rémunération: 9 professions × an outline « Nouvelle version », and each grid's tiers and prices written as a run-on sentence (« De 28 % à 25 % (dès 301 séances) · 60 min / couple 200,00 $ · … ») instead of columns.
- Contrats et formulaires: 5 filter tabs (« Tous (2) », « Publiés (0) », « Brouillon en cours (2) », « Non publiés (2) », « Retirés (0) ») and a search field for 2 templates; buttons « Ouvrir « Consentement au droit à l'image » ».
- Four header styles (finding 5). Numbers are tabular everywhere (good), but « Documents » « 0 / 3 » and « Cumul » are left-aligned.
- Professionnels list: rows 51 px (two lines), header 32 px; good. The count appears three times: « 10 professionnels · 7 actifs » (subtitle), « 10 résultats » (toolbar), « 10 sur 10 professionnels » (footer).

**Why it matters.** Admin tables are where the clinic configures money and jobs; tall rows and repeated buttons hide the one row that needs attention.

**Proposal.** The table rules of §2.6: a description column at least 320 px (or truncated to two lines, full text in a tooltip or the row's detail), one visible text action per row at most (others in « ⋯ »; « Exécuter maintenant » as a row menu item or a ghost icon button on hover and focus), numbers and counts right-aligned, filter tabs only when a list can exceed one screen, one count per list.

### 10. Page headers and primary actions are placed three different ways

**Screens:** Professionnels list ([1920](screenshots/desktop/admin-professionnels-1920.jpg)), the record header, Utilisateurs et accès, Révision mensuelle.

**Measured.**

- List header: `PageHeader` aligns actions to the **bottom** (`items-end`): « Ajouter » sits at y = 88 while the H1 is at y = 72, so the primary action is 16 px lower than the title it belongs to.
- Record header: actions aligned to the **top** of the title (y = 72).
- Utilisateurs et accès: « Inviter » on its own row above the table (a 52 px band), not in the section header.
- Button heights in the same area: « Fiche PDF » 32 px next to « Envoyer l'invitation » 28 px in the rail; « Modifier » 28 px in card headers, « Modifier » 32 px in Coordonnées.

**Why it matters.** The primary action should be where the eye already is; three placements mean three habits.

**Proposal.** One page-header pattern (§2.4): title block left, actions right, **vertically centred on the title line** (not the subtitle), at most one teal button per screen, 32 px buttons in headers and card footers, the section's « Inviter » / « Ajouter » in the section header.

### Also noted (lower impact)

- **Settings menu**: 23 entries in three groups, 722 px tall: fine with a sticky menu (finding 7); a « Rechercher un réglage » field is not needed yet.
- **Tabs**: the active tab switches from 400 to 500 weight, which widens it by 2–4 px and nudges the tabs after it; reserve the bold width (a hidden bold copy of the label, as in mockup 1). Gap 12 px, padding 2 px: fine.
- **Accueil**: when nothing needs attention, a 1120 px card holds one sentence and two shortcut buttons; at 1920 it is a long empty band. Lower priority: Accueil will fill with module cards (Demandes).
- **Courriels → Envoi et webhook**: one card mixes a saved field (« Domaine d'envoi » with its own « Enregistrer » mid-card) and three secret actions; split into two sections.
- **Login**: card padding 28 px (`p-7`), off the 16/20 steps; harmless.
- **`font-synthesis`** is the default (`weight style small-caps`). Nothing is synthesised today (variable font, three weights); set `font-synthesis: none` on `body` as a guard against a future static subset.

## 2. Layout system proposal

Each rule names the `src/shared` (or shell) code it changes. Token names follow `src/styles/globals.css`.

### 2.1 Container widths per page type

| Page type | Width | Examples | Code |
|---|---|---|---|
| Frame (every page) | `--content-max` **1280** (was 1120), centred, gutter 24 (16 on phones) | — | `globals.css`, `AppShell.tsx` |
| Top bar content | the same frame | breadcrumb, search, bell | `Topbar.tsx` (inner `mx-auto max-w-content`) |
| List / table | full frame | Professionnels, Journal d'audit, Révision mensuelle | — |
| Record | full frame: main `minmax(0,1fr)` + rail `--rail-w` **320**, gap 24, at ≥ 1280 (`xl`); rail above the content (three summary tiles in a row) below 1280 | the professional record | `ProfessionalRecordPage.tsx`, `RecordTabs.tsx` |
| Settings | full frame: menu 212 (sticky) + 32 + pane; form surfaces up to 880, tables full pane | Paramètres | `SettingsLayout.tsx` |
| Single-purpose pages | full frame, cards in a 2-column grid at ≥ 1280 | Mon compte, Mon profil, Mes documents | `AccountPage.tsx`, `MyProfilePage.tsx`, `MyDocumentsPage.tsx` |
| Step form | step list 240 + 32 + form 640, then the rest of the frame free (a « Ce qui sera envoyé » summary could go there later) | questionnaire | unchanged |
| Reading measure | `max-w-prose` (~65ch) for descriptions and help | page subtitles | `PageHeader` (already) |
| Overlays | dialog 512; wide sheet 720; template editor 1120; palette 600 | unchanged | — |

Measured result of the 1280 frame: at 1440 the frame is the full content area (1172 px), at 1920 it leaves 186 px each side instead of 266 (1120 frame).

### 2.2 Type scale (size, weight, line height, colour per role)

Weights 400 / 500 / 600 only (the variable file covers them; no faux bold). Sizes from the existing tokens; **no new size**.

| Role | Size / line | Weight | Colour | Classes / component |
|---|---|---|---|---|
| Page title H1 (also the Paramètres section title) | 20 / 28, −0.01em | 600 | foreground | `PageHeader level={1}`, `RecordHeader` |
| Panel title: card, dialog, sheet | **16 / 24** | 600 | foreground | `CardTitle`, `SettingsCard` title, `DialogTitle`, `SheetTitle` (`text-lg font-semibold`) |
| Group heading above cards; table header; menu group | 11 / 16, +0.06em, caps | 500 | secondary | overline recipe; `TableHead`; new `SectionHeading` |
| Sub-group inside a card (H4) | 13 / 18 | 600 | foreground | `text-sm font-semibold` |
| Label, button, active tab and nav, list-row name, motif category | 13 / 18 | 500 | foreground | `Label`, `Button`, `MotifsSummary` (from 600) |
| Body, value, table cell | 13 / 18 | 400 | foreground | default |
| Read-only label (dt) | 13 / 18 | 400 | secondary #6B6B6E | `DescriptionList` |
| Help, description, secondary line | 12 / 16 | 400 | secondary | `FormField` help, `CardDescription` |
| Figure | 20 / 28, tabular | 600 | foreground | — |
| Placeholder, icon, « — » | — | 400 | muted #8E8E92 | `text-subtle` (never a sentence) |

The steps between levels become 20 → 16 → 13/500 → 13/400 → 12: each level differs from the next by size or weight, and the panel title is now 3 px and one weight step above the label. Mockup [4](mockups/04-type-scale.html).

### 2.3 Spacing scale (4 px grid) and when to use each step

| Step | Use |
|---|---|
| 4 (`1`) | label → control → help / error (`FormField`) |
| 8 (`2`) | buttons side by side; chip gaps; group heading → its group |
| 12 (`3`) | between fields; card title → content; card content → footer |
| 16 (`4`) | card padding; between rail cards |
| 20 (`5`) | section padding (top/bottom) in a sectioned surface; between cards of one group |
| 24 (`6`) | page gutter; page header → content; main column ↔ rail; aside ↔ fields |
| 32 (`8`) | **between groups** of cards (new); settings menu ↔ pane |

Rule of thumb: the gap between two things is smaller than the gap around their group. Today 20 is used for both (finding 8).

### 2.4 Page header pattern, card pattern

**Page header** (`PageHeader.tsx`): title block left (H1, then an optional 13 px secondary subtitle at `max-w-prose`), actions right, **centred on the title line** (`items-start` with the actions box `h-7` centred), wrapping under the title on narrow screens. At most one teal button per screen. Counts live in the subtitle (« 10 professionnels · 7 actifs ») and, filtered, in the table footer; nowhere else. In Paramètres the section header is the page header (H1) and holds the section's actions (« Inviter », « Ajouter un ordre »).

**When a card, when not:**

- A **card** is one object or one form: a document list, a contract, a summary tile, a form section group. Padding 16, hairline border, radius 6, no shadow (unchanged).
- Several related forms on one page are **sections of one surface** (hairline between them), not a stack of cards: record form tabs, Paramètres form sections, Mon compte. A section is `SettingsCard` with `layout="section"`: title + description in a 220 px aside, fields beside it (≤ 560 px), when the surface is ≥ 720 px wide (container query `cq-720`, already in `tailwind.config.js`); stacked below.
- A group of cards gets an **overline heading** (`SectionHeading`), 32 px above and 8 px below; no H3 16/600 inside a tab.
- **No card in a card** (rare today: the only nested bordered boxes are the logo preview and the drop zone); an empty state inside a card never adds padding (`EmptyState` reads the card context).
- A card's actions: header right for « Modifier » / « Téléverser » (32 px), footer right for a form's « Annuler / Enregistrer », shown only while dirty or saving (needs OK, finding 3).

Code: `card.tsx` (`CardTitle` 16/24), `SettingsCard.tsx` (`layout`, title size, footer visibility, empty-state context), `FormActions.tsx`, `EmptyState.tsx`, new `SectionHeading.tsx`.

### 2.5 Form layout rules at desktop

- Labels on top (French labels are long; left labels would cost 160+ px per row).
- Field widths from content: `xs` 96, `sm` 160, `md` 264, `full`. `FormField` gets `width="xs" | "sm" | "md" | "full"` (default `full` inside a 560 px fields column, so nothing grows past the reading width). A field is at least as wide as its label (« Années d'expérience » is `sm`, not `xs`).
- Rows only for fields that belong together and fit: Prénom | Nom; Ville | Province | Code postal (`md` + `sm` + `xs` = 544 px); Téléphone | Courriel; Titre | N° de permis | « Retirer ».
- Sections in an aside layout (2.4) at ≥ 720 px of surface; below, the current stacked card.
- Long forms (questionnaire, a sheet): pinned footer with the primary action, as the questionnaire does.
- Read-only for the whole tab: `DescriptionList` (2.6), not inputs (needs OK, finding 6).

Code: `form-field.tsx` (width prop), `globals.css` / `tailwind.config.js` (`--field-xs/sm/md`, `--section-aside-w`), every form that declares fields (lane B).

### 2.6 Table and list rules; description lists

- One header style: `TableHead` (11/16, 500, caps, +0.06em, secondary). Group rows: `TableGroupRow` = the overline on `bg-muted` (as `RoleMatrix` does), never 12/600 dark caps.
- Row height: 40 for one line, 52 for two lines (name + email); a cell never wraps past two lines by default; long descriptions get a 320 px minimum column or two-line truncation with the full text in a tooltip or the row detail.
- Alignment: text left; numbers, amounts, counts (« 0 / 3 »), percentages right-aligned and tabular; dates left, tabular, fixed width; status columns 128–144 px.
- Actions: at most one visible text button per row; the rest in a « ⋯ » row menu; repeated per-row actions (« Exécuter maintenant », « Nouvelle version ») as ghost buttons or menu items.
- Toolbar: search 320, selects 160–220, left-aligned with the table; filter tabs only when the list can exceed a screen; one count per list.
- Sticky `thead` over about 15 rows.
- Empty table: `EmptyState inCard` inside the table card.
- **DescriptionList** (new, `src/shared/components/DescriptionList.tsx`): `dt` 400 secondary, `dd` 400 foreground, hairline between rows, 180 px label column, « Non indiqué » in muted for empty values, two columns of pairs at ≥ 1280. Used by Aperçu, Mon profil, Mon compte « Courriel actuel », read-only record tabs.

Code: `table.tsx` (`TableGroupRow`, `align` on `TableHead` / `TableCell`, `stickyHeader` on `Table`), `DescriptionList.tsx`.

### 2.7 The record page layout

```
┌ top bar 48 (sticky) ─ Professionnels / Geneviève Tremblay ───────────── Rechercher ⌘K ─┐
├ record header (sticky, compact on scroll) ──────────────────────────────────────────────┤
│ (GT) Geneviève Tremblay ● Actif                                  [Fiche PDF ▾] [Activer] [⋯] │
│      Psychologue · OPQ 08417 · courriel · FR · EN       (meta line hides when compact)   │
│ Aperçu  Jumelage  Profil public  Identité et permis  Documents  Rémunération  Historique │
├─────────────────────────────────────────────────────────────┬───────────────────────────┤
│ main: minmax(0, 1fr)                                        │ rail 320 (sticky)         │
│  tab content, full width of the column                      │  Dossier (checklist)      │
│  forms: one surface, sections with an aside header          │  À surveiller             │
│  lists: one card per group, overline headings, 32 between   │  Prochaine action [btn]   │
│                                                             │  En bref (places, langues)│
└─────────────────────────────────────────────────────────────┴───────────────────────────┘
```

- ≥ 1280 (`xl`): two columns; main 668 (1280), 828 (1440), 936 (1920).
- < 1280: the rail becomes three summary tiles above the content (Dossier, À surveiller, Prochaine action), then the content.
- Aperçu keeps its own content (Profil de jumelage, note, key facts) in the main column; its right-hand cards move to the rail, shared by every tab, read through `useRecordData` (no refetch, P4-71).
- Profil public could later use the main column's width for a live preview of the client card beside the text fields.

Code: `ProfessionalRecordPage.tsx`, `RecordHeader.tsx`, `RecordTabs.tsx`, `OverviewTab.tsx`, `ReadinessCard.tsx`, `WatchCard.tsx`, `NextActionCard.tsx`, the `tabs/*.tsx` (drop `max-w-form`).

## 3. Before / after

| # | Change | Mockup | Before |
|---|---|---|---|
| 1 | Record layout (rail, sticky header), sectioned form, field widths, actions only when dirty | [`mockups/01-record-identite.html`](mockups/01-record-identite.html) | [Identité 1920](screenshots/desktop/admin-professionnels_p01_identite-1920.jpg), [conseillère 1440](screenshots/desktop/counselor-professionnels_p01_identite-1440.jpg) |
| 2 | Settings section: H1 section title, sticky menu, aside sections, field widths | [`mockups/02-settings-section.html`](mockups/02-settings-section.html) | [Identité légale 1920](screenshots/desktop/admin-parametres_identite-1920.jpg) |
| 3 | Grouping: overline groups, 32 px between groups, required documents as one list, in-card empty states, one button size | [`mockups/03-record-documents.html`](mockups/03-record-documents.html) | [Documents 1440](screenshots/desktop/admin-professionnels_p09_documents-1440.jpg) |
| 4 | Type scale: weights and hierarchy, today vs proposed, with the role table | [`mockups/04-type-scale.html`](mockups/04-type-scale.html) | measurements in finding 5 |

The mockups are static HTML using the app's tokens (`mockups/mockup.css`; proposed tokens marked) and the repo's self-hosted Inter Variable (open them from a checkout with `node_modules`). Content is the local seed. Mockup 1 reflows under 1280 (the rail moves above the content).

**Mon compte** (not worth a mockup): the four cards become a two-column grid at ≥ 1280, « Nom affiché » | « Courriel » on the first row, « Mot de passe » | « Sessions » on the second; « Courriel actuel » becomes a `DescriptionList` row; the page drops from 938 to about 560 px and fills the frame instead of 640 px on the left.

**Professionnels list** (precise description): actions centred on the H1 line; drop « 10 résultats » (keep the subtitle, and the footer when filtered); « Documents » right-aligned; the table fills the 1280 frame (at 1920, 1280 instead of 1120 px: « À surveiller » gets the 160 px, which is the column that wraps first).

## 4. Implementation plan

Ordered so two agents can build in parallel without touching the same files. Lane A owns `src/shared/**`, `src/app/**`, `src/styles/**`, `tailwind.config.js` and `docs/design-system/**`; lane B owns `src/modules/**` and `src/core/**` pages. Each batch is one PR, green on CI, with its unit tests (`src/shared` components have tests next to them) and a screenshot check at the three widths.

| Batch | Lane | Size | Content | Files | Depends on |
|---|---|---|---|---|---|
| **A1** Tokens and frame | A | S | `--content-max` 1280, `--rail-w`, `--section-aside-w`, `--field-xs/sm/md`; Tailwind `maxWidth` / `width` keys; frame in `AppShell`; top bar content in the frame; `font-synthesis: none`; update `typography-and-spacing.md` §3 | `src/styles/globals.css`, `tailwind.config.js`, `src/app/AppShell.tsx`, `src/app/shell/Topbar.tsx`, `docs/design-system/typography-and-spacing.md` | — (merge first, small) |
| **A2** Type scale in components | A | M | `CardTitle` and `SettingsCard` title 16/24; `TableHead` the only header style; `TableGroupRow`; `align` on head and cell; `stickyHeader`; new `SectionHeading` | `src/shared/ui/card.tsx`, `src/shared/ui/table.tsx`, `src/shared/components/SettingsCard.tsx`, `src/shared/components/SectionHeading.tsx` (+ tests) | A1 |
| **A3** Form primitives | A | M | `FormField` `width` prop; `SettingsCard layout="section"` (aside via `cq-720`) and the sectioned surface; `FormActions` hidden until dirty (**after Jonathan's OK**); `EmptyState` card context | `src/shared/ui/form-field.tsx`, `src/shared/components/SettingsCard.tsx`, `FormActions.tsx`, `EmptyState.tsx` (+ tests) | A2 (same file `SettingsCard`: A2 then A3 in the same lane) |
| **A4** Page header and description list | A | S | `PageHeader` actions centred on the title line, count slot; new `DescriptionList` | `src/shared/components/PageHeader.tsx`, `src/shared/components/DescriptionList.tsx` (+ tests) | A1 |
| **B1** Record layout | B | L | Rail (Dossier, À surveiller, Prochaine action, En bref) on every tab; sticky compact header and tabs; Aperçu's right cards move to the rail; grid `align-items: start`; tabs drop `max-w-form`; tab bold-width reserve | `src/modules/professionals/pages/ProfessionalRecordPage.tsx`, `components/record/RecordHeader.tsx`, `RecordTabs.tsx`, `ReadinessCard.tsx`, `WatchCard.tsx`, `NextActionCard.tsx`, `tabs/OverviewTab.tsx`, `tabs/*Tab.tsx` (width only) | A1 |
| **B2** Settings shell and tables | B | M | « Paramètres » H1 out, section title H1; sticky menu; « Inviter » in the section header; Tâches planifiées columns and row actions; Rémunération grids as a compact table; Contrats: filter tabs only past one screen | `src/core/settings/SettingsLayout.tsx`, `src/core/settings/pages/UsersSettingsPage.tsx`, `ScheduledJobsSettingsPage.tsx`, `AuditLogPage.tsx` (sticky head), `src/modules/professionals/pages/settings/CompensationSettingsPage.tsx`, `ContractsSettingsPage.tsx` | A2 (table API), A4 |
| **B3** Forms: sections and widths | B | L | Apply `layout="section"` and field widths: record Identité, Profil public, Rémunération (Fiscalité, Banque), Jumelage cards; Paramètres form sections (Identité légale, Fiscalité, Signataire, Confidentialité, Courriels, Signature électronique, Invitations); « Code postal » / numbers aligned on the questionnaire's widths | `src/modules/professionals/components/record/tabs/IdentityTab.tsx`, `PublicProfileTab.tsx`, `CompensationTab.tsx`, `components/record/*Card.tsx` (form cards), `src/core/settings/components/*`, `src/core/settings/pages/*SettingsPage.tsx` (forms) | A3, B1 (same tab files: after B1) |
| **B4** Grouping and documents | B | M | Documents tab: overline groups, required documents as one list card, in-card empty states, button sizes; Mes documents the same; motif categories 500 | `components/record/tabs/DocumentsTab.tsx`, `DocumentsPanel.tsx`, `RequiredDocumentCard.tsx`, `DocumentRow.tsx`, `SubmissionsCard.tsx`, `ContractCard.tsx`, `MotifsSummary.tsx`, `pages/self/MyDocumentsPage.tsx` | A2, A3; B1 |
| **B5** Single-purpose pages and read-only | B | M | Mon compte and Mon profil in a 2-column grid; `DescriptionList` for Mon profil, Mon compte « Courriel actuel » and read-only record tabs (**after Jonathan's OK**); Professionnels list header and counts | `src/core/account/pages/AccountPage.tsx`, `src/modules/professionals/pages/self/MyProfilePage.tsx`, `pages/ProfessionalsListPage.tsx`, `components/list/ProfessionalsTable.tsx`, the read-only branches of the record tabs | A4; B3 for the record tabs |

Order: **A1** alone (small, everyone depends on the tokens); then lane A runs A2 → A3 → A4 while lane B runs B1 (needs only A1); B2 after A2 + A4; B3 and B4 after A3 and B1; B5 last. Lane A never edits a module or a core page; lane B never edits `src/shared`. The only cross-lane contract is the component APIs (`width`, `layout="section"`, `SectionHeading`, `TableGroupRow`, `DescriptionList`): agree them in A2/A3's PR description before B starts using them.

### Decisions to confirm before building

1. `--content-max` 1120 → 1280 (a design-system token, decision #29).
2. `FormActions` hidden until the section is dirty (today: outline until dirty).
3. `DescriptionList` instead of `readOnly` inputs when the user can never edit a tab (CLAUDE.md §8 read-only rule).
4. The « Paramètres » H1 removed; the section title becomes the H1.
5. Merging small sections (record « Expérience » + « Numéros de payeurs », mockup 1) changes which fields one « Enregistrer » saves; optional.
