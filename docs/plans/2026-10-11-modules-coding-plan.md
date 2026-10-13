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
| Clients | `clients` | `/clients`, `/clients/:id/:onglet?` | `professionals` | `clients.view` (A C J), `clients.manage` (A C J), `clients.merge` (A J), `clients.privacy` (A), `clients.self` (P) | A 10 d + C 5 d (consents) |
| Rendez-vous | `appointments` | `/agenda`, `/agenda/disponibilites`, `/mon-agenda`, public `/rendez-vous/action` | `clients`, `services`, `professionals` | `appointments.view` (A C J), `appointments.manage` (A C J), `appointments.self` (P), `appointments.settings` (A) | A 21 d + C 6 d (Zoom) |
| Facturation | `billing` | `/facturation/:onglet?`, `/facturation/factures/:id`, `/mes-recus` | `appointments`, `clients`, `services` | `billing.view` (A J), `billing.manage` (A J), `billing.settings` (A), `billing.self` (P) | A 19 d + B 8 d (QBO) + C 13 d (Stripe / Interac, payroll) |
| Demandes | `demandes` | `/demandes`, `/demandes/:id/:onglet?`, `/liste-attente` | `clients`, `professionals`, `services` | `demandes.view` (A C J), `demandes.manage` (A C), `demandes.notes` (A C), `demandes.stats` (A), `demandes.self` (P), `demandes.waitlist` (A C) | B 16 d (lot a) |
| Communications | `communications` | `/courriels`, Paramètres → `courriels-gmail`, `ia` | — (core) ; `clients` optional for linking | `communications.inbox` (A C J), `communications.send` (A C J), `communications.mailboxes_manage` (A), `communications.ai_draft` (A C J), `communications.sms` (A C J) | B 9 d (Gmail) + C 6 d (SMS) |
| Rapports | `reports` | `/rapports/:rapport?` | `billing`, `appointments` (later `demandes`) | `reports.view` (A), `reports.finance` (A J) | A 2 d |
| Import GOrendezvous | — (scripts + `private` RPCs in each module) | none | all of the above | service role / terminal only | C 5 d + B 5 d |

`clients` does not depend on `appointments`: the provider visibility rule (visite §2) is a `client_professional_links` table that `clients` owns and `appointments` feeds through `private.clients_link_professional(…)`.

---

## 2. Sequence and gates (three lanes), 2026-10-12 → cutover 2026-11-30

**Direction (Jonathan, 2026-10-12): « le plus rapide possible, sans couper sur la qualité ».** The earlier calendar spread ~130 agent-days over three months as if they were human working days. Agents work continuously and in parallel: a « 4–5 day » batch lands in one or two hours (Phase 4 took days; ~15 PRs merged on 2026-10-12). So this section replaces calendar weeks with **sequence and gates**. The batches, their order, dependencies, tests and reviews in §5–§12 are unchanged: that is the quality. The « Lane, dates » cells in those tables now mean **lane and sequence position only**; the calendar dates they still carry are superseded here.

**Targets:**
- **Code complete and merged: 2026-10-30** (every pre-cutover batch below, at the observed pace, with the reviews).
- **Clinic testing: November** (§2.4), on the import dry runs and two half-day sessions with Rachel and the counselors.
- **Cutover: Monday 2026-11-30** — December billing, the Dec 1 payroll summary and the January IVAC / PAE run happen in the new app. The « T-n » steps of §4 are counted from that date.
- **Fallback: Monday 2027-01-11.** **Hard limit: 2027-01-31** (GOrendezvous renewal), a limit, not the goal.
- **Partial cutover on Monday 2026-11-02, if the external items land early** (§2.3): « partial » = Demandes (a) with the waitlist and the discovery-call page, client consents, and Communications' Gmail sync go live for the counselors, **while GOrendezvous keeps the agenda, invoicing and reminders**; Rendez-vous and Facturation stay disabled until Nov 30. It needs the client import (I1) done for real, the 7 consent texts, and the Yeastar DID only if SMS confirmations are wanted for discovery calls (not required). No partial cutover of the agenda alone: reminders, invoices and the morning queue must move together.

### 2.1 The three lanes, as sequences

Each row: the batch, **its gate** (what must be merged before it starts) and what it unblocks. Every batch also passes the **quality gate** of §2.2. Lanes run in parallel; a lane waits at a gate, never skips it.

| Lane A (critical path) | Gate (merged before) | Unblocks |
|---|---|---|
| **S1** Services schema | `main` (Professionnels live) | S2 |
| **S2** Services RPCs + `private.grid_client_price` | S1 | S3, R1 price reads, F1 |
| **S3** Services UI, docs, e2e | S2 | — |
| **C1** Clients schema | S1 (module pattern) | C2, C5a, D1 |
| **C2** Clients RPCs (duplicates, merge, privacy) | C1 | C3, I1 |
| **C3** Clients list, creation, record | C2 | C4, R2 (client picker) |
| **C4** Merge UI, Loi 25, ⌘K, docs | C3 | — |
| **R1** Agenda schema + booking RPCs (balance hook stub) | C2, S2 | R2, RZ, D3b, I2 |
| **R2** Agenda UI + availability mode | R1, C3 | R3 |
| **R3** Recurrence, states, cancellations, `mark_completed` | R2 | R4 |
| **R4** Reminders (email + SMS), confirmation link, fixed video link, « Clients sans rappel » | R3, SM | R5, F2 (completed sessions) |
| **R5** « Mon agenda » (video card, fee stub), client visits tab, publications | R4 | F3 (fee decision), D4 |
| **F1** Invoices, lines, payer model, numbering, taxes | R5, C2 | F2, FS, FQ push, FPay wiring |
| **F2** Morning queue, receipts, statements, supervisor | F1, CM1 (Interac feed optional) | F3, RP1, I3 |
| **F3** Dunning, balance rule, fee decided by the pro, refunds, registration fee | F2 | FPay final wiring, I3 |

| Lane B (intake, import, integrations) | Gate | Unblocks |
|---|---|---|
| **CM1** Gmail: `info@` + `administration@` sync, Interac notice parsing, status screen | `main` | FS (Interac feed), CM2 (after cutover) |
| **D1** Demandes schema, states, waitlist tables | C1 | D2, D3c |
| **D2** Inbox, intake, record, realtime hook | D1, C3 | D3 |
| **D3** Waitlist part 1 | D2, C5a (consent « liste d'attente »), S2 (fee service) | D3b, I2 (waitlist import) |
| **D3b** Discovery-call tasks, proposals with acceptance link | D3, R1 | D4 (after cutover) |
| **FQ** QuickBooks: connection, customer mapping, sub-customers; then the invoice and payment push | connection part: C2; push part: F1 | I3, FPay (bills by specialty) |
| **I2** Appointments + waitlist dry run | R3, D3, the support export | I3, rehearsal |
| **I3** Billing dry run, QBO mapping report, cutover runbook written | F3, FQ, I2 | rehearsal |

| Lane C | Gate | Unblocks |
|---|---|---|
| **SM** SMS through the Yeastar P-Series OpenAPI as PS Hub (Jonathan, 2026-10-12): send by DID, consents, « ARRÊT », « OUI », threads view | `main`; the PBX access (own PBX or a dedicated DID on PS's, roadmap question 53) for the real send test (a fake PBX locally until then) | R4 |
| **C5a** Client consents part 1 | C1 (and C2 for the relations rights) | D3, R4 flag, I1 (consent facts) |
| **I1** Import tooling, clients dry run, price gap report | C2, S2 | I2, D3c (real clients), partial cutover |
| **D3c** Public discovery-call page with source tracking | D1, I1 (for a real test) | partial cutover |
| **RZ** Zoom per professional | R1 | R5 video card (fixed link needs nothing) |
| **FPay** Payroll periods, rules, « Ma paie » | R3 (completed sessions), Professionnels compensation RPC; fee wiring after F3 | first summary Dec 1 |
| **FS** Stripe cards on file + next-day charge + link; Interac reconciliation | F1, CM1 | I3 |
| **RP1** Revenus + cancellations reports | F2 | — |

**After the cutover, in the same lanes:** C5b (consents part 2), FP (IVAC / PAE, gate F3; needed before the January IVAC run and the April PAE closing), D4–D6 (gate D3b, R5), R6 (Google busy), CM2–CM4 (gate CM1, C3), RP2 (gate D6, FPay), SMS two-way conversations.

### 2.2 Quality gate, every batch

Unchanged from §0; restated as the gate each PR must pass before merge:
1. **pgTAP first** for every migration (grants with `function_privs_are`, RLS per role and per clinic, RPC refusals in French, audit rows), `000_invariants` green; `db:reset`, `db:test`, `db:types` under the DB lock.
2. **Function tests** (Deno) for every edge function: auth and module gate, signatures, idempotency, no PII in logs; `check:functions`, `lint:functions`, `deno fmt --check`.
3. **Vitest** for api parsing, schemas, components and hooks; `typecheck`, `lint`, `lint:supabase`, `lint:migrations`, `build`.
4. **Playwright** on the repeatable path of the batch (one spec per module, extended per batch).
5. **Screenshots at three widths** (375, 1024, 1280) for every batch with a new or changed screen, attached to the PR, checked against the design system and UI-1…UI-5.
6. **One review per batch** (a reviewer agent, then Jonathan's merge); a full review before the last batch of a module.
7. **No merge with CI red**; a red CI is fixed in the same PR, never bypassed.
8. Docs: `docs/modules/<name>.md` and the status doc's lines updated in the batch.

### 2.3 External constraints: the real calendar

These are the only items on a human calendar. All start **now** (2026-10-12).

| Item | Owner | Lead time | Needed by | Fallback |
|---|---|---|---|---|
| GOrendezvous appointment-history export (and receipts / consents in bulk) | Christine with GOrendezvous support | unknown: ask today, chase weekly | I2 (mid-October for a first file; final file at the freeze) | future appointments re-entered by hand on the cutover weekend; history imported later |
| Yeastar PBX access for SMS (as PS Hub): own PBX or a dedicated DID on PS's PBX (roadmap question 53); on it an OpenAPI application (client id and secret), a webhook secret, an SMS-capable DID (cellular trunk or SIP provider with SMS) and its prefix; a processing agreement between PS and the clinic if the DID is on PS's PBX (Loi 25) | Jonathan | dedicated DID on PS's PBX: a day; own PBX and DID: 1–3 weeks | SM real send test (Oct 19); reminders at the cutover | email reminders only until the DID is live |
| Google Cloud OAuth app « Interne » + Pub/Sub topic for Gmail | Jonathan | hours | CM1 real test | sync by polling until Pub/Sub exists |
| Zoom app (per-professional OAuth may require publication for accounts outside the clinic's) | Jonathan (developer account), Zoom review | weeks if publication is required | RZ | **the fixed personal link works for everyone from day one**; Zoom OAuth is an enhancement that can land after the cutover |
| The 7 consent texts in fr and en, and Christine's remaining answers (questions 20, 47–49, 51) | Christine | her time; ask this week | C5a publish, partial cutover | drafts published as « Texte à faire valider », nothing sent to clients until she approves |
| QuickBooks access (OAuth app on the clinic's Intuit account, accountant's chart of accounts) | Jonathan, Christine, the accountant | days | FQ real test (late October) | push paused; the mapping report from the sandbox company |
| Stripe account (existing), keys, card-on-file consent wording | Jonathan, Christine | days | FS | payment link only |
| Professionals connect their video link (Zoom or fixed) | each professional, chased by the clinic | 2 weeks of reminders | T-14 (Nov 16) | the clinic enters the fixed link for them |
| Clients re-enter their card at Stripe | clients, invited by email | 2–3 weeks | T-14 (Nov 16) | payment link or Interac meanwhile |
| Testing sessions: a half-day on billing with Rachel; a half-day on agenda + demandes with the counselors | Christine schedules | book now | Nov 9–13 and Nov 16–20 | — |
| Interac notice samples from `administration@` (bank email format) | Rachel | a day | FS parser | manual matching |

### 2.4 Clinic testing plan (November)

- **Where:** **production, with the new modules enabled only for the testers** (a « Modules » switch per clinic exists; a per-user visibility flag is added in C1 so a module can be on for named testers and off for everyone else), on real imported clients from the dry runs. A separate staging copy was considered and rejected: the clinic has one Supabase project, the import must be rehearsed against the real QuickBooks customers, and a second environment would double the secrets to manage. Test invoices, payments and emails go to the clinic's own test addresses and a Stripe test mode key until the go / no-go.
- **Checklists per role** (written in I3 as `docs/runbooks/gorendezvous-cutover.md` §Tests, one page each):
  - **Adjointe (Rachel):** morning queue on yesterday's test sessions, hold on an « Entente particulière », send one and all, credit note and corrected invoice, Interac notice matched, card charged next day in test mode, receipt received, dunning steps, balance refusal and override, payer chosen per invoice, intern receipt with the supervisor, QuickBooks sub-customer and accounts, payroll period validated and a professional invoice attached.
  - **Conseillère:** a demande from the discovery-call page with its source, quick log, waitlist registration (consent, fee), proposal with the acceptance link, booking inside availability, a client under 14 (consent to the parent), reminders received by email and SMS at the right time, « OUI » by SMS, a late cancellation with the fee decided by the pro.
  - **Professionnel:** « Mon agenda », availability rules and a vacation exception, video link (fixed link saved, Zoom connected if available), « Démarrer », presence marked, fee decision, « Ma paie » validation.
- **Import dry runs:** clients (I1) as soon as the export is in hand; appointments and waitlist (I2) as soon as support's file arrives; billing and the QBO mapping (I3) after F3; each with its report reviewed by Christine and Rachel.
- **Rehearsal (Nov 23–25):** full dry run on production, full import into the local stack, the three checklists run end to end, go / no-go criteria of §4 checked on Thu Nov 26.
- **Go / no-go criteria:** §4 (unchanged); plus « the two half-day sessions found no open blocker ».

---

## 3. Decisions to answer before each module starts

Numbers refer to the roadmap's §4 questions. Defaults (the recommendation) are used if Jonathan has not answered when the batch starts, and recorded as R- decisions.

| Before | Questions | Default if unanswered |
|---|---|---|
| S1 (Oct 12) | 10 drops, 11 student / reduced rates (who decides), 23 cancellation policy, 6 buffer after 50 min (9 price source answered by the data: per profession → grid; 46 taxes answered by Christine: list confirmed; 23 answered: the professional decides the fee) | drops as proposed; dated per-service discount; 10 min « pause après » |
| C1 (Oct 19) | 12 visibility rule, 13 tags → fields, 14 RAMQ, 15 consents | GOrendezvous rule; fields as listed; no RAMQ; facts imported, 7 templates recreated fr / en |
| C5a (Oct 22) | 47 optional yes / no clauses, 48 re-sign population at a new version, 49 retention | clauses as Christine lists them (none until then); « nouveaux clients seulement » by default; no automatic deletion |
| CM1 (Oct 12) | 27 mailboxes, 30 retention | `info@` shared first; bodies 24 months |
| I1 (Oct 28) | 1 export request, 2 cutover date, 3 counselors | Christine asks support; Jan 11; one account each |
| D1 (Nov 4) | 7 proposals, 17 PHQ-2/GAD-2, 19 workbook questions; waitlist 34–40 | proposals with acceptance link; dropped; workbook defaults; fee as today, follow-up every 8 weeks, ≤ 2 entries, counselor sets priority with a reason, 48-h offer one client at a time, any profession, counselors own the lists |
| R1 (Nov 2) | 8 Google busy (video answered: Zoom per professional; 5 locations answered by the data: video + phone) | after cutover |
| SM (Oct 19) | 53 own PBX vs dedicated DID on PS's PBX (43 answered: SMS before the cutover, Yeastar as PS Hub) | dedicated DID on PS's PBX with a processing agreement; OpenAPI app, webhook secret and DID provided by Jonathan (roadmap §3.4) |
| C5a (Oct 27) | 47, 48, 49 consents | see the C5a row below |
| RZ (Nov 26) | 41 Zoom app publication | Jonathan creates the Zoom developer account at the start of RZ |
| F1 (Dec 1) | 26 old receipts, 52 cards re-consent (answered by Christine: 21 morning queue, 23 fee decided by the pro, 24 IVAC / PAE, 25 QBO accounts, 42 no split, 45 « comptant » = QuickBooks Payments card) | no PDF import; re-consent link in December |
| FPay (Nov 24) | none (answered: payroll rules, answer 14) | — |
| D3c | none (44 answered by Jonathan, 2026-10-12: Calendly replaced, source tracking mandatory; R-74) | — |
| Lane C (Oct 19) | 50 third lane | without it, the target is Jan 25 (R-68) |
| CM4 (Jan) | 28 OpenAI account and Loi 25, 29 model | clinic account, Canada project if eligible, ZDR asked; `gpt-5.4` after a 20-draft trial |

---

## 4. Cutover runbook (outline)

To be written in full as `docs/runbooks/gorendezvous-cutover.md` during I3. Dates for the **Nov 30** target; the fallback (Jan 11) shifts every step by six weeks.

1. **T-30 (Fri Oct 30, code complete):** email to professionals (video link: Zoom connection or fixed link, « Mon agenda », « Ma paie », fee decisions, new links in client emails); email to clients with a card on file at GOrendezvous (secure link to re-enter the card at Stripe with the next-day charge consent, since cards do not transfer; roadmap question 52); Yeastar DID live and the SMS consent wording in the reminder texts; counselor and admin_assistant accounts invited (one per person, roadmap question 3); GOrendezvous support confirms the final export date and format (Fri Nov 27).
2. **T-14 (Mon Nov 16):** every professional active in GOrendezvous has an account, a primary title, availability rules and a video link (Zoom connected or a fixed link; report: « Professionnels prêts pour la bascule », with the « Vidéoconférence » column; reminders sent to those without one); the Yeastar DID has sent its test reminders and received a « OUI » and an « ARRÊT »; the Interac notice parser has matched a week of real notices in the dry run; the 7 consent templates published in fr and en; QuickBooks connected with the accounts map (Services, Ventes, expenses by specialty) **and the GOrendezvous customer mapping reviewed** (FQ's report: matched, to decide, none created yet); email and SMS templates reviewed; the two half-day testing sessions done (§2.4).
3. **Rehearsal (Mon Nov 23 – Wed Nov 25):** dry run of the full import on production (dry run writes only `private.import_*`, then clears them) with the latest exports; full import into the local stack; the three role checklists run end to end by Christine, Rachel and a counselor; go / no-go criteria checked on Thu Nov 26.
4. **Freeze (Fri Nov 27, 18:00):** GOrendezvous kept open read-only by convention (no new bookings); last GOrendezvous reminders already cover appointments up to Tue Dec 1; final exports (clients, Revenus, support's appointment export with the future appointments).
5. **Final import (Sat Nov 28 – Sun Nov 29):** clients (with default payers) → services map → appointments (history read-only, future active; a future video appointment keeps the Zoom link GOrendezvous already sent when the export carries it, else a link is queued on the professional's Zoom or the fixed link is used and sent to the client) → waitlist entries (the fake « Inscription – Liste attente … » / « LISTE ATTENTE À RAPPELER » appointments) → invoices and payments (history; « Argent comptant » as « Carte (QuickBooks Payments) ») → consents facts → QuickBooks links from the reviewed mapping; reconciliation report (counts and totals vs exports and QuickBooks); 10 records checked; modules enabled for everyone (Paramètres → Modules); jobs switched on (`appointments.reminders` from Mon Nov 30 for Tue Dec 1 appointments; `appointments.mark_completed`; `billing.build_drafts` for the first morning queue on Tue Dec 1; `billing.payout_periods` for the Dec 1 summary of November's GOrendezvous sessions, imported); QuickBooks push **paused**; Stripe switched to live keys.
6. **Go-live (Mon Nov 30):** hypercare (an agent on call, daily triage); invoice sequence continues GOrendezvous's 2026 numbers; the first « File du matin » on Tue Dec 1.
7. **Go / no-go (Wed Dec 2, noon):** if green, QuickBooks push released (queued invoices and payments go out) and GOrendezvous is cancelled before Jan 31 (keeping read access if obtained, question 2). **Rollback** if a blocking defect (cannot book, cannot invoice, reminders failing, data loss): reopen GOrendezvous, disable the four modules, hand the report « créé dans l'app depuis le 30 novembre » (appointments, invoices, payments) for manual re-entry; QuickBooks untouched because the push was paused; retry on Mon Jan 11 (fallback), the hard limit being Jan 31.

**Partial cutover (Mon Nov 2), if the external items land early:** Demandes (a) with the waitlist and the discovery-call page, client consents and the Gmail sync go live for the counselors on the real client import; GOrendezvous keeps the agenda, invoicing and reminders; the fake « conseillère » appointments stop that day. Steps: I1 run for real (clients only), consents published, **the website's « Réserver un appel découverte » button repointed to the app's booking page** (mandatory at the partial cutover, R-74) and **the existing Calendly bookings exported and copied into Demandes by hand** by a counselor, counselors' half-day done the week before.

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
| Taxes as practised: taxable = file opening (37,83 $ + taxes), waitlist registration (18,91 $ + taxes), couple 30 min, supervision, travel fees, naturopathie; every consultation untaxed | visite §18 | Keep | `tax_rule` per service; the list confirmed by Christine (answer 15), « Statut Indien » exempt (answer 16) |
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
- `services` (`org_id`, `family_id`, `code` int 10000–89999 unique per org and inside its family's range, `key` text unique immutable, `name`, `description`, `kind` (`session` / `call` / `fee` / `workshop` / `admin`), `duration_minutes` (0 for fees), `buffer_after_minutes`, `for_two` bool, `price_source` (`grid` / `fixed` / `free` / `entered`), `fixed_price_cents`, `grid_duration_minutes` (which grid column), `tax_rule` (`exempt` / `taxable`), `requires_consent_template_key`, `colour`, `is_active`, `sort_order`). Checks: `fixed` ⇒ price set; `grid` ⇒ grid duration set; `entered` ⇒ no price (Facturation requires an amount on the line).
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
| Signed, versioned consents, fr / en, yes / no clauses, required per service / payer / situation, « À compléter » with a deadline, withdrawal | visite §2, §15, §17 | Keep + Add | C5 (feature table there), core signing |
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
- Consents: `client_consent_rules`, `client_consent_requests`, `client_consents`, `client_consent_settings` (detail in C5).
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

**C5 — client consents (Lane C: C5a Oct 27–Nov 2, 5 d; C5b after the cutover, 2 d)**

Jonathan (2026-10-11): « faut que notre module client gère bien ça comme GOrendezvous ». Reference: tour §2 « Consentements », §15, §17; roadmap §2.2 bis; the Professionnels image consent is the in-house precedent (`professionals-consent-sign`, `EmbeddedSigning`, P4-481 – P4-489).

*Keep / Change / Drop against GOrendezvous*

| GOrendezvous feature (tour) | Mark | Ours |
|---|---|---|
| Rich-text consent templates with dynamic fields (client, pro, title, company, address, service, location, signer) | Keep | Core document templates, module `clients`; `{{ variables }}` checked at publish: `client.*`, `signataire.*`, `professionnel.*`, `clinique.*`, `service.nom`, `payeur.organisation`, `aujourd_hui` |
| Versioned; never deleted, made inactive; one active per service | Keep | Core versions `draft → published → archived`; a signed version is never deleted (core trigger); one published per template |
| fr / en texts | Keep | One template per (consent, language): `clients.consent.<key>.fr` / `.en`; the request picks the client's language |
| Sections « Accord requis » and « Oui / Non » | Change | Yes / no clauses answered on our pre-signing page, printed into the PDF as checked boxes and stored in `answers`; no Documenso checkbox fields (R-46) |
| Required per employee and per service, once or at each appointment | Change | `client_consent_rules`: by service, payer kind, professional status (intern), situation (waitlist, file transfer), general for every first appointment; `once` / `each_time` |
| Signature électronique à l'acceptation; signer, date / time | Keep | Core signing (Documenso embedded), sealed PDF with certificate and journal; no IP stored by us |
| Who signs: the client or a related person with the right « gérer rendez-vous et formulaires » | Keep + Change | Under 14 → relation with `can_manage_appointments`; both parents when shared custody is recorded (two signers) |
| « À compléter » list with a deadline (portal and emails) | Keep | Public consent page via secure link; `due_at`; staff « Consentements à obtenir » and a bell notice at 48 h |
| Sent from the appointment « Actions » (demande de consentement) | Keep | From the appointment, the demande, the record; automatic at the first booking |
| Consent copies shared in the client portal | Change | « Envoyer la copie signée » by email on request; full portal later |
| Health forms (raison, échelle 0–10, signes vitaux…) | Drop (D8) | None (not used at MANA either) |
| Withdrawal | Add | « Retirer le consentement » with date, actor, note; future appointments flagged; re-sign later |
| New version → who re-signs | Add | Chosen at publish: « tous les clients actifs » or « nouveaux clients seulement » (R-49, question 48) |
| Reports | Add | `clients_consent_gaps`: clients without a valid required consent per template and pro |

*Data model (migration `…_clients_consents.sql`, pgTAP `100_clients_consents.test.sql`)*
- `client_consent_rules` (`org_id`, `template_key`, `trigger_kind` (`general` / `service` / `payer_kind` / `professional_status` / `situation`), `target` (service id, payer kind, status key or situation key), `frequency` (`once` / `each_time`), `is_active`; seeded for the 7 texts).
- `client_consent_requests` (`client_id`, `template_key`, `language`, `template_version_id`, `context_type` / `context_id` (demande, appointment, waitlist entry), `signers` jsonb [{ role `client` | `relation`, client id, relation id }], `secure_link_id`, `due_at`, `state` (`pending` / `signed` / `declined` / `expired` / `cancelled`), `answers` jsonb (clause key → yes / no), `signature_request_id`, `reminded_at`, timestamps). Audit: signers redacted.
- `client_consents` (the consent in force: `client_id`, `template_key`, `version_label`, `signed_at`, `signed_by` jsonb (name, relation), `answers`, `signed_file_id`, `request_id`, `source` (`app` / `import`), `withdrawn_at` / `withdrawn_by` / `withdrawal_note`; unique active per (client, template)). Audit: signer redacted.
- Settings table `client_consent_settings` (`default_due_days_before_first_appointment` 1, `reminder_days` 7, `pre_appointment_reminder_hours` 48, `retention_policy` text set by Christine).
- **RLS:** `clients.view` reads states and answers; providers read `client_consents_status` for their linked clients only; writes via RPCs; secure-link purpose `client_consent` (`resolve_rpc` returns the text to show and the clauses; `accept_rpc` stores answers and the signer confirmation, then the function starts the Documenso signing).
- **Published:** `private.required_consents_for(client, service, payer_kind, professional) → (template_key, state)[]` (Rendez-vous's booking RPC and the agenda flag; Demandes' waitlist registration), view `client_consents_status`, `clients_consent_gaps`, `private.clients_mark_consent_signed` (called by the signing capture trigger).

*C5a tasks (before the cutover)*
- C5a.1 pgTAP first: rules refuse an unknown template key; a request for a client under 14 without an authorised relation is refused in French (HINT `signer_required`); both parents required when `shared_custody` is set on the dossier; `each_time` rules create a request per appointment, `once` rules none while a consent is in force; a published new version flags « À signer de nouveau » only for that template and only for the chosen population; provider RLS.
- C5a.2 Migration: tables above, purposes (`secure_link_purposes` row `client_consent`, 14-day TTL, `max_uses` 1), seeds (7 rules; 14 templates = 7 texts × fr / en as drafts with « Texte à faire valider par la direction avant publication » as the first line, variables declared, one signature page with roles `client` and optional `relation_1` / `relation_2`), `pii_encrypted_values` untouched (no PII columns).
- C5a.3 RPCs: `set_consent_rule`, `request_client_consent(client, template_key, context, signers?, due_at?)` (picks the language and the published version, resolves the signers by the 14-year and custody rules, issues the secure link through `private.issue_secure_link` with a token hashed by the function), `cancel_consent_request`, `resend_consent_request` (new link, old one revoked), `record_consent_answers` (accept_rpc), `publish_consent_version(template, population)` (wraps core's publish and flags clients), `withdraw_client_consent` (C5b), `import_client_consent_fact` (service role, I1).
- C5a.4 Functions: `clients-consent-send` (user, `clients.manage`: calls `request_client_consent`, emails template `clients.consent_request` with the link, fr / en, attachment none); `clients-consent-sign` (public token: resolves the link, after the answers calls `createSignatureRequest` with `distributionMethod: 'NONE'`, a `redirectUrl` back to the public page, the answers rendered as block placeholders, and returns the embedded signing token once; per-IP limit before any lookup); the core capture trigger files the sealed PDF and `private.clients_mark_consent_signed` writes `client_consents`; job `clients.consent_reminders` (daily, `local_hour` 8: 7-day reminder of pending requests; 48-h notice for appointments with a missing required consent, email `clients.consent_before_appointment` and bell notice `clients.consent_missing`).
- C5a.5 UI: record tab « Consentements » (per template: state line, answers, « Envoyer », « Renvoyer », « Signer ici » (opens the public page on the staff device), sealed PDF via `SignedDocumentDownloads`, history); settings section « Consentements » (`clients.manage`: the rules, the templates with core's versions editor, the due / reminder settings); public page `/consentement` (identity check: first name + birth year, clauses, embedded Documenso, « Merci »); staff list « Consentements à obtenir » (filters: overdue, by professional); `useRecordData` for the tab.
- C5a.6 Integration hooks shipped here, consumed later: Rendez-vous R1 calls `required_consents_for` on booking and shows « Consentement signé / manquant » (R2) and in « Mon agenda » (R5); Demandes D2 offers « Envoyer le consentement général » from the discovery-call task; the waitlist D3 requires the « liste d'attente » text before « Active ».
- C5a.7 Tests: Vitest (tab states, signer picker rules, public page flow with the fake Documenso), Deno (`clients-consent-send`, `clients-consent-sign`: token single use, under-14 refusal, answers rendered, no PII in logs), Playwright `consents.spec.ts` (send → public page → signed state).
- **Acceptance:** a 13-year-old's consent goes to the authorised parent (both parents if shared custody); a client answers a yes / no clause and the sealed PDF shows it; a new published version with « nouveaux clients seulement » changes nothing for signed clients; the appointment of a client without the general consent shows « Consentement manquant » and is still bookable.

*C5b tasks (after the cutover, lane A, Jan 11–12)*
- C5b.1 Withdrawal: `withdraw_client_consent` + UI (« Retirer le consentement », note, confirmation), future appointments re-flagged, audit.
- C5b.2 « Envoyer la copie signée » (email with the sealed PDF, logged), retention setting applied by `storage-cleanup` rules if Christine sets a duration.
- C5b.3 Reports: `clients_consent_gaps` in Rapports (per template and professional), signatures and withdrawals per month, send → sign delay.
- C5b.4 Re-sign campaign: « Demander une nouvelle signature à tous les clients actifs » from the settings section (batched sends, 100 a day, through the same function).
- **Acceptance:** a withdrawn consent shows « Retiré le … » and the next appointment flags it; the gaps report counts match the record tabs.

*Import (I1 / I2):* consent facts from the support export (template, GOrendezvous version label, date, signer when present) → `client_consents` with `source = 'import'`, no PDF; roadmap question 15.

### 6.4 Risks

- ~7 400 clients: list and search need indexes and keyset paging from C1 (no `.or()` text search).
- Duplicates in the GOrendezvous export (no merge there): I1's report may be long; merge UI must be fast.
- Provider visibility depends on links fed by Rendez-vous and the import: backfill in I2.

---

## 7. Rendez-vous (`appointments`) — batches

**Routes:** `/agenda` (staff; all pros, a service's pros, one pro), `/agenda/disponibilites` (availability edit mode), `/mon-agenda` (provider), public `/rendez-vous/action` (client links). **Depends on:** `clients`, `services`, `professionals`.

**Keep / Change / Drop (summary; full table in `docs/modules/appointments.md` at R1):** Keep — §E views, blocks, editor, cancellation with reason, « Client absent », deep link, audit; visite §1 views (Jour, Semaine, Prochains jours, Mois), all pros / service / one pro, availability edit mode with recurring default schedule, exceptions (Jour férié, Vacances, Autre), visible-to-clients and overflow flags, services per block, « Deuxième personne », participant presence, states (pending acceptance, reminder sent, confirmed by client, present / absent, cancelled, kept on schedule, deleted), cancellation reasons (minus COVID-19), « garder à l'horaire », recurrence weekly or every 2–12 weeks with conflict check, personal appointments, work appointments, Zoom per pro, « Démarrer ». Change — clinic time everywhere, DB-enforced booking rules, « Raison / Notes » split into internal note + client message, `completed` set by a job, one account per counselor. Drop (Jonathan's OK) — rooms, equipment, group classes, physical locations, health forms, « Lumino Santé » print, inventory.

**Data model:** `appointment_settings` (clinic hours Monday–Friday 8:00–17:00, used for reminder sending hours and the morning queue; appointments allowed outside them; R-52), `availability_rules` (pro, weekday, local start / end, services allowed, visible to clients, overflow allowed, valid from / to), `availability_exceptions` (pro, kind, local range, label), `appointment_series` (rule, interval 1–12 weeks, weekdays, count or until, `ignored_conflicts`), `appointments` (pro, service, `starts_at` / `ends_at`, mode, state, series, cancel reason / details / at / by, `kept_on_schedule`, `internal_note`, `client_message`, `is_personal`, `is_work`, `video_url` / `video_external_id` / `video_status` (`ready` / `pending` / `failed`), `external_ref`; exclusion constraint on `tstzrange` per pro over active states, including `buffer_after_minutes`), `appointment_participants` (client, role, presence, confirmed at), `cancellation_reasons` (seeded), `appointment_reminders` (channel `email` / `sms`, per recipient (client or relation, by their channel preference), due at, sent at, status; unique per appointment, recipient and channel), `professional_video_links` (professional, `kind` `zoom` / `fixed`, fixed URL (Meet, Teams, other), updated at; R-55), `video_connections` (Zoom: one account per professional, Zoom user id and email, state `connected` / `needs_reconnect` / `disconnected`, encrypted access and refresh tokens via `private.encrypt_pii`, listed in `private.pii_encrypted_values()`, expiry, connected at), `video_tasks` (queue: create, update, delete a Zoom meeting; attempts, last error code). RLS: staff `appointments.view`; provider own rows (`current_professional_id()`) and other pros' busy blocks only (« Occupé », no client); personal appointments private. **Published:** `get_open_slots`, `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)`, `private.appointments_reassign_client(old, new)`; calls `private.clients_link_professional`.

**Functions and jobs:** `appointments-reminders` (job `appointments.reminders`, `local_hour` 8, within clinic hours: appointments **one business day ahead** — Friday for Monday, as GOrendezvous's real setting (visite §18) — not yet reminded, one reminder per recipient and channel from the channel preferences: email template `appointments.reminder` with the confirmation link, or SMS through Communications' `sms-send` (« OUI » confirms); an unconfirmed appointment triggers nothing (R-53); the video link (Zoom meeting or the professional's fixed link) in both); SQL job `appointments.mark_completed` (hourly: past active appointments → completed unless presence says absent); secure-link purposes `appointment_confirm` (v1) and `appointment_change` / `appointment_cancel` (seeded but **disabled by default**: the data shows « clients must call to cancel, at any time » for almost every pro; a clinic or per-pro setting enables them, and under 24 h the page says « Pour annuler à moins de 24 h, appelez la clinique au … »); view `appointments_without_reminder` (« Clients sans rappel »: upcoming appointments whose client has no email or a bounced one, for the counselors to phone while SMS is deferred); `zoom-connect`, `zoom-callback`, `zoom-disconnect` (user, `appointments.self` for one's own account), `zoom-deauthorize` (webhook, signature), job `appointments.video_sync` (function `appointments-video-sync` draining `video_tasks`, every 5 min and right after a booking), job `appointments.zoom_token_refresh` (hourly, refreshes tokens expiring within the hour, marks `needs_reconnect` on failure and notifies), email template `appointments.video_link` (« Votre lien de rencontre »); email templates `appointments.confirmation`, `.reminder`, `.changed`, `.cancelled`, `.proposal` (fr / en by client language).

**UI:** agenda (port of PS Hub's grid with clinic-time placement and overlap range filter; Pointer Events drag at 15 min, click to create at the service's duration), editor `Sheet` with tabs Participants / Facturation / Notes / Actions / Historique (in-sheet tabs out of the tab order), availability mode with « J'ai terminé », « Je suis en vacances toute la semaine », copy week; « Mon agenda » for providers; client record « Visites et paiements » tab (R5); public action page.

| Batch | Goal | Areas | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|---|
| R1 | Schema + booking RPCs (`set_availability_rule`, `add_exception`, `book_appointment` — refuses when `private.client_has_balance` says so unless an override row exists (R-58; the helper is a stub returning false until F3) —, `move_appointment`, `set_presence`, `cancel_appointment`, `get_open_slots`), clinic hours setting | migrations, pgTAP `099_…` | overlaps refused, DST weekends (two Sundays), buffer, provider limits, balance refusal with HINT `balance_due` | booking outside availability refused in French; 50-min session takes 60 min | 5 d | A, Nov 2–6 |
| R2 | Agenda UI + availability mode | `src/modules/appointments/` pages, grid components | Vitest grid placement at DST, drag snapping; Playwright book + move | 4 views, all pros / one pro, keyboard reachable view switch | 5 d | A, Nov 9–13 |
| R3 | Recurrence, states, cancellations, personal appointments, `mark_completed` job | migration, RPCs `create_series`, `cancel_series_from` | conflicts listed then skipped or refused; late cancel flags fee | series every 2 weeks × 10 with 1 conflict shown | 4 d | A, Nov 16–19 |
| R4 | Reminders (J-1, weekend skipped, clinic hours) by email **and SMS** per recipient preference, confirmation link and « OUI » by SMS, confirmation / change / cancellation emails and texts, **fixed video link** inserted in them, « Clients sans rappel » view | function `appointments-reminders`, link purposes, templates, `professional_video_links` | Deno tests: business-day rule, idempotency, one reminder per recipient and channel, cancel link disabled by default, under-24 h page when enabled, fixed link rendered | a teen gets the SMS and the parent the email for the same Monday appointment, both sent Friday 8:00 clinic time | 5 d | A, Nov 20–26 |
| R5 | « Mon agenda » (with the « Vidéoconférence » card: Zoom or fixed link, and the fee-decision action stub for F3), client visits tab, publications for Demandes and Facturation, `appointments.spec.ts` | pages, views | Playwright provider path | provider sees others as « Occupé » only; a fixed link saved on the card appears in the next confirmation | 2 d | A, Nov 27–30 |
| RZ | Zoom per professional (decided by Jonathan): connect, staff visibility, token refresh, links per appointment, not-connected warning, disconnect / reconnect | `zoom-*` functions, `appointments-video-sync`, `video_connections`, `video_tasks`, « Vidéoconférence » card in « Mon agenda » (the provider portal page Rendez-vous owns; « Mon profil » belongs to Professionnels), settings section « Vidéoconférence » (`appointments.view`: every professional with Connecté / Non connecté / À reconnecter, filter, « Relancer » email) and a dot in the agenda's professional picker | Deno: signed state, revoke on disconnect, deauthorize webhook signature, refresh failure → `needs_reconnect`, token never returned; pgTAP: provider manages only their own connection | « Démarrer » opens the per-appointment link; move updates it; cancel deletes it; booking video with an unconnected pro shows the warning and still books | 6 d | C, Nov 16–23 |
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

**Routes:** `/facturation/:onglet?` (« File du matin », « Factures », « Paiements », « À rapprocher », « Impayés », « Payeurs », « Paie », « Revenus »), `/facturation/factures/:id`, `/mes-recus` and `/ma-paie` (provider). **Depends on:** `appointments`, `clients`, `services`, `professionals`; `communications` for the `administration@` Interac notices (optional dependency: « À rapprocher » shows a manual entry when the mailbox is not connected).

**Christine's answers (2026-10-12, [research](../research/2026-10-12-christine-answers.md)) are decided, not revisable:** invoices built and sent every morning (morning queue); Interac notices at `administration@`; cards on file charged the day after the appointment; « Argent comptant » = QuickBooks Payments card; dunning 3 / 5 / 7 / 10 days and no new appointment with a balance; « Entente particulière » stops in the queue; the professional decides cancellation fees and gets 30 % once paid; the supervisor on an intern's receipt; invoices never split between separated parents; IVAC 94,50 $ per session with the gap billed to the client, monthly per-client invoices; PAE per-client agreements renewing March 31, invoiced early April; no MANA PAE program; monthly payroll summary on the 1st; QBO accounts « Services », « Ventes », expenses by specialty; tax list confirmed and « Statut Indien » exempt.

**Keep / Change / Drop (summary):** Keep — §F lines, TPS / TVQ per line, statuses, file-opening fee, invoice numbering, IVAC report; visite §5 invoice → payment → receipt, several lines per invoice, `AAAA-N` numbering, payment modes ↔ QuickBooks accounts, annual statement, receipt template. Change — invoices built nightly and sent from a morning queue (today one by one in GOrendezvous); receipt on payment; cancellation fee decided by the professional (today a typed line); credit notes instead of cancelling; couples: one payer per invoice, no split; IVAC gap invoice; PAE agreements per client; server-side PDF (pdfmake, ADR 0008). Add — dunning and the balance rule at booking, Interac reconciliation from the mailbox, next-day card charge, payroll summary and professional invoices, payer organisations with monthly invoices. Drop (confirmed by the data) — TELUS eRéclamations, gift / loyalty / visit cards, Square, PayPal, Accès D, Assurance, « seulement TPS », Stripe deposits per service.

**Payer model, « Facturé à » (Jonathan 2026-10-11, Christine 2026-10-12; roadmap §2.6 bis):** the client is the dossier; the payer is the client (default), a related person holding `receives_invoices`, or an organisation (IVAC, a PAE provider). A dated default payer per dossier, chosen per invoice when needed (separated parents: the invoice goes to one parent or the other, never split). The invoice is addressed to the payer; the receipt names both, plus the professional (or the intern's supervisor), order, licence, date, duration, service, amount, receipt number, clinic address, tax numbers. **QuickBooks:** payer = parent customer, one sub-customer per (payer, dossier) pair billed with the parent, never re-parented; GOrendezvous-made customers matched, never duplicated (FQ).

**Data model:** `invoice_drafts` (appointment or source, built at, state `to_review` / `ready` / `sent` / `held`, hold reason (`special_agreement` / `price_missing` / `payer_missing`), payer, lines snapshot), `invoices` (`number` `AAAA-N` from `invoice_sequences`, `client_id`, `payer_kind`, `payer_client_id` / `payer_organisation_id`, status, issued / due, totals, tax rates applied, `source_type` / `source_id`, `external_ref`), `billing_payer_defaults`, `invoice_lines` (appointment, service code, description, quantity, unit, TPS, TVQ, `line_type` (`service` / `cancellation_fee` / `file_opening` / `adjustment` / `ivac_gap`)), `credit_notes`, `payments` (mode, amount, at, reference, `stripe_payment_intent`, `interac_notice_id`, reconciled by), `refunds`, `payment_modes` (seeded: Interac → « 1075 Virement bancaire à recevoir », Stripe (carte au dossier and link) → « 1070 Banque Stripe », « Carte (QuickBooks Payments) » → « Fonds non déposés » (transition, used by the import), Virement bancaire and Chèque → « Compte courant », Note de crédit), `interac_notices` (from the `administration@` sync: amount, sender name, message, received at, matched invoice), `stripe_customers` (payer → Stripe customer id, `card_on_file` bool, consent recorded at; never a card number), `dunning_runs` (invoice, step 3 / 5 / 7 / 10, sent at), `special_agreements` (dossier, note, active; the « Entente particulière » flag), `payer_organisations` (IVAC, PAE providers: name, address, email, QBO customer), `payer_agreements` (client, organisation, `per_session_amount` or `coverage_percent`, `max_amount`, `renews_on` (March 31), `invoicing_cadence`, used amount), `payer_invoices` (organisation, period, lines per client with file number and session dates), `cancellation_fee_decisions` (appointment, decided by professional or staff, applied / waived, at), `professional_payout_periods` (professional, month, state `draft` / `to_validate` / `validated` / `paid`), `professional_payout_lines` (appointment or item, kind (`session` / `cancellation_fee` / `report` / `discussion`), client price, grid rate, rule (100 % / 30 % / 15 %), payable (fee lines only once the invoice is paid)), `professional_invoices` (period, uploaded file or generated PDF, QBO bill id), `receipts`, `statements`, `qbo_connection`, `qbo_links`, `qbo_customer_matches`, `qbo_sync_queue`, `payment_provider_events`. RLS: `billing.view` / `billing.manage`; provider reads own receipts, payout periods and fee decisions (`billing.self`). **Published:** `client_balance(client)`, `private.client_has_balance(client)` (the booking rule in Rendez-vous), `billing_summary`, `revenue_by_invoice / _service / _payment`, `create_service_invoice(…)`, `invoice_status(id)`, `private.billing_reassign_client`. **Needs:** Professionnels `professionals.supervisor_professional_id` (small migration, F2.0) and `get_professional_compensation(id, on)`; Communications `private.interac_notices_since(ts)` (CM1).

**Functions and jobs:** SQL job `billing.build_drafts` (nightly 23:30 clinic time: yesterday's completed sessions and decided fee lines → `invoice_drafts`, held when the dossier has a special agreement, the service is `entered` without an amount, or the payer is missing); `billing-documents` (user: invoice, receipt, statement, payer invoice and payout summary PDFs; store via `register_system_file`; email via `sendTemplatedEmail`, templates `billing.invoice`, `.receipt`, `.statement`, `.payer_invoice`, `.dunning_3 / _5 / _7 / _10`, `.payout_summary`); `billing-send-queue` (user, `billing.manage`: send one draft or all ready drafts; finalises, numbers, emails, queues the next-day charge when a card is on file); `billing-stripe` (user: payment link; card-on-file setup session; next-day charge of a sent invoice); `stripe-webhook` (webhook: signature, `claim_webhook_event`, records payments and card setups); SQL job `billing.card_charges` (daily 09:00 clinic time: charges yesterday's sent invoices whose payer has a card on file, receipt on success, « Paiement refusé » in the queue on failure); SQL job `billing.dunning` (daily: steps 3 / 5 / 7 / 10 days after the due date, emails, bell notice to the admin_assistant at day 10); SQL job `billing.interac_match` (every 15 min: `interac_notices` ↔ open invoices by amount and payer name, auto-match only when unique, else « À rapprocher »); `qbo-connect` / `qbo-callback` (user, `billing.settings`), `qbo-sync` (job `billing.qbo_sync`, paused flag at the cutover); SQL job `billing.payout_periods` (1st of the month 06:00: builds each professional's period from the previous month, notice « Votre sommaire de paie est prêt »).

**UI:** « File du matin » (the day's drafts: held first, inline edits, « Envoyer », « Tout envoyer », « Mettre en attente »); « Factures » and the invoice page (lines, payer picker among the dossier's authorised relations, credit note, resend); « Paiements » and « À rapprocher » (Interac notices, Stripe charges, manual entry); « Impayés » (dunning state, « Dérogation » for a booking); « Payeurs » (organisations, agreements per client, monthly invoices); « Paie » (periods per professional, validation state, mark paid); provider « Ma paie » (summary lines, « Valider », « Téléverser ma facture » / « Générer ma facture ») and « Mon agenda » fee decision (« Appliquer les frais » / « Ne pas facturer »); settings « QuickBooks » (connection, accounts map: Services, Ventes, expense accounts by specialty, payment modes) and « Facturation » (due terms, dunning days, card-charge hour).

| Batch | Goal | Areas | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|---|
| F1 | Invoices, lines, payer model (default per dossier, choice per invoice), numbering `AAAA-N`, taxes incl. « Statut Indien » exemption, credit notes, `create_service_invoice` | migrations, RPCs `create_invoice(appointment_ids[])`, `set_default_payer`, `set_invoice_payer`, `finalize_invoice`, `issue_credit_note` | pgTAP money math (per-line rounding §F), sequence without gaps under concurrency, payer without the right refused, tax exemption | a child's invoice goes to the chosen parent, the receipt names both | 5 d | A, Nov 30–Dec 4 |
| F2 | **Morning queue** (`billing.build_drafts`, « File du matin », holds for special agreements, send one / all), receipts on payment, statements, PDFs (supervisor on an intern's receipt: F2.0 Professionnels migration `supervisor_professional_id`), emails, UI (Factures, appointment « Facturation » tab, client « Visites et paiements ») | job, `billing-send-queue`, `billing-documents`, pages | pgTAP: yesterday's completed sessions become drafts once, held when flagged; Deno render tests (receipt text read back, supervisor line); Vitest queue | at 08:00 the admin_assistant sees yesterday's drafts and sends them all in one click; a corrected invoice produces a credit note and a new invoice | 7 d | A, Dec 7–15 |
| F3 | Dunning 3 / 5 / 7 / 10, **balance rule at booking** (`private.client_has_balance`, override with reason, notices to counselor and pro), cancellation fee **decided by the professional** (« Mon agenda » action, staff override), refunds, waitlist registration fee invoices, Revenus view hand-off to RP1, `billing.spec.ts` | SQL jobs, RPCs, views | pgTAP: dunning steps idempotent; booking refused with HINT `balance_due`, allowed with an override row; fee line only after the pro's decision; refund reverses a payment | a client with a 10-day-old balance cannot be booked without the admin_assistant's override | 4 d | A, Dec 16–21 |
| FS | **Stripe: payment link, card on file (Setup Session, consent recorded), next-day automatic charge job**; **Interac reconciliation** from `administration@` notices (CM1 feed), auto-match when unique, « À rapprocher » list | `billing-stripe`, `stripe-webhook`, `billing.card_charges`, `billing.interac_match`, pages | Deno: webhook signature, idempotency, setup vs payment events; pgTAP: charge only once per invoice, only with consent; matching unique-or-manual | an invoice sent Monday morning for a client with a card is paid Tuesday 09:00 and the receipt goes out; an Interac notice matches its invoice in one click | 7 d | B, Dec 8–16 |
| FQ | QuickBooks Online port with PS Hub's flaws fixed: payer parents, (payer, dossier) sub-customers billed with the parent, invoices → « Services » / « Ventes », payments by mode account, professional invoices → expense accounts by specialty (used by FPay), ids back; mapping step for GOrendezvous-made customers | `qbo-*`, queue, settings cards « QuickBooks » and « Correspondance des clients QuickBooks » | Deno: signed state, encrypted tokens, retry, pause, sub-customer creation, no duplicate on a probable match | a child's invoice lands under the parent customer in the child's sub-customer, revenue in « Services », the payment in « 1075 » or « 1070 » | 8 d | B, Dec 17–30 (Dec 24 excluded) |
| FPay | **Paie des professionnels:** monthly periods built on the 1st from completed sessions at the grid rate (100 %), cancellation fees at 30 % only once the invoice is paid, reports and external-intervener discussions at 15 %, IVAC / PAE at the regular rate; « Ma paie » validation, professional invoice upload or generation, admin « Paie » page, QBO bill by specialty | migration, `billing.payout_periods` job, RPCs `validate_payout_period`, `attach_professional_invoice`, `mark_period_paid`, PDFs | pgTAP: every completed session paid once; 30 % line payable only when the client paid; 15 % rules; a session moved across months counts once; Vitest « Ma paie » | the January 2027 summaries exist on Feb 1 and match a hand-made check for 3 professionals | 6 d | C, Nov 24–Dec 2 (fee-decision wiring finished in F3) |
| FP | **Third-party payers:** IVAC (94,50 $ per session, client gap line, monthly invoice per client with file number and session dates, report writing billable), PAE providers (per-client agreement: amount per session or %, max amount, renewal March 31, ~3 invoices per 800 $ agreement, early-April closing), organisations as QBO customers, monthly « Payeurs » run | migrations, RPCs, `billing-documents` payer invoice, « Payeurs » page | pgTAP: agreement consumption and cap, gap computed, renewal resets the cap on March 31, monthly invoice groups sessions per client | February's IVAC and PAE invoices are produced from the app; April's PAE closing can be run | 6 d | A, Jan 13–20 |

**Risks:** the morning queue changes the admin_assistant's routine the most (walkthrough with her in F2's week); card-on-file consent wording (Loi 25 and Stripe terms; a sentence in the general consent, question 47); Interac notice formats (parse the bank's emails from a sample before FS); « Argent comptant » history imported as « Carte (QuickBooks Payments) » (Christine's answer), amounts never reinterpreted; tax rounding vs GOrendezvous (compare 100 historical invoices in I3); invoice sequence continuity at cutover; QuickBooks duplicates (paused push until go / no-go, mapping reviewed at T-14); payroll rules edge cases (sessions paid later than the month they were held: the 30 % line moves to the month the client pays).

---

## 9. Importation GOrendezvous — batches

**No module key:** a terminal script `scripts/import-gorendezvous.mjs` (same safety model as `import-professionals.mjs`: local by default, typed project reference for a remote, credentials from `/dev/tty`, dry run by default) calling service-role RPCs each module publishes (`private.import_client`, `private.import_appointment`, `private.import_invoice`, `private.import_payment`, `private.import_consent_fact`), with staging tables `private.import_runs`, `private.import_rows` (raw row hash, target, status, message). Files stay in `~/Clinique-MANA-import/` (mode 700), never in git.

**Keep / Change / Drop:** Keep — clients, relations and insurances if exported, appointment history (from support), invoices and payments (Revenus export + QuickBooks), consent facts. Change — tags mapped to fields; ~900 pro-service pairs mapped to catalogue codes; employee profiles mapped to professionals by a reviewed CSV (`conseillère`, « Administration », « Z MATRICE » excluded). Change — GOrendezvous's « Argent comptant » payments are imported as « Carte (QuickBooks Payments) » (Christine, answer 6; R-57); the waitlist (GOrendezvous's own waitlist is empty, visite §18: the real one is the fake « Inscription – Liste attente psychologie et psychothérapie » appointments, 51 in 2026 at 21,74 $, and « LISTE ATTENTE À RAPPELER » at 0 $ in the « conseillère » agenda) becomes `waitlist_entries` through `private.import_waitlist_entry` (registration date = the fake appointment's or the entry's date; fee « paid » when an invoice exists; one entry per client and target); default payers derived from the export (« Payé par » on invoices) through `private.import_default_payer`. Drop — receipt and consent PDFs one by one, health forms (none).

| Batch | Goal | Tests | Acceptance | Size | Lane, dates |
|---|---|---|---|---|---|
| I1 | Script skeleton, mapping files (employees → professionals; the 28 catalogue codes and the legacy uncoded services → codes; 31 tags → fields, the duplicated « IVAC » and « Nouveau client » merged), clients dry run with the duplicate rules, report; **price gap report** grid vs GOrendezvous per profession | script unit tests (parsers, normalisers), pgTAP for `private.import_client` | report: counts (7 390 active, ~1 078 archived, 2 635 without primary pro), rejects with reasons, HIGH / MEDIUM duplicates | 5 d | C, Nov 3–9 |
| I2 | Appointments and waitlist dry run (history read-only, future active with their existing Zoom links, links backfilled, waitlist entries from the fake appointments; the 911 « Bureau administratif » visits of the conseillère account qualified as discovery calls, registrations or cancellations) | parsers for the support format | totals per month match GOrendezvous (8 635 visits in 2026); no future overlap left; waitlist count = fake registrations still open, deduplicated | 2 d | B, Nov 26 + Dec 10 |
| I3 | Invoices and payments dry run with payers, reconciliation vs QuickBooks, QBO customer mapping report, runbook written | sums per month and mode | gaps listed and explained; every payer matched to a QBO customer or « à trancher » | 3 d | B, Dec 28–30 |
| I4 | Rehearsal and final import | — | §4 steps 3–5 | (in buffer) | A + B, Jan 4–10 |

**I1 built (lane C, 2026-10-12):** `scripts/import-gorendezvous.mjs` (`clients`: dry run, `--commit`, relations; `prix`: the price gap report), `public.import_client` / `import_client_relation` (decision I-7 replaces the service-role `private.import_client`), the employees and services mapping files, runbook `docs/runbooks/import-gorendezvous.md`; decisions I-7 … I-14.

**Built ahead of I1 (lane C, 2026-10-12):** `scripts/import-gorendezvous/` holds the readers (clients, the three « Revenus » exports, waitlist, cancellations), the normalisers (names, E.164, emails, date-only, cents), the tag and payment-method tables, the duplicate rules and a local dry-run report (`dry-run.mjs`, no database), with synthetic fixtures and tests; decisions I-1 … I-6. I1 wires them to `scripts/import-gorendezvous.mjs` and `private.import_client` once C2 lands.

**Risks:** the support export arrives late or in an unusual format (fallback: per-pro iCal feeds for future appointments only, or manual re-entry of ~3 weeks of future appointments on Jan 9–10); employee ↔ professional mapping errors (reviewed CSV, refused when ambiguous).

---

## 10. Demandes (`demandes`) — batches

**Routes:** `/demandes` (inbox), `/demandes/:id/:onglet?`, `/liste-attente`. **Depends on:** `clients`, `professionals`, `services`; uses `appointments` publications for proposals.

**Keep / Change / Drop (summary):** Keep — §C intake fields, participants, `DEM-AAAA-NNNN`; §D's rules as rewritten by Professionnels' 12 rules; the workbook's KPIs. Change — states from GOrendezvous's « Requêtes de service » (Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs; « Urgent » as a flag) mapped onto the workbook's events (sans réponse, proposée, confirmée, non pertinente); discovery calls and waiting list leave the fake « conseillère » appointments. Drop (Jonathan's OK) — PHQ-2 / GAD-2 screening (D8), the dormant legacy scorers, the browser AI schedule interpreter.

**Data model:** `demandes` (received at / by, channel, referral source, for whom, previous therapy, language, mode, availability, preferred pro gender, motifs, concerns, payer kind, insurer, `internal_note` (permission `demandes.notes`, never logged or notified), state, urgent flag, assigned conseillère, `DEM-` number), `demande_participants`, `demande_events`, `demande_tasks` (discovery call due, attempts), `demande_propositions` (pro, by, at, response, directory snapshot), `first_appointment_cancellations`, `capacity_snapshots`.

**Waitlist (Jonathan, 2026-10-11: « pour les psy souvent nous avons une liste d'attente, il faut incorporer ça aussi »; roadmap §2.3 bis).** A demande in state « Liste d'attente » carries one or two `waitlist_entries`: target `profession_title_id` (Psychologie, Psychothérapie, or any title) and / or `professional_id`; `priority` (`normal` / `priority` + reason), `registered_at` (order: priority then date; rank shown), criteria copied from the demande (availability periods and days, mode, language, motif ids, age band, preferred gender, payer), optional bridge professional, `state` (`incomplete` until the « liste d'attente » consent is signed and the fee paid or waived, then `active`, `to_call`, `offered`, `closed`), `fee_status` (`to_invoice` / `invoiced` / `paid` / `waived` + reason) and `fee_invoice_id`, `last_contact_at`, exit `reason` (`placed` / `referred_elsewhere` / `withdrew` / `no_answer` / `other`) and date, `external_ref`. `waitlist_contacts` (call, follow-up email, answer), `waitlist_offers` (slots offered, secure link, expires at, answer). Permission `demandes.waitlist` to manage; providers read entries targeting them (`demandes.self`, no internal note). Jobs: `demandes.waitlist_followup` (daily, `local_hour` 7: entries without contact for N weeks → `to_call`, bell notice to counselors; optional email `demandes.waitlist_still_waiting` with Oui / Non secure links (purpose `waitlist_confirm`); no answer in 14 days → « Sans réponse »). Slot freed (availability added, `new_client_places` raised, a series ended, a professional of the title activated) → notice `demandes.waitlist_slot_available`. Offer (part 2): `waitlist_offer` secure link valid 48 h with 1–3 slots, acceptance books through Rendez-vous's proposal RPC and closes the entry « Placé ». The fee: Services et tarifs' « Inscription liste d'attente »; « Facturer l'inscription » calls Facturation's published `create_service_invoice` (optional dependency on `billing`: hidden while Facturation is disabled, the fee stays « À facturer »). Published `waitlist_summary` (length per title and professional, average and median wait, entries and exits per month) for Rapports. **Realtime:** core hook `useOrgRealtime` (private broadcast channel per org, ids only; roadmap §3.1) built in D2, with a « Je m'en occupe » soft lock.

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| D1 | Schema (demandes, states, tasks, **waitlist tables**), RPCs (create, quick log, change state, assign, tasks), pgTAP | 4 d | B, Oct 23–28 |
| D2 | Inbox (age vs 24–48 h, « sans réponse », filters), quick log, record (Accueil, Participants, Suivi, Historique), core realtime hook | 5 d | B, Oct 29–Nov 4 |
| D3 | **Waitlist part 1:** registration from a demande (target, priority, criteria), « Liste d'attente » page per title / professional with rank and waiting time, consent sent (Clients C5 template « liste d'attente »), fee status and « Facturer l'inscription », follow-up job and notices, optional client email with Oui / Non links, exit with reason, offers noted by hand; Vitest + pgTAP (order, rank, state machine), Playwright `waitlist.spec.ts` | 5 d | B, Nov 5–11 |
| D3b | Discovery-call tasks, proposals with acceptance link (Rendez-vous `.proposal` template, pending state; GOrendezvous auto-accepts and has no expiry, so the 48-h hold is ours) | 2 d | B, Nov 12–13 |
| D3c | **Public discovery-call booking page** replacing Calendly (the website's « Réserver un appel découverte » points to calendly.com, visite §18): public function `demandes-book-call` (per-IP limit before any write, reCAPTCHA or Turnstile, counselor slots from a simple weekly rule, creates a « Nouvelle » demande with its call task, confirmation email, cancel link), **source tracking as the acceptance criterion** (decided by Jonathan, 2026-10-12: Calendly is replaced, R-74): campaign / UTM parameters, referrer and the « Comment avez-vous entendu parler de MANA ? » answer captured on the public page, stored on the demande (`source_campaign`, `source_referrer`, `referral_source_id`) and reported in D6; as simple as Calendly for the client (one screen, no account); the website button is repointed by Jonathan at the partial cutover and the existing Calendly bookings are exported and copied into Demandes by hand | 3 d | C, Nov 11–13 |
| D4 | Matching panel (Professionnels' rules, documented order, « Bon à savoir », insurance notes, **exclusions shown as a warning, never a filter** — Christine, answer 21, R-66 — and the workbook's colours as a priority hint) **and waitlist part 2**: « Place disponible » notice, compatible registrants in list order, « Offrir la plage » (48-h link, next on refusal or expiry) | 6 d | A, Jan 21–28 |
| D5 | Places left, capacity snapshots job, availability board | 3 d | A, Jan 29–Feb 2 |
| D6 | KPIs (activity and cohort rates, delays, cancellations, waitlist length and wait times, **demandes by source: campaign / UTM, referrer, « Comment avez-vous entendu parler de MANA ? »**, from D3c's capture) feeding Rapports | 3 d | A, Feb 3–5 |

**Risks:** the waitlist fee refund / credit rule unknown (roadmap question 34; amount confirmed at 18,91 $ + taxes); Calendly bookings made before D3c ships are copied by hand into Demandes (as today); state mapping disagreements (validate with the counselors in D2's walkthrough); realtime channel authorisation (pgTAP on `realtime.messages` policy).

---

## 11. Communications (`communications`) — batches

**Routes:** `/courriels` (inbox, threads, « À rattacher »), Paramètres → « Courriels Gmail » (`courriels-gmail`), « Rédaction IA » (`ia`). **Depends on:** core; `clients` for linking (optional dependency: linking hidden while Clients is disabled).

**Keep / Change / Drop:** Keep from PS Hub — Gmail history sync with lease lock and 404 / 410 fallback, Pub/Sub watch renewal, auto-linking order, optimistic actions, docked composer, TipTap, template pill, sandboxed HTML, MIME builder, AI bar « Accepter / Rejeter / Affiner », OpenAI Chat Completions. Change — every flaw listed in roadmap §2.4 bis (encrypted tokens via `private.encrypt_pii`, never returned; definer RPCs; signed `state`; no external URLs; attachments from `stored_files` only; required webhook secret / OIDC). Drop — open pixel, approval queue, writing-style learning, AI summaries of received mail, the Gmail / Resend dual route for one message.

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| CM1 | Module skeleton, `mail_connections` (encrypted tokens), `gmail-connect` / `gmail-callback` (signed state), `gmail-webhook` (required secret, per-IP hit, claim), `gmail-sync` + jobs `communications.gmail_sync`, `communications.gmail_watch_renew`, threads and messages tables with 24-month body purge job; **two shared mailboxes from the start: `info@` and `administration@`** (Christine, answer 6); **Interac notice parsing** for `administration@` (sender name, amount, message, received at → `interac_notices`, published to Facturation through `private.interac_notices_since`; a parser built from a sample of the bank's emails, tested on fixtures, never logging the body); sync status screen | 9 d | B, Oct 12–22 |
| SM | **SMS (decided by Jonathan, 2026-10-12: before the cutover, through the Yeastar P-Series OpenAPI « le même système que PS Hub »):** port of PS Hub's `_shared/yeastar.ts` (OpenAPI token with refresh, `:191-202`, `:315-334`; stored encrypted with `private.encrypt_pii`, never in a client-readable table) and `_shared/yeastar-webhook.ts` (event codes, PBX time zone), send by DID (`yeastar-send-sms/index.ts:135-154`) with failed sends logged too (`:187-214`), inbound texts and delivery reports from the signed webhook (`yeastar-webhook/index.ts:738-745`, `:874-895`); `sms_consents` (person, number, granted at, source, withdrawn at), `sms_messages` (direction, hashed number, status, body purged after 12 months), `contact_channel_preferences` (client or relation: email, SMS, both), `sms_settings` (PBX base URL, DID, sending hours); `sms-send` (service function, templates `appointments.reminder_sms`, `.confirmation_sms`, `.changed_sms`, business hours enforced), `sms-webhook` (Yeastar HMAC signature with `timingSafeEqual`, per-IP hit first, `claim_webhook_event`, « OUI » → confirms the appointment through Rendez-vous's published RPC, « ARRÊT » / « ARRET » / STOP → consent withdrawn and acknowledged), read-only « Textos reçus » threads view (PS Hub's grouping by last 10 digits), settings card « Textos » (PBX, DID, test send); fake PBX locally (`npm run fake:yeastar`); Deno tests (signature, token refresh, keywords, no body in logs), pgTAP (consent required before any send, withdrawal blocks sends). Not copied: PS Hub's org-wide `allow_sms` as the only control, the opportunity linking. | 6 d | C, Oct 19–26 |
| CM2 | Inbox UI (three panes desktop, stacked on phone), actions via `gmail-modify`, attachments copied to storage, auto-linking to clients by identity, « À rattacher » | 5 d | B, Jan 11–15 (moved after the cutover for the waitlist) |
| CM3 | Composer (docked desktop, full screen phone), send from Gmail (`gmail-send`, attachments by file id), templates (core catalogue + personal), 5-s undo | 5 d | B, Jan 18–22 |
| CM4 | « Rédiger avec l'IA » (`communications-draft`, OpenAI, placeholders, `ai_requests`, limits, monthly cap) | 4 d | B, Jan 25–28 |

**Risks:** Google Workspace prerequisites (internal OAuth app, Pub/Sub topic: Jonathan creates them with go-ahead per step); Gmail volume of `info@` (first sync limited to 45 days); Loi 25 scope of synced bodies (roadmap question 30).

---

## 12. Rapports (`reports`) — batches

| Batch | Goal | Size | Lane, dates |
|---|---|---|---|
| RP1 | « Revenus » by invoice / service / payment with filters and CSV export; « Annulations par raison »; « Clients à relancer » | 2 d | C, Dec 17–18 |
| RP2 | Intake KPIs (from D6), payouts, IVAC report (with CSV, disabled in legacy), places, waitlist (length per profession and professional, average and median wait, exits by reason) | 5 d | B, Feb 1–5 |

Reports read only published views through definer RPCs that check `reports.view` / `reports.finance` first; CSV built in the browser from the RPC result (no file stored).

---

## 13. Cross-cutting work owned by core

| Item | When | Owner batch |
|---|---|---|
| OAuth helpers in `_shared/` (`oauth-state.ts`: HMAC-signed state with nonce and 10-min expiry; `oauth-tokens.ts`: store / read through module service-role RPCs that use `private.encrypt_pii` / `decrypt_pii`) | CM1 | reused by RZ, FQ, R6 (Google busy) |
| `private.pii_encrypted_values()` extended for each token column | each batch adding one | CM1, RZ, FQ, R6 (Google busy) |
| Yeastar OpenAPI client in `_shared/sms/` (ported from PS Hub: token and refresh, send by DID, webhook signature, event codes; keywords in SQL), per-clinic settings in Paramètres → Textos (address, client id, number) and org secrets in Vault (`yeastar_client_secret`, `yeastar_webhook_secret`; as built, SM-10), `fake:yeastar` for local runs | SM | reused by R4 (reminders), later two-way SMS |
| Stripe client in `_shared/stripe/` (payment link, setup session, off-session charge, webhook signature) and secrets | FS | Facturation only |
| Realtime: `useOrgRealtime` hook, `private.broadcast_change(module, table, id, op)` trigger helper, `realtime.messages` policy | D2 | Demandes, then Rendez-vous |
| Secure-link purposes for appointment actions (module rows, resolve / accept RPCs) | R4 | appointments |

---

## 14. Global risks

1. **The deadline:** two lanes at ~50–55 days each before Dec 29 leave two weeks of slack; any scope added before the cutover must replace something (§2's slip rule).
2. **External exports and accounts:** GOrendezvous support export, Stripe, QuickBooks, Zoom app, Google Workspace: each has a named owner and a date in §4.
3. **Data quality:** duplicates and per-pro prices in GOrendezvous; reports in I1–I3 before anything is written.
4. **Production is live:** every merge deploys; migrations additive; modules disabled until the cutover weekend; no production data writes except the final import with Jonathan's go-ahead.
5. **Staff change:** counselors move from a shared account (admin rights minus delete today, visite §18) and an agenda with fake appointments to Demandes and personal accounts: a one-page guide and a walkthrough during the buffer.
6. **The timeline after 2026-10-12:** the answers added the morning queue, cards on file, dunning, payroll, full consents and SMS before the cutover; with two lanes Jan 11 no longer holds (lane A +4 days, lane B +10). A third lane from Oct 19 to Dec 18 (R-68, roadmap question 50) restores the date with ~9 days of slack in lane C and ~8 in lane B, none in lane A before the holidays; without it, the honest target is Jan 25 with no slack.
7. **SMS through the Yeastar PBX:** the transport is PS Hub's (decided by Jonathan); the open point is own PBX vs a dedicated DID on PS's PBX (roadmap question 53): a dedicated DID is ready in a day but routes the clinic's texts through PS's infrastructure (processing agreement, Loi 25); an own PBX with an SMS-capable DID takes 1–3 weeks. Delivery depends on the trunk's SMS support: tested with a real send on Oct 19.
8. **Cards on file:** GOrendezvous's saved cards do not transfer to our Stripe customers; clients re-enter their card through a secure link in December with the next-day charge consent (roadmap question 52); until then those clients pay by link or Interac.
