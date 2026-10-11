# Coding plan — the modules after Professionnels (2026-10-11)

**For:** the agents who build the next modules, and Jonathan (review). **Status:** plan, nothing built. **Direction (Jonathan, 2026-10-11):** « build a system close to GOrendezvous; adapt it to us, don't reinvent the wheel ».
**Read first:** [roadmap](2026-10-11-next-modules-roadmap.md) (the why, in French, with Jonathan's questions), [GOrendezvous tour](../research/2026-10-11-gorendezvous-tour.md) (« visite §n »), [legacy inventory](2026-10-06-legacy-feature-inventory.md) (§B Clients, §C Demandes, §D matching, §E Rendez-vous, §F Facturation, §G payers, §H Services), [intake workbook](../research/2026-10-08-intake-workbook.md), `CLAUDE.md`, [database conventions](../standards/database-conventions.md), [core module doc](../modules/core.md) (« How a module plugs in »), [Professionnels doc](../modules/professionals.md) (« What the module publishes »), [decisions log](2026-10-07-decisions-log.md) (series R-, delegated and revisable).
**Language:** this plan is in English; every user-facing label is French and goes through `t()`.

---

## 0. Rules every batch follows

**One batch = one branch = one PR**, merged to `main` when green and reviewed (merging deploys, CLAUDE.md §11: Jonathan's go-ahead for each merge). Branch names `feat/<module>-<batch>` (e.g. `feat/services-s1`).

**Definition of done (every batch):**
1. pgTAP first: one file per migration in `supabase/tests/database/` (next free number, `094_…`), covering grants (`function_privs_are`, never calling a refused function as the switched role), RLS per role (admin, counselor, admin_assistant, provider, another clinic), RPC refusals (`42501`, French `P0001` with HINT), audit rows, and `000_invariants` green.
2. Migration `YYYYMMDDHHMMSS_<module>_<name>.sql` from `date -u`, seconds ≠ `00`; closed by default (`revoke all … from anon, authenticated`, then explicit `select` / column grants); RLS on every table through `private` helpers wrapped in `(select …)` with a `has_permission` term; `org_id` + `private.audit_trigger(<redacted columns>)` on every business table; definer RPCs with `set search_path = ''`, permission check first; seeds `on conflict do nothing`. Then `db:reset`, `db:test`, `db:types` under `scripts/with-db-lock.sh`, ending with the restore (handoff §8).
3. Edge functions (if any): `handler.ts` + `index.ts`, `createHandler(deps)`, doubles from `_shared/testing/`; category per CLAUDE.md §7 (user → `verifyAuth(req, { module, permission })`; job → `runJob`; webhook → `?org=`, signature with `timingSafeEqual`, one per-IP hit, `claim_webhook_event`); `readJson` + Zod; errors `{ error: { code, message } }`; `reportError` with codes and ids only; Deno tests (`npm run test:functions`), `deno fmt --check`.
4. Frontend: `src/modules/<name>/` (manifest, `index.ts`, `api/` Zod-parsed, `hooks/keys.ts`, `schemas/`, `lib/`, `components/`, `pages/`, `test/`); no Supabase client in `.tsx` (`lint:supabase`); `invokeFunction` for functions; `useReadyAccess`, `can()`, `<RequireAccess>`; `lazyPage` for pages and record tabs; record tabs read `useRecordData`; dates through `@/shared/lib/timezone` (`formatDateOnly*` for date-only); address line 1 = `AddressAutocomplete`; files via `uploadFile` / `useSignedFileUrl`; forms through `FormField`, `useUnsavedChanges`; **UI-1** frame 1280; **UI-2** `FormActions` hidden until dirty; **UI-3** never-editable tabs are a `DescriptionList`; **UI-4** settings section title is the H1; **UI-5** small sections merged where it reads better; close buttons and in-form section tabs out of the tab order, page-level views real Radix tabs (CLAUDE.md §10). Vitest with `renderWithContexts`.
5. One Playwright spec per module (e2e server on 5190, seed logins), extended per batch when a repeatable path exists; one manual walkthrough per batch with new screens (375 px included).
6. Docs: `docs/modules/<name>.md` (tables, RPCs, permissions, what the module publishes), a few lines in the status doc; decisions worth revisiting in the decisions log.
7. `typecheck`, `lint`, `lint:supabase`, `lint:migrations`, `test:run`, `build`, `check:functions`, `lint:functions`, `test:functions` green; one review per batch, a full review before merging the last batch of a module.

**Lean process:** 2 lanes (A and B) working in parallel worktrees; never `git commit -a`; explicit paths; the shared local stack only under the DB lock.

**Module rules (CLAUDE.md §5):** each module has a manifest (`key`, `labelKey`, `dependsOn`, `nav`, `routes`, `settingsSections`, optional `homeCards`, `search`, `audit`), is listed in `ALL_MODULES`, starts **disabled** in every clinic, owns its tables, and publishes views / RPCs / `private` helpers for the others. A module that needs data from a later module receives it through a helper the earlier module publishes and the later one calls (data plugs in, never code: ADR 0003).

---

## 1. Module catalogue

| Module | Key | Routes (French) | `dependsOn` | Permissions (defaults: A admin, C counselor, J admin_assistant, P provider) | Lane, before cutover |
|---|---|---|---|---|---|
| Services et tarifs | `services` | Paramètres → `services-et-tarifs` | `professionals` | `services.view` (A C J P), `services.manage` (A J) | A, 5 d |
| Clients | `clients` | `/clients`, `/clients/:id/:onglet?` | `professionals` | `clients.view` (A C J), `clients.manage` (A C J), `clients.merge` (A J), `clients.privacy` (A), `clients.self` (P) | A 10 d + B 4 d |
| Rendez-vous | `appointments` | `/agenda`, `/agenda/disponibilites`, `/mon-agenda`, public `/rendez-vous/action` | `clients`, `services`, `professionals` | `appointments.view` (A C J), `appointments.manage` (A C J), `appointments.self` (P), `appointments.settings` (A) | A 20 d + B 6 d |
| Facturation | `billing` | `/facturation/:onglet?`, `/facturation/factures/:id`, `/mes-recus` | `appointments`, `clients`, `services` | `billing.view` (A J), `billing.manage` (A J), `billing.settings` (A), `billing.self` (P) | A 15 d + B 12 d |
| Demandes | `demandes` | `/demandes`, `/demandes/:id/:onglet?`, `/liste-attente` | `clients`, `professionals`, `services` | `demandes.view` (A C J), `demandes.manage` (A C), `demandes.notes` (A C), `demandes.stats` (A), `demandes.self` (P), `demandes.waitlist` (A C) | B 16 d (lot a) |
| Communications | `communications` | `/courriels`, Paramètres → `courriels-gmail`, `ia` | — (core) ; `clients` optional for linking | `communications.inbox` (A C J), `communications.send` (A C J), `communications.mailboxes_manage` (A), `communications.ai_draft` (A C J) | B 8 d (lot a) |
| Rapports | `reports` | `/rapports/:rapport?` | `billing`, `appointments` (later `demandes`) | `reports.view` (A), `reports.finance` (A J) | A 2 d |
| Import GOrendezvous | — (scripts + `private` RPCs in each module) | none | all of the above | service role / terminal only | B 10 d |

`clients` does not depend on `appointments`: the provider visibility rule (visite §2) is a `client_professional_links` table that `clients` owns and `appointments` feeds through `private.clients_link_professional(…)`.

---

## 2. Lane schedule (2026-10-12 → cutover 2027-01-11)

Working days, one agent per lane; Jonathan reviews each batch within a day. Dates are the batch's merge target. Updated after Jonathan's answers of 2026-10-11 (Zoom per professional, waitlist, « Facturé à »): the Gmail inbox screen (CM2) moves after the cutover to make room for the waitlist (D3) before it.

| Week | Lane A (critical path) | Lane B |
|---|---|---|
| Oct 12–16 | **S1** schema (Oct 13) · **S2** RPCs (Oct 14) · **S3** UI (Oct 16) | **CM1** Gmail connect + token vault + sync engine + sync status screen (→ Oct 21) |
| Oct 19–23 | **C1** schema (Oct 21) · **C2** RPCs (Oct 23) | CM1 · **C5** client consents (Oct 22 → 27) |
| Oct 26–30 | **C3** list, create, record (Oct 28) · **C4** merge, Loi 25, ⌘K (Oct 30) | C5 · **I1** import tooling + clients dry run (Oct 28 → Nov 3) |
| Nov 2–6 | **R1** agenda schema + booking RPCs (Nov 6) | I1 · **D1** demandes schema, states, waitlist tables (Nov 4 → 9) |
| Nov 9–13 | **R2** agenda UI + availability mode (Nov 13) | D1 · **D2** inbox, intake, record, realtime (Nov 10 → 16) |
| Nov 16–20 | **R3** recurrence, states, cancellations (Nov 19) · R4 starts | D2 · **D3** waitlist part 1 (Nov 17 → 23) |
| Nov 23–27 | **R4** reminders + client links (Nov 25) · **R5** « Mon agenda », publications (Nov 27) | D3 · **D3b** discovery calls, proposals with acceptance link (Nov 24 → 25) · **RZ** Zoom per professional starts (Nov 26) |
| Nov 30–Dec 4 | **F1** invoices, lines, payer model, numbering, taxes (Dec 4) | RZ (→ Dec 3) · **I2** appointments + waitlist dry run, day 1 (Dec 4, needs the support export) |
| Dec 7–11 | **F2** payments, receipts, statements, UI (Dec 11) | **FS** Stripe link + Interac reconciliation (→ Dec 10) · I2 day 2 (Dec 11) |
| Dec 14–18 | **F3** cancellation and registration fees, couple split, payouts read (Dec 16) · **RP1** Revenus + cancellations (Dec 18) | **FQ** QuickBooks: payer parents, dossier sub-customers, GOrendezvous customer mapping (→ Dec 23) |
| Dec 21–Jan 1 | **D3c** public discovery-call booking page replacing Calendly (Dec 21–23; the first batch dropped if lane A slips: Calendly has no deadline) · Buffer: fixes from walkthroughs; staff guide; holidays | FQ · **I3** billing dry run + QBO mapping report (Dec 28–30) |
| Jan 4–8 | **Rehearsal** (Jan 4–6), go / no-go (Jan 7), **freeze** Fri Jan 8 18:00 | Rehearsal, final exports |
| Jan 9–11 | **Cutover weekend**, go-live Mon Jan 11 | Cutover weekend |
| Jan 11–Feb 26 | **D4–D6** Demandes (b) incl. waitlist offers · **FP** third-party payers · **R6** Google busy | **CM2** inbox UI + linking · **CM3** composer + Gmail send + templates · **CM4** OpenAI drafting · **RP2** reports |

- **Critical path:** S1–S3 → C1–C2 → R1–R5 → F1–F3 → FQ → I3 → rehearsal → cutover. Lane A finishes on Dec 18 (≈ 50 days); lane B on Dec 30 (≈ 56 days). **Slack:** lane A two weeks (Dec 21 → Jan 4), lane B only the holidays; then the Jan 25 fallback.
- **External dependencies on the path:** the appointment-history export from GOrendezvous support (I2; roadmap question 1), QuickBooks access (FQ), the Zoom developer app (RZ; question 41) and each professional connecting Zoom (cutover T-14), Christine's 7 consent texts (C5).
- **If lane A slips more than 5 days:** R5 and RP1 move after cutover (providers see « Mon agenda » through `/agenda` filtered; revenue from the GOrendezvous history and QuickBooks for the first weeks), then F3's payouts read. **If lane B slips:** D3b proposals move after cutover (offers by phone meanwhile), then FS's Interac screen (manual matching in « Paiements »).

---

## 3. Decisions to answer before each module starts

Numbers refer to the roadmap's §4 questions. Defaults (the recommendation) are used if Jonathan has not answered when the batch starts, and recorded as R- decisions.

| Before | Questions | Default if unanswered |
|---|---|---|
| S1 (Oct 12) | 10 drops, 11 student / reduced rates (who decides), 23 cancellation policy, 6 buffer after 50 min, 46 taxes on sexologie / orientation (9 price source answered by the data: per profession, identical across pros → grid) | drops as proposed; dated per-service discount; two tiers 50 % / 100 % in **confirm** mode only; 10 min « pause après »; therapy untaxed, `to_confirm` flag on those two |
| C1 (Oct 19) | 12 visibility rule, 13 tags → fields, 14 RAMQ / TELUS / Lumino, 15 consents | GOrendezvous rule; fields as listed; none of the three; facts imported, 7 templates recreated |
| CM1 (Oct 12) | 27 mailboxes, 30 retention | `info@` shared first; bodies 24 months |
| I1 (Oct 28) | 1 export request, 2 cutover date, 3 counselors | Christine asks support; Jan 11; one account each |
| D1 (Nov 4) | 7 proposals, 17 PHQ-2/GAD-2, 19 workbook questions; waitlist 34–40 | proposals with acceptance link; dropped; workbook defaults; fee as today, follow-up every 8 weeks, ≤ 2 entries, counselor sets priority with a reason, 48-h offer one client at a time, any profession, counselors own the lists |
| R1 (Nov 2) | 8 Google busy (video answered: Zoom per professional; 5 locations answered by the data: video + phone) | after cutover |
| R4 (Nov 20) | 43 SMS regression | « Clients sans rappel » view in R4; Twilio reminders only if Jonathan picks option (b) |
| RZ (Nov 26) | 41 Zoom app publication | Jonathan creates the Zoom developer account at the start of RZ |
| F1 (Nov 30) | 21 invoice → receipt, 24 PAE / IVAC, 25 QuickBooks, 26 old receipts, 42 split parents, 45 « Argent comptant » = Interac autodeposit? (payer model answered: « Facturé à », QBO parent + sub-customer per dossier; 22 Stripe answered by the data: payment link only) | receipt on payment; 0 $ client invoice until FP; plain lines, modes ↔ accounts as GOrendezvous (§8); no PDF import; two payers with shares; « Comptant » inactive, history kept |
| D3c (Dec 21) | 44 Calendly: replace or keep | replace with the public booking page; Calendly stays until it ships |
| CM4 (Jan) | 28 OpenAI account and Loi 25, 29 model | clinic account, Canada project if eligible, ZDR asked; `gpt-5.4` after a 20-draft trial |

---

## 4. Cutover runbook (outline)

To be written in full as `docs/runbooks/gorendezvous-cutover.md` during I3.

1. **T-30 (Dec 9):** email to professionals (Zoom connection, « Mon agenda », new links in client emails); counselor and admin_assistant accounts invited (one per person, roadmap question 3); GOrendezvous support confirms the final export date and format (Jan 8).
2. **T-14 (Dec 28):** every professional active in GOrendezvous has an account, a primary title, availability rules and a Zoom connection (report: « Professionnels prêts pour la bascule », with the « Zoom » column; reminders sent to the unconnected); the 7 consent templates published; QuickBooks connected with the payment-mode ↔ account map **and the GOrendezvous customer mapping reviewed** (FQ's report: matched, to decide, none created yet); email templates reviewed.
3. **Rehearsal (Jan 4–6):** dry run of the full import on production (dry run writes only `private.import_*`, then clears them) with the latest exports; full import into the local stack; walkthrough by Christine and the admin_assistant (book, move, cancel late, invoice, pay by link, receipt, statement); go / no-go criteria checked on Jan 7.
4. **Freeze (Fri Jan 8, 18:00):** GOrendezvous kept open read-only by convention (no new bookings); last GOrendezvous reminders already cover appointments up to Tue Jan 12; final exports (clients, Revenus, support's appointment export with the future appointments).
5. **Final import (Sat Jan 9 – Sun Jan 10):** clients (with default payers) → services map → appointments (history read-only, future active; a future video appointment keeps the Zoom link GOrendezvous already sent when the export carries it, else a link is queued on the professional's Zoom and sent to the client) → waitlist entries (GOrendezvous waitlist export + the fake « Inscription – Liste attente … » / « LISTE ATTENTE À RAPPELER » appointments) → invoices and payments (history) → consents facts → QuickBooks links from the reviewed mapping; reconciliation report (counts and totals vs exports and QuickBooks); 10 records checked; modules enabled (Paramètres → Modules); jobs switched on (`appointments.reminders` from Mon Jan 11 for Wed Jan 13 appointments; `appointments.mark_completed`); QuickBooks push **paused**.
6. **Go-live (Mon Jan 11):** hypercare (an agent on call, daily triage); invoice sequence continues GOrendezvous's 2027 numbers.
7. **Go / no-go (Wed Jan 13, noon):** if green, QuickBooks push released (queued invoices and payments go out) and GOrendezvous is cancelled before Jan 31 (keeping read access if obtained, question 2). **Rollback** if a blocking defect (cannot book, cannot invoice, reminders failing, data loss): reopen GOrendezvous, disable the four modules, hand the report « créé dans l'app depuis le 11 janvier » (appointments, invoices, payments) for manual re-entry; QuickBooks untouched because the push was paused; retry on Jan 25.

---

## 5. Services et tarifs (`services`) — full task detail

**Route:** settings section `services` (« Services et tarifs », path `services-et-tarifs`, `permission: services.view`, `editPermission: services.manage`). **Depends on:** `professionals` (titles, retention grids). **Lane A, Oct 12–16.**

### 5.1 Keep / Change / Drop

| Item | Source | Mark | How |
|---|---|---|---|
| List: search, active / archived filter, sort, create, edit, archive, restore | §H | Keep | Settings cards, grouped by family |
| Fields: name, description, duration, colour, « toujours taxable », requires consent | §H, visite §3 | Keep | Key and code set once |
| Key derived from the name, duplicates unhandled | §H | Change | Typed, unique in DB |
| Numbered families 10xxx–80xxx, code per service | visite §3 | Keep | `service_families`, `services.code` (QuickBooks item) |
| Services and prices per employee copied from « Z MATRICE » (~900 pairs) | visite §3 | Change | One catalogue; `service_titles` says which titles offer it |
| Price per profession category (« Offert », price, taxable, hourly) | §H | Change | Prices from the retention grids (`price_source = 'grid'`); fixed or free otherwise. **Confirmed by the data (visite §18):** GOrendezvous prices are per profession and identical across the pros of a profession (TS 85 / 120 / 150, psychoéducation 100 / 140 / 165, sexologie 110 / 150 / 175, psychothérapie 120 / 160 / 185, psychologie 130 / 175) |
| Pricing models `fixed`, `by_profession_category` | §H | Change | `price_source` |
| Admin family 50xxx priced 0, amount typed on the invoice (report 56–208 $, discussion 33–84 $, test 40 $, supervision 100 $) | visite §18 | Keep | `price_source = 'entered'`: Facturation asks the amount; no prorata engine |
| Taxes as practised: taxable = file opening (37,83 $ + taxes), waitlist registration (18,91 $ + taxes), couple 30 min, supervision, travel fees, naturopathie; every consultation untaxed | visite §18 | Keep | `tax_rule` per service; `to_confirm` on sexologie and orientation only (roadmap question 46) |
| `by_profession_hourly_prorata`, `rule_cancellation_prorata` | §H | Drop (Jonathan's OK) | Unused |
| Service for two (couple) | visite §3 | Keep | `for_two`; Facturation splits |
| Student rate, reduced rate (services 10131 / 10151 / 10152 in GOrendezvous: 2 + 68 + 3 lines in 2026; psychologie 96 / 120) | visite §3, §18 | Change | `service_rate_variants`, dated discount; the import maps those codes to the base service + variant |
| Late cancellation / no-show: 605 lines in 2026, ~103 billed, typed 17,75–140 $, never the signed 50 % / 100 % | visite §18 | Change | `billing_policies.fee_mode` defaults to `confirm`; `automatic` only after Jonathan's and Christine's explicit go |
| 0 $ PAE / IVAC services; IVAC file opening 43,49 $ taxable | visite §3, §H | Keep | Seeded as `free` / `fixed` |
| Late cancellation / no-show service with a typed price | visite §5 | Change | Two-tier policy (`billing_policies`), fee line computed by Facturation |
| Seed prices per category | §H | Drop here | Already in the grids |
| PRÉSENTIEL variants, office rental, item sale, recherche-action | visite §3 | Drop (Jonathan's OK) | Online clinic |
| Rooms, equipment, places, fixed hours, tag rules, RAMQ, Lumino specialty, « who can choose » | visite §3 | Drop (Jonathan's OK) | Unused at MANA |
| « Pause après » | visite §3 | Keep | `buffer_after_minutes` (10 for 50-min sessions) |
| Writes admin / staff | §H | Change | `services.manage` |
| Duplicate price rows, hourly base ignored, hard-coded taxes | §H broken | Fixed | Constraints, `tax_rate_on` |

### 5.2 Data model

- `service_families` (`org_id`, `code` smallint 10–80 step 10, `name`, `sort_order`; unique (`org_id`, `code`)).
- `services` (`org_id`, `family_id`, `code` int 10000–89999 unique per org and inside its family's range, `key` text unique immutable, `name`, `description`, `kind` (`session` / `call` / `fee` / `workshop` / `admin`), `duration_minutes` (0 for fees), `buffer_after_minutes`, `for_two` bool, `price_source` (`grid` / `fixed` / `free` / `entered`), `fixed_price_cents`, `grid_duration_minutes` (which grid column), `tax_rule` (`exempt` / `taxable` / `to_confirm`), `requires_consent_template_key`, `colour`, `is_active`, `sort_order`). Checks: `fixed` ⇒ price set; `grid` ⇒ grid duration set; `entered` ⇒ no price (Facturation requires an amount on the line).
- `service_titles` (`service_id`, `profession_title_id`; unique pair) — FK to the Professionnels title table (referential only).
- `service_rate_variants` (`service_id`, `variant` (`student` / `reduced`), `discount_kind` (`amount` / `percent`), `value`, `effective_from`, `effective_to`; no overlap per (service, variant), `btree_gist`).
- `billing_policies` (`org_id`, `effective_from`, `late_notice_hours` default 24, `first_fee_percent` 50, `next_fee_percent` 100, `file_opening_service_id`, `fee_mode` (`confirm` / `automatic`); periods never overlap).
- **RLS:** read with `services.view` (array form for providers), writes only through RPCs; audit on all five (no redaction).
- **Published:** view `services_catalog` (`security_invoker`, active rows with family and titles), `get_service_price(p_service, p_title, p_variant, p_on) → (price_cents, tax_rule, source)` (invoker), `billing_policy_on(p_on)`, `private.service_price(…)` for definer callers in Rendez-vous and Facturation.
- **Needs from Professionnels:** `private.grid_client_price(p_title_id, p_duration_minutes, p_on) → int` (the retention grid's client price in force; a small migration owned by Professionnels, task S2.1).

### 5.3 Batches and tasks

**S1 — schema and seeds (Lane A, Oct 12–13, 2 d)**
- S1.1 pgTAP `094_services_module.test.sql`: tables exist, RLS on, grants (no client insert / update / delete), `has_permission` term in every policy, audit triggers, checks (code range, `fixed` price, `grid` duration), overlap refusal on variants and policies, module row and permission rows, role defaults.
- S1.2 Migration `…_services_module.sql`: `modules` row (`services`, « Services et tarifs »), `module_dependencies` (`professionals`), permissions and `role_permissions` defaults (§1 table), the five tables, indexes on every FK, RLS, grants, audit triggers.
- S1.3 Seeds (`on conflict do nothing`): the 8 families; **GOrendezvous's real catalogue** (visite §18, the « Z MATRICE » template, 28 services), kept with its codes so the import maps 1:1 and QuickBooks items match: `10100` Ouverture de dossier – individuel (fixed 37,83 $, taxable), `10130` / `10150` Consultation individuelle 30 / 50 min (grid), `10131` / `10151` student and `10152` reduced (base service + variant), `20100` / `20102` Ouverture de dossier couple-famille (fixed 37,83 $, taxable), `20150` Consultation individuelle – couple-famille 60 (grid), `20160` Consultation couple-famille 60 (grid, `for_two`), `20170` Consultation couple-famille 30 (grid, taxable as practised), `30100` Ouverture de dossier IVAC (fixed 37,83 $, taxable), `30150` / `30152` IVAC 50 / tarif réduit (`entered`: client share), `40130` / `40150` / `40160` PAE externe 30 / 50 / couple 60 (`entered`, 0 by default), `50100` Inscription liste d'attente (fixed 18,91 $, taxable), `50400` Rédaction de rapport, `50401` Test psychométrique, `50500` Discussion avec un autre intervenant, `50602` Supervision (taxable) (`entered`), `50600` Transfert de dossier and `50601` Appel découverte 15 min (free), `60100` / `60200` Atelier – animation / participation (`entered`), `70300` / `70360` Annulation tardive / absence – individuel / couple-famille (fee lines computed by Facturation), `80100` Frais de déplacement (`entered`, taxable); naturopathie `10157` (grid, taxable) as an inactive row until a naturopath is active. PRÉSENTIEL codes (`10154`, `10155`, `20151`, `20161`) are not seeded (Drop) and map to their online twin at import. `service_titles` from the per-profession observations (psychologie has no couple, IVAC or PAE services).
- S1.4 `npm run db:reset && db:test && db:types` under the lock; invariants green.
- **Acceptance:** a provider reads the catalogue, cannot write; another clinic sees nothing; the module starts disabled.

**S2 — RPCs and published contract (Lane A, Oct 14, 1 d)**
- S2.1 Professionnels migration `…_professionals_grid_client_price.sql`: `private.grid_client_price` (EXECUTE to no role) + pgTAP `095_…` (price in force at a date, none before the grid, title without grid → null).
- S2.2 RPCs (definer, permission first, French P0001 with HINT field): `create_service`, `update_service` (key and code immutable), `set_service_active`, `set_service_titles(p_service, p_title_ids[])`, `add_service_rate_variant`, `end_service_rate_variant`, `add_billing_policy` (closes the open period), `import_service_catalogue(p_rows jsonb, p_dry_run)` (service role; used by I1).
- S2.3 Read: `services_catalog`, `get_service_price`, `billing_policy_on`; pgTAP `096_services_rpcs.test.sql`: price per source (grid via S2.1, fixed, free), variants applied and dated, taxes left to Facturation (rule only), refusals.
- **Acceptance:** `get_service_price(10150, Psychologue, null, '2026-11-01')` returns the grid's 50-min client price (175 $ expected from the data); with `student` it returns 120 $; `10100` returns 37,83 $ taxable; `50400` returns `entered`; a duplicate code is refused in French on the right field.

**S3 — UI, docs, e2e (Lane A, Oct 15–16, 2 d)**
- S3.1 `src/modules/services/`: `manifest.ts` (no nav; one `settingsSections` entry), `index.ts`, `api/catalogue.ts` (Zod), `hooks/keys.ts` (`servicesKeys`), `schemas/service.ts`, i18n `modules.services.*` in `fr-CA.json`; add to `ALL_MODULES`.
- S3.2 Settings page (UI-4: section title is the H1): `SettingsCard` « Catalogue » (families as groups, codes shown, search, `ListStatusFilter`, row → `Sheet` editor with `FormField`s, titles multi-select, « Pause après », « Pour deux personnes »); card « Tarifs étudiant et réduit »; card « Politique d'annulation » (dated, shows the policy in force and upcoming); card « Prix » (read-only `DescriptionList` of grid prices per title and duration, link to Paramètres → Rémunération).
- S3.3 Vitest: api parsing, the editor's validation, the policy card's dated display; `manifest.test.tsx`.
- S3.4 Playwright `e2e/services.spec.ts`: admin enables the module, creates a service, sets a student rate, sees the price.
- S3.5 `docs/modules/services.md`, status doc lines, R- decisions confirmed or revised.
- **Acceptance:** the walkthrough at 1280 and 375 px; providers do not see the section (they have no settings access) but the catalogue reads work for them through the API.

### 5.4 Risks

- Grid prices differ from GOrendezvous's per-profession prices (visite §18 lists them) → the gap report during I1 compares grid vs observed, per profession and duration.
- A service whose titles have no grid prints « À confirmer »; Facturation refuses to invoice it with a clear message.

---

## 6. Clients (`clients`) — full task detail

**Routes:** `/clients` (list), `/clients/:id/:onglet?` (record); nav « Clients » (`clients.view`); provider sees « Mes clients » (`clients.self`). **Depends on:** `professionals`. **Lane A Oct 19–30; C5 in lane B Oct 29–Nov 3.**

### 6.1 Keep / Change / Drop

| Item | Source | Mark | How |
|---|---|---|---|
| List filters (status, search, primary pro, tags), sort, column picker, deep link | §B, visite §2 | Keep | Filters in the URL, remembered per user (`user_preferences`, like Professionnels) |
| New client form in sections + Google address | §B | Keep | `AddressAutocomplete` + `addressAutofill` |
| Duplicate detection (HIGH blocks, MEDIUM confirms) | §B | Keep | Moved to SQL (`find_client_duplicates`), identity first (PS Hub ADR 0033) |
| Duplicate merge | visite §2 | **Add** | `merge_clients`, audited, reversible report |
| Fields: first / last name, sex, birthday, email, mobile / home / work + ext, language, reminders yes/no | §B, visite §2 | Keep | E.164 phones |
| Birth first name, pronouns (8), time zone | visite §2 | Keep | Optional fields |
| « Référé par », custom field, primary pro, notes | visite §2, §B | Keep | « Notes administratives » card |
| Referral source (« Comment avez-vous entendu parler de MANA ? ») | business context §3 | Add | Reference list |
| Relations with inverse types; main contact; **3 rights** | §B, visite §2 | Keep + Change | Rights per direction |
| Guardian `responsible_client_id` (display only) | §B | Change | A relation with the rights replaces it |
| Primary and secondary insurance | visite §2 | Keep | `client_insurances` |
| TELUS eRéclamations consents, RAMQ number | visite §2 | Drop (Jonathan's OK) | Question 14 |
| Tags (max 5, satisfaction tags, rates, payers…) | visite §2 | Change | Useful ones become fields; ≤ 5 free tags |
| Signed, versioned consents | visite §2, §15 | Keep | C5, core signing |
| Visits & payments, receipts | visite §2 | Keep | Tabs filled by Rendez-vous and Facturation |
| Provider visibility (created, seen / to see, primary) | visite §2 | Keep | `client_professional_links` |
| Delete with first name + password | visite §2 | Change | `clients.privacy` + confirmation; anonymisation (Loi 25) |
| Archive, `CLI-` number, history | §B | Keep | `client_number` sequence |
| Client balance trigger | §B | Change | Read from Facturation's published view |
| Half-built items (notes, tags, consents never saved; fake ids; `.or()` search) | §B | Fixed | — |

### 6.2 Data model

- `clients` (`org_id`, `client_number` (sequence per org), `first_name`, `last_name`, `birth_first_name`, `pronouns`, `sex` (`female` / `male` / `other`), `birthday` date, `email`, `email_normalized`, `mobile_e164`, `home_e164`, `work_e164`, `work_ext`, `language` (`fr` / `en`), `time_zone`, `email_reminders` bool, address columns, `referral_source_id`, `referred_by` text, `custom_field`, `primary_professional_id`, fields from tags (`rate_variant` (`student` / `reduced`), `is_banned`, `file_incomplete`, `payment_plan`, `custom_billing`, `tax_exempt_status`), `admin_notes`, `archived_at`, `anonymized_at`, `external_ref`). Audit redacts names, birthday, contacts, address, notes.
- `client_relations` (pair stored once `client_a_id < client_b_id`, `type_a_to_b`, `type_b_to_a`, `is_main_contact_*`, rights per direction: `can_manage_appointments`, `receives_communications`, `receives_invoices`).
- `client_insurances` (`client_id`, `rank` 1 / 2, `insurer`, `policy_number`, `certificate_number`, `relation`, `holder_name`; redacted).
- `client_payers` (`client_id`, `kind` (`pae` / `ivac` / `employer`), `organisation_name`, `file_number`, `expires_on`, `coverage` jsonb; unique active per kind) — Facturation reads it through a published view.
- `client_tags` (≤ 5 per client, trigger), `referral_sources` (seeded with the website's list), `client_professional_links` (`client_id`, `professional_id`, `reason` (`created` / `appointment` / `primary` / `demande`), first and last seen), `client_merges` (kept id, merged id, by, at, moved counts).
- **RLS:** staff read with `clients.view`; provider reads rows linked to `private.current_professional_id()` through `client_professional_links` and only the columns of the view `my_clients` (no admin notes, no insurance); writes via RPCs.
- **Published:** `clients_directory` (invoker), `search_clients(p_query, p_limit)` (definer, `clients.view` or `clients.self`), `get_client_summary(id)`, `client_payers_active` (for Facturation), `private.clients_link_professional(client, pro, reason)` (for Rendez-vous and Demandes), `private.client_contacts_for(client, right)` (who receives communications or invoices), `private.import_client(jsonb, dry_run)` (I1).

### 6.3 Batches and tasks

**C1 — schema (Lane A, Oct 19–21, 3 d)**
- C1.1 pgTAP `097_clients_module.test.sql` first (grants, RLS per role including a provider with and without a link, another clinic, audit redaction, relation ordering trigger, ≤ 5 tags, one active payer per kind).
- C1.2 Migration `…_clients_module.sql`: module rows and permissions, tables above, sequence, `referral_sources` seed, relation ordering trigger (swap ids and types), indexes on FKs and on `email_normalized`, phone columns, `lower(last_name)`.
- C1.3 Professionnels migration: FK `professional_client_agreements.client_id → clients` (the module doc says `client_id` waits for Clients); pgTAP.
- C1.4 Add the encrypted-columns note: none here (no PII under ADR 0004 rules), but names are redacted in audit.
- **Acceptance:** invariants green; a provider without a link reads nothing.

**C2 — RPCs (Lane A, Oct 22–23, 2 d)**
- C2.1 `find_client_duplicates(p_email, p_phone, p_first, p_last, p_birthday, p_exclude)` → rows with level (`high` / `medium`) and reasons (port of §B's algorithm: normalisation, similarity, last-10 / last-7 phone digits), pgTAP with the §B cases.
- C2.2 `create_client(p jsonb, p_confirm_medium bool)` (refuses HIGH, MEDIUM needs confirmation), `update_client`, `archive_client`, `unarchive_client`, `set_client_relation`, `remove_client_relation`, `upsert_client_insurance`, `set_client_payer`, `set_client_tags`.
- C2.3 `merge_clients(p_keep, p_merge)` (`clients.merge`): moves relations, insurances, payers, tags, links, and calls the published `private.<module>_reassign_client(old, new)` hooks of modules that exist (none yet; Rendez-vous, Facturation, Demandes add theirs), writes `client_merges`, archives the merged row.
- C2.4 `search_clients`, `get_client_summary`, `export_client_privacy(id)` (JSON for the Loi 25 PDF), `anonymize_client(id)` (`clients.privacy`; blanks identity, keeps ids and amounts).
- **Acceptance:** pgTAP `098_clients_rpcs.test.sql`; HIGH duplicate refused with HINT `duplicate`; merge leaves no orphan.

**C3 — list, creation, record (Lane A, Oct 26–28, 3 d)**
- C3.1 `src/modules/clients/` skeleton, manifest (nav « Clients », routes, `search` provider « Clients » → `search_clients`, `audit` loader), `hooks/keys.ts` (`clientsKeys`), api with Zod.
- C3.2 List page: `ClientsTable` (columns, picker, archived dimmed), filters in the URL (`useClientsFilters` modelled on `useProfessionalsFilters`), remembered filters.
- C3.3 « Nouveau client » dialog: sections Identité, Coordonnées, Adresse, Notes administratives; live duplicate panel (debounce 400 ms, « Ouvrir le dossier existant »); MEDIUM confirm checkbox.
- C3.4 Record page `/clients/:id/:onglet`: header (name, pronouns, number, status, tags), `RecordTabs` with real Radix tabs: « Aperçu », « Informations » (editable sections: Identité, Coordonnées, Adresse, Notes administratives, Préférences), « Proches » (relations with the 3 rights), « Assurance et payeurs », « Visites et paiements » (placeholder `EmptyState` until R5 / F2), « Consentements » (C5), « Historique » (audit labels); UI-2 / UI-3 / UI-5.
- **Acceptance:** keyboard path through the form in visual order; 375 px; « Mes clients » for a provider lists only linked clients.

**C4 — merge, Loi 25, docs (Lane A, Oct 29–30, 2 d)**
- C4.1 « Fusionner » flow from the duplicate panel and the record menu (side-by-side choice of values, confirmation listing what moves).
- C4.2 « Confidentialité » menu (`clients.privacy`): « Exporter le dossier (PDF) » rendered in the browser with the fiche's react-pdf base, « Anonymiser » with typed confirmation.
- C4.3 Playwright `e2e/clients.spec.ts` (create with duplicate warning, add a relation with rights, merge); Vitest for duplicate panel, relation rights, filters.
- C4.4 `docs/modules/clients.md`; Keep / Change / Drop table copied there.

**C5 — consents (Lane B, Oct 29–Nov 3, 4 d)**
- C5.1 Seven document templates (module `clients`, `view_permission` `clients.view`, `edit_permission` `clients.manage`) with placeholder text until Christine's: general (« Consentement général »), waiting list, file transfer, intern in psychotherapy, coaching, naturopathy, external PAE; signer roles `client` (and `clinic` where needed).
- C5.2 `client_consent_requirements` (template key per service or payer kind, `once` / `each_time`); `services.requires_consent_template_key` used.
- C5.3 Function `clients-consent-send` (user, `clients.manage`): `prepare_client_consent` (service role, `p_actor`), **14-year rule**: a client under 14 → the signer is a relation with `can_manage_appointments`, else refused in French; `createSignatureRequest` with an idempotency key; email via Documenso.
- C5.4 « Consentements » tab: per template, latest version signed, date, signer, « Envoyer pour signature », « Renvoyer »; view `client_consents_status` from `list_subject_signature_requests` plus imported facts (`client_consent_facts`, I1).
- **Acceptance:** a 13-year-old's consent goes to the parent; a published new version marks clients « À signer de nouveau » only for that template.

### 6.4 Risks

- ~7 400 clients: list and search need indexes and keyset paging from C1 (no `.or()` text search).
- Duplicates in the GOrendezvous export (no merge there): I1's report may be long; merge UI must be fast.
- Provider visibility depends on links fed by Rendez-vous and the import: backfill in I2.

---

## 7. Rendez-vous (`appointments`) — batches

**Routes:** `/agenda` (staff; all pros, a service's pros, one pro), `/agenda/disponibilites` (availability edit mode), `/mon-agenda` (provider), public `/rendez-vous/action` (client links). **Depends on:** `clients`, `services`, `professionals`.

**Keep / Change / Drop (summary; full table in `docs/modules/appointments.md` at R1):** Keep — §E views, blocks, editor, cancellation with reason, « Client absent », deep link, audit; visite §1 views (Jour, Semaine, Prochains jours, Mois), all pros / service / one pro, availability edit mode with recurring default schedule, exceptions (Jour férié, Vacances, Autre), visible-to-clients and overflow flags, services per block, « Deuxième personne », participant presence, states (pending acceptance, reminder sent, confirmed by client, present / absent, cancelled, kept on schedule, deleted), cancellation reasons (minus COVID-19), « garder à l'horaire », recurrence weekly or every 2–12 weeks with conflict check, personal appointments, work appointments, Zoom per pro, « Démarrer ». Change — clinic time everywhere, DB-enforced booking rules, « Raison / Notes » split into internal note + client message, `completed` set by a job, one account per counselor. Drop (Jonathan's OK) — rooms, equipment, group classes, physical locations, health forms, « Lumino Santé » print, inventory.

**Data model:** `availability_rules` (pro, weekday, local start / end, services allowed, visible to clients, overflow allowed, valid from / to), `availability_exceptions` (pro, kind, local range, label), `appointment_series` (rule, interval 1–12 weeks, weekdays, count or until, `ignored_conflicts`), `appointments` (pro, service, `starts_at` / `ends_at`, mode, state, series, cancel reason / details / at / by, `kept_on_schedule`, `internal_note`, `client_message`, `is_personal`, `is_work`, `video_url` / `video_external_id` / `video_status` (`ready` / `pending` / `failed`), `external_ref`; exclusion constraint on `tstzrange` per pro over active states, including `buffer_after_minutes`), `appointment_participants` (client, role, presence, confirmed at), `cancellation_reasons` (seeded), `appointment_reminders` (channel `email`, due at, sent at, status; unique per appointment and kind), `video_connections` (one Zoom account per professional: Zoom user id and email, state `connected` / `needs_reconnect` / `disconnected`, encrypted access and refresh tokens via `private.encrypt_pii`, listed in `private.pii_encrypted_values()`, expiry, connected at), `video_tasks` (queue: create, update, delete a Zoom meeting; attempts, last error code). RLS: staff `appointments.view`; provider own rows (`current_professional_id()`) and other pros' busy blocks only (« Occupé », no client); personal appointments private. **Published:** `get_open_slots`, `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)`, `private.appointments_reassign_client(old, new)`; calls `private.clients_link_professional`.

**Functions and jobs:** `appointments-reminders` (job `appointments.reminders`, `local_hour` 6: appointments **one business day ahead** — Friday for Monday, as GOrendezvous's real setting (visite §18) — not yet reminded, email template `appointments.reminder`, confirmation link); SQL job `appointments.mark_completed` (hourly: past active appointments → completed unless presence says absent); secure-link purposes `appointment_confirm` (v1) and `appointment_change` / `appointment_cancel` (seeded but **disabled by default**: the data shows « clients must call to cancel, at any time » for almost every pro; a clinic or per-pro setting enables them, and under 24 h the page says « Pour annuler à moins de 24 h, appelez la clinique au … »); view `appointments_without_reminder` (« Clients sans rappel »: upcoming appointments whose client has no email or a bounced one, for the counselors to phone while SMS is deferred); `zoom-connect`, `zoom-callback`, `zoom-disconnect` (user, `appointments.self` for one's own account), `zoom-deauthorize` (webhook, signature), job `appointments.video_sync` (function `appointments-video-sync` draining `video_tasks`, every 5 min and right after a booking), job `appointments.zoom_token_refresh` (hourly, refreshes tokens expiring within the hour, marks `needs_reconnect` on failure and notifies), email template `appointments.video_link` (« Votre lien de rencontre »); email templates `appointments.confirmation`, `.reminder`, `.changed`, `.cancelled`, `.proposal` (fr / en by client language).

**UI:** agenda (port of PS Hub's grid with clinic-time placement and overlap range filter; Pointer Events drag at 15 min, click to create at the service's duration), editor `Sheet` with tabs Participants / Facturation / Notes / Actions / Historique (in-sheet tabs out of the tab order), availability mode with « J'ai terminé », « Je suis en vacances toute la semaine », copy week; « Mon agenda » for providers; client record « Visites et paiements » tab (R5); public action page.

| Batch | Goal | Areas | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|---|
| R1 | Schema + booking RPCs (`set_availability_rule`, `add_exception`, `book_appointment`, `move_appointment`, `set_presence`, `cancel_appointment`, `get_open_slots`) | migrations, pgTAP `099_…` | overlaps refused, DST weekends (two Sundays), buffer, provider limits | booking outside availability refused in French; 50-min session takes 60 min | 5 d | A, Nov 2–6 |
| R2 | Agenda UI + availability mode | `src/modules/appointments/` pages, grid components | Vitest grid placement at DST, drag snapping; Playwright book + move | 4 views, all pros / one pro, keyboard reachable view switch | 5 d | A, Nov 9–13 |
| R3 | Recurrence, states, cancellations, personal appointments, `mark_completed` job | migration, RPCs `create_series`, `cancel_series_from` | conflicts listed then skipped or refused; late cancel flags fee | series every 2 weeks × 10 with 1 conflict shown | 4 d | A, Nov 16–19 |
| R4 | Reminders (J-1, weekend skipped) + confirmation link + confirmation / change / cancellation emails + « Clients sans rappel » view | function `appointments-reminders`, link purposes, templates | Deno tests: business-day rule, idempotency, cancel link disabled by default, under-24 h page when enabled | Monday appointment reminded Friday 6:00 clinic time; the email says to call to cancel | 4 d | A, Nov 20–25 |
| R5 | « Mon agenda », client visits tab, publications for Demandes and Facturation, `appointments.spec.ts` | pages, views | Playwright provider path | provider sees others as « Occupé » only | 2 d | A, Nov 26–27 |
| RZ | Zoom per professional (decided by Jonathan): connect, staff visibility, token refresh, links per appointment, not-connected warning, disconnect / reconnect | `zoom-*` functions, `appointments-video-sync`, `video_connections`, `video_tasks`, « Vidéoconférence » card in « Mon agenda » (the provider portal page Rendez-vous owns; « Mon profil » belongs to Professionnels), settings section « Vidéoconférence » (`appointments.view`: every professional with Connecté / Non connecté / À reconnecter, filter, « Relancer » email) and a dot in the agenda's professional picker | Deno: signed state, revoke on disconnect, deauthorize webhook signature, refresh failure → `needs_reconnect`, token never returned; pgTAP: provider manages only their own connection | « Démarrer » opens the per-appointment link; move updates it; cancel deletes it; booking video with an unconnected pro shows the warning and still books | 6 d | B, Nov 26–Dec 3 |
| R6 | Google busy / free for professionals who want it (after cutover) | `google-*` functions, `calendar_connections`, `external_busy_blocks` | as Gmail | busy shown « Occupé », never a title | 3 d | A, Feb |

**RZ tasks (connection flow):**
- RZ.1 Spike (day 1): Zoom app type and scopes; whether accounts outside the clinic's Zoom account need a published app (roadmap question 41); Jonathan creates the developer app and pastes the client id and secret as function secrets.
- RZ.2 Migration: `video_connections`, `video_tasks`, `appointments.video_*`; `private.pii_encrypted_values()` extended; pgTAP (owner-only writes through RPCs, staff read state but never tokens, encrypted columns listed).
- RZ.3 `zoom-connect` (returns the authorize URL with the signed state) and `zoom-callback` (verifies state, exchanges the code, stores tokens through a service-role RPC, redirects to `APP_URL/mon-agenda?onglet=video`); `zoom-disconnect` (revokes at Zoom, clears tokens, marks future appointments `pending`); `zoom-deauthorize` webhook.
- RZ.4 `appointments-video-sync` (create / update / delete meeting titled « Rendez-vous MANA », stores the join URL, retries with backoff, `failed` after 3 attempts with « Réessayer »); on (re)connection, queues the professional's future video appointments and emails the clients « Votre lien de rencontre ».
- RZ.5 `appointments.zoom_token_refresh` job; notice `appointments.zoom_reconnect` (important) to the professional and `appointments.manage` holders.
- RZ.6 UI: « Vidéoconférence » card (« Connecter mon Zoom », « Connecté : … depuis le … », « Déconnecter », « Reconnecter »); the editor's warning « Ce professionnel n'a pas connecté son Zoom : le client recevra le lien plus tard. »; settings section « Vidéoconférence » (list of professionals with their Zoom state, filter, « Relancer »; Rendez-vous owns it, so Professionnels is untouched) and a dot in the agenda's professional picker; report « Professionnels prêts pour la bascule ».

**Risks:** DST and range bugs (PS Hub had both) → tests at both 2027 change dates; Zoom app publication (roadmap question 41) → RZ starts with a spike, and the cutover keeps the GOrendezvous Zoom links already sent; email volume (~650–1 000 appointments a month → about 100 confirmations and reminders a day) stays well under the core cap of 500 per clinic per day, invoices and receipts included (~40 a day).

---

## 8. Facturation (`billing`) — batches

**Routes:** `/facturation/:onglet?` (« Factures », « Paiements », « À rapprocher », « Revenus »), `/facturation/factures/:id`, `/mes-recus` (provider). **Depends on:** `appointments`, `clients`, `services`.

**Keep / Change / Drop (summary):** Keep — §F lines, TPS / TVQ per line, statuses, payment methods, file-opening fee, cancellation fee, IVAC flat rate, PAE rules, invoice numbering; visite §5 invoice → payment → receipt, several lines per invoice, couple split with a receipt per person, `AAAA-N` numbering, payment modes ↔ QuickBooks accounts, annual statement, receipt template per pro (title, order, licence, signature). Change — dated taxes stored on the invoice, receipt sent when payment is recorded, automatic cancellation fees from the two-tier policy (confirm mode first), credit notes instead of cancelling paid or multi-line invoices, server-side PDF (pdfmake, ADR 0008). Drop (Jonathan's OK) — TELUS eRéclamations, gift / loyalty / visit cards, Stripe deposits per service, Square, PayPal, Accès D (unless used), « seulement TPS » (accountant).

**Payer model, « Facturé à » (decided by Jonathan, 2026-10-11; roadmap §2.6 bis):** the **client** is the person served (the dossier); the **payer** is the client (default), a related person holding the relation right `receives_invoices` (parent, guardian), or an organisation (PAE, IVAC, employer; FP). Each dossier has a dated default payer (or two payers with shares, e.g. separated parents 50 / 50), overridable per appointment, series or invoice. The invoice is addressed to the payer; the receipt names **both** the person served and the payer, plus the professional's name, profession, order and licence, date, duration, service, amount paid, receipt number, clinic address (insurer conventions to verify with Rachel during F2). **QuickBooks:** payer = parent customer; **one sub-customer per (payer, dossier) pair** with `Job = true`, `ParentRef`, `BillWithParent = true`; a payer change creates a new pair (never re-parent: QBO would move the old history under the new payer); display name « N° de dossier · Prénom N. », no health data; existing GOrendezvous-made QBO customers are **matched, never duplicated** (FQ mapping step). Couples: a split invoice = two invoices, two payers; one payer for a family = one parent with a sub-customer per member.

**Data model:** `invoices` (`number` `AAAA-N` from `invoice_sequences` (org, year, last), `client_id` (dossier), `payer_kind` (`self` / `person` / `organisation`), `payer_client_id` / `payer_organisation_id`, `payer_share_percent`, status, issued at, due at, totals, tax rates applied, `source_type` / `source_id` (appointment, waitlist registration…), `external_ref`), `billing_payer_defaults` (dossier → payer(s) and shares, dated), `billing_payer_overrides` (appointment or series → payer), a check refusing a `person` payer without the `receives_invoices` right on that dossier (`private.client_contacts_for`), `invoice_lines` (appointment, service code, description, quantity, unit, discount, TPS, TVQ, `line_type` (`service` / `cancellation_fee` / `file_opening` / `adjustment`)), `credit_notes`, `payments` (mode, amount, at, reference, `stripe_payment_intent`, `interac_reference`, reconciled by), `refunds` (payment, amount, at, reason; 24 in 2026), `payment_modes` (label, `qbo_payment_method`, `qbo_account_ref`, active; seeded from GOrendezvous's live map, visite §18: Interac → « Virement bancaire à recevoir », Stripe / carte → « Banque Stripe », Virement bancaire and Chèque → « Compte courant », Note de crédit → « Compte courant »; « Comptant (GOrendezvous) » inactive, « Compte courant », for the imported history only; Accès D, PayPal, Square, Assurance, « seulement TPS », gift and loyalty cards not seeded), `receipts` (number, invoice, person, amount paid, file id), `statements` (client, year, file id), `payer_invoices` (FP), `qbo_connection` (encrypted tokens), `qbo_links` (payer → QBO parent customer; (payer, dossier) → QBO sub-customer; invoice / payment → QBO ids), `qbo_customer_matches` (GOrendezvous-made QBO customers ↔ our payers: `matched` / `to_decide` / `ignored`), `qbo_sync_queue`, `payment_provider_events`. RLS: `billing.view`; provider reads own receipts and payout lines (`billing.self`). **Published:** `client_balance(client)`, `billing_summary`, `revenue_by_invoice / _service / _payment` (for Rapports), `create_service_invoice(client, service, source_type, source_id)` (for the waitlist registration fee), `invoice_status(id)`, `private.billing_reassign_client`.

**Functions and jobs:** `billing-documents` (user: render invoice, receipt, statement PDFs; store via `register_system_file`; email via `sendTemplatedEmail` with templates `billing.invoice`, `billing.receipt`, `billing.statement`, attachment allowed), `billing-stripe-link` (user: Payment Link or Checkout Session per invoice), `stripe-webhook` (webhook: signature, `claim_webhook_event`, records payments), `qbo-connect` / `qbo-callback` (user, `billing.settings`), `qbo-sync` (job `billing.qbo_sync` every 15 min draining `qbo_sync_queue`; **paused flag** for the cutover), SQL job `billing.cancellation_fees` (hourly: late-cancelled or absent appointments → a **proposed** fee line the admin_assistant confirms or discards; `automatic` mode exists but ships off, since the data shows the signed policy was never applied: 605 cancellation lines in 2026, ~103 billed, typed amounts).

| Batch | Goal | Areas | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|---|
| F1 | Invoices, lines, payer model (defaults, overrides, shares), numbering `AAAA-N`, taxes, couple split, credit notes, `create_service_invoice` | migrations, RPCs `create_invoice(appointment_ids[])`, `set_default_payer`, `set_payer_override`, `split_invoice_for_two`, `finalize_invoice`, `issue_credit_note` | pgTAP money math (per-line rounding §F), sequence without gaps under concurrency, payer without the right refused, 50 / 50 split | a child's invoice goes to the parent, the receipt names both; couple: two invoices or one payer | 5 d | A, Nov 30–Dec 4 |
| F2 | Payments, receipts, statements, PDFs, emails, UI (Factures, Paiements, appointment « Facturation » tab, client « Visites et paiements ») | `billing-documents`, pages | Deno render tests (text read back), Vitest | receipt PDF names the pro's title, order and licence; sent on payment | 5 d | A, Dec 7–11 |
| F3 | Cancellation fees (policy, proposed mode), refunds, waitlist registration fee invoices (from Demandes' « Facturer l'inscription »), payout read for « Ma paie », `billing.spec.ts` | SQL job, views | pgTAP 1st late cancel 50 %, 2nd 100 %, line stays « proposée » until confirmed; refund reverses a payment; registration fee invoice without appointment (18,91 $ + taxes) | fee line proposed and confirmed by the admin_assistant; automatic mode off | 3 d | A, Dec 14–16 |
| FS | Stripe « PAYER » link + Interac reconciliation (« À rapprocher » list, match by amount and name, one click) | `billing-stripe-link`, `stripe-webhook` | webhook signature, idempotency, partial payments | paid by card → receipt within a minute | 4 d | B, Dec 7–10 |
| FQ | QuickBooks Online port with PS Hub's flaws fixed: payer parent customers, (payer, dossier) sub-customers billed with the parent, invoices and payments app → QBO, ids back; **mapping step** for the customers GOrendezvous created (read all QBO customers, match by email / name / GOrendezvous client number, report « à trancher », create nothing while a probable match exists) | `qbo-*`, queue, settings cards « QuickBooks » (mode ↔ account map) and « Correspondance des clients QuickBooks » | Deno: signed state, encrypted tokens, retry, pause, sub-customer creation, payer change → new pair, no duplicate on a probable match | an invoice for a child lands under the parent customer in the child's sub-customer, with the right accounts | 8 d | B, Dec 14–23 |
| FP | Third-party payers: PAE, IVAC, employers, batch invoices / statements, PAE consumption (§G algorithm) | migrations, UI « Payeurs » | pgTAP §G rules | monthly PAE statement per organisation | 6 d | A, Feb |

**Risks:** « Argent comptant » (4 955 payments, 632 k$ in 2026) is most likely Interac autodeposit recorded as cash (roadmap question 45): the history is imported as recorded, never reinterpreted; tax rounding vs GOrendezvous (compare 100 historical invoices in I3; 43,49 $ = 37,83 $ + 5 % + 9,975 %); invoice sequence continuity at cutover (start value set during the final import); Stripe account ownership (the clinic's existing account, keys pasted by Jonathan); QuickBooks duplicates if the push runs before go / no-go (paused flag) or if a GOrendezvous-made customer is not matched (mapping reviewed at T-14); receipt wording for insurers (sample of insurers checked in F2).

---

## 9. Importation GOrendezvous — batches

**No module key:** a terminal script `scripts/import-gorendezvous.mjs` (same safety model as `import-professionals.mjs`: local by default, typed project reference for a remote, credentials from `/dev/tty`, dry run by default) calling service-role RPCs each module publishes (`private.import_client`, `private.import_appointment`, `private.import_invoice`, `private.import_payment`, `private.import_consent_fact`), with staging tables `private.import_runs`, `private.import_rows` (raw row hash, target, status, message). Files stay in `~/Clinique-MANA-import/` (mode 700), never in git.

**Keep / Change / Drop:** Keep — clients, relations and insurances if exported, appointment history (from support), invoices and payments (Revenus export + QuickBooks), consent facts. Change — tags mapped to fields; ~900 pro-service pairs mapped to catalogue codes; employee profiles mapped to professionals by a reviewed CSV (`conseillère`, « Administration », « Z MATRICE » excluded). Change — the waitlist (GOrendezvous's own waitlist is empty, visite §18: the real one is the fake « Inscription – Liste attente psychologie et psychothérapie » appointments, 51 in 2026 at 21,74 $, and « LISTE ATTENTE À RAPPELER » at 0 $ in the « conseillère » agenda) becomes `waitlist_entries` through `private.import_waitlist_entry` (registration date = the fake appointment's or the entry's date; fee « paid » when an invoice exists; one entry per client and target); default payers derived from the export (« Payé par » on invoices) through `private.import_default_payer`. Drop — receipt and consent PDFs one by one, health forms (none).

| Batch | Goal | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|
| I1 | Script skeleton, mapping files (employees → professionals; the 28 catalogue codes and the legacy uncoded services → codes; 31 tags → fields, the duplicated « IVAC » and « Nouveau client » merged), clients dry run with the duplicate rules, report; **price gap report** grid vs GOrendezvous per profession | script unit tests (parsers, normalisers), pgTAP for `private.import_client` | report: counts (7 390 active, ~1 078 archived, 2 635 without primary pro), rejects with reasons, HIGH / MEDIUM duplicates | 5 d | B, Oct 28–Nov 3 |
| I2 | Appointments and waitlist dry run (history read-only, future active with their existing Zoom links, links backfilled, waitlist entries from the fake appointments; the 911 « Bureau administratif » visits of the conseillère account qualified as discovery calls, registrations or cancellations) | parsers for the support format | totals per month match GOrendezvous (8 635 visits in 2026); no future overlap left; waitlist count = fake registrations still open, deduplicated | 2 d | B, Dec 4 + 11 |
| I3 | Invoices and payments dry run with payers, reconciliation vs QuickBooks, QBO customer mapping report, runbook written | sums per month and mode | gaps listed and explained; every payer matched to a QBO customer or « à trancher » | 3 d | B, Dec 28–30 |
| I4 | Rehearsal and final import | — | §4 steps 3–5 | (in buffer) | A + B, Jan 4–10 |

**Risks:** the support export arrives late or in an unusual format (fallback: per-pro iCal feeds for future appointments only, or manual re-entry of ~3 weeks of future appointments on Jan 9–10); employee ↔ professional mapping errors (reviewed CSV, refused when ambiguous).

---

## 10. Demandes (`demandes`) — batches

**Routes:** `/demandes` (inbox), `/demandes/:id/:onglet?`, `/liste-attente`. **Depends on:** `clients`, `professionals`, `services`; uses `appointments` publications for proposals.

**Keep / Change / Drop (summary):** Keep — §C intake fields, participants, `DEM-AAAA-NNNN`; §D's rules as rewritten by Professionnels' 12 rules; the workbook's KPIs. Change — states from GOrendezvous's « Requêtes de service » (Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs; « Urgent » as a flag) mapped onto the workbook's events (sans réponse, proposée, confirmée, non pertinente); discovery calls and waiting list leave the fake « conseillère » appointments. Drop (Jonathan's OK) — PHQ-2 / GAD-2 screening (D8), the dormant legacy scorers, the browser AI schedule interpreter.

**Data model:** `demandes` (received at / by, channel, referral source, for whom, previous therapy, language, mode, availability, preferred pro gender, motifs, concerns, payer kind, insurer, `internal_note` (permission `demandes.notes`, never logged or notified), state, urgent flag, assigned conseillère, `DEM-` number), `demande_participants`, `demande_events`, `demande_tasks` (discovery call due, attempts), `demande_propositions` (pro, by, at, response, directory snapshot), `first_appointment_cancellations`, `capacity_snapshots`.

**Waitlist (Jonathan, 2026-10-11: « pour les psy souvent nous avons une liste d'attente, il faut incorporer ça aussi »; roadmap §2.3 bis).** A demande in state « Liste d'attente » carries one or two `waitlist_entries`: target `profession_title_id` (Psychologie, Psychothérapie, or any title) and / or `professional_id`; `priority` (`normal` / `priority` + reason), `registered_at` (order: priority then date; rank shown), criteria copied from the demande (availability periods and days, mode, language, motif ids, age band, preferred gender, payer), optional bridge professional, `state` (`incomplete` until the « liste d'attente » consent is signed and the fee paid or waived, then `active`, `to_call`, `offered`, `closed`), `fee_status` (`to_invoice` / `invoiced` / `paid` / `waived` + reason) and `fee_invoice_id`, `last_contact_at`, exit `reason` (`placed` / `referred_elsewhere` / `withdrew` / `no_answer` / `other`) and date, `external_ref`. `waitlist_contacts` (call, follow-up email, answer), `waitlist_offers` (slots offered, secure link, expires at, answer). Permission `demandes.waitlist` to manage; providers read entries targeting them (`demandes.self`, no internal note). Jobs: `demandes.waitlist_followup` (daily, `local_hour` 7: entries without contact for N weeks → `to_call`, bell notice to counselors; optional email `demandes.waitlist_still_waiting` with Oui / Non secure links (purpose `waitlist_confirm`); no answer in 14 days → « Sans réponse »). Slot freed (availability added, `new_client_places` raised, a series ended, a professional of the title activated) → notice `demandes.waitlist_slot_available`. Offer (part 2): `waitlist_offer` secure link valid 48 h with 1–3 slots, acceptance books through Rendez-vous's proposal RPC and closes the entry « Placé ». The fee: Services et tarifs' « Inscription liste d'attente »; « Facturer l'inscription » calls Facturation's published `create_service_invoice` (optional dependency on `billing`: hidden while Facturation is disabled, the fee stays « À facturer »). Published `waitlist_summary` (length per title and professional, average and median wait, entries and exits per month) for Rapports. **Realtime:** core hook `useOrgRealtime` (private broadcast channel per org, ids only; roadmap §3.1) built in D2, with a « Je m'en occupe » soft lock.

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| D1 | Schema (demandes, states, tasks, **waitlist tables**), RPCs (create, quick log, change state, assign, tasks), pgTAP | 4 d | B, Nov 4–9 |
| D2 | Inbox (age vs 24–48 h, « sans réponse », filters), quick log, record (Accueil, Participants, Suivi, Historique), core realtime hook | 5 d | B, Nov 10–16 |
| D3 | **Waitlist part 1:** registration from a demande (target, priority, criteria), « Liste d'attente » page per title / professional with rank and waiting time, consent sent (Clients C5 template « liste d'attente »), fee status and « Facturer l'inscription », follow-up job and notices, optional client email with Oui / Non links, exit with reason, offers noted by hand; Vitest + pgTAP (order, rank, state machine), Playwright `waitlist.spec.ts` | 5 d | B, Nov 17–23 |
| D3b | Discovery-call tasks, proposals with acceptance link (Rendez-vous `.proposal` template, pending state; GOrendezvous auto-accepts and has no expiry, so the 48-h hold is ours) | 2 d | B, Nov 24–25 |
| D3c | **Public discovery-call booking page** replacing Calendly (the website's « Réserver un appel découverte » points to calendly.com, visite §18): public function `demandes-book-call` (per-IP limit before any write, reCAPTCHA or Turnstile, counselor slots from a simple weekly rule, creates a « Nouvelle » demande with its call task, confirmation email, cancel link); the website button is repointed by Jonathan once live | 3 d | A, Dec 21–23 (first batch dropped if lane A slips: Calendly keeps working) |
| D4 | Matching panel (Professionnels' rules, documented order, « Bon à savoir », insurance notes) **and waitlist part 2**: « Place disponible » notice, compatible registrants in list order, « Offrir la plage » (48-h link, next on refusal or expiry) | 6 d | A, Jan 11–18 |
| D5 | Places left, capacity snapshots job, availability board | 3 d | A, Jan 19–21 |
| D6 | KPIs (activity and cohort rates, delays, cancellations, waitlist length and wait times) feeding Rapports | 3 d | A, Jan 22–26 |

**Risks:** the waitlist fee refund / credit rule unknown (roadmap question 34; amount confirmed at 18,91 $ + taxes); Calendly bookings made before D3c ships are copied by hand into Demandes (as today); state mapping disagreements (validate with the counselors in D2's walkthrough); realtime channel authorisation (pgTAP on `realtime.messages` policy).

---

## 11. Communications (`communications`) — batches

**Routes:** `/courriels` (inbox, threads, « À rattacher »), Paramètres → « Courriels Gmail » (`courriels-gmail`), « Rédaction IA » (`ia`). **Depends on:** core; `clients` for linking (optional dependency: linking hidden while Clients is disabled).

**Keep / Change / Drop:** Keep from PS Hub — Gmail history sync with lease lock and 404 / 410 fallback, Pub/Sub watch renewal, auto-linking order, optimistic actions, docked composer, TipTap, template pill, sandboxed HTML, MIME builder, AI bar « Accepter / Rejeter / Affiner », OpenAI Chat Completions. Change — every flaw listed in roadmap §2.4 bis (encrypted tokens via `private.encrypt_pii`, never returned; definer RPCs; signed `state`; no external URLs; attachments from `stored_files` only; required webhook secret / OIDC). Drop — open pixel, approval queue, writing-style learning, AI summaries of received mail, the Gmail / Resend dual route for one message.

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| CM1 | Module skeleton, `mail_connections` (encrypted tokens), `gmail-connect` / `gmail-callback` (signed state), `gmail-webhook` (required secret, per-IP hit, claim), `gmail-sync` + jobs `communications.gmail_sync`, `communications.gmail_watch_renew`, threads and messages tables with 24-month body purge job | 8 d | B, Oct 12–21 |
| CM2 | Inbox UI (three panes desktop, stacked on phone), actions via `gmail-modify`, attachments copied to storage, auto-linking to clients by identity, « À rattacher » | 5 d | B, Jan 11–15 (moved after the cutover for the waitlist) |
| CM3 | Composer (docked desktop, full screen phone), send from Gmail (`gmail-send`, attachments by file id), templates (core catalogue + personal), 5-s undo | 5 d | B, Jan 18–22 |
| CM4 | « Rédiger avec l'IA » (`communications-draft`, OpenAI, placeholders, `ai_requests`, limits, monthly cap) | 4 d | B, Jan 25–28 |

**Risks:** Google Workspace prerequisites (internal OAuth app, Pub/Sub topic: Jonathan creates them with go-ahead per step); Gmail volume of `info@` (first sync limited to 45 days); Loi 25 scope of synced bodies (roadmap question 30).

---

## 12. Rapports (`reports`) — batches

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| RP1 | « Revenus » by invoice / service / payment with filters and CSV export; « Annulations par raison »; « Clients à relancer » | 2 d | A, Dec 17–18 |
| RP2 | Intake KPIs (from D6), payouts, IVAC report (with CSV, disabled in legacy), places, waitlist (length per profession and professional, average and median wait, exits by reason) | 5 d | B, Feb 1–5 |

Reports read only published views through definer RPCs that check `reports.view` / `reports.finance` first; CSV built in the browser from the RPC result (no file stored).

---

## 13. Cross-cutting work owned by core

| Item | When | Owner batch |
|---|---|---|
| OAuth helpers in `_shared/` (`oauth-state.ts`: HMAC-signed state with nonce and 10-min expiry; `oauth-tokens.ts`: store / read through module service-role RPCs that use `private.encrypt_pii` / `decrypt_pii`) | CM1 | reused by RZ, FQ, R6 (Google busy) |
| `private.pii_encrypted_values()` extended for each token column | each batch adding one | CM1, RZ, FQ, R6 (Google busy) |
| Realtime: `useOrgRealtime` hook, `private.broadcast_change(module, table, id, op)` trigger helper, `realtime.messages` policy | D2 | Demandes, then Rendez-vous |
| Secure-link purposes for appointment actions (module rows, resolve / accept RPCs) | R4 | appointments |

---

## 14. Global risks

1. **The deadline:** two lanes at ~50–55 days each before Dec 29 leave two weeks of slack; any scope added before the cutover must replace something (§2's slip rule).
2. **External exports and accounts:** GOrendezvous support export, Stripe, QuickBooks, Zoom app, Google Workspace: each has a named owner and a date in §4.
3. **Data quality:** duplicates and per-pro prices in GOrendezvous; reports in I1–I3 before anything is written.
4. **Production is live:** every merge deploys; migrations additive; modules disabled until the cutover weekend; no production data writes except the final import with Jonathan's go-ahead.
5. **Staff change:** counselors move from a shared account (admin rights minus delete today, visite §18) and an agenda with fake appointments to Demandes and personal accounts: a one-page guide and a walkthrough during the buffer.
6. **SMS regression:** GOrendezvous sends ~165 SMS reminders a month today; at the cutover only email reminders exist. Mitigation in the plan: the « Clients sans rappel » view (R4) and a daily phone round; Twilio reminders brought forward only if Jonathan picks option (b) of roadmap question 43.
