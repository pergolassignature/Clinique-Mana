# Phase 4 — Module 1 « Professionnels » Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in this session) to implement this plan task-by-task.

**Goal:** Build the Professionnels module: the bank of ~50 professionals as clean, curated data that matching relies on (motifs, approches, clientèles, langues, disponibilités générales, readiness), the record staff read and edit, and the full lifecycle: creation → invitation → questionnaire → review → documents → contract → activation, with soft insurance expiry.

**Architecture:** [Design](2026-10-08-professionals-module-design.md) (approved through the decisions below), on the Phase 1–2 patterns.
- **Data:** per-clinic reference lists (soft delete, immutable keys, composite `(org_id, id)` foreign keys), a `professionals` row with 1:1 tables (public profile, matching profile, private data) and junctions whose primary key starts with `professional_id`, all audited.
- **Writes:** column grants + RLS for plain fields; `security definer` RPCs that check their permission first for everything else (sets, status, private data, settings lists).
- **Reads:** one bundle RPC per record (`get_professional_record`), one flat list view (`professionals_list`), one cached catalogue RPC (`get_professionals_catalog`), and the published contract for other modules (`professionals_directory`, catalogue views, `private.current_professional_id()`).
- **Frontend:** module folder `src/modules/professionals/` (`api/`, `hooks/`, `schemas/`, `lib/`, `components/`, `pages/`), routes and settings sections declared in the manifest, every page and tab code-split with `lazyPage`.

**Tech Stack:** React 19 · Vite 6 · TypeScript strict · React Router 6.30 · TanStack Query 5 · Tailwind 3 + shadcn/ui (design system) · Zod 4 · react-hook-form · Sonner · Vitest + Testing Library · Playwright (new in 4a.0) · Supabase (Postgres 17, Auth, Vault, pgcrypto, btree_gist, unaccent) · pgTAP · Deno edge functions (4b–4d).

**Phasing:** 4a needs Phase 2 only and starts at once, in parallel with Phase 3. 4b, 4c and 4d each start after the Phase 3 tasks they consume (§ « Dépendances Phase 3 », by Phase 3 task number).

**Aligned with:** the [Phase 3 plan](2026-10-08-phase-3-shared-services-plan.md) (commit `65d29d5`), decisions P3-1…P3-30. Where the Professionnels design and Phase 3 differ, **Phase 3 wins** (P3-20) and this plan follows it.

---

## Décisions adoptées (déléguées par Jonathan, 2026-10-08 — révisables)

Jonathan, 2026-10-08: « You will go on without asking me questions you have phase 3 and 4 to go. » Every open question of the design (§8) takes the design's recommendation, and the proposed Drops D1–D7 are approved. A Drop means « not ported to the rebuild »: no existing data is deleted (staging holds no real professional data). Questions that need outside input get a safe default that can be reversed later; they are repeated in « Mise en service (Jonathan) ». Each decision can be reversed; the task that implements it is named so the change has one place to go.

### Open questions Q1–Q21

| # | Decision | Rationale |
|---|---|---|
| P4-1 | **Expiry day (Q1):** the day after `expires_on`, the professional stays `active`, is flagged « Assurance expirée » everywhere, Demandes asks for confirmation before assigning a **new** client, and a weekly reminder goes out until a valid insurance is verified (4c.4). | Soft expiry was approved by Jonathan (A4.5); flagging keeps existing clients unaffected. |
| P4-2 | **Insurance expiry date (Q2):** defaults to the next March 31 and can be corrected by a reviewer (`professionals.documents.review`), audited. Stored as a `date` (last valid day), displayed with `formatDateOnly*`. | Some professionals hold private insurance with another end date; a date-only field never shifts by time zone. |
| P4-3 | **Clientèles are their own list (Q3)** with age bounds, separate from approaches; the UI still groups both under « Spécialités ». | Clientèles are a hard matching filter with fixed meaning; approaches are soft scoring. |
| P4-4 | **Interim availability (Q4):** general periods `am / pm / evening / weekend` + note, and « Accepte de nouveaux clients », stored now; Rendez-vous slots replace the periods later. | Demandes comes before Rendez-vous; matching needs some availability data from day one. |
| P4-5 | **Gender (Q5):** optional `gender` (`female` « Femme », `male` « Homme », `unspecified` « Autre / non précisé »), visible to staff only, used only for the client preference. No feminine title forms in 4a; revisit with the fiche (4c.5). | Minimum data (Loi 25); feminine forms only matter on the fiche, which is built in 4c. |
| P4-6 | **Professions (Q6):** seed the 8 legacy titles plus « Nutritionniste » (ODNQ, new category « Nutrition »); a licence is required only when the title belongs to an order (naturopathe and coach have none). The lists stay editable in « Professions et ordres ». | Matches the website and the design-system mock; editable data, so reversible without a migration. |
| P4-7 | **SIN (Q7) — outside input: the accountant.** The encrypted `sin` column and its RPCs are built (4a.17) behind ADR 0004's « Before Phase 4 » checklist (4a.16, blocking). Collection is **off by default** (module setting `collect_sin = false`): no screen asks for a SIN and `set_professional_private` refuses one until an admin turns it on after the accountant confirms. | Loi 25: collect the minimum; the column costs nothing to keep ready, and turning collection on is a settings switch. |
| P4-8 | **Programme de reconnaissance (Q8) — outside input: the cap interpretation.** Rules are stored as dated settings with the contract's numbers as given (step 50 sessions, 0,50 $ / 50 min, 0,25 $ / 30 min, `cap_pct = 25`) plus `cap_basis = 'unconfirmed'`; each professional's level is entered by hand with history. **No amount is computed anywhere** until the interpretation is confirmed. | Recording terms is safe under any reading of « jusqu'à concurrence de 25 % »; computing money on a guessed reading is not. |
| P4-9 | **Margin per professional (Q9):** one value per professional and kind, with history; Annexe A shows that value, or the default range when none is set. | The design-system « Tarifs » card already shows a single « Marge clinique 28 % ». |
| P4-10 | **Conseillères edit matching data (Q10):** `professionals.matching` is a counselor default; identity, status and documents stay with the adjointe and the admin. | They « know every professional's specialties ». |
| P4-11 | **Inactive professionals keep their login (Q11)** for « Mon profil » / « Mes documents »; only a reason marked « désactive le compte » (« Fin de collaboration ») disables the profile, and reactivation re-enables it. | An inactive professional may need to renew insurance. |
| P4-12 | **Address (Q12):** manual fields in 4a, as in « Identité légale ». Google Places comes with Clients and is reused here then. | Clients needs it more; no new secret for 4a. |
| P4-13 | **Tabs (Q13):** Aperçu · Jumelage · Profil public · Identité et permis · Documents · Rémunération et fiscalité · Historique. « Contrats » merges into Documents, « Courriels » into Historique. | One compliance tab and one timeline; most professionals have 0–3 emails. |
| P4-14 | **IVAC number (Q14)** is written with `professionals.manage` (the adjointe), unique per clinic. | She handles IVAC billing; a cross-clinic check would leak other orgs' data. |
| P4-15 | **Education (Q15)** is left out. | Not used by matching, documents or the fiche. |
| P4-16 | **`is_restricted` motifs (Q16):** kept and enforced in `set_professional_motifs` (a regulated profession is required); no motif is restricted by default; the admin sets it in « Motifs ». | Legacy meaning preserved, now enforced in the database. |
| P4-17 | **Initials on every contract page (Q17):** kept. The shared renderer draws an initials box in every page header for the roles in `header.initialsFor` and returns the `INITIALS` fields to Documenso (Phase 3 Task 3.30). If the Task 3.29 spike finds the clinic's Documenso cannot take per-page initials, it falls back to signature + date only, listed as a Drop for approval in 4d.4. | Legacy DocuSeal did it; Phase 3 built the capability. |
| P4-18 | **Annexe A wording (Q18) — outside input: the accountant.** « avant taxes » by default; one i18n string to change if the accountant says otherwise. | Legacy printed « taxes incluses » on pre-tax prices, which is wrong. |
| P4-19 | **Sent fiches (Q19):** no stored copy; `email_log` records what was sent and when. | Fiches are regenerated from current data (D2). |
| P4-20 | **Import of the ~50 existing professionals (Q20) — running it on staging is Jonathan's go-ahead.** A reviewed CSV import (identity, professions, licences, languages, clientèles, approaches, motifs, IVAC) through `import_professional` and `scripts/import-professionals.mjs`, with a dry run, built and tested locally (4a.19). Then activation with the override reason « Dossier complété hors application ». | Faster and less error-prone than typing 50 records (~15 min each); nothing touches staging without the go-ahead. |
| P4-21 | **Untracked motif / compliance work (Q21):** the design's recommendation holds: seed the `legacy-v1` lists (72 motifs, 8 categories). The v2 list (107 motifs, 10 categories) is **not** adopted now; its soft-delete swap strategy is the pattern for any later list change (task 4a.20 records it as a ready follow-up). The compliance check's auto-deactivation is rejected; its checklist definition informs readiness. Details in « Q21 — the two untracked migrations ». | v2 uses diagnostic category names and drops 34 legacy keys; auto-deactivation contradicts the approved soft expiry. |

### Drops D1–D7 (approved; not ported, no data deleted)

| # | Decision | Rationale |
|---|---|---|
| P4-22 | **D1** — no `professionals.license_number` column; the licence lives on the profession row only. | Two sources drifted in legacy. |
| P4-23 | **D2** — no `fiche_version` column and no `fiche` document type; fiches are generated on demand, `fiche_generated_at` is kept. | A fiche is a view of current data, never an upload. |
| P4-24 | **D3** — no `professional_specialties.proficiency_level`. | Never used; the « spécialisé » star replaced it. |
| P4-25 | **D4** — no browser (localStorage) copy of the questionnaire draft; server autosave only, with a visible warning when a save fails. | The questionnaire holds bank (and possibly SIN) data; reception PCs are shared. |
| P4-26 | **D5** — no raw JSON views (Historique, original submission). | Readable before/after values replace them, as in the Journal d'audit. |
| P4-27 | **D6** — « Copier le lien » only on the creation confirmation; later, « Nouveau lien » (which revokes the previous one). | Tokens are stored hashed (Phase 3 §3.1). |
| P4-28 | **D7** — legacy-archived reference data is not re-seeded: specialty categories `issue` / `modality` and their rows, clientèles `lgbtq`, `indigenous`, `newcomers`. | Archived in legacy; issues are covered by motifs; the clinic is online only. They can be re-added in settings. |

### Choices made while writing this plan (resolve inconsistencies between documents)

| # | Decision | Rationale |
|---|---|---|
| P4-29 | **Phase 3 wins on shared-service details (P3-3, P3-16–P3-20):** storage paths `{org_id}/professionals/{subject_id}/{file_id}.{ext}` with no file name; signed read URLs last **5 min** (design A4.4 said 1 h); every template key — email **and** document — uses the module prefix `professionals.` (design §7 said `professional.*`); Documenso sends the signing emails, so there is no `contract.sent` template; `accept-invite` calls the purpose's `accept_rpc` (pluggable handler); staged uploads use `stored_files.retain_until` and `private.attach_stored_file`; attachments and free recipients are template flags (`recipient_mode`, `allows_attachments`); one shared PDF renderer (`_shared/pdf/`). | One owner per shared behaviour; Jonathan's instruction (2026-10-08): Phase 3 wins where the designs differ. |
| P4-30 | **In-app notifications come from Phase 3** (P3-15, Tasks 3.12–3.13): `notifications` addressed by permission, `private.notify` for SQL callers, `_shared/notifications.ts` for functions, the topbar bell that **polls every 60 s** (P3-24) and Accueil « À surveiller ». Phase 4 only defines its notification kinds and calls them (task 4c.1). | Phase 3 took the ownership the Professionnels design asked for. |
| P4-31 | **Seeded rows keep their legacy keys** (French ASCII for motifs and professions, e.g. `anxiete`, `psychologue`; English for approaches and clientèles, e.g. `cbt`, `children`). Keys created in the app are slugs of the French name (`unaccent`, `[a-z0-9_]`, ≤ 50). Keys are data, immutable, never shown. | Design §3.1 says « English snake_case », but the legacy 72 motif keys are French; inventing English keys would break the import mapping for no gain. |
| P4-32 | **Every reference table names its label `name`** (motifs included; design §3.2 listed both `name` and `label` for motifs). | One column name, one generic settings component. |
| P4-33 | **Years of experience: 0–60** everywhere (database, Zod, questionnaire); legacy's questionnaire said 0–50. | One rule; design §3.3 says 0–60. |
| P4-34 | **Duplicate email check at creation: the clinic's professionals and the clinic's profiles only.** `profiles.email` is already globally unique, so `accept-invite` refuses an address taken in another org with Phase 3's generic message. | Design A1.3 said « all profiles »; checking other orgs reveals their data (same reasoning as Phase 3 Q8). |
| P4-35 | **The creation dialog shows « N° de permis » when the chosen title is regulated** (required then). | The database requires a licence for regulated titles (A2.9); the dialog of §5.2 had no licence field. |
| P4-36 | **Child rows with their own id use a composite primary key `(professional_id, id)`** (+ `unique (id)` for other modules' FKs): `professional_professions` now, `professional_documents` in 4c. History then finds every child row, deleted ones included, by the record-id prefix `<professional_id>`, through an expression index. | Design §3.9 « by child ids » misses deleted rows, whose ids are no longer in the table. |
| P4-37 | **The questionnaire is filled signed in.** The invitation link (Phase 3 `/invitation`, Task 3.21) creates the account through `accept-invite` and the purpose's `accept_rpc` (P3-16); the professional then lands on `/mon-profil/questionnaire`, read and written through `professionals.self` RLS and RPCs. No public-token write endpoint exists. | Smaller attack surface than token-authorised writes; matches design §3.7 (account on acceptance). |
| P4-38 | **Private values typed in the questionnaire are encrypted at once** in `professional_submission_private` (bytea, audit-redacted), never in the draft JSON, and applied on approval. | A draft is readable by staff reviewing it; a SIN or account number must never sit there in clear. |
| P4-39 | **PS Hub is the tie-breaker for uncertain choices** (read-only at `/Users/jonathanharvey/Documents/Claude Projects/NEW PS Hub`). A task facing an uncertain choice checks how PS Hub solved it, follows PS Hub unless that conflicts with these decisions or with our security rules, and records any deviation in the task's commit message and in `docs/modules/professionals.md` (« Écarts par rapport à PS Hub »). | Jonathan, 2026-10-08: « For questions or uncertainty we can check PS Hub too. » |
| P4-40 | **Cross-org integrity in the schema:** each reference table has `unique (org_id, id)`; every reference from a professional's row is a composite FK `(org_id, <x>_id)`. | A row of org A can never point at org B's motif, even through a bug in an RPC. |
| P4-41 | **pgTAP files of Phase 4 are numbered 040–069**; Phase 3 uses 014–039. | Both phases add tests in parallel branches; no rename at merge. |
| P4-42 | **Clientèles and languages that matching relies on are `is_system`** (the 7 clientèles, French) and cannot be archived; their names and age bounds stay editable. The reason `other` is `is_system` too. | Archiving `children` or French would silently break matching or creation. |
| P4-43 | **Displayed status of `in_review`:** « À réviser » (yellow) while a submission waits for review; « En préparation » (neutral) once it is approved and the file is not yet active. The stored status stays `in_review` until activation (detailed in Batch 4b). | Design §3.4 defines no status between approval and activation. |
| P4-44 | **Profile-update requests use no secure link.** The professional already has an account: the email's button opens `/mon-profil/questionnaire`, behind sign-in (`RequireAuth` keeps the return target). Phase 3's `profile_update` purpose is not seeded. | A token would only duplicate the session; Phase 3 `linkUrl` serves `/invitation` only and session-only purposes have their own module flow (Task 3.20 step 7). |
| P4-45 | **Clinic-hour jobs run at a clinic-local hour, once per local day** (P3-22, Task 3.3): `professionals.insurance_expiry_notice` at **06:00 clinic time** (`local_hour = 6`), `professionals.invitation_reminders` at **08:00 clinic time** (`local_hour = 8`); their cron entries run hourly and `list_job_orgs` / `start_job_run` pick each clinic once per local date. | Jonathan wants 06:00 clinic time; a fixed UTC hour drifts by one hour with daylight saving. |
| P4-46 | **One database token for both phases:** Phase 3's lock directory `$(git rev-parse --git-common-dir)/clinique-mana-db.lock` (P3-25). `scripts/with-db-lock.sh` (4a.0) only wraps that same directory with `mkdir` / `rmdir`. | Two lock paths would not exclude each other. |
| P4-47 | **Every new `public` function is added to the `functions_are` list** of `003_core_module_settings_secrets.test.sql` in the same commit (Phase 3 ground rule). | The list is exact; a missing entry fails CI. |
| P4-48 | **Phase 4 edge functions follow Phase 3's shape:** `handler.ts` (all logic, `createHandler(deps)`) + `index.ts` (wiring); database access only through `client.rpc(…)` and `client.storage`; tests with `_shared/testing/` fakes; errors reported through `_shared/report.ts` (ids and codes only, P3-29); error codes from P3-28. | Testable without a server; no raw table reads from functions. |
| P4-49 | **No module storage policy.** File access is the one core read policy on `stored_files.view_permission` (Task 3.24); a professional's own files use the owner branch (`owner_profile_id` + `owner_permission = 'professionals.self'`). `private.current_professional_id()` is never called from a storage policy. Phase 4 lists files through its own rows (`professional_documents.stored_file_id`, the submission's staged files), **never through `stored_files.subject_id`**: on a file no module RPC has attached, the subject is client-supplied and untrusted (Task 3.24 review). | Phase 3 inconsistency 12: one policy, ownership expressed in the row. |
| P4-50 | **Professionnels-owned email templates** (seeded by this module's migrations, keys `professionals.*`): `invite`, `invite_reminder`, `profile_update`, `submission_received`, `document_rejected`, `document_expiring`, `document_expired` (expiry day) and `document_expired_reminder` (weekly after expiry), and `fiche` (`recipient_mode = 'free'`, `allows_attachments = true`). | Phase 3 inconsistency 5: these keys belong to the module. |
| P4-51 | **Non-clinical seeded labels** (delegated, 2026-10-08, revisable). Motif names say what people live, not a diagnosis: Trouble bipolaire → Bipolarité; Trouble de personnalité limite (TPL) → Personnalité limite (TPL); Trouble de personnalité narcissique (TPN) → Traits narcissiques; Trouble obsessionnel-compulsif (TOC) → Obsessions et compulsions (TOC); Trouble oppositionnel avec provocation (TOP) → Opposition et provocation (TOP); Trouble des conduites → Difficultés de conduite; Trouble du sommeil → Difficultés de sommeil; Trouble du spectre de l'autisme → Spectre de l'autisme (TSA); Troubles alimentaires → Relation à l'alimentation; Traumatisme et Trouble de stress post-traumatique (TSPT) → Traumatisme et stress post-traumatique; Dysfonctions sexuelle → Difficultés sexuelles; Transsexualité → Transidentité. Category descriptions: « Apprentissage, attention et développement », « Anxiété, dépression, estime de soi et bien-être émotionnel », « Deuil, santé et transitions de vie ». Legacy typos fixed: Comportements sexuels abusifs, Difficultés de langage, Réadaptation professionnelle, Victime d'agression sexuelle, Situations de crise. **Psychose** and **Dépression** stay. Keys are unchanged; sort orders follow the new names. | CLAUDE.md: « motifs are orientation tags, not diagnoses ». Psychose and Dépression are the everyday words clients use to say what they live, not formal diagnoses, and no plainer word says the same thing. Keys are unchanged, so the import (4a.19) maps legacy rows as before; each clinic can still rename any label. |
| P4-52 | **« Sans âge » for a clientèle without ages** (delegated, 2026-10-08, revisable): a clientèle that is not an age group (Couples, Familles, Groupes) reads « Sans âge » in the Clientèles table (muted), and the dialog's help uses the same term (« clientèle sans âge », « elle reste sans âge »); `agesLabel` reads 0 to 0 as « Moins de 1 an ». | 4a.8 review: « Sans limite d'âge » read like « Tous les âges » (0, no maximum), the opposite of « not filtered by age »; « 0 an » is not French. |
| P4-54 | **Motifs are reordered within their category** (delegated, 2026-10-08, revisable): « Monter / Descendre » under « Par catégorie » move a motif among its group's motifs (the catalogue order, which the record's motif picker follows); « Liste A–Z » sorts by name (`fr-CA` collation) and has no reorder. The categories sheet reorders the groups. | The plan named reorder for the categories only; without it a new motif always lands last in its group (as titles and clientèles, 4a.7–4a.8). Moving among A–Z neighbours would change an order the screen does not show. |
| P4-55 | **Restricting a motif keeps it on the records that have it** (delegated, 2026-10-08, revisable): `save_motif` changes the flag only; a professional without a title from an order keeps the motif, the readiness shows the gap (`regulated_title`) and `set_professional_motifs` refuses the next save until the motif is removed or such a title is added. When a motif someone has becomes « Réservé », the dialog says so before saving (« Les professionnels qui ont déjà ce motif sans titre d'un ordre professionnel devront le retirer de leur dossier ou ajouter un tel titre. »). | Removing motifs from records silently would change matching data behind the staff's back; the database already enforces the rule at the next save (P4-16), so the settings screen only has to warn, as the licence note of 4a.7. |
| P4-60 | **Remembered filters are stored as the URL's query string** (« déléguée — révisable », 4a.10): the value of `professionals.list_filters` is `{ "query": "statut=actif&langue=…" }`, the filters without the page, and `parseProfessionalsFilters` reads it back. | One serialisation and one validator (unknown ids, statuses and sizes fall back to the defaults, as a stale link does); no second schema to keep in step with the URL. |
| P4-61 | **Clearing every filter deletes the preference** (« déléguée — révisable », 4a.10): « Réinitialiser », or removing the last filter, calls `delete_user_preference`; the plan said « saves `{}` ». | No row for someone who filters nothing; the table already accepts both. |
| P4-62 | **What is remembered, and when it is read** (« déléguée — révisable », 4a.10): only the filters a person chooses are saved (search, status, the popover's filters, a chip, « Réinitialiser »), after a 1.5 s pause, one write per pause, and at once when they leave the list, hide the page or unload it (`pagehide`, best effort: a closing tab may not send it); a link, Back or a page change is not saved (PS Hub saves from its setters too). The preference is read once per session (`staleTime: Infinity`); every change goes through the cache first, so a change made on another computer shows at the next sign-in or reload. | A link from another screen is navigation, not a choice; the list should not refetch the preference on every visit. |
| P4-63 | **The list's columns follow the card's width** (« déléguée — révisable », 4a.10), with container queries: under 480 px Nom and Statut (the email stays under the name), from 480 px Profession, from 720 px À surveiller, from 880 px Langues (the design system's five columns). The rows are a grid with ARIA table roles, so each row is one link. | The card is narrower at 768 px (sidebar 220 px) than at 640 px, so window breakpoints would hide the wrong columns; a `<tr>` cannot be a link. |
| P4-64 | **List details** (« déléguée — révisable », 4a.10): the popover's title filter is « Titre principal » (the client filter matches the primary title, 4a.5 note); « À réviser » shows yellow (P4-43); a row's record is prefetched after the pointer rests 120 ms on it, or at once when its link gets focus; ‹ › stay focusable at the first and last page (`aria-disabled`). | A pointer crossing the list would otherwise prefetch every row it passes; a `disabled` button drops focus to the page. |
| P4-65 | **Creation dialog details** (« déléguée — révisable », 4a.10): choosing a title with no order clears the hidden licence, so nothing hidden is sent; the RPC's refusals go under the field their HINT names (`first_name`, `last_name`, `email`, `title`, `licence`; never by the wording, review of 4a.10: « …non permis » is about the first name), when that field is on screen, others above the buttons; the description reads « Le dossier est créé au statut « À inviter ». Vous compléterez son profil avant de l'inviter. » (no invitation in 4a). `ProfessionalsPlaceholderPage` stays: the record route (4a.11) and the « Motifs » section (4a.9) still use it. | The design-system dialog sends an invitation, which comes with 4b; the plan's « delete the placeholder » predates two other routes still pointing at it. |
| P4-58 | **The fiche uses PS Hub's PDF base** (Jonathan, 2026-10-08): `@react-pdf/renderer` in the browser, PS Hub's structure (page components, `fonts.ts`, `loadImages.ts`, `generate…PDF.ts`), lazy-loaded; email uploads the rendered file and a function attaches it. Contracts keep the server pdfmake renderer (ADR 0008). See Task 4c.5. | One PDF approach with PS Hub for documents people read; contracts need fixed signing coordinates rendered on the server. |
| P4-70 | **A record tab switch replaces the history entry** (« déléguée — révisable », 4a.11): clicking a tab, the arrow keys and Aperçu's links to a tab (`TabLink`) all `navigate(…, { replace: true })`. | PS Hub's `useOpportunityUrlState` does the same; Back then leaves the record for the list (with its remembered filters) instead of walking back through every tab viewed. The URL still names the tab, so links and alerts open it. |
| P4-71 | **Tabs not built yet show « en préparation »** (« déléguée — révisable », 4a.11): Jumelage, Profil public, Identité et permis and Historique (everyone with `professionals.view`) and Rémunération et fiscalité (`professionals.compensation` or `professionals.private`) are registered in `components/record/record-tabs.ts`, each a `lazyPage` of `TabInPreparation` until 4a.12, 4a.13, 4a.15 and 4a.18 swap their line. « Documents » is not registered until 4c. | The shell, the URL rules, the hidden-tab redirect and the keyboard behaviour are built and checked once, with real slots; each later task changes one line. |
| P4-72 | **Aperçu ships in the record page's chunk, not as its own lazy chunk** (« déléguée — révisable », 4a.11). The other tabs are `lazyPage`s, preloaded on tab hover or focus. | Aperçu is the landing tab of nearly every visit: as its own chunk it would always load after the page's, one more round trip (and React's 300 ms Suspense hold) on every cold open. The page chunk with it is ≈ 17 kB raw, 6 kB gzip. |
| P4-73 | **Motifs are summarised, never listed in full by default, and every summary is always expandable** (Jonathan's requirements, 2026-10-08; thresholds « déléguée — révisable », 4a.11, review of 4a.11; display revised in 4a.12 at Jonathan's request: « separate title », no wall of text). `lib/motif-summary.ts` (`summarizeMotifs`) + `MotifsSummary.tsx`, used by Aperçu and Jumelage. With more than 3 held, the whole list reads « Tous les motifs (72) », or « Tous sauf A et B (70 sur 72) » with at most 5 exceptions; that line unfolds to the categories. Otherwise the categories show at once. **Each category is a header on its own line** (icon, name 13/600, « 6 / 16 » muted at the right, hairlines between categories) with a short summary under the name: the names when ≤ 3 are held (checked first, so a category of one or two motifs, all held, reads its names, never « Tous »; no disclosure then), else « Tous », « Tous sauf … » (≤ 3 missing) or the count alone. Every other category header is a disclosure (`aria-expanded`, `aria-controls` on a list kept mounted with `hidden`), folded by default, that unfolds to its motifs **one per line in 1, 2 or 3 columns** (an auto-fill grid that follows the list's own width, P4-86), archived ones last, « (archivé) » muted. « Tout ouvrir / Tout fermer » when two or more categories fold. So 72 held motifs read one line, then eight calm rows, never 72 names at once. Archived motifs held count in neither number and are also named apart (« Motif archivé : … » / « Motifs archivés : … »). Every place that shows a professional's motifs uses it. | Some professionals hold nearly all 72 motifs: a run of 72 names cannot be scanned, and an inline « Catégorie : A · B · C … » run was still a wall. « Tous » alone hides which motifs those are, so the names stay one click away on every category. Counts use active motifs only, like readiness and matching. |
| P4-74 | **No header actions until 4a.14** (« déléguée — révisable », 4a.11): « Activer » and the « … » menu arrive with their dialogs; meanwhile Aperçu's « Le dossier est prêt à être activé. » has no button. | A button without its confirmation dialog would either do nothing or skip the override rules; 4a.14 already modifies `RecordHeader.tsx`. |
| P4-75 | **« Professionnel introuvable » without a request for an id that is not a UUID** (« déléguée — révisable », 4a.11); a null record (no such row, another clinic's, or not readable) reads the same, with « Retour à la liste ». | The RPC would refuse a malformed id with `22P02` (an error screen); the three null cases must not tell each other apart. |
| P4-76 | **Aperçu « Dossier » shows the gaps whenever the file is incomplete** (« déléguée — révisable », 4a.11), active or not: « Dossier complet » only for an active complete file; « Activé sans dossier complet : {raison} » above the gaps for an override activation. Held archived items show in the digest with « (archivé) ». | An active file can become incomplete (an archived motif or clientèle); a « Dossier complet » line would then be false. |
| P4-80 | **The Jumelage picker ships in the tab's chunk, not as its own lazy chunk** (« déléguée — révisable », 4a.12; the plan said « sheet body `lazyPage`-loaded on first open »). | The tab is already a `lazyPage`, preloaded on tab hover or focus, and the picker is only used there: `MatchingTab` with the picker is 20.2 kB raw, 7.2 kB gzip (review of 4a.12). A second chunk would add a request (and React's 300 ms Suspense hold) on the first « Modifier » for no saving elsewhere; `lazyPage` also takes prop-less components only. |
| P4-81 | **Picker order** (« déléguée — révisable », 4a.12): in starred lists (clientèles, approaches) the items held ★ come first, then the other held items, then the rest, each block in the catalogue's order (not A–Z: clientèles are curated age groups); motifs and languages keep the catalogue's order (P4-54). The order is taken when the sheet opens and never changes while it is open. | A row that jumps when ticked or starred is missed or mis-clicked; the catalogue order is the one admins curate and the digest uses. |
| P4-82 | **Picker filtering** (« déléguée — révisable », 4a.12): categories are folded by default (one line each: chevron, icon, name, « 3 sur 16 », « Tout sélectionner » / « Tout désélectionner »), with « Tout ouvrir / Tout fermer » (the summaries' words, review of 4a.12). A search (accents ignored, words marked; a category's name lists its motifs) or « Sélectionnés seulement » shows the matches unfolded under plain headings, without bulk actions. « Sélectionnés seulement » keeps the items held when it was turned on, so an item unticked meanwhile stays in view. The search field and the switch appear for grouped lists and lists of more than 12 items. Screen readers hear the number of matches (« 3 résultats », « Aucun résultat ») from an `sr-only` status, and « Sélection : N sur M » only after a category's bulk action (a tick is announced by its checkbox; the visible total is not a live region). | With 72 motifs held the sheet opens on 8 calm lines and the total; « Tout » acting on a filtered subset would be ambiguous; a short list (3 languages, 7 clientèles) needs no search. |
| P4-83 | **Closing a picker** (« déléguée — révisable », 4a.12): with changes, Échap, X or a click outside asks « Abandonner les modifications ? » (« Continuer la modification » focused first / « Abandonner »); « Annuler » discards at once, like every dialog's « Annuler ». While saving, the sheet cannot close and the list is inert (toolbar and rows in a disabled `fieldset`, and the draft ignores changes): what is saved is what is on screen. A refusal (schema or database) stays in the sheet above the buttons, without a toast. | Losing many ticks to a stray Échap is the risk; « Annuler » is already an explicit choice. |
| P4-84 | **Picker rules** (« déléguée — révisable », 4a.12): a restricted motif reads « Réservé »; without a regulated title it is disabled while unticked, with the reason under it, but a held one can be removed (P4-55) and the draft is refused before the RPC if it stays. A held archived item is listed with « Archivé » and can be removed and ticked again. « Tout sélectionner » skips blocked and archived items. The last language is disabled with « Au moins une langue est requise. ». Counts are over active items, like the summaries. | Mirrors `set_professional_motifs` and `set_professional_languages`, so the database never has to refuse what the sheet allowed. |
| P4-85 | **`StarToggle` names the action** (« déléguée — révisable », 4a.12): « Marquer comme spécialisé » / « Retirer la spécialisation » (design system), no `aria-pressed`, described by the item's label; the filled star is yellow-700 (an icon that must be seen, decision #30); shown only on held items. | A toggle whose name changes with its state would be read twice over with `aria-pressed`; the design system's labels are kept. |
| P4-86 | **An open category lists its motifs in an auto-fill grid** (« déléguée — révisable », 4a.12): one per line, columns of at least 11rem, at most 3, never wider than the list (`grid-cols-[repeat(auto-fill,minmax(min(100%,max(11rem,calc((100%-3rem)/3))),1fr))]`: the outer `min(100%, …)`, review of 4a.12, keeps one column inside a container under 11rem instead of overflowing), instead of the `cq-480` / `cq-720` variants the request named. | Aperçu's value cell is ≈ 450px at 1280 px, under `cq-480`: the container queries would give one column of 16 names there. The auto-fill grid follows the list's own width all the same: 1 column at 375 px, 2 in Aperçu, 3 in the Jumelage card. |
| P4-90 | **Gender select: empty reads « Non indiqué »** (« déléguée — révisable », 4a.13): the empty option (null, nothing recorded) is the select's placeholder « Non indiqué », clearable, and read-only an empty gender reads « Non indiqué » too (`Select.readOnlyEmptyLabel`, review of 4a.13); `unspecified` keeps its label « Autre / non précisé ». The plan listed « Non précisé » and « Autre » as two options. | « Non précisé » next to « Autre / non précisé » reads as the same choice twice; null (never asked) and `unspecified` (asked, other or not said) are different facts. |
| P4-91 | **Refusals about one title name it** (« déléguée — révisable », 4a.13): `professional_professions_guard` and `set_professional_professions` raise their title and licence refusals with HINT `title` / `licence` **and DETAIL = the title id**; the editor puts the message under that row's field (`professionsErrorField`, the last row for a title chosen twice), else above the buttons. `set_professional_payer_number` raises HINT `ivac`. Edited in place in `…_professionals_core.sql` (not on staging); pgTAP `042` checks each pair. `rpcErrorDetail` joins `rpcErrorHint` in `core/modules/errors.ts` (never sent to Sentry). | A HINT names the field; with two rows it does not say which one. The title id is not personal data and is already in the request. |
| P4-92 | **« Titre principal » only with two titles** (« déléguée — révisable », 4a.13): the radio pair shows when the draft has two rows (one row is primary by definition); read-only, « Titre principal » is written under the primary row. A row's title select omits the other row's title. | A lone checked radio is a control that cannot change anything; offering the other row's title only leads to « Un titre ne peut être choisi qu'une fois. ». |
| P4-93 | **Record-tab read-only notice** (« déléguée — révisable », 4a.13): « Seules les personnes qui gèrent les dossiers des professionnels peuvent modifier ces informations. » (the settings notice says « Seule l'administration », false here: the adjointe edits). The « Présentation » (bio) and approach counters read « 120 / 4000 caractères », counting the trimmed text as stored, as the field's description (read with it). Read-only, no field help shows on these tabs (`editingHelp`: counters, gender, login email, IVAC, licence; review of 4a.13). | Says who can, without naming roles that a clinic may rename. |
| P4-94 | **Stored phones show in the Québec format in forms** (« déléguée — révisable », 4a.13): `toContactFormValues` and `toPublicProfileFormValues` format E.164 as « 514 555-1234 », as the organization cards do; `regroupPhone` moved to `shared/lib/format.ts` (used by both and by Identité légale). | A form showing `+15145551234` asks staff to read a storage format. |
| P4-100 | **One save reads as one entry, and many items are counted** (« déléguée — révisable », 4a.15): the rows of one transaction (same `created_at`, actor and source) of one set table and one kind of change become one entry. Up to 3 items are named in the sentence (« a ajouté les motifs Anxiété, Deuil et Stress »); past 3, the sentence counts (« a ajouté 65 motifs ») and the names unfold behind the entry's disclosure, by category for motifs (`summarizeMotifs().full`, P4-73), archived ones marked. Same for languages, clientèles (★ as « (spécialisé) ») and approaches. | The audit writes one row per motif; Jonathan: never one huge sentence, the names stay one click away. |
| P4-101 | **A page's oldest save waits for the next page** (« déléguée — révisable », 4a.15): while more pages exist, the rows of the last transaction on screen are held back (they may go on in the next page). The tab reads on by itself while the last loaded page holds only rows of that held-back save (its first and last rows are of one transaction) — the first page, or the one « Charger plus » brought, which then added nothing to the screen; it stops on an error, an empty page or the end of the history, and the focus moves to « Début de l'historique » only when the chain ends there. A failure before anything shows reads « L'historique n'a pas pu être chargé. » with « Réessayer » (`fetchNextPage`), never an empty state; once entries show, « Charger plus » stays with its error line. A refresh after a record change, or a remount, reloads the first page only (the cache drops the other pages). | Keyset pages of 50 rows can cut a 72-motif save in two: « a ajouté 50 motifs », then « 72 » after « Charger plus », would be wrong. No server change (lane A owns the migrations). |
| P4-102 | **Creation and redaction** (« déléguée — révisable », 4a.15): « a créé le dossier » shows Prénom, Nom, Courriel (and « Compte de connexion : Lié » when linked); the empty 1:1 rows of the same save are folded into it; French, added by `create_professional`, is its own entry. A redacted field of an insert never appears; of an update, only « a modifié la ville » and « Ville : (masqué) ». | The trigger writes « [redacted] » for every redacted key of an insert, even a null one (4a.4 note): reading it as « a renseigné » would be false. |
| P4-103 | **Sentences, values and silences** (« déléguée — révisable », 4a.15): one changed field carries its values in the sentence (« a modifié la province : QC → ON »), except free texts (présentation, approche, notes, raisons) and redacted fields; several fields are named (« a modifié le genre, les années d'expérience et la ville ») with the values in the details. Status rows read as what happened (« a activé / réactivé / désactivé le dossier (raison : …) », « a activé le dossier incomplet », « a changé le statut : À inviter → À réviser »); the deactivation note, the override reason (a free text) and the account change are in the details. A title losing the « principal » flag says nothing (the new primary does); an added title shows its licence when there is one and « Titre principal : Oui » only when it is the primary; an updated title row is named through the record and the loaded rows, else « Titre archivé ». A payer the tab does not know reads « le numéro de payeur », never its key. A table the tab does not know yet reads « a modifié une autre section du dossier » (« a consulté une section du dossier » for a `read` row), never its name or its values. Values: never a UUID-shaped string or « [redacted] » (« (valeur non affichable) », « (masqué) »), an object or a list reads « (valeur non affichable) », not « (vide) ». In every set, archived items come after the active ones, unknown ones last. | Short, scannable lines; no value, id or JSON the reader should not see (D5). |
| P4-104 | **Who, when no person is named** (« déléguée — révisable », 4a.15): « L'importation » (`seed`, `import…`), « Une mise à jour du système » (`migration:…`), « Le système » (other sources, `bootstrap` and `service` included), « Une personne qui n'a plus accès » (an actor id the clinic no longer names). The plan said « Importation » / « Mise à jour du système ». | Each entry reads « {qui} {a fait quoi} »: the subject must read as French (« L'importation a ajouté 72 motifs »). |
| P4-105 | **« Modifications » leaves out consultations** (« déléguée — révisable », 4a.15): the filter « Tout · Modifications » runs on the loaded pages; « Modifications » hides `read` rows (« a affiché le NAS », « a affiché le numéro de compte », « a consulté des données privées », 4a.17). Until 4a.17 and 4b.3 (« Courriels ») both views are the same. | The plan names the filter; consultations are the only rows that are not changes. |
| P4-106 | **Tab data prefetch is a field of the tab registry** (« déléguée — révisable », 4a.15): `RecordTabDef.prefetch?(queryClient, id)` runs with the chunk preload on tab hover or focus; Historique uses `prefetchProfessionalHistory` (fresh 30 s, so opening the tab makes no second request). | 4a.18 (Rémunération) can do the same without a special case in `RecordTabs`. |

---

## Écarts relevés entre les documents (inconsistencies found)

Resolved above or handled by a task; listed so reviewers can check them.

1. **Notifications ownership.** Phase 3 design §1: « Out of scope: in-app notifications (with Professionnels 4c) ». Professionnels design §7: « Not in the Phase 3 list yet; please add it. » → settled by the Phase 3 plan (P3-15, Tasks 3.12–3.13); P4-30.
2. **Storage path and signed-URL TTL.** Professionnels A4.4 / §7: 1 h, name in the path; Phase 3 §7: 5 min, `{file_id}.{ext}`. → P3-20, P4-29.
3. **Template keys.** Professionnels §7 / §5.5: `professional.invite`, `contract.sent`, `professional.service_contract`; Phase 3: `professionals.*` for email and document templates, Documenso sends signing emails, no `document_expired` / weekly reminder key. → P3-3, P3-20, P4-29, P4-50.
4. **« Intégrations » section.** Phase 3 §9: « arrives with Google Places in Professionnels 4a »; Professionnels Q12: Places comes with Clients. → P4-12: no « Intégrations » section in Phase 4.
5. **Insurance job time.** Professionnels §3.4: « daily job at 06:00 » (clinic); Phase 3 design §8: « daily 11:00 » UTC = 06:00 EST / 07:00 EDT. → P3-22: `local_hour = 6`, 06:00 clinic time all year (P4-45).
6. **Years of experience** 0–50 (A3.4) vs 0–60 (§3.3). → P4-33.
7. **Keys English** (§3.1) vs French legacy keys. → P4-31.
8. **Motifs `label` vs `name`** (§3.2). → P4-32.
9. **Duplicate email « all profiles »** (A1.3) vs Phase 3 Q8. → P4-34.
10. **Creation dialog without licence** vs licence required for regulated titles. → P4-35.
11. **History by child ids** misses deleted rows. → P4-36.
12. **Legacy document type `license` means the image-rights consent**, not a licence attestation (`_legacy/src/professionals/mappers.ts` `REQUIRED_DOCUMENTS`: `type: 'license'`, « Consentement droit à l'image »; the untracked compliance migration calls it `license_missing`). The design's new type « attestation de permis » is unrelated. → the rebuild never uses the word `license` for a document type (`image_consent`, `licence_attestation`); 4a.19 and 4c.2 note the mapping.
13. **Design-system tab list** (8 tabs incl. Contrats, Courriels) vs design §5.3 (7 tabs). → P4-13.
14. **Design-system creation dialog** « Nom complet » vs design Prénom / Nom. → design §5.2 (Prénom*, Nom*), A1.3.
15. **Design-system statuses** « En attente » (`pending`) vs design `in_review` « À réviser ». → design §3.4.
16. **Phase 2 plan commits use `git add -A`.** This worktree is shared with other agents: every commit in this plan stages explicit paths only (memory: subagent git hygiene).
17. **Editable roles (decision #40, Task 2.20) are not on `feat/phase-2-core-settings` yet** (commit `18b07bd` is on `feat/phase-2-roles`). Role defaults inserted in `role_permissions` reach clinics only through 2.20's template-propagation trigger. → 4a.0 precondition.
18. **Phase 3 `accept-invite` « purpose handler »** vs Phase 3's own rule « a core function never imports module code ». → settled by P3-16: `secure_link_purposes.resolve_rpc` / `accept_rpc` (Task 3.17).
19. **`StarToggle`** (`src/shared/ui/star-toggle.tsx`) hard-coded French strings instead of `t()`; unused, it was deleted in the Phase 2 review. → recreated with `t()` labels in 4a.12.
20. **Conventions §5b example** shows `professionals_directory` with `display_name` / `is_active`, which the real view does not have. → updated in 4a.20.
21. **The two untracked migrations would break a local `db reset` run from the main checkout**: they target the legacy schema (`label_fr`, `icon_name`, `display_order`, `document_instances`, `professional_questionnaire_submissions`). CI never sees them (untracked). → « Mise en service » item 14; not moved by this plan.
22. **Phase 3 `/invitation` always navigates to `/accueil`** after acceptance (Task 3.21), while a new professional must land on the questionnaire. → 4b.2 passes an optional `redirect` (app path) from the `accept_rpc` result through `accept-invite` to the page, validated by `safeRedirect`; Accueil also shows « Complétez votre profil » to a provider with an open submission (fallback).
23. **Notification content.** The Professionnels plan draft used PS Hub's `event_key` + params; Phase 3 stores a French `title` / `body` (Task 3.12). → Phase 3 wins; 4c.1 defines the French texts, with names and dates only (no clinical content).
24. **Profile-update links.** Phase 3 design §3.1 plans a `profile_update` purpose for Phase 4; Phase 3 Task 3.20 says session-only purposes have their own module flow. → P4-44: no token for update requests.

---

## Q21 — the two untracked migrations (read-only review)

Location: `/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/supabase/migrations/` (main checkout, untracked, not in `legacy-v1`). They are siblings of the tracked legacy `20260207000002_tighten_specialty_category_check.sql` (commit `7d5d48c`), so they are the legacy app's last work in progress. **Not moved, edited or deleted.**

### `20260207000001_motifs_v2_categories_and_items.sql` (337 lines)

- Replaces the 72 motifs / 8 categories with **107 motifs in 10 categories**: deactivates every category, upserts 10 new ones by key, upserts 107 motifs by key (label, category, reactivate), then deactivates every motif not in the list. No hard delete; UUIDs kept where keys match; idempotent.
- Categories (key, label, icon): `sante_mentale` « Santé mentale / Troubles psychologiques » (Brain) · `personnalite` « Personnalité et comportements » (UserCog) · `dependances` (Repeat) · `couple_famille` « Couple, famille et parentalité » (Users) · `sante_physique` (HeartPulse) · `neurodeveloppement` (GraduationCap) · `sexualite_identite` (Heart) · `violence_abus` « Violence / abus / victimisation » (ShieldAlert) · `travail_carriere` (Briefcase) · `autres` (MoreHorizontal). Counts 23 / 8 / 6 / 16 / 7 / 12 / 9 / 8 / 9 / 9.
- Overlap with `legacy-v1`: **38 keys kept, 34 legacy keys retired** (e.g. `consommation_alcool`, `identite_genre`, `identite_raciale`, `guerre_conflit_arme_veterans`, `insomnie`, `trouble_bipolaire`, `victime_violence`), **69 new keys**. No motif is restricted.

**What informs the rebuild:**
- **Adopted:** the swap strategy (upsert by key, deactivate the rest, never delete) is exactly our soft-delete rule; a later list change uses it in a migration that seeds every org (4a.20 writes the follow-up).
- **Not adopted now:**
  - category names are diagnostic (« Troubles psychologiques », « Personnalité » with « Trouble de personnalité limite (TPL) »), against the non-clinical rule (CLAUDE.md §1, design principle 1); the legacy-v1 « sphères de vie » (Vie intérieure, Relations et famille…) fit it;
  - 34 retired keys would orphan legacy mappings (veterans, racial identity…) without anyone deciding to drop them;
  - 5 of its 10 icons (UserCog, Repeat, HeartPulse, ShieldAlert, MoreHorizontal) are outside the 20-icon set of the categories editor.
- **To decide later (Mise en service item 4):** if the clinic prefers v2 (it may mirror GOrendezvous' list), apply it as a reviewed follow-up migration with the same strategy, renamed categories, and the icon set extended.

### `20260207000003_professional_compliance_check.sql` (471 lines)

- **What it does:** widens `professionals.deactivation_reason` to `manual`, `insurance_expired`, `photo_missing`, `insurance_missing`, `license_missing`, `license_expired`, `contract_unsigned`; adds `check_professional_compliance(p_id)` that **deactivates an active professional automatically** when: no verified photo → no verified, unexpired insurance → no valid image-rights consent (a verified `license` document, or an approved questionnaire's electronic consent signed < 12 months ago) → no signed `contrat_service` document instance. Triggers on `professional_documents` (delete, verify / expiry change) and `document_instances` (contract status), **automatic reactivation** when the missing item is fixed, and a cron function `deactivate_noncompliant_professionals()` looping over active professionals. Manual deactivations are never overwritten.
- **Rejected:** automatic deactivation and reactivation (contradicts A4.5 / P4-1, approved by Jonathan); `security definer` with `search_path = public` and functions in `public`; a per-professional loop calling a function per row (N+1); reasons stored as free text.
- **Adopted as input:**
  - the **readiness definition** for 4c/4d: verified photo; verified insurance with `expires_on >= clinic today`; valid image-rights consent (verified document **or** e-consent within 12 months; 3-month withdrawal notice, A3.5); signed service contract. 4c.2 and 4d.1 extend `private.professional_readiness` with exactly these items;
  - the distinction **missing vs expired** for « À surveiller » wording (« Assurance manquante » / « Assurance expirée »);
  - the `license` = consent naming trap (inconsistency 12).

---

## Ground rules for the executor

- **Where:** create the branch `feat/phase-4-professionals` from `feat/phase-2-core-settings` (task 4a.0) in a new worktree, `/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/.claude/worktrees/phase-4-professionals`, unless the coordinator names another. Lanes get their own worktrees (§ « Lanes »).
- **Read first:** `CLAUDE.md`, `docs/standards/database-conventions.md`, the [design](2026-10-08-professionals-module-design.md), this plan's decisions, and for 4b–4d the [Phase 3 plan](2026-10-08-phase-3-shared-services-plan.md) (decisions P3-1…P3-30 and the tasks named in each « Depends on »). When the built Phase 3 code differs from a name used here, **Phase 3 wins** and the task records the rename.
- **Approvals:** nothing in this plan pushes, opens a PR, or touches staging. No secrets anywhere (code, tests, chat, git). Everything external (Resend, Documenso, storage API, Google) is mocked in tests. Merging to `main` deploys migrations to staging: push, PR and merge each need Jonathan's go-ahead.
- **Git hygiene (shared worktrees):** never `git commit -a`, `git add -A`, `git add .` or `git stash`. Stage the files the task lists, by path: `git add <path> <path> && git commit -m "…"`. Commits are Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Docker / local stack:** `open -a OrbStack`, then `npm run db:start` (ports 553xx; never PS Hub's 543xx).
- **Shared local database:** one Supabase stack serves every worktree (Phase 3 lanes included). **At most one lane runs `db:reset` at a time.** A database run is one locked unit under the shared DB token (P4-46): `scripts/with-db-lock.sh bash -c 'npm run db:reset && …'`. Never assume the schema left by another lane: reset at the start of every locked unit.
- **`functions_are`:** every task that adds a `public` function adds it to `supabase/tests/database/003_core_module_settings_secrets.test.sql` in the same commit (P4-47).
- **Edge functions (4b–4d):** Phase 3 shape (P4-48): `handler.ts` + `index.ts`, `Deps` injection, RPC-only database access, `_shared/testing/` fakes, `_shared/report.ts`.
- **After every migration** (inside the lock):
  ```bash
  scripts/with-db-lock.sh bash -c 'npm run db:reset && npm run db:test && npm run db:types'
  ```
  and once per task also with `supabase db reset --no-seed && supabase test db` (conventions §10).
- **Before every commit:**
  ```bash
  npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run
  ```
- **Migration names:** `$(date -u +%Y%m%d%H%M%S)_<name>.sql`, seconds ≠ `00`, created **when the task runs** (so 4b–4d migrations sort after the Phase 3 ones they need).
- **Error codes in SQL:** `42501` permission; `22023` invalid technical argument; `P0001` with a **French** message for anything a user can cause. The UI shows `P0001` as is through `moduleErrorMessage(error, fallback, 'professionals')`.
- **Regex:** `[0-9]`, never `\d`; blank checks `btrim(x, E' \t\r\n')`; one check constraint per column named `<table>_<column>_check`.
- **Detail level:** as in the Phase 2 plan, the infrastructure and one representative item per pattern are given in full (a reference table, a junction and its set RPC, the status RPCs, the list view, the history RPC, one settings section, the record shell). The others follow the same pattern with their fields, rules, messages and tests listed. Reproduce the pattern exactly.
- **PS Hub check (P4-39):** where a task says « PS Hub check », or whenever a choice is uncertain, read the PS Hub files named (read-only), follow them unless they conflict with our decisions or security rules, and record the deviation.
- **UI rules that apply to every screen:** FR-CA copy through `t()` (`modules.professionals.*`); non-clinical words (« motif », « besoin », « accompagnement », never « diagnostic », « trouble », « patient »); design system (one teal action per screen, status = dot + word, empty states = two lines); CLAUDE.md §10 tab order (X buttons and in-form section tabs out of the tab order; page-level record tabs are real Radix tabs, decision #35); no save on arrow keys (decision #36); dates through `@/shared/lib/timezone`, date-only fields (`expires_on`, `effective_from`) through `formatDateOnly*`.

## Efficiency and production-quality checks (every review)

Jonathan, 2026-10-08: « ensure the code is clean, efficient, this will be a prod app. » Each task's quality review checks, and the reviewer probes live:

1. **No query waterfalls.** A page issues its queries in parallel at mount; nothing waits on a first response to start a second request it could have started at once. The record page is **one** RPC (`get_professional_record`) plus the cached catalogue; tabs that need more (Historique, Rémunération) fetch when opened, and their chunk and data are prefetched on tab hover/focus. Check: the browser pane's network list on a cold record load shows ≤ 3 Supabase requests (access is already loaded), all started in the same tick.
2. **An index for every RLS, FK and list filter/sort path.** `000_invariants` covers FKs; the review also checks: `org_id` leading index on every table (RLS), `professionals (org_id, last_name, first_name)` (list sort), `professionals (org_id, status)`, junction `(org_id, <x>_id)` (FK + usage counts), the audit-history expression index, `(org_id, sort_order)` on reference tables. Check with `explain (analyze, buffers)` on the 200-professional fixture (4a.4 step).
3. **No N+1 in RPCs or list views.** Aggregates are computed once per statement (grouped subqueries joined by `professional_id`), never a function call or query per row in a loop; set RPCs replace a set with three statements (delete, insert, update), not one per item. Jobs (4c.4) select every due document in one query and send in batches.
4. **Bounded payloads.** The list loads at most `PROFESSIONALS_LIST_MAX = 500` rows (the API passes `.limit(501)` and shows « Affinez la recherche » beyond 500; ~50 today, < 200 expected), and returns ids/keys, never labels (resolved from the cached catalogue). History and email timelines use keyset pagination (50 per page). No RPC returns an unbounded array.
5. **Lazy-loaded UI.** Every route, settings section **and record tab** uses `lazyPage` (`@/shared/lib/lazy-page`); pickers and dialogs that pull heavy code (e.g. the motifs picker) are lazy too. The route-preload helper (`src/app/route-preload.ts`) picks module routes from the manifest automatically: keep paths in the manifest.
6. **Clean code.** No dead code, no duplicate helpers (reuse `src/shared/lib/format.ts`, the field schemas extracted in 4a.0, `useSettingsForm`, `FormActions`, `SettingsCard`, `FormField`), no `any`, named exports, functions under ~60 lines, comments that say *why*.

---

## Lanes and the shared database

| Lane | Branch / worktree | Tasks | Database |
|---|---|---|---|
| **A — Données** | `feat/phase-4-lane-db` | 4a.1 → 4a.2 → 4a.3 → 4a.4 → 4a.17 (after 4a.16) → 4a.19 (RPC part) → later 4b.1, 4b.2 (job migration), 4c.2, 4c.4 (job migration), 4c.5, 4d.1 | **Owns migrations.** Runs `db:reset` / `db:test` / `db:types` inside the lock. |
| **B — Paramètres** | `feat/phase-4-lane-settings` | 4a.6 → 4a.7 → 4a.8 → 4a.9 (after 4a.5) → 4a.18 (settings part) | Reads the local DB for browser checks, never resets it; Vitest mocks the API. |
| **C — Fiche** | `feat/phase-4-lane-record` | 4a.10 → 4a.11 → 4a.12 → 4a.13 → 4a.14 → 4a.15 (after 4a.5) → 4a.18 (tab part) | Same as B. |
| **D — Sécurité et import** | `feat/phase-4-lane-security` | 4a.16 (docs, workflow step) → 4a.19 (script part) | The health-check SQL of 4a.16 is handed to lane A. |

- **Order:** 4a.0 (coordinator) → lane A runs 4a.1–4a.4 while lane D starts 4a.16 → 4a.5 (coordinator, after 4a.4's types) → lanes B and C in parallel; lane A continues with 4a.17 once 4a.16 is merged.
- **Merges:** the coordinator merges a lane into `feat/phase-4-professionals` after its task passes both reviews (`git merge --no-ff feat/phase-4-lane-x -m "merge: Task 4a.N … (lane X)"`), then runs one locked `db:reset && db:test` and tells the other lanes to rebase. Lanes B and C rebase on the new types before using new RPCs.
- **With Phase 3:** both phases share one stack and **one DB token**, Phase 3's lock directory (P3-25, P4-46). Before acquiring it, merge the phase branch into the lane branch so its migrations folder is the newest; release it as soon as the run ends. Phase 3's « DB lane » and Phase 4's lane A never hold it at the same time.

## Dépendances Phase 3 (Phase 3 plan task numbers)

| Id | Phase 3 tasks | Provides (names as in the Phase 3 plan) | Needed by |
|---|---|---|---|
| D-3a | **3.1** permissions + `private.current_permission_keys()` (P3-21); **3.2** `consume_rate_limit`, `webhook_events`; **3.3** `scheduled_jobs` (`local_hour`, P3-22), `org_scheduled_jobs`, `scheduled_job_runs`, `list_job_orgs` / `start_job_run` / `finish_job_run`, `pg_cron` + `pg_net`; **3.4** `_shared` foundations (`deps.ts`, `http.ts` `readJson`, `jobs.ts`, `report.ts`, `testing/`); **3.5** « Tâches planifiées » | 4b.2, 4c.4 |
| D-3b | **3.6** `email_template_defaults` (`recipient_mode`, `allows_attachments`, P3-18), `email_log`, `list_subject_emails` (P3-26); **3.7** rendering; **3.8** `sendTemplatedEmail` + transports (Mailpit locally); **3.10** `send-email` (internal); **3.12** `notifications`, `private.notify`, `create_notification`; **3.13** bell (60 s polling, P3-24), « À surveiller », `_shared/notifications.ts` | 4b.1–4b.3, 4c.1–4c.5 |
| D-3d | **3.17** `secure_link_purposes` (`resolve_rpc`, `accept_rpc`, `creates_account`, P3-16), `private.issue_secure_link` / `consume_secure_link` / `revoke_secure_links`; **3.19** `_shared/links.ts` (`generateToken`, `hashToken`, `linkUrl`); **3.20** `resolve-link`, `accept-invite` (calls `accept_rpc`, deletes the user on failure), `users-set-status` (ban `876000h`); **3.21** `/invitation` page | 4b.1, 4b.2, 4b.6 |
| D-3e | **3.24** buckets, `upload_purposes` (`owner_permission`, `retain_days`), `stored_files` (`retain_until`, P3-17), the one read policy, `create_pending_upload`, `private.attach_stored_file`, `private.soft_delete_stored_file`, `register_system_file`; **3.25** content sniffing; **3.26** `storage-upload` / `storage-confirm` / `storage-cleanup`; **3.27** upload widget | 4b.4 (photo and insurance steps), 4c.2–4c.6, 4d |
| D-3f | **3.29** renderer spike; **3.30** `_shared/pdf/` (`PdfDocument`, `fillTemplate`, `loadAssets`, initials boxes, P3-19); **3.31** `document_templates` + versions RPCs, `create_signature_request`, `list_subject_signature_requests`; **3.32** Documenso fake; **3.33** `_shared/signing.ts` `createSignatureRequest`, `signing-webhook`, `signing-sync`; **3.34** « Signature électronique » | 4c.5 (3.29–3.30 only), 4d.1–4d.3 |

**Merge order.** `feat/phase-2-core-settings` → `main` first (Jonathan's go-ahead). **4a can merge to `main` on its own**, before or after Phase 3: it neither needs nor changes Phase 3 objects. Before starting 4b (and again before 4c and 4d), merge `main` (with the needed Phase 3 batches) into `feat/phase-4-professionals`. **Migration order rule:** before each Phase 4 PR, any Phase 4 migration not yet applied on staging whose timestamp sorts before the newest migration on `main` is renamed to a fresh `date -u` timestamp (its pgTAP file name does not change), then `db:reset && db:test` is re-run. Local order then equals staging order.

---
## Conventions used throughout

```ts
// One key factory per domain; mutations invalidate `all`.
export const professionalKeys = {
  all: ['professionals'] as const,
  list: () => [...professionalKeys.all, 'list'] as const,
  record: (id: string) => [...professionalKeys.all, 'record', id] as const,
  history: (id: string) => [...professionalKeys.all, 'history', id] as const,
  compensation: (id: string) => [...professionalKeys.all, 'compensation', id] as const,
  private: (id: string) => [...professionalKeys.all, 'private', id] as const,
}
export const professionalCatalogKeys = {
  all: ['professionals-catalog'] as const,
  catalog: () => [...professionalCatalogKeys.all, 'catalog'] as const,
  usage: () => [...professionalCatalogKeys.all, 'usage'] as const,
}
```

```sql
-- RPC skeleton (copy 20261007204045_core_tax_rates.sql). Every module RPC:
create function public.some_rpc(p_id uuid, p_x text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);   -- P0001 « Professionnel introuvable. » outside the org
  -- …
end;
$$;
revoke all on function public.some_rpc(uuid, text) from public, anon, authenticated;
grant execute on function public.some_rpc(uuid, text) to authenticated;
```

- `service_role` gets no grant unless a task says so (edge functions in 4b–4d get the service-role variants they need, named `…_for_service`).
- In plpgsql functions that `return query` with `returns table (…)` columns named like table columns: `#variable_conflict use_column` first, and every column qualified.
- **pgTAP fixtures** reuse the Phase 2 block (`supabase/tests/database/007_core_tax_rates.test.sql`): orgs A and B created **after** the migration (so seeding triggers run), one user per role in A (admin, conseillère, adjointe, provider), admin in B, module `professionals` enabled in both (`insert into public.org_modules`). Assert privileges with `table_privs_are` / `column_privs_are` / `function_privs_are`, never `throws_ok` on a function the role cannot execute (image `.106` crash). Filter by fixture ids, never count a whole table (the seed writes rows). Set `plan(n)` to the final count.
- **Vitest:** render with `renderWithContexts` (`src/test/contexts.tsx`) and `testAccess` overrides per role; API tests mock `@/core/supabase/client` as `src/core/settings/tax/api.test.ts` does.

---

# Batch 4a — Données, fiche, jumelage (independent of Phase 3)

## Task 4a.0: Branch and prerequisites

**Files:**
- Create: `scripts/with-db-lock.sh`
- Create: `src/shared/lib/field-schemas.ts` + `field-schemas.test.ts`; Modify: `src/core/settings/organization/schemas.ts` (import from it)
- Create: `src/shared/lib/shell-crumb.ts` (context + `useShellCrumb`), Modify: `src/app/shell/Topbar.tsx`, `src/app/AppShell.tsx`, `src/shared/lib/use-page-title.ts`; tests next to them
- Modify: `src/app/AuthenticatedApp.tsx` (+ test): timezone propagation
- Create: `playwright.config.ts`, `e2e/fixtures/accounts.ts`, `e2e/fixtures/auth.ts`, `e2e/smoke.spec.ts`; Modify: `package.json` (`@playwright/test`, scripts `e2e`, `e2e:install`), `.gitignore` (`playwright-report/`, `test-results/`), `.github/workflows/ci.yml` (job `e2e`), `tsconfig.json` / `eslint.config.js` (include `e2e/`)

**Step 1: Preconditions.**
```bash
cd "/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/.claude/worktrees/clinique-mana-architecture-477a6b"
git log --oneline feat/phase-2-core-settings | grep -i "editable roles"
```
Expected: the Task 2.20 commit (`feat(db): editable roles per clinic …`). If it is missing, stop and tell the coordinator: role defaults of 4a.1 must reach clinics through 2.20's `org_role_permissions` template trigger. Also check `src/shared/lib/lazy-page.ts` is committed (`git log --oneline -- src/shared/lib/lazy-page.ts` shows `perf(routing)`).

**Step 2: Branch and worktree.**
```bash
git worktree add "/Users/jonathanharvey/Documents/Claude Projects/Clinique-Mana/.claude/worktrees/phase-4-professionals" -b feat/phase-4-professionals feat/phase-2-core-settings
```
Expected: a new worktree on `feat/phase-4-professionals`. All later paths are relative to it.

**Step 3: Database lock.** `scripts/with-db-lock.sh` (executable):
```bash
#!/usr/bin/env bash
# One Supabase stack serves every worktree (Phase 3 and Phase 4 lanes). Only one
# lane may reset or test it at a time: run DB work as `scripts/with-db-lock.sh <cmd…>`.
set -euo pipefail
# Same directory as Phase 3's DB token (P3-25): shared by every worktree, untracked.
LOCK="$(git rev-parse --git-common-dir)/clinique-mana-db.lock"
until mkdir "$LOCK" 2>/dev/null; do
  echo "[db-lock] waiting: another lane holds the DB token…"; sleep 5
done
trap 'rmdir "$LOCK"' EXIT
"$@"
```
It creates and removes exactly the directory Phase 3's protocol uses (`mkdir` / `rmdir`, no files inside), so a Phase 3 lane acquiring the token by hand and a Phase 4 lane using the script exclude each other. If Phase 3 already committed a wrapper, use it and skip this file.

**Step 4: Shared field schemas (refactor, no behaviour change).** Move the private helpers of `src/core/settings/organization/schemas.ts` that the module reuses (required/optional trimmed text with `withoutControlChars`, `EMAIL`, phone through `parsePhone`, postal code, `PROVINCES`) into `src/shared/lib/field-schemas.ts` as named exports; `organization/schemas.ts` imports them. Run its existing tests unchanged: they must pass without edits. Add `field-schemas.test.ts` for the moved helpers (same cases as the organization tests).

**Step 5: `useShellCrumb` (Phase 2 follow-up).** A small context: `ShellCrumbProvider` in `AppShell`, `useShellCrumb(label: string | null)` sets the last crumb while the calling page is mounted (cleared on unmount). The Topbar renders « {nav label} / {crumb} », the nav label a link. `usePageTitle` gains an optional second argument so a detail page sets both from one value: `usePageTitle(name, { crumb: true })`. Tests: the crumb shows and links back; it is cleared on unmount; the tab title equals « {name} · Clinique MANA » (existing format).

**Step 6: Clinic time zone propagation (Phase 2 follow-up).** In `AuthenticatedApp`, key the routed tree on `access.org_timezone` (`<Fragment key={tz}>`), so a « Région » change remounts every memoised subtree with the new zone. Test: re-rendering with another `org_timezone` remounts a probe component (mount counter) and `getClinicTimezone()` returns the new zone.

**Step 7: Playwright.** PS Hub check: `NEW PS Hub/playwright.config.ts` and `e2e/fixtures/auth.ts`. Follow their structure (config, fixtures folder, trace on retry, screenshots on failure). **Deviations (record them):** no remote URL fallback (PS Hub hard-codes its Supabase URL); log in through the real login page, not by injecting a session; the base URL is `http://localhost:5173` only, and the fixture refuses any other host.
- `e2e/fixtures/accounts.ts`: the four seed logins and their documented local password, with the comment « local seed only, `supabase/seed.sql` header ».
- `playwright.config.ts`: `testDir: 'e2e'`, `use.baseURL: 'http://localhost:5173'`, `webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true }`, Chromium only, `workers: 1` (one shared database).
- `e2e/smoke.spec.ts`: admin signs in, sees « Accueil », signs out.
- `package.json`: `"e2e": "playwright test"`, `"e2e:install": "playwright install chromium"`.
- `ci.yml` job `e2e` (after the DB job pattern): `supabase start` (with seed), write `.env.local` from `supabase status -o env` (`API_URL` → `VITE_SUPABASE_URL`, `ANON_KEY` → `VITE_SUPABASE_ANON_KEY`), `npx playwright install --with-deps chromium`, `npm run e2e`, upload `playwright-report/` on failure.

Run: `scripts/with-db-lock.sh bash -c 'npm run db:reset && npm run e2e'`. Expected: 1 passed.

**Step 8: Checks and commits (one per step 3–7).**
```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run
git add scripts/with-db-lock.sh && git commit -m "chore(db): lock script so one lane resets the shared local stack at a time"
git add src/shared/lib/field-schemas.ts src/shared/lib/field-schemas.test.ts src/core/settings/organization/schemas.ts && git commit -m "refactor(shared): field schemas shared by settings and modules"
# …same for the crumb, the time zone and Playwright, each with its own paths
```
Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 4a.1: Migration `professionals_reference_data` (permissions, reference lists, seeding)

**Files:**
- Create: `supabase/migrations/<ts>_professionals_reference_data.sql`
- Create: `supabase/tests/database/040_professionals_reference_data.test.sql`
- Modify: `supabase/tests/database/004_professionals_module.test.sql` (role-default assertion only if it lists every professionals permission; it asserts `professionals.view` alone, so expect no change)

**Step 1: Write the failing pgTAP test** `040_professionals_reference_data.test.sql`. Fixtures as in Conventions. Assert:
- **Permissions:** the 7 new keys exist with `module_key = 'professionals'`. Role template (`role_permissions`) for `professionals.%`, exact sets:
  - `admin`: `activate_override, compensation, manage, matching, private, self, settings, view`;
  - `admin_assistant`: `manage, matching, view`;
  - `counselor`: `matching, view`;
  - `provider`: `self`.
  Behaviour (as each fixture user): `has_permission('professionals.matching')` true for the conseillère, false for the provider; `professionals.self` true for the provider; `professionals.settings` false for the adjointe.
- **Tables:** `has_table` for the 9 tables. For each: `table_privs_are(… 'anon', array[]::text[])` and `(… 'authenticated', array['SELECT'])` (18 assertions).
- **Seeding** (org A, created after the migration): counts 6 orders, 9 categories, 9 titles, 7 clientèles, 10 approaches, 8 motif categories, 72 motifs, 3 languages, 4 deactivation reasons. Spot checks:
  - `psychologue` → order `opq`; `naturopathe` and `coach_professionnel` → no order; `nutritionniste` → `odnq`, category `nutrition`;
  - `children` 0–12, `adolescents` 13–17, `adults` 18–64, `seniors` 65–null, `couples` null–null;
  - `fr` « Français » `is_system`; the 7 clientèles and reason `other` are `is_system`; reason `collaboration_ended` has `disables_account`; `other` has `requires_note`;
  - motif `anxiete` is in category `inner_life`; the number of motifs without a category equals the legacy count (compute it from `_legacy/supabase/migrations/20260127000003_motif_category_assignments.sql` while writing the seed; expected 0 if every motif is assigned);
  - none of `issue`, `modality`, `lgbtq`, `indigenous`, `newcomers` exists (D7).
- **Idempotence:** as `postgres`, `select private.seed_professionals_reference('<org A>')` twice adds no row.
- **Audit:** org A has `audit_log` rows for `motifs` with `source = 'seed:professionals_reference'`, and the audit source setting is restored after seeding (`current_setting('app.audit_source', true)` equals what it was before the org insert).
- **RLS:** admin A, conseillère A and provider A each read 72 motifs; admin B reads only org B's; after `set_module_enabled('professionals', false)` in org B, admin B reads 0 motifs.
- **Integrity** (as `postgres`):
  - a `profession_titles` row in org A pointing at org B's category throws `23503` (composite FK, P4-40);
  - key `'Bad Key'` throws `23514`; icon `'Skull'` throws `23514`; clientèle `min_age 13, max_age 12` throws `23514`; a second `motifs` row named `ANXIÉTÉ` (case) in org A throws `23505`.

**Step 2: Run it and check that it fails.**
Run: `scripts/with-db-lock.sh npm run db:test`. Expected: 040 fails (tables and permissions missing).

**Step 3: Write the migration.** Header, then sections in this order.

```sql
-- =============================================================================
-- Professionnels: permissions and per-clinic reference lists
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.1–3.2, §4
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.1 (P4-6, P4-28, P4-31, P4-32, P4-40, P4-42)
-- * Lists are per clinic, seeded by a trigger on organizations (like tax_rates)
--   and for existing clinics below. Keys are immutable ASCII snake_case; seeded
--   rows keep their legacy keys. Names are French and editable.
-- * Soft delete only (is_active). is_system rows (clientèles, French, « Autre »)
--   cannot be archived: matching and creation rely on them.
-- * Read by staff (professionals.view) and providers (professionals.self);
--   written only through the settings RPCs of the next migration.
-- * unique (org_id, id) on every list: rows that reference them use composite
--   FKs, so a row can never point at another clinic's list.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_reference_data', true);

-- -----------------------------------------------------------------------------
-- Permissions (4a keys) and role defaults (template; decision #40 propagates them)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('professionals.manage',            'professionals', 'Gérer les dossiers des professionnels'),
  ('professionals.matching',          'professionals', 'Modifier le profil de jumelage'),
  ('professionals.activate_override', 'professionals', 'Activer un dossier incomplet (avec une raison)'),
  ('professionals.settings',          'professionals', 'Modifier les listes du module Professionnels'),
  ('professionals.compensation',      'professionals', 'Voir et modifier la rémunération'),
  ('professionals.private',           'professionals', 'Voir et modifier les renseignements fiscaux et bancaires'),
  ('professionals.self',              'professionals', 'Accéder à son propre dossier')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.manage'), ('admin', 'professionals.matching'),
  ('admin', 'professionals.activate_override'), ('admin', 'professionals.settings'),
  ('admin', 'professionals.compensation'), ('admin', 'professionals.private'),
  ('admin', 'professionals.self'),
  ('admin_assistant', 'professionals.manage'), ('admin_assistant', 'professionals.matching'),
  ('counselor', 'professionals.matching'),
  ('provider', 'professionals.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Read access to the lists (one helper for the nine policies)
-- -----------------------------------------------------------------------------
create function private.can_read_professionals_reference()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('professionals.view') or private.has_permission('professionals.self')
$$;
revoke all on function private.can_read_professionals_reference() from public, anon;
grant execute on function private.can_read_professionals_reference() to authenticated;
```

**The reference table pattern** (in full for `motif_categories` and `motifs`; the seven others follow it exactly):

```sql
create table public.motif_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  icon text not null default 'Brain',
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motif_categories_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint motif_categories_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint motif_categories_description_check check (length(btrim(description, E' \t\r\n')) between 1 and 300),
  -- The 20 Lucide icons of the categories editor (legacy category-editor-dialog.tsx).
  constraint motif_categories_icon_check check (icon in (
    'Brain', 'Users', 'AlertTriangle', 'Briefcase', 'GraduationCap', 'Fingerprint', 'Shield', 'Leaf', 'Heart', 'Activity',
    'Star', 'Zap', 'Cloud', 'Sun', 'Moon', 'Home', 'Target', 'Compass', 'Sparkles', 'MessageCircle')),
  constraint motif_categories_org_id_key_key unique (org_id, key),
  constraint motif_categories_org_id_id_key unique (org_id, id)
);
create unique index motif_categories_org_name_key on public.motif_categories (org_id, lower(normalize(name, NFKC)));
create index motif_categories_org_sort_idx on public.motif_categories (org_id, sort_order);

create table public.motifs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  category_id uuid,                       -- null, or an archived category: shown under « Autres »
  is_restricted boolean not null default false,
  is_system boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motifs_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint motifs_name_check check (length(btrim(name, E' \t\r\n')) between 1 and 120 and name = btrim(name, E' \t\r\n')),
  constraint motifs_org_id_key_key unique (org_id, key),
  constraint motifs_org_id_id_key unique (org_id, id),
  constraint motifs_category_fkey foreign key (org_id, category_id) references public.motif_categories (org_id, id)
);
create unique index motifs_org_name_key on public.motifs (org_id, lower(normalize(name, NFKC)));
create index motifs_org_category_idx on public.motifs (org_id, category_id);
create index motifs_org_sort_idx on public.motifs (org_id, sort_order);

-- Same block for every list:
revoke all on public.motif_categories, public.motifs from anon, authenticated;
grant select on public.motif_categories, public.motifs to authenticated;
alter table public.motif_categories enable row level security;
alter table public.motifs enable row level security;

create policy motif_categories_select on public.motif_categories
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy motifs_select on public.motifs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));

create trigger motif_categories_set_updated_at before update on public.motif_categories
  for each row execute function private.set_updated_at();
create trigger motif_categories_audit after insert or update or delete on public.motif_categories
  for each row execute function private.audit_trigger();
create trigger motifs_set_updated_at before update on public.motifs
  for each row execute function private.set_updated_at();
create trigger motifs_audit after insert or update or delete on public.motifs
  for each row execute function private.audit_trigger();
```

**The seven other lists** (common columns: `id, org_id, key, name, is_system, sort_order, is_active, created_at, updated_at`, the same key/name checks, `unique (org_id, key)`, `unique (org_id, id)`, `unique (org_id, lower(normalize(name, NFKC)))`, `(org_id, sort_order)` index, grants, policy, triggers):

| Table | Extra columns and checks |
|---|---|
| `professional_orders` | `acronym text not null` (`^[A-Z]{2,10}$`), `licence_label text not null default 'N° de permis'` (1–60), `licence_pattern text` (1–200; validated as a regex by `save_professional_order`) |
| `profession_categories` | — |
| `profession_titles` | `category_id uuid not null`, `order_id uuid` (null = not regulated, no licence required); composite FKs `(org_id, category_id)` → `profession_categories`, `(org_id, order_id)` → `professional_orders`; indexes `(org_id, category_id)`, `(org_id, order_id)` |
| `clienteles` | `min_age smallint`, `max_age smallint`; checks `min_age between 0 and 120`, `max_age between 0 and 120`, `max_age is null or min_age is not null`, `max_age is null or max_age >= min_age` |
| `specialties` | — (therapeutic approaches) |
| `languages` | `code text not null` (`^[a-z]{2}$`, ISO 639-1) **instead of** `key`; `unique (org_id, code)` |
| `deactivation_reasons` | `requires_note boolean not null default false`, `disables_account boolean not null default false` |

**Seeding** (one function, called by a trigger on new organizations and once here for existing ones):

```sql
create function private.seed_professionals_reference(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_reference', true);

  insert into public.professional_orders (org_id, key, name, acronym, sort_order) values
    (p_org, 'opq',     'Ordre des psychologues du Québec', 'OPQ', 10),
    (p_org, 'otstcfq', 'Ordre des travailleurs sociaux et des thérapeutes conjugaux et familiaux du Québec', 'OTSTCFQ', 20),
    (p_org, 'oppq',    'Ordre des psychoéducateurs et psychoéducatrices du Québec', 'OPPQ', 30),
    (p_org, 'opsq',    'Ordre professionnel des sexologues du Québec', 'OPSQ', 40),
    (p_org, 'occoq',   'Ordre des conseillers et conseillères d''orientation du Québec', 'OCCOQ', 50),
    (p_org, 'odnq',    'Ordre des diététistes-nutritionnistes du Québec', 'ODNQ', 60)
  on conflict do nothing;

  insert into public.profession_categories (org_id, key, name, sort_order) values
    (p_org, 'psychologie', 'Psychologie', 10), (p_org, 'psychotherapie', 'Psychothérapie', 20),
    (p_org, 'travail_social', 'Travail social', 30), (p_org, 'psychoeducation', 'Psychoéducation', 40),
    (p_org, 'sexologie', 'Sexologie', 50), (p_org, 'naturopathie', 'Naturopathie', 60),
    (p_org, 'orientation', 'Orientation', 70), (p_org, 'coaching_professionnel', 'Coaching professionnel', 80),
    (p_org, 'nutrition', 'Nutrition', 90)
  on conflict do nothing;

  insert into public.profession_titles (org_id, key, name, category_id, order_id, sort_order)
  select p_org, t.key, t.name, c.id, o.id, t.sort_order
    from (values
      ('psychologue',            'Psychologue',                       'psychologie',            'opq',     10),
      ('psychotherapeute',       'Psychothérapeute',                  'psychotherapie',         'opq',     20),
      ('travailleur_social',     'Travailleur.euse social.e',         'travail_social',         'otstcfq', 30),
      ('psychoeducateur',        'Psychoéducateur.trice',             'psychoeducation',        'oppq',    40),
      ('sexologue',              'Sexologue',                         'sexologie',              'opsq',    50),
      ('naturopathe',            'Naturopathe',                       'naturopathie',           null,      60),
      ('conseiller_orientation', 'Conseiller.ère en orientation',     'orientation',            'occoq',   70),
      ('coach_professionnel',    'Coach professionnel.le certifié.e', 'coaching_professionnel', null,      80),
      ('nutritionniste',         'Nutritionniste',                    'nutrition',              'odnq',    90)
    ) as t(key, name, category_key, order_key, sort_order)
    join public.profession_categories c on c.org_id = p_org and c.key = t.category_key
    left join public.professional_orders o on o.org_id = p_org and o.key = t.order_key
  on conflict do nothing;

  insert into public.clienteles (org_id, key, name, min_age, max_age, is_system, sort_order) values
    (p_org, 'children', 'Enfants', 0, 12, true, 10), (p_org, 'adolescents', 'Adolescents', 13, 17, true, 20),
    (p_org, 'adults', 'Adultes', 18, 64, true, 30), (p_org, 'seniors', 'Aînés', 65, null, true, 40),
    (p_org, 'couples', 'Couples', null, null, true, 50), (p_org, 'families', 'Familles', null, null, true, 60),
    (p_org, 'groups', 'Groupes', null, null, true, 70)
  on conflict do nothing;

  -- Approaches: the legacy therapy_type rows, keys and names unchanged
  -- (_legacy/supabase/migrations/20260118000003_professionals_schema.sql, lines 352–361).
  insert into public.specialties (org_id, key, name, sort_order) values
    (p_org, 'cbt', 'Thérapie cognitivo-comportementale (TCC)', 10), (p_org, 'psychodynamic', 'Thérapie psychodynamique', 20),
    (p_org, 'humanistic', 'Approche humaniste', 30), (p_org, 'systemic', 'Thérapie systémique', 40),
    (p_org, 'gestalt', 'Gestalt-thérapie', 50), (p_org, 'emdr', 'EMDR', 60),
    (p_org, 'act', 'Thérapie d''acceptation et d''engagement (ACT)', 70),
    (p_org, 'dbt', 'Thérapie comportementale dialectique (DBT)', 80),
    (p_org, 'art_therapy', 'Art-thérapie', 90), (p_org, 'play_therapy', 'Thérapie par le jeu', 100)
  on conflict do nothing;

  -- Motif categories: legacy 20260127000002_motif_categories_seed.sql (keys, names,
  -- descriptions, icons, order) — copy all 8 rows. Motifs: the 72 rows of
  -- 20260118000008_motifs_seed.sql (keys and names exactly as there, P4-21), with the
  -- category of 20260127000003_motif_category_assignments.sql, sort_order = 10 × the
  -- row's rank by name. One insert … select … from (values …) join motif_categories,
  -- as for profession_titles above.
  -- …

  insert into public.languages (org_id, code, name, is_system, sort_order) values
    (p_org, 'fr', 'Français', true, 10), (p_org, 'en', 'Anglais', false, 20), (p_org, 'es', 'Espagnol', false, 30)
  on conflict do nothing;

  insert into public.deactivation_reasons (org_id, key, name, requires_note, disables_account, is_system, sort_order) values
    (p_org, 'leave', 'Congé', false, false, false, 10),
    (p_org, 'collaboration_ended', 'Fin de collaboration', false, true, false, 20),
    (p_org, 'insurance_expired', 'Assurance expirée', false, false, false, 30),
    (p_org, 'other', 'Autre', true, false, true, 40)
  on conflict do nothing;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_reference(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_reference
  after insert on public.organizations
  for each row execute function private.seed_professionals_reference_on_org();

revoke all on function private.seed_professionals_reference(uuid), private.seed_professionals_reference_on_org()
  from public, anon, authenticated, service_role;

select private.seed_professionals_reference(o.id) from public.organizations o;
```

**Review follow-ups (applied in the migration, which is the reference where this sketch differs):** names, licence labels and patterns and descriptions use `char_length(…) between 1 and N and private.is_tidy_text(…)` (no leading or trailing Unicode whitespace, no control or invisible character: the classes of `valid_role_name` / `roles_name_no_control_chars`); the 9 name indexes are `(org_id, lower(normalize(name, NFKC)))` like `roles_org_id_name_key`; one `before update` trigger function, `private.freeze_reference_identity()`, refuses changes to `key` / `code` / `org_id` on the 9 tables; `can_read_professionals_reference()` is true for any of the 8 professionals keys (view, every staff key a person may hold by override, and self); the seed matches a row holding a seeded name under another key instead of adding a copy, and attaches titles and motifs to it; seeded labels follow P4-51.

**Step 4: Run the database checks** (inside the lock): `npm run db:reset && npm run db:test && npm run db:types`, then `supabase db reset --no-seed && supabase test db`. Expected: all green, `000_invariants` included (every new table has `org_id`, RLS, an audit trigger and indexed FKs). Check the local seed org was seeded:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -c "select count(*) from public.motifs"
```
Expected: `72`. If a Phase 1–2 test counts `audit_log` rows without a `table_name` filter, add the filter; never change the expected number.

**Step 5: Commit.**
```bash
git add supabase/migrations/<ts>_professionals_reference_data.sql supabase/tests/database/040_professionals_reference_data.test.sql src/core/supabase/database.types.ts
git commit -m "feat(db): professionals permissions and per-clinic reference lists"
```

---

## Task 4a.2: Migration `professionals_reference_settings` (settings RPCs, catalogue, module settings)

**Files:**
- Create: `supabase/migrations/<ts>_professionals_reference_settings.sql`
- Create: `supabase/tests/database/041_professionals_reference_settings.test.sql`

**Step 1: Write the failing pgTAP test.** Assert:
- **`function_privs_are`:** every `save_*`, `set_professionals_reference_active`, `reorder_professionals_reference`, `get_professionals_catalog`, `set_professionals_settings`, `get_professionals_settings` executable by `authenticated`, not by `anon`; `private.reference_key` and `private.professionals_setting` executable by nobody but the owner.
- **`private.reference_key`** (as postgres): `'Thérapie d''impact'` → `therapie_d_impact`; `'  Œuvre  sociale '` → `oeuvre_sociale`; `'2e ligne'` → `k_2e_ligne`; `'!!!'` → `item`; a 70-character name → 50 characters without a trailing `_`.
- **`save_motif`** (admin A): create `('Proche aidance', <inner_life id>, false)` returns an id with key `proche_aidance`; creating `'Proche-aidance'` throws P0001 « Un motif porte déjà ce nom… » only if the lowercase names match (they do not: assert the second create succeeds with key `proche_aidance_2`); renaming keeps the key; a category of org B throws P0001 « Catégorie introuvable ou archivée. »; `'  '` throws P0001.
- **Each other `save_*`:** one create and one update (key immutable on update), plus its own rules:
  - `save_professional_order`: acronym `'opq'` → P0001 « Sigle : 2 à 10 lettres majuscules. »; pattern `'['` → P0001 « Format de permis invalide. »;
  - `save_profession_title`: archived category → P0001;
  - `save_clientele`: `(13, 12)` → P0001 « L'âge maximum doit être supérieur ou égal à l'âge minimum. »;
  - `save_language`: code `'EN'` normalised to `en`; duplicate code → P0001 « Cette langue existe déjà. »; changing the code of an existing row → P0001 « Le code d'une langue ne change pas. »;
  - `save_deactivation_reason`: flags stored.
- **`set_professionals_reference_active`:** archiving a motif succeeds and it disappears from `motifs_catalog`; restoring it brings it back; archiving clientèle `children`, language `fr` or reason `other` → P0001 « Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé. »; archiving a category with active titles → P0001 « Archivez d'abord les titres de cette catégorie. »; unknown kind → `22023`.
- **`reorder_professionals_reference('motif_categories', array[c3, c1, c2])`:** sort orders become 10, 20, 30 in that order; an id of org B → `22023`.
- **`get_professionals_catalog()`** (conseillère A): a JSON object with the 9 arrays; `motifs` has 72 entries including archived ones flagged `is_active: false`; no `org_id` key anywhere. As admin B: only org B's rows.
- **Catalogue views** `motifs_catalog`, `clienteles_catalog`, `languages_catalog`: active rows only; a motif whose category is archived has `category_id` null.
- **Module settings:** `get_professionals_settings()` returns `{"collect_sin": false}` by default; `set_professionals_settings('{"collect_sin": true}')` as admin succeeds; as the adjointe with an override `professionals.settings = true` but without `professionals.private` → `42501`; `'{"unknown": 1}'` → `22023`; `'{"collect_sin": "yes"}'` → `22023`.
- **Permissions:** the adjointe (no `professionals.settings`) gets `42501` from `save_motif`; the conseillère gets `42501` too.
- **Audit:** a `save_motif` rename writes an `update` row with `name` before/after.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
create extension if not exists unaccent with schema extensions;

-- Key from a French name: lower ASCII snake_case, ≤ 50, starts with a letter.
create function private.reference_key(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  with k as (
    select pg_catalog.rtrim(pg_catalog.left(pg_catalog.btrim(
             pg_catalog.regexp_replace(pg_catalog.lower(extensions.unaccent(coalesce(p_name, ''))), '[^a-z0-9]+', '_', 'g'),
             '_'), 50), '_') as v
  )
  select case when v = '' then 'item' when v ~ '^[0-9]' then pg_catalog.rtrim(pg_catalog.left('k_' || v, 50), '_') else v end from k
$$;
revoke all on function private.reference_key(text) from public, anon, authenticated, service_role;
```
Check in the test that `unaccent` maps « œ » to « oe »; if it does not, add `replace(p_name, 'œ', 'oe')` before `unaccent`.

**`save_motif`** (the representative save RPC; the others follow it). Names follow 4a.1's checks (review follow-up): strip Unicode whitespace at both ends and refuse control or invisible characters with a French `P0001` before the insert (same classes as `valid_role_name` and `private.is_tidy_text`), and compare names as `lower(normalize(…, NFKC))` like the unique indexes:

```sql
create function public.save_motif(p_id uuid, p_name text, p_category_id uuid, p_is_restricted boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_name text := pg_catalog.btrim(coalesce(p_name, ''), E' \t\r\n');
  v_base text;
  v_key text;
  v_n int := 1;
  v_id uuid;
begin
  if not private.has_permission('professionals.settings') then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  if pg_catalog.length(v_name) not between 1 and 120 then
    raise exception 'Le nom compte de 1 à 120 caractères.' using errcode = 'P0001';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.motif_categories c where c.org_id = v_org and c.id = p_category_id and c.is_active
  ) then
    raise exception 'Catégorie introuvable ou archivée.' using errcode = 'P0001';
  end if;

  -- One writer per clinic: the name check and the key search below must not race.
  perform 1 from public.organizations o where o.id = v_org for no key update;

  if exists (
    select 1 from public.motifs m
     where m.org_id = v_org
       and pg_catalog.lower(pg_catalog.normalize(m.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
       and m.id is distinct from p_id
  ) then
    raise exception 'Un motif porte déjà ce nom (il est peut-être archivé).' using errcode = 'P0001';
  end if;

  if p_id is null then
    v_base := private.reference_key(v_name);
    v_key := v_base;
    while exists (select 1 from public.motifs m where m.org_id = v_org and m.key = v_key) loop
      v_n := v_n + 1;
      v_key := pg_catalog.rtrim(pg_catalog.left(v_base, 46), '_') || '_' || v_n;
    end loop;
    insert into public.motifs (org_id, key, name, category_id, is_restricted, sort_order)
    values (v_org, v_key, v_name, p_category_id, coalesce(p_is_restricted, false),
            coalesce((select max(m.sort_order) from public.motifs m where m.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.motifs m
       set name = v_name, category_id = p_category_id, is_restricted = coalesce(p_is_restricted, m.is_restricted)
     where m.id = p_id and m.org_id = v_org
    returning m.id into v_id;
    if v_id is null then
      raise exception 'Motif introuvable.' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;
```

Other save RPCs (same shape, same messages with their noun, all `returns uuid`, all `professionals.settings`):

| RPC | Arguments after `p_id, p_name` | Extra rules |
|---|---|---|
| `save_professional_order` | `p_acronym text, p_licence_label text, p_licence_pattern text` | acronym upper-cased, `^[A-Z]{2,10}$`; pattern validated with `perform '' ~ p_licence_pattern` inside `begin … exception when invalid_regular_expression then raise … P0001 'Format de permis invalide.'` |
| `save_profession_category` | — | — |
| `save_profession_title` | `p_category_id uuid, p_order_id uuid` | category active, order active or null; changing the order does not touch existing licences (readiness flags missing ones) |
| `save_clientele` | `p_min_age int, p_max_age int` | bounds 0–120, max ≥ min, max needs min |
| `save_specialty` | — | — |
| `save_motif_category` | `p_description text, p_icon text` | icon in the 20-name list (P0001 « Icône inconnue. ») |
| `save_language` | `p_code text` | code lower-cased `^[a-z]{2}$` on create; immutable afterwards (no `key` column: the code is the key) |
| `save_deactivation_reason` | `p_requires_note boolean, p_disables_account boolean` | — |

**Archive / restore and reorder** — one function each, **static branches, no dynamic SQL**:

```sql
-- p_kind: professional_orders | profession_categories | profession_titles | clienteles |
--         specialties | motif_categories | motifs | languages | deactivation_reasons
create function public.set_professionals_reference_active(p_kind text, p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_system boolean;
begin
  if not private.has_permission('professionals.settings') then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;

  case p_kind
    when 'motifs' then
      select m.is_system into v_system from public.motifs m where m.id = p_id and m.org_id = v_org;
      if not found then raise exception 'Élément introuvable.' using errcode = 'P0001'; end if;
      if v_system and not p_active then
        raise exception 'Cet élément est utilisé par le jumelage ou la création ; il ne peut pas être archivé.' using errcode = 'P0001';
      end if;
      update public.motifs m set is_active = p_active where m.id = p_id and m.org_id = v_org;
    when 'profession_categories' then
      -- … same lookup/system check, then:
      if not p_active and exists (select 1 from public.profession_titles t where t.org_id = v_org and t.category_id = p_id and t.is_active) then
        raise exception 'Archivez d''abord les titres de cette catégorie.' using errcode = 'P0001';
      end if;
      -- update …
    -- one branch per kind (rules below)
    else
      raise exception 'Liste inconnue : %', p_kind using errcode = '22023';
  end case;
end;
$$;
```

| Kind | Archive rule | Restore rule |
|---|---|---|
| `professional_orders` | refused while an active title uses it (« Archivez d'abord les titres de cet ordre. ») | — |
| `profession_categories` | refused while an active title uses it | — |
| `profession_titles` | allowed (assigned rows stay; the title can't be newly chosen) | refused while its category is archived (« Restaurez d'abord sa catégorie. ») |
| `motif_categories` | allowed; its motifs show under « Autres » | — |
| `clienteles`, `languages`, `deactivation_reasons` | refused for `is_system` rows | — |
| `motifs`, `specialties` | allowed | — |

`reorder_professionals_reference(p_kind text, p_ids uuid[]) returns void`: same permission and lock; static branch per kind: `update … t set sort_order = x.ord * 10 from unnest(p_ids) with ordinality as x(id, ord) where t.id = x.id and t.org_id = v_org`; if the number of updated rows differs from `cardinality(p_ids)` → `22023` « Éléments inconnus. » (rolled back by the exception).

**Catalogue** (one round trip, RLS applies, cached by the client):

```sql
create function public.get_professionals_catalog()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'orders',              coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.professional_orders x), '[]'),
    'categories',          coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.profession_categories x), '[]'),
    'titles',              coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.profession_titles x), '[]'),
    'clienteles',          coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.clienteles x), '[]'),
    'specialties',         coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.specialties x), '[]'),
    'motif_categories',    coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.motif_categories x), '[]'),
    'motifs',              coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.motifs x), '[]'),
    'languages',           coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.languages x), '[]'),
    'deactivation_reasons',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' order by x.sort_order, x.name) from public.deactivation_reasons x), '[]')
  )
$$;
```
Security invoker on purpose: each table's RLS scopes it to the caller's clinic and module gate.

**Published catalogue views** (for Demandes; `security_invoker`, `select` to `authenticated`):
- `motifs_catalog`: `id, org_id, key, name, is_restricted, sort_order, category_id, category_key, category_name, category_sort_order, category_icon` — active motifs; category columns null when the category is archived;
- `clienteles_catalog`: `id, org_id, key, name, min_age, max_age, sort_order` — active;
- `languages_catalog`: `id, org_id, code, name, sort_order` — active.

**Module settings** (`org_module_settings`, module `professionals`):
- `private.professionals_settings_defaults() returns jsonb` → `{"collect_sin": false}` (4b and 4c `create or replace` it to add their keys);
- `private.professionals_setting(p_org uuid, p_key text) returns jsonb` (definer, granted to nobody): stored value, else the default;
- `public.get_professionals_settings() returns jsonb`: defaults `||` stored, for callers with `professionals.view` or `professionals.self` (`42501` otherwise);
- `public.set_professionals_settings(p_patch jsonb) returns jsonb`: `professionals.settings`; every key must be known and of the right type (`collect_sin` boolean; `22023` otherwise); `collect_sin` also requires `professionals.private`; upserts `settings = settings || p_patch` and returns the effective settings. `org_module_settings` has no audit trigger today: insert an explicit `audit_log` row (`table_name 'org_module_settings'`, `record_id '<org>:professionals'`, before/after of the changed keys, `source 'rpc:set_professionals_settings'`), as `set_org_secret` does.

**As built (the migration is the reference where this sketch differs):**
- Names go through `private.reference_text`: Unicode spaces are stripped at both ends, inner runs fold to one space (like `valid_role_name`), and invisible characters are refused. Messages: « Le nom est obligatoire. », « Le nom ne peut pas dépasser 120 caractères. », « Le nom contient des caractères invisibles ou non permis. ». The same rules apply to the description, the licence label and the licence pattern; the pattern keeps its inner spaces. Duplicates are compared as `lower(normalize(…, NFKC))` and use the unique index.
- The permission check and the org lock share one helper, `private.lock_for_professionals_settings()`. Keys come from `private.unique_reference_key(private.reference_key(name), <org keys>)`. `reference_key` uses the two-argument `unaccent`, because the one-argument form needs a search_path.
- The acronym is upper-cased, like the language code and the 4a.7 dialog: `'ot'` is stored as `OT`, and `'O1'` gets « Sigle : 2 à 10 lettres majuscules. ».
- A title is restored only once its category **and** its order are active (« Restaurez d'abord son ordre. »). A row may keep the archived category or order it already has when it is renamed. Archive and restore leave a row that is already in the requested state untouched.
- `reorder` refuses an empty or repeated id list, or one longer than 500 (`22023`). It writes only the rows whose order changes.
- Each list holds at most **500 rows**, archived rows included (« Cette liste compte déjà 500 éléments (archivés compris). »). This bounds the catalogue, which is about 30 KB today and about 1 ms.
- `get_professionals_catalog` is `security definer`. It applies the policies' own predicate (org and `can_read_professionals_reference()`), evaluated once rather than nine times. Callers without access get nine empty lists.
- `org_module_settings` already has an audit trigger. `set_professionals_settings` therefore sets `app.audit_source = 'rpc:set_professionals_settings'` around its upsert and writes no second row. `get_professionals_settings` returns the known keys only, through `private.professionals_settings(org)`. It is open to any professionals key, as the lists are; its `42501` message names no permission (« Accès refusé aux réglages des professionnels. »).
- Review follow-ups:
  - Each setting has its own rule in `private.validate_professionals_setting(p_key text, p_value jsonb)` (granted to nobody). It raises `22023` for an unknown key or an invalid value; `collect_sin` is a boolean, never null. `set_professionals_settings` calls it for each key of the patch. 4b and 4c `create or replace` it, adding a `when` branch per key, and add the same keys to `professionals_settings_defaults()`. For example, `invitation_reminder_after_days` is an integer from 1 to 29, or `null`. pgTAP checks that every default passes its own rule.
  - System clientèles keep their kind: `min_age is null` stays as seeded. Otherwise the error is « Cette clientèle garde son type (groupe d'âge ou non). ». The reason « Autre » keeps `requires_note = true` (« La raison « Autre » demande toujours une note. »). Order acronyms are unique per clinic, ignoring case (« Un ordre porte déjà ce sigle (il est peut-être archivé). »).
  - `reorder_professionals_reference` contract: the order is global in every list today, so callers send the **full** list, archived rows included. The archive and restore updates also filter on `org_id`.

**Step 4: Run the database checks** (lock; with and without seed). **Step 5: Commit** (`feat(db): settings RPCs and cached catalogue for the professionals lists`), staging the migration, the test and `database.types.ts`.

---

## Task 4a.3: Migration `professionals_core` (the record, its sets, the provider link)

**Files:**
- Create: `supabase/migrations/<ts>_professionals_core.sql`
- Create: `supabase/tests/database/042_professionals_core.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures + professionals P1 (org A, `draft`), P2 (org A, linked to provider A's profile, as `postgres`), P3 (org B). Assert:
- **Privileges:**
  - `professionals`: `authenticated` SELECT only at table level; `column_privs_are` UPDATE on exactly `first_name, last_name, personal_phone, address_line1, address_line2, city, province, postal_code, years_experience, gender`; none on `email`, `status`, `profile_id`, `deactivation_*`, `activation_override_reason`;
  - `professional_public_profiles`: UPDATE on `bio, approach, public_email, public_phone`;
  - `professional_matching_profiles`: UPDATE on `accepting_new_clients, availability_periods, availability_note`;
  - the five junctions and `professional_payer_numbers`: SELECT only; `anon`: nothing anywhere.
- **`create_professional`** (adjointe A):
  - `('Marie', 'Tremblay', '  Marie.T@Exemple.CA ', <psychologue>, 'OPQ-1234')` returns an id; the row has `email = 'marie.t@exemple.ca'`, `status = 'draft'`; one public profile, one matching profile (`accepting_new_clients = true`), language `fr`, one primary profession with that licence;
  - the same email again → P0001 « Ce courriel est déjà utilisé. »; the email of the conseillère's profile → same message; an email used by a profile **of org B only** → succeeds (P4-34);
  - a regulated title without licence → P0001 « Le numéro de permis est requis pour ce titre. »; `naturopathe` without licence → succeeds;
  - `'x'` as email → P0001 « Courriel invalide. »; blank first name → P0001;
  - as the conseillère → `42501`.
- **Column updates** (adjointe A): `update professionals set city = 'Lévis'` on P1 → 1 row; `status = 'active'` → `42501` (no column grant); the conseillère's identity update → 0 rows (RLS); `update professional_matching_profiles set accepting_new_clients = false` as the conseillère → 1 row.
- **`set_professional_professions`** (adjointe A, P1):
  - `[{"title_id": psychologue, "licence_number": "OPQ-1", "is_primary": false}, {"title_id": sexologue, "licence_number": "S-2", "is_primary": true}]` → 2 rows, sexologue primary; the psychologue row keeps its id;
  - three items → P0001 « Un professionnel a au plus deux titres. »; two items flagged primary → P0001 « Un seul titre principal. »;
  - `[{"title_id": psychologue, "licence_number": "OPQ-1"}]` (primary removed) → 1 row, now primary (promotion);
  - an order with `licence_pattern '^[0-9]{5}$'` and licence `'abc'` → P0001 « Le numéro de permis n'a pas le format attendu par l'ordre. »;
  - an archived title not already assigned → P0001 « Ce titre est archivé. »;
  - as `postgres`, deleting the primary row directly → the deferred check raises P0001 « Un des titres doit être le titre principal. » at commit (use a `savepoint` + `set constraints all immediate`).
- **`set_professional_clienteles` / `_specialties`** (conseillère A): `[{"id": adults, "specialized": true}, {"id": couples}]` → two rows, `is_specialized` true / false; replacing with `[]` → zero rows; an id of org B → `22023`.
- **`set_professional_motifs`:** sets and replaces; an archived motif already assigned stays when re-sent; a newly added archived motif → P0001 « Le motif « … » est archivé. »; a restricted motif for a professional whose only title is `naturopathe` → P0001 « Le motif « … » est réservé aux professions réglementées. »; for P1 with `psychologue` → succeeds.
- **`set_professional_languages`:** `[]` → P0001 « Au moins une langue est requise. »; `[fr, en]` → 2 rows.
- **`set_professional_payer_number`** (adjointe A): `(P1, 'ivac', '123456')` stores it; the same number on another professional of org A → P0001 « Ce numéro IVAC est déjà attribué à un autre professionnel. »; the same number in org B → succeeds; `''` deletes it; type `'csst'` → `22023`.
- **`set_professional_email`:** works on P1 (no account); on P2 → P0001 « Ce professionnel a un compte : le courriel se change dans « Mon compte ». »
- **Email sync:** as `postgres`, update provider A's `profiles.email` → P2's `email` follows (lower-cased).
- **`private.current_professional_id()`:** as provider A → P2's id; as admin A → null; after provider A's profile is disabled → null.
- **Provider RLS:** provider A selects P2 and its junctions, never P1; with the module disabled → nothing.
- **Isolation:** admin B sees only P3; every set RPC on P1 as admin B → P0001 « Professionnel introuvable. »
- **Usage counts:** `list_professionals_reference_usage()` returns `('motifs', <id>, 1)` for a motif assigned once.
- **Audit:** every junction write is in `audit_log` with `record_id` starting with the professional's id (`left(record_id, 36) = P1::text`), professions included (`<P1>:<profession row id>`).

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- =============================================================================
-- Professionnels: the professional record, its matching sets, the provider link
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.3, §3.7, §3.9
-- Plan:    Task 4a.3 (P4-33, P4-34, P4-35, P4-36, P4-40)
-- * Child rows' primary keys start with professional_id, so audit record ids
--   start with it and list_professional_history finds every child row.
-- * Plain fields: column grants + RLS (professionals.manage / .matching).
--   Sets, email, status: RPCs that lock the professional row (no key update).
-- * Providers read their own record through private.current_professional_id().
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_core', true);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid,
  first_name text not null,
  last_name text not null,
  email text not null,
  personal_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  province text not null default 'QC',
  postal_code text,
  country text not null default 'CA',
  years_experience smallint,
  gender text,
  status text not null default 'draft',
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(user_id) on delete set null,
  deactivation_reason_id uuid,
  deactivation_note text,
  deactivation_disabled_account boolean not null default false,
  activation_override_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint professionals_org_id_id_key unique (org_id, id),
  constraint professionals_profile_id_key unique (profile_id),
  constraint professionals_profile_fkey foreign key (profile_id, org_id)
    references public.profiles (user_id, org_id) on delete set null (profile_id),
  constraint professionals_deactivation_reason_fkey foreign key (org_id, deactivation_reason_id)
    references public.deactivation_reasons (org_id, id),
  constraint professionals_first_name_check check (length(btrim(first_name, E' \t\r\n')) between 1 and 80 and first_name = btrim(first_name, E' \t\r\n')),
  constraint professionals_last_name_check check (length(btrim(last_name, E' \t\r\n')) between 1 and 80 and last_name = btrim(last_name, E' \t\r\n')),
  constraint professionals_email_check check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint professionals_personal_phone_check check (personal_phone ~ '^\+1[0-9]{10}$'),
  constraint professionals_address_line1_check check (length(btrim(address_line1, E' \t\r\n')) between 1 and 200),
  constraint professionals_address_line2_check check (length(btrim(address_line2, E' \t\r\n')) between 1 and 200),
  constraint professionals_city_check check (length(btrim(city, E' \t\r\n')) between 1 and 100),
  constraint professionals_province_check check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  constraint professionals_postal_code_check check (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  constraint professionals_country_check check (country = 'CA'),
  constraint professionals_years_experience_check check (years_experience between 0 and 60),
  constraint professionals_gender_check check (gender in ('female', 'male', 'unspecified')),
  constraint professionals_status_check check (status in ('draft', 'invited', 'in_review', 'active', 'inactive')),
  constraint professionals_deactivation_check check ((status = 'inactive') = (deactivation_reason_id is not null)),
  constraint professionals_deactivation_note_check check (length(btrim(deactivation_note, E' \t\r\n')) between 1 and 500),
  constraint professionals_activation_override_reason_check check (length(btrim(activation_override_reason, E' \t\r\n')) between 5 and 500)
);
create unique index professionals_org_email_key on public.professionals (org_id, email);
create index professionals_org_name_idx on public.professionals (org_id, last_name, first_name);
create index professionals_org_status_idx on public.professionals (org_id, status);
create index professionals_status_changed_by_idx on public.professionals (status_changed_by);
create index professionals_created_by_idx on public.professionals (created_by);

revoke all on public.professionals from anon, authenticated;
grant select on public.professionals to authenticated;
grant update (first_name, last_name, personal_phone, address_line1, address_line2, city, province,
              postal_code, years_experience, gender) on public.professionals to authenticated;
alter table public.professionals enable row level security;

-- The caller's own professional row (null unless the caller's profile is active).
-- Published contract: Clients, Demandes and Rendez-vous policies call it too.
create function private.current_professional_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.professionals p
   where p.profile_id = auth.uid() and p.org_id = private.current_user_org_id()
$$;
revoke all on function private.current_professional_id() from public, anon;
grant execute on function private.current_professional_id() to authenticated;

create policy professionals_select_staff on public.professionals
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professionals_select_self on public.professionals
  for select to authenticated
  using (id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create policy professionals_update on public.professionals
  for update to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')))
  with check (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.manage')));

create trigger professionals_set_updated_at before update on public.professionals
  for each row execute function private.set_updated_at();
create trigger professionals_audit after insert or update or delete on public.professionals
  for each row execute function private.audit_trigger();

-- Lock one professional of the caller's clinic, or say it does not exist there.
create function private.lock_professional(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.professionals p
   where p.id = p_id and p.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.lock_professional(uuid) from public, anon, authenticated, service_role;
```

**1:1 tables** (PK `professional_id`, `org_id`, composite FK `(org_id, professional_id)` → `professionals (org_id, id)` on delete cascade, index `(org_id)`, `updated_at` + trigger, audit, select policies staff + self as above, update policy with the permission named):

| Table | Columns and checks | Update grant · policy permission |
|---|---|---|
| `professional_public_profiles` | `bio text` (1–4000), `approach text` (1–4000), `public_email` (email format), `public_phone` (`^\+1[0-9]{10}$`) | those 4 columns · `professionals.manage` |
| `professional_matching_profiles` | `accepting_new_clients boolean not null default true`, `availability_periods text[] not null default '{}'` (check `availability_periods <@ array['am','pm','evening','weekend']` and `cardinality = cardinality(array(select distinct unnest(…)))`), `availability_note text` (1–500) | those 3 columns · `professionals.matching` |

**`professional_professions`** (P4-36):

```sql
create table public.professional_professions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  profession_title_id uuid not null,
  licence_number text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_professions_pkey primary key (professional_id, id),
  constraint professional_professions_id_key unique (id),          -- target of Services et tarifs' FK
  constraint professional_professions_title_key unique (professional_id, profession_title_id),
  constraint professional_professions_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_professions_title_fkey foreign key (org_id, profession_title_id)
    references public.profession_titles (org_id, id),
  constraint professional_professions_licence_number_check check (licence_number ~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$')
);
create unique index professional_professions_one_primary on public.professional_professions (professional_id) where is_primary;
create index professional_professions_org_title_idx on public.professional_professions (org_id, profession_title_id);

-- Licence required for regulated titles, order's format, at most two titles.
create function private.professional_professions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_pattern text;
begin
  new.licence_number := nullif(pg_catalog.btrim(new.licence_number, E' \t\r\n'), '');
  select t.order_id, o.licence_pattern into v_order, v_pattern
    from public.profession_titles t
    left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
   where t.org_id = new.org_id and t.id = new.profession_title_id;
  if v_order is not null and new.licence_number is null then
    raise exception 'Le numéro de permis est requis pour ce titre.' using errcode = 'P0001';
  end if;
  if v_pattern is not null and new.licence_number is not null and new.licence_number !~ v_pattern then
    raise exception 'Le numéro de permis n''a pas le format attendu par l''ordre.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.professional_professions pp where pp.professional_id = new.professional_id) >= 2 then
    raise exception 'Un professionnel a au plus deux titres.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger professional_professions_guard
  before insert or update on public.professional_professions
  for each row execute function private.professional_professions_guard();

-- Exactly one primary whenever titles exist (checked at commit: set RPCs move it).
create function private.professional_professions_check_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid uuid := coalesce(new.professional_id, old.professional_id);
begin
  if exists (select 1 from public.professional_professions pp where pp.professional_id = v_pid)
     and not exists (select 1 from public.professional_professions pp where pp.professional_id = v_pid and pp.is_primary) then
    raise exception 'Un des titres doit être le titre principal.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger professional_professions_primary
  after insert or update or delete on public.professional_professions
  deferrable initially deferred
  for each row execute function private.professional_professions_check_primary();

revoke all on function private.professional_professions_guard(), private.professional_professions_check_primary()
  from public, anon, authenticated, service_role;
-- + revoke/grant select, RLS (staff + self), set_updated_at, audit — as for the other child tables.
```

**Junctions** (same shape for the four; `professional_motifs` in full):

```sql
create table public.professional_motifs (
  org_id uuid not null,
  professional_id uuid not null,
  motif_id uuid not null,
  created_at timestamptz not null default now(),
  constraint professional_motifs_pkey primary key (professional_id, motif_id),
  constraint professional_motifs_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_motifs_motif_fkey foreign key (org_id, motif_id) references public.motifs (org_id, id)
);
-- Serves the composite FKs (leading org_id) and the usage counts by motif.
create index professional_motifs_org_motif_idx on public.professional_motifs (org_id, motif_id);

revoke all on public.professional_motifs from anon, authenticated;
grant select on public.professional_motifs to authenticated;
alter table public.professional_motifs enable row level security;
create policy professional_motifs_select_staff on public.professional_motifs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_motifs_select_self on public.professional_motifs
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));
create trigger professional_motifs_audit after insert or update or delete on public.professional_motifs
  for each row execute function private.audit_trigger();
```
- `professional_clienteles` and `professional_specialties` add `is_specialized boolean not null default false` and `updated_at` (+ trigger).
- `professional_languages`: `(professional_id, language_id)`, no extra column.
- `professional_payer_numbers`: PK `(professional_id, payer_type)`, `payer_type text not null check (payer_type in ('ivac'))`, `number text not null` (`^[A-Z0-9-]{3,30}$`: stored upper-case, so unique whatever the case, review of 4a.13), `updated_at`; `unique (org_id, payer_type, number)` (leading `org_id`: serves the FK too).

**The set RPC pattern** (`set_professional_motifs` in full):

```sql
create function public.set_professional_motifs(p_id uuid, p_motif_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[] := coalesce((select pg_catalog.array_agg(distinct x) from pg_catalog.unnest(p_motif_ids) as x where x is not null), '{}');
  v_bad text;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_ids) as x
              where not exists (select 1 from public.motifs m where m.org_id = v_org and m.id = x)) then
    raise exception 'Motif inconnu.' using errcode = '22023';
  end if;

  -- An archived motif may stay where it already is, never be added.
  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where not m.is_active
     and not exists (select 1 from public.professional_motifs pm where pm.professional_id = p_id and pm.motif_id = x)
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est archivé.', v_bad using errcode = 'P0001';
  end if;

  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where m.is_restricted
     and not exists (
       select 1 from public.professional_professions pp
         join public.profession_titles t on t.org_id = pp.org_id and t.id = pp.profession_title_id
        where pp.professional_id = p_id and t.order_id is not null)
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est réservé aux professions réglementées.', v_bad using errcode = 'P0001';
  end if;

  delete from public.professional_motifs pm where pm.professional_id = p_id and pm.motif_id <> all (v_ids);
  insert into public.professional_motifs (org_id, professional_id, motif_id)
  select v_org, p_id, x from pg_catalog.unnest(v_ids) as x
  on conflict do nothing;

  return query select pm.motif_id from public.professional_motifs pm where pm.professional_id = p_id;
end;
$$;
```

Other RPCs (all lock the professional, validate ids as above, return the new set):

| RPC | Permission | Input → output | Rules |
|---|---|---|---|
| `create_professional(p_first_name text, p_last_name text, p_email text, p_profession_title_id uuid default null, p_licence_number text default null) returns uuid` | `manage` | — | Trims names; email `lower(btrim())`, format (« Courriel invalide. »); duplicate among the org's professionals **or** the org's profiles (« Ce courriel est déjà utilisé. », P4-34); locks the org row first. Inserts the professional (`created_by = auth.uid()`), both 1:1 rows, language `fr` (the org's `is_system` language), and the profession as primary when given (the guard applies). |
| `set_professional_email(p_id uuid, p_email text) returns void` | `manage` | — | Only while `profile_id is null`; same checks as create. |
| `set_professional_professions(p_id uuid, p_items jsonb) returns table (id uuid, profession_title_id uuid, licence_number text, is_primary boolean)` | `manage` | `[{title_id, licence_number?, is_primary?}]`, 0–2 items | Distinct titles; ≤ 1 flagged primary (« Un seul titre principal. »), else the first item; new titles active (« Ce titre est archivé. »). Order: delete removed titles → clear `is_primary` on rows that lose it → upsert `on conflict (professional_id, profession_title_id) do update` (row ids survive). |
| `set_professional_clienteles(p_id uuid, p_items jsonb) returns table (clientele_id uuid, is_specialized boolean)` | `matching` | `[{id, specialized?}]` | As motifs (archived rule); `is_specialized` updated only where it changed (no audit noise). |
| `set_professional_specialties(p_id uuid, p_items jsonb) returns table (specialty_id uuid, is_specialized boolean)` | `matching` | same | same |
| `set_professional_languages(p_id uuid, p_language_ids uuid[]) returns setof uuid` | `matching` | — | At least one (« Au moins une langue est requise. »). |
| `set_professional_payer_number(p_id uuid, p_payer_type text, p_number text) returns void` | `manage` | — | Blank deletes; `unique_violation` → P0001 « Ce numéro IVAC est déjà attribué à un autre professionnel. » |
| `list_professionals_reference_usage() returns table (kind text, id uuid, usage int)` | `manage` (`42501` otherwise) | — | Security invoker; one `union all` of grouped counts: motifs, clientèles, approaches, languages, titles (professions), reasons (current inactive professionals), and for parents the active children (titles per category / order, motifs per category). |

**Email sync** (profiles ← auth is the source once the account exists):
```sql
create function private.professionals_email_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.professionals p set email = pg_catalog.lower(new.email)
   where p.profile_id = new.user_id and p.email is distinct from pg_catalog.lower(new.email);
  return null;
end;
$$;
create trigger profiles_sync_professional_email
  after update of email on public.profiles
  for each row when (old.email is distinct from new.email)
  execute function private.professionals_email_from_profile();
revoke all on function private.professionals_email_from_profile() from public, anon, authenticated, service_role;
```

**As built (the migration is the reference where this sketch differs):**
- **Professions guard:** the « at most two » count ignores the row's own title. An upsert that re-sends an existing title fires `BEFORE INSERT` before the conflict is found, so the sketch's count would refuse re-sending two titles. pgTAP re-sends the two held titles and moves the primary between them; with the sketch's count put back, it fails. A licence outside the order's pattern gives P0001 « Le numéro de permis pour {titre} n'a pas le bon format. » (the title's name). The guard also checks the base licence format with a French P0001 (« Numéro de permis invalide : lettres, chiffres, espaces et traits d'union (30 caractères au plus). »), so the check constraint (`23514`) is never what a user sees. A title repeated in the items gets « Un titre ne peut être choisi qu'une fois. ». An unknown title gives `22023` « Titre inconnu. ».
- **Restricted motifs, both ways (P4-16):** `set_professional_professions` refuses to remove the last regulated title while restricted motifs are held: « Retirez d'abord les motifs réservés aux professions réglementées : Psychose. » (names joined with « , »). Two paths stay open, as in the sketch: an admin marking a held motif restricted (`save_motif`), and a title losing its order (`save_profession_title`). 4a.4 readiness can flag them.
- **Set inputs:**
  - a `null` set (`p_motif_ids`, `p_language_ids`, `p_items`) is refused with `22023`, while `[]` clears the set. The sketch's `coalesce(…, '{}')` would have cleared a set on a client bug.
  - At most 500 ids or items (`22023`), and null ids are ignored.
  - JSON ids (`id`, `title_id`) are checked against the uuid form before the cast, so a malformed one gives `22023`, not `22P02`.
  - Clientèles and approaches parse `[{id, specialized?}]` through `private.parse_specialized_items` (an id repeated is specialized if any item says so).
  - Unknown ids give `22023` (« Clientèle inconnue. », « Approche inconnue. », « Langue inconnue. », « Motif inconnu. »). New archived rows give P0001 « La clientèle « … » est archivée. », « L'approche « … » est archivée. » or « La langue « … » est archivée. »; a row already held may stay.
- **Writes only what changes:** profession upserts and specialized flags are skipped when unchanged, so re-sending a set writes no audit row. pgTAP checks the no-op writes only for motifs and languages.
- **Lock order:** `set_professional_email` locks the professional, then the org row (conventions §6). `create_professional` locks the org row only. Names go through `private.reference_text` (« Le prénom est obligatoire. », 80 characters). The email helpers are `private.professional_email` (« Courriel invalide. ») and `private.assert_professional_email_free(org, email, except)`.
- **Other errors:** a licence without a title in `create_professional` gives `22023`. Without an active system language, `create_professional` raises P0001 « Aucune langue active n'est disponible. » rather than create a record without a language. An IVAC number (upper-cased first) outside `^[A-Z0-9-]{3,30}$` gives P0001 « Numéro IVAC invalide : 3 à 30 lettres, chiffres ou traits d'union. ».
- **Check constraints:**
  - the matching profile's « distinct periods » check calls `private.has_no_duplicates(text[])`, because a check constraint cannot hold a subquery. It is granted to `authenticated` and `service_role`, since checks run with the writer's privileges.
  - `bio`, `approach` and `availability_note` are 1–4000 / 1–500 characters and not blank.
- **Indexes:** the four matching junction indexes are `(org_id, <x>_id) include (professional_id)`, so « who holds X » never needs the heap for the id.
  - EXPLAIN (50 professionals, ~600 motif rows, conseillère under RLS): the matching query (clientèle + language + accepting, scored by motif hits) runs in about 1 ms. RLS helpers run once per statement (InitPlans), and lookups use the junction primary keys or the `(org_id, <x>_id)` indexes.
  - `set_professional_motifs` with 15 motifs runs in about 2 ms.
- **`list_professionals_reference_usage`:**
  - `kind` is the table name, as `set_professionals_reference_active` takes it: `motifs`, `clienteles`, `specialties`, `languages`, `profession_titles`, `deactivation_reasons`, `profession_categories`, `professional_orders`, `motif_categories`.
  - It needs `professionals.settings` (who edits the lists) or `professionals.manage`, else `42501`.
  - It is plpgsql security definer and scopes every count to the caller's org explicitly, so a holder without `professionals.view` (an override) gets the clinic's true counts, not RLS-filtered ones. Each count uses its index.
- **Email sync test:** `profiles.email` is always copied from `auth.users` by a `BEFORE` trigger, so the pgTAP updates `auth.users.email` and checks that the change reaches `professionals.email` through the profile.
- **Email sync conflict (decision #38):** when the new login address is already the email of an unlinked professional of the clinic, the sync trigger catches the unique violation and leaves `professionals.email` unchanged. Raising would break GoTrue's email-change confirmation, and « Mon compte » never reveals that an address is used. So the login change succeeds, nothing is shown, and there is no UI pre-check either. 4a.4 readiness or a staff notification can flag the mismatch later. pgTAP covers the conflict (login changes, professional email kept) and the sync without conflict.
- **Provider's own read (Loi 25 right of access):** through `professionals_select_self`, a provider reads their own `deactivation_note` and `activation_override_reason`. Staff write those notes knowing the professional can read them.
- **RPC refusals:** pgTAP calls every RPC as disabled staff and with the module off; each gives `42501`.
- **Redaction (Loi 25):** `professionals` uses `private.audit_trigger('personal_phone', 'address_line1', 'address_line2', 'city', 'postal_code', 'gender')`. `audit_log` outlives the record and its readers, so the history shows that these fields changed, not their values. City is part of the home address. There is no birth date column. Province and years of experience stay readable; names and email are what the history is about. pgTAP checks the redaction on update and insert, and that no personal value of the fixture reaches `audit_log`. The other tables hold no SIN or bank data (that is 4a.17).

**Step 4: Run the database checks** (lock; with and without seed). **Step 5: Commit** (`feat(db): professional record, matching sets and provider link`).

---

## Task 4a.4: Migration `professionals_lifecycle` (readiness, status, read models, history)

**Files:**
- Create: `supabase/migrations/<ts>_professionals_lifecycle.sql`
- Create: `supabase/tests/database/043_professionals_lifecycle.test.sql`
- Create: `supabase/scripts/perf-professionals.sql` (local only: 200 generated professionals in a rolled-back transaction + `explain (analyze, buffers)` of the read models)

**Step 1: Write the failing pgTAP test.** Assert:
- **`professionals_readiness`** (view): P1, created with `psychologue` + licence (French is added at creation) → `matching_complete = false`, `ready = false`, and `get_professional_readiness(P1)` → `{"complete": false, "done": 0, "total": 1, "items": [{"key": "matching_profile", "done": false, "missing": ["clientele", "motif"]}]}`. A professional created without a title → `missing` = `["profession", "clientele", "motif"]`. After a clientèle and a motif → `ready = true`. A regulated title without licence (inserted as `postgres` with `alter table … disable trigger professional_professions_guard` inside a savepoint) → `missing` = `["licence"]`.
- **`activate_professional`** (adjointe A):
  - P1 incomplete, no reason → P0001 « Le dossier n'est pas complet. Seule l'administration peut activer un dossier incomplet. »;
  - as admin A, P1 incomplete, reason `'abc'` → P0001 « Indiquez la raison (au moins 5 caractères). »; reason « Dossier complété hors application » → `active`, reason stored, `status_changed_by = admin A`;
  - P1 complete, as the adjointe → `active`, `activation_override_reason` null;
  - already active → P0001 « Ce professionnel est déjà actif. »;
  - as the conseillère → `42501`.
- **`deactivate_professional`** (adjointe A): reason `other` without note → P0001 « Précisez la raison. »; with note → `inactive`, reason + note stored; reason `collaboration_ended` on P2 (linked) → P2's profile `disabled`, `deactivation_disabled_account = true`; `activate_professional(P2, …)` → profile `active` again, flag cleared; deactivating an inactive professional → P0001 « Ce professionnel est déjà inactif. »; a reason of org B → P0001 « Raison introuvable. »
- **`professionals_list`** (conseillère A): one row per org-A professional with `primary_title_id`, `primary_licence_number`, `language_ids`, `clientele_ids`, `specialty_ids`, `motif_ids`, `accepting_new_clients`, `matching_complete`, `ready`; nothing of org B; nothing for the provider.
- **`professionals_directory`** (conseillère A): P2 row has `language_codes = {fr}`, `clienteles` JSON `[{id, key, specialized, min_age, max_age}]`, `motif_ids`, `motif_keys`, `insurance_status = 'unknown'`, `ready`; provider A sees nothing (no `professionals.view`).
- **`get_professional_record(P1)`** (conseillère A): JSON with `professional`, `public_profile`, `matching_profile`, `professions`, `clienteles`, `specialties`, `motif_ids`, `language_ids`, `payer_numbers`, `readiness`; no `org_id` key; as admin B → null; as provider A on P2 → the record (self policies).
- **`get_professional_public_profile(P2)`:** portrait, public contact, motifs grouped by active category (archived/none under `"autres"`), clientèles and approaches with names.
- **`list_professional_history(P1)`** (conseillère A): rows of `professionals`, `professional_professions`, `professional_motifs`, … newest first; `p_before_id` pages; `p_limit 500` returns at most 200; as admin B → empty; as provider A → `42501`. A deleted profession row still appears (its `delete` row).
- **Indexes:** `has_index('public', 'audit_log', 'audit_log_org_record_prefix_idx')`.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**

```sql
-- Readiness grows by phase: 4b, 4c and 4d replace this view (same columns first,
-- new ones appended; `ready` is redefined each time).
create view public.professionals_readiness with (security_invoker = true) as
select p.id as professional_id,
       p.org_id,
       (pr.n > 0)                                   as has_profession,
       (coalesce(pr.missing_licences, 0) = 0)       as licences_ok,
       (l.professional_id is not null)              as has_language,
       (c.professional_id is not null)              as has_clientele,
       (m.professional_id is not null)              as has_motif,
       (pr.n > 0 and coalesce(pr.missing_licences, 0) = 0 and l.professional_id is not null
        and c.professional_id is not null and m.professional_id is not null) as matching_complete,
       (pr.n > 0 and coalesce(pr.missing_licences, 0) = 0 and l.professional_id is not null
        and c.professional_id is not null and m.professional_id is not null) as ready
  from public.professionals p
  left join (select x.professional_id, count(*) as n,
                    count(*) filter (where t.order_id is not null and x.licence_number is null) as missing_licences
               from public.professional_professions x
               join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id
              group by x.professional_id) pr on pr.professional_id = p.id
  left join (select distinct professional_id from public.professional_languages) l on l.professional_id = p.id
  left join (select distinct professional_id from public.professional_clienteles) c on c.professional_id = p.id
  left join (select distinct professional_id from public.professional_motifs) m on m.professional_id = p.id;
revoke all on public.professionals_readiness from anon, authenticated;
grant select on public.professionals_readiness to authenticated;
```
`get_professional_readiness(p_id uuid) returns jsonb` (security invoker, `language sql stable`): builds `{complete, done, total, items: [{key: 'matching_profile', done, missing: [...]}]}` from one row of the view, where `missing` ⊆ `profession, licence, language, clientele, motif`.

**Status RPCs:**

```sql
create function public.activate_professional(p_id uuid, p_override_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
  v_ready boolean;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_override_reason, ''), E' \t\r\n'), '');
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id;
  if v_row.status = 'active' then
    raise exception 'Ce professionnel est déjà actif.' using errcode = 'P0001';
  end if;

  select r.ready into v_ready from public.professionals_readiness r where r.professional_id = p_id;
  if coalesce(v_ready, false) then
    v_reason := null;                       -- a complete file needs no override
  else
    if not private.has_permission('professionals.activate_override') then
      raise exception 'Le dossier n''est pas complet. Seule l''administration peut activer un dossier incomplet.' using errcode = 'P0001';
    end if;
    if v_reason is null or pg_catalog.length(v_reason) < 5 then
      raise exception 'Indiquez la raison (au moins 5 caractères).' using errcode = 'P0001';
    end if;
  end if;

  update public.professionals p
     set status = 'active', deactivation_reason_id = null, deactivation_note = null,
         activation_override_reason = v_reason, deactivation_disabled_account = false,
         status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
   where p.id = p_id;

  -- Re-enable the account only if this module's deactivation disabled it (P4-11).
  if v_row.deactivation_disabled_account and v_row.profile_id is not null then
    update public.profiles pr set status = 'active'
     where pr.user_id = v_row.profile_id and pr.org_id = v_org and pr.status = 'disabled'
       and exists (select 1 from public.user_roles r where r.user_id = pr.user_id and r.role = 'provider');
  end if;
end;
$$;
```

`deactivate_professional(p_id uuid, p_reason_id uuid, p_note text default null) returns void`: `manage`; lock; refuse when already inactive; the reason must be an active row of the org (« Raison introuvable. »); note required when `requires_note` (« Précisez la raison. »), 1–500 characters; sets `inactive`, reason, note, `status_changed_*`; when the reason `disables_account` and `profile_id` is set: the profile (role `provider` only) becomes `disabled` and `deactivation_disabled_account = true`. Ending open sessions comes in 4b.6 (needs Phase 3 `users-set-status`).

**Read models** (all `security_invoker`, `select` to `authenticated`, ids rather than labels):

```sql
create view public.professionals_list with (security_invoker = true) as
select p.id, p.org_id, p.first_name, p.last_name, p.email, p.status, p.status_changed_at,
       p.profile_id is not null              as has_account,
       pp.profession_title_id                as primary_title_id,
       pp.licence_number                     as primary_licence_number,
       coalesce(l.ids, '{}')                 as language_ids,
       coalesce(c.ids, '{}')                 as clientele_ids,
       coalesce(s.ids, '{}')                 as specialty_ids,
       coalesce(m.ids, '{}')                 as motif_ids,
       mp.accepting_new_clients,
       r.matching_complete,
       r.ready,
       p.created_at, p.updated_at
  from public.professionals p
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select professional_id, array_agg(language_id) as ids from public.professional_languages group by 1) l on l.professional_id = p.id
  left join (select professional_id, array_agg(clientele_id) as ids from public.professional_clienteles group by 1) c on c.professional_id = p.id
  left join (select professional_id, array_agg(specialty_id) as ids from public.professional_specialties group by 1) s on s.professional_id = p.id
  left join (select professional_id, array_agg(motif_id) as ids from public.professional_motifs group by 1) m on m.professional_id = p.id;
```
- `professionals_directory`: the design §3.8 columns — `id, org_id, status, accepting_new_clients, availability_periods, display_name` (« Prénom Nom »), `primary_title_id, primary_title_key, primary_title_name, category_key, order_acronym, licence_number, professions jsonb [{id, title_id, title_key, title_name, category_key, order_acronym, licence_number, is_primary}], language_codes text[], clienteles jsonb [{id, key, specialized, min_age, max_age}], specialties jsonb [{id, key, specialized}], motif_ids uuid[], motif_keys text[], years_experience, gender, insurance_status` (`'unknown'::text` until 4c), `ready, updated_at` (greatest of the professional's and its children's `updated_at`/`created_at`, so a stored recommendation can say « profil modifié depuis »). Same pre-aggregated joins; no per-row function call.
- `get_professional_record(p_id uuid) returns jsonb` (security invoker, `language sql stable`): one `jsonb_build_object` with the keys listed in Step 1, each child set from one `jsonb_agg` subquery on the PK prefix; `readiness` from the view.
- `get_professional_public_profile(p_id uuid) returns jsonb` (security invoker): `{first_name, last_name, bio, approach, public_email, public_phone, primary_title_name, order_acronym, licence_number, motif_groups: [{category_key, category_name, icon, motifs: [names]}], clienteles: [{name, min_age, max_age, specialized}], approaches: [{name, specialized}]}`; groups in category order, « Autres » last.

**History:**

```sql
-- Every child row's record_id starts with its professional's id (P4-36).
create index audit_log_org_record_prefix_idx on public.audit_log (org_id, (left(record_id, 36)), id desc);

-- Tables shown in a professional's history (later batches add theirs).
create function private.professional_history_tables(p_with_compensation boolean)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_professions', 'professional_clienteles', 'professional_specialties',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers']
$$;
revoke all on function private.professional_history_tables(boolean) from public, anon, authenticated, service_role;

create function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    return;
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           -- private data: only that it changed, never the values (4a.17 adds the table)
           case when a.table_name = 'professional_private' and a.action <> 'read' then null else a.changed_fields end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
     where a.org_id = v_org
       and left(a.record_id, 36) = p_id::text
       and a.table_name = any (private.professional_history_tables(private.has_permission('professionals.compensation')))
       and (p_before_id is null or a.id < p_before_id)
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
```

**As built (the migration is the reference where this sketch differs):**
- **Readiness** adds two items to « Profil de jumelage complet » (4a.3 review):
  - `regulated_title` in `missing` when a restricted motif is held without a regulated title (an admin may restrict a motif after it was given). The order of `missing` is `profession, licence, regulated_title, language, clientele, motif`.
  - A `warnings` array, which holds `login_email_mismatch` when a linked professional's email differs from the login address (the email sync left it, decision #38). It is not a gap: `complete` stays true.
- **New view columns:** the readiness view adds `restricted_motifs_ok` and `email_matches_login`. Staff without `users.view` cannot read profiles, so the comparison is one definer set function, `private.professional_login_email_mismatches()`, scanned once per statement. Test 043 checks the licence gap by making `naturopathe` regulated after the fact, so no trigger is disabled.
- **Status RPCs** return `table (status, account_change, profile_id)`, not `void`. `account_change` is `'disabled'` or `'enabled'` when the call changed the provider's account, else null, so 4b.6 knows when to ban or unban without a second read.
  - Both RPCs lock the account first, then the professional (`private.lock_professional_with_account`), in the same order as the email sync trigger, so they never deadlock.
  - The account goes through `private.set_provider_account_status`, which behaves like `set_user_status`: on disable it also deletes `auth.sessions` (P3-32). It acts only on a `provider` profile of the clinic and only when the status changes. If the account was already disabled by someone else, deactivation leaves `deactivation_disabled_account` false, so reactivation leaves the account alone.
  - Messages added: « La raison compte au plus 500 caractères. » and « La note compte au plus 500 caractères. ». Deactivation clears `activation_override_reason`, and a complete file stores no override reason.
- **Views:** `professionals_list` and `professionals_directory` filter on `(select private.has_permission('professionals.view'))`. Without that filter, the provider's self policies would put their own row there.
  - `professionals_list` adds `deactivation_reason_id` and `email_matches_login`.
  - `professionals_directory.updated_at` is `greatest(professionals.updated_at, matching profile updated_at)`. Every set RPC of 4a.3 (professions, clientèles, approaches, motifs, languages, IVAC number) bumps `professionals.updated_at` when one of its statements touched a row, removals included, so the view needs no `max()` per set. `audit_trigger` skips an `updated_at`-only change: the bump writes no audit row.
  - **List-page cost:** the list view's set aggregates (and the readiness subqueries) are grouped over the whole junction tables, so a `list_professionals` page costs about as much as reading the whole list (5–6 ms for 200 professionals). That is fine at ≤ 500 professionals per clinic; if the clinic count grows, move the aggregates into `lateral` subqueries bounded by the page.
- **`list_professionals`** pages the list on the server (coordinator request, added to the plan's client-side list). 4a.10 can keep reading `professionals_list` whole.
  - **Filters:** statuses, titles (any of the professional's titles), languages, clientèles and motifs (any of the ids within a filter), and accepting new clients. Filters combine with « and », and an empty array means no filter.
  - **Sorts:** `name` (last name, first name, id) or `recent` (`status_changed_at` desc, id desc). The keyset cursor and the org are plpgsql variables, so they are index bounds of `professionals_org_name_idx` (row prefix; the id is rechecked) and of the new `professionals_org_status_changed_idx`.
  - **Set filters** are resolved first, in one statement, through the junctions' `(org_id, <x>_id)` indexes.
  - **Limits:** the page holds 1 to 200 rows (default 50); `22023` for an unknown sort or status, or more than 500 ids.
- **History:** `private.professional_history_tables()` takes no argument, and there is no `professional_private` branch yet. 4a.17 adds both with its table, so no dead code ships now. Redacted fields come back as the audit trigger wrote them (« [redacted] »). There is no existence pre-check: org scoping is enough.
- **Review follow-ups (same task):**
  - **Accounts an admin disabled stay disabled.** The trigger `profiles_release_professional_account` (after update of `status` on `profiles`) clears `deactivation_disabled_account` when the status changes outside the module. The module's own changes set `app.professionals_account_status = 'on'` (transaction-local, reset on every path, errors included). The coordinator chose this module-side trigger; core is unchanged. The P4-11 écart (an adjointe re-enables an account the module disabled) is written up in `docs/modules/professionals.md`.
  - **Readiness** counts only active titles, motifs, clientèles and languages (matching ignores archived rows).
  - **`private.professional_login_email_mismatches()`** returns only ids its caller may read (`professionals.view`, or their own record with `professionals.self`). It is no longer granted to `service_role`.
  - **`lock_professional_with_account`** re-checks that the locked professional's `profile_id` is still the profile it locked, else `40001` (« Le dossier vient de changer. Réessayez. »). **4b:** linking an account must lock the profile, then the professional.
  - **`list_professionals` partial cursors:** a last name alone starts after every row of that last name; a full name without an id, after every row of that name.
- **For later tasks:**
  - **4a.5:** the generated types say `activate_professional` / `deactivate_professional` return a non-null `account_change` and `profile_id`. Both are null unless the account changed: type them `string | null` in the API layer.
  - **4a.15:** an insert audit row shows `"[redacted]"` for every redacted field, even a null one (`audit_trigger` redacts by key). The history must not read it as « a renseigné ».
  - **4b:** deactivating an invited professional (status `invited`) must also revoke their open invitation links; 4a.4 does not touch invitations.
- **Indexes:** the 4a.3 name index already bounds the cursor (`ROW(last_name, first_name) >= …` as an index condition), so none was replaced; 042 asserts it. « Accepte de nouveaux clients » reads the matching profile through its `(org_id)` index, since a boolean index would not narrow ≤ 500 rows.
- **4a.3 follow-up (separate commit):** the email sync trigger also catches `check_violation` (23514, `professionals_email_check`), so a GoTrue confirmation of an address without a dotted domain never fails. 042 now has 215 tests.
- **Performance probe** (`supabase/scripts/perf-professionals.sql`, run through `docker exec … psql`, since `psql` is not on the host and the Supabase image refuses `auto_explain`, so function bodies are shown as prepared generic plans). Local, 200 professionals, 5 000 motif rows, ≈ 8 200 audit rows, as the seed conseillère:

  | Read | Time |
  |---|---|
  | `professionals_list` | 5–7 ms |
  | `professionals_directory` | 9–13 ms |
  | readiness of one professional | 0.6 ms |
  | `get_professional_record` | 2–3 ms |
  | `list_professional_history` | 0.3–0.5 ms (statement 0.02 ms) |
  | `list_professionals` page | 5–6 ms |

  - No SubPlan runs once per row; the only `loops=200` is a Memoize cache of title lookups.
  - The history reads `audit_log_org_record_prefix_idx` with org, prefix and cursor as index conditions.
  - The unfiltered name page reads `professionals_org_name_idx` with the cursor as an index condition. The motif-filtered page reads `professionals_pkey` with the resolved ids.

**Step 4: Run the database checks** (lock). Then the performance probe:
```bash
scripts/with-db-lock.sh psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f supabase/scripts/perf-professionals.sql
```
The script inserts 200 professionals with 2 professions, 3 languages, 4 clientèles, 3 approaches and 25 motifs each into the seed org, `set local role authenticated` as the seed conseillère, runs `explain (analyze, buffers)` on `select * from professionals_list`, `select * from professionals_directory`, `select get_professional_record(<one id>)` and `select * from list_professional_history(<id>)`, then `rollback`. Expected: each under 50 ms locally; no `SubPlan` executed 200 times; the history uses `audit_log_org_record_prefix_idx`. Paste the four timings in the commit body.

**Step 5: Commit** (`feat(db): readiness, activation, list and directory views, record history`), staging the migration, the test, the perf script and the types.

---
## Task 4a.5: Module frontend foundation (types, API, hooks, schemas, manifest)

*Coordinator task, after 4a.4's types are committed. Lanes B and C start from it.*

**Files** (all under `src/modules/professionals/`, each with a `.test.ts` next to it):
- Create: `api/catalog.ts`, `api/list.ts`, `api/record.ts`, `api/history.ts`, `api/settings.ts` (module settings), `api/parse.ts` (Zod parsers of RPC JSON)
- Create: `hooks/keys.ts`, `hooks/use-catalog.ts`, `hooks/use-professionals-list.ts`, `hooks/use-professional-record.ts`, `hooks/use-professional-mutations.ts`, `hooks/use-reference-mutations.ts`
- Create: `schemas/create.ts`, `schemas/identity.ts`, `schemas/contact.ts`, `schemas/public-profile.ts`, `schemas/matching.ts`, `schemas/professions.ts`, `schemas/reference.ts`, `schemas/status.ts`
- Create: `lib/display.ts`, `lib/watch.ts`, `lib/readiness.ts`, `lib/filters.ts`, `lib/constants.ts`
- Modify: `manifest.ts`, `index.ts`, `src/i18n/fr-CA.json` (`modules.professionals.*`, `audit.fields.<table>.<column>` for every new table)
- Delete: `pages/ProfessionalsPlaceholderPage.tsx` (replaced in 4a.10; keep it until then)

**Step 1: Types and parsers.** Row types come from `database.types.ts` (`Tables<'professionals'>`, `Views<'professionals_list'>`…). JSON-returning RPCs (`get_professionals_catalog`, `get_professional_record`, `get_professional_public_profile`, `get_professional_readiness`) are parsed with Zod in `api/parse.ts` and mapped to camelCase domain types:
```ts
export interface ProfessionalsCatalog {
  orders: ProfessionalOrder[]; categories: ProfessionCategory[]; titles: ProfessionTitle[]
  clienteles: Clientele[]; specialties: Specialty[]; motifCategories: MotifCategory[]
  motifs: Motif[]; languages: Language[]; deactivationReasons: DeactivationReason[]
}
export interface ProfessionalRecord {
  professional: Professional; publicProfile: PublicProfile; matchingProfile: MatchingProfile
  professions: ProfessionRow[]; clienteles: SpecializedRef[]; specialties: SpecializedRef[]
  motifIds: string[]; languageIds: string[]; payerNumbers: PayerNumber[]; readiness: Readiness
}
```
A parse failure throws `new Error('professionals: unexpected RPC shape')` (reported to Sentry by the error boundary, no row values in the message). Test each parser with a fixture copied from a real local RPC response (`psql … -c "select get_professional_record(…)"`).

**Step 2: API** (no Supabase client outside `api/`):
```ts
export const PROFESSIONALS_LIST_MAX = 500
export async function fetchProfessionalsCatalog(): Promise<ProfessionalsCatalog>          // rpc get_professionals_catalog
export async function fetchReferenceUsage(): Promise<ReadonlyMap<string, number>>         // key `${kind}:${id}`
export async function fetchProfessionalsList(): Promise<{ rows: ProfessionalListRow[]; truncated: boolean }>
//   from('professionals_list').select(LIST_COLUMNS).order('last_name').order('first_name').limit(PROFESSIONALS_LIST_MAX + 1)
export async function fetchProfessionalRecord(id: string): Promise<ProfessionalRecord | null>
export async function createProfessional(input: CreateProfessionalOutput): Promise<string>
export async function updateProfessional(id: string, patch: ProfessionalPatch): Promise<void>     // column-granted fields only
export async function updatePublicProfile(id: string, patch: PublicProfilePatch): Promise<void>
export async function updateMatchingProfile(id: string, patch: MatchingProfilePatch): Promise<void>
export async function setProfessions(id: string, items: ProfessionInput[]): Promise<ProfessionRow[]>
export async function setClienteles(id: string, items: SpecializedRef[]): Promise<SpecializedRef[]>
export async function setSpecialties(id: string, items: SpecializedRef[]): Promise<SpecializedRef[]>
export async function setMotifs(id: string, motifIds: string[]): Promise<string[]>
export async function setLanguages(id: string, languageIds: string[]): Promise<string[]>
export async function setPayerNumber(id: string, type: 'ivac', value: string): Promise<void>
export async function setProfessionalEmail(id: string, email: string): Promise<void>
export async function activateProfessional(id: string, overrideReason?: string): Promise<void>
export async function deactivateProfessional(id: string, reasonId: string, note?: string): Promise<void>
export async function fetchProfessionalHistory(id: string, beforeId?: number): Promise<HistoryEntry[]>
export async function saveReference<K extends ReferenceKind>(kind: K, input: ReferenceInput<K>): Promise<string>
export async function setReferenceActive(kind: ReferenceKind, id: string, active: boolean): Promise<void>
export async function reorderReference(kind: ReferenceKind, ids: string[]): Promise<void>
export async function fetchProfessionalsSettings(): Promise<ProfessionalsSettings>
export async function saveProfessionalsSettings(patch: Partial<ProfessionalsSettings>): Promise<ProfessionalsSettings>
```
`ProfessionalPatch` is a `Pick` of the column-granted fields, so a non-granted column is a compile error. Every function throws the PostgREST error unchanged (the hooks map it).

**Step 3: Hooks.**
- `useProfessionalsCatalog()`: `staleTime: 5 * 60_000`; `select` adds lookup maps built once (`byId` per list, motifs grouped by category with « Autres » last) via a memoised selector, so pages never rebuild maps per render.
- `useProfessionalsList()`, `useProfessionalRecord(id)`, `useProfessionalHistory(id)` (`useInfiniteQuery`, `getNextPageParam` = last id when the page is full).
- **Prefetch helpers** (no waterfall): `prefetchProfessionalRecord(queryClient, id)` used on list-row hover/focus; `prefetchProfessionalHistory` on tab hover.
- Mutations (one hook each, `use-professional-mutations.ts`): on success, write the RPC's returned set into the record cache (`setQueryData`), then `invalidateQueries({ queryKey: professionalKeys.all })`; toast « Modifications enregistrées. »; errors → `toast.error(moduleErrorMessage(error, t('modules.professionals.errors.saveFailed'), 'professionals'))`. Reference mutations invalidate `professionalCatalogKeys.all` and `professionalKeys.all` (names appear in records).
- Tests: cache update + invalidation; error mapping (`P0001` shown, `42501` generic, other codes reported).

**Step 4: Schemas** (Zod mirrors of the SQL checks, same French messages; `[0-9]` in regexes; reuse `src/shared/lib/field-schemas.ts`):

| Schema | Fields → messages |
|---|---|
| `createProfessionalSchema` | `firstName`, `lastName` 1–80 (« Prénom requis. », « Nom requis. »); `email` (« Courriel invalide. »); `titleId` optional; `licenceNumber` required when the title has an order (`superRefine` with the catalogue passed in: « Le numéro de permis est requis pour ce titre. ») |
| `identitySchema` | first/last name, `gender` `'' | female | male | unspecified` → null when `''` |
| `contactSchema` | `personalPhone` (`parsePhone`, « Téléphone invalide. »), address lines, city, province (default `QC`), postal code (normalised `A1A 1A1`) |
| `experienceSchema` | `yearsExperience` `''` or 0–60 (« Entre 0 et 60 ans. ») |
| `publicProfileSchema` | `bio`, `approach` ≤ 4000 (« 4000 caractères au maximum. »), `publicEmail`, `publicPhone` |
| `availabilitySchema` | flat booleans `am`, `pm`, `evening`, `weekend`, `acceptingNewClients`, `note` ≤ 500 → output `{ availabilityPeriods: Period[], acceptingNewClients, availabilityNote }` (flat values, so `useSettingsForm` works) |
| `professionItemSchema` | `titleId`, `licenceNumber` (`^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$`, « Numéro de permis invalide. »), `isPrimary` |
| `referenceSchemas[kind]` | name 1–120 + each kind's fields (acronym, licence pattern, ages, code, icon, flags) |
| `deactivateSchema` | `reasonId` required (« Choisissez une raison. »), `note` required when the reason requires it (« Précisez la raison. ») |
| `overrideSchema` | `reason` ≥ 5 (« Indiquez la raison (au moins 5 caractères). ») |

Tests per schema: valid, each invalid case, normalisation (email lower-cased, postal code spaced, empty → null).

**Step 5: `lib/`.**
- `display.ts`: `fullName(p)`, `clienteleLabel(c)` → « Enfants (0 à 12 ans) », « Aînés (65 ans et plus) », « Couples » (wording aligned with 4a.8's `agesLabel`); `languagesLabel(codes)` → « FR · EN »; `professionLine(row, catalog)` → « Psychologue · OPQ 12345 ».
- `watch.ts`: `watchFlags(row, catalog)` → ordered `{ key, label, tone: 'danger' | 'muted' }[]`. 4a flags: `matching_incomplete` « Profil de jumelage incomplet » (muted); 4b adds `invitation_pending` (« Invitation sans réponse · 6 j »), `review_pending` (« Dossier à réviser »); 4c adds `insurance_expiring` (« Assurance expire le 31 mars », danger), `insurance_expired`, `insurance_missing`. One function, one test table.
- `readiness.ts`: item and missing-field labels (`profession` « un titre professionnel », `licence` « le numéro de permis », …) and `nextAction(record, can)` (Aperçu « Prochaine action »).
- `filters.ts`: `useProfessionalsFilters()` — URL is the source of truth: `q`, `statut`, `profession`, `langue`, `clientele`, `motif` (repeatable), `nouveaux` (`1`), `surveiller` (`1`), `page`. **PS Hub check:** `NEW PS Hub/src/hooks/useCrmUrlState.ts` (`parseEnumParam`, URL as source of truth, `replace: true` for typing). Unknown values fall back to defaults; changing a filter resets `page`. `filterProfessionals(rows, filters, catalog)`: pure, tested (search on name, email and licence, accent-insensitive with `normalize('NFD')`).
- `constants.ts`: `RECORD_TABS = ['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'remuneration', 'historique'] as const`, `AVAILABILITY_PERIODS`, `PAGE_SIZE = 25`.

**Step 6: Manifest.** Routes and sections (pages arrive in later tasks; until then point them at a shared « en préparation » page so the manifest compiles):
```ts
routes: [
  { path: 'professionnels', permission: 'professionals.view', component: lazyPage(() => import('./pages/ProfessionalsListPage'), 'ProfessionalsListPage') },
  { path: 'professionnels/:id/:onglet?', permission: 'professionals.view', component: lazyPage(() => import('./pages/ProfessionalRecordPage'), 'ProfessionalRecordPage') },
],
settingsSections: [
  { id: 'professions', path: 'professions', labelKey: 'modules.professionals.settings.professions.title', icon: GraduationCap, permission: 'professionals.manage', editPermission: 'professionals.settings', group: 'modules', component: lazyPage(…) },
  { id: 'specialties', path: 'specialites', … },
  { id: 'motifs', path: 'motifs', … },
  { id: 'languages', path: 'langues', … },
  { id: 'deactivation-reasons', path: 'raisons-desactivation', … },
  { id: 'compensation', path: 'remuneration', permission: 'professionals.compensation', group: 'modules', … },   // 4a.18
],
```
Test (`manifest.test.tsx`): every route and section component has `preload`; section ids and paths are unique against `coreSettingsSections`; `route-preload` resolves `/professionnels/<uuid>/jumelage` to the record page.

**Step 7: Checks and commit** (`feat(professionals): module API, hooks, schemas and manifest`), staging the files above by path.

**As built (the code is the reference where this sketch differs):**
- **Section visibility.** The five list sections are seen with `professionals.manage` **or** `professionals.settings` and edited with `professionals.settings` (`LIST_SECTION` in `manifest.ts`). The sketch said `.manage` only, but then a user given `.settings` by override could not open the lists they edit. `list_professionals_reference_usage` already serves both. « Rémunération » (4a.18) is not registered yet.
- **Narrow invalidation**, not `professionalKeys.all` after every change. There are three key roots (`professionalKeys`, `professionalCatalogKeys`, `professionalsSettingsKeys`), and the table in `hooks/keys.ts` says what each change refetches:
  - a record change refetches `record(id)`, `lists()` and `history(id)`; a set or status change also refetches `usage()`;
  - a creation refetches `lists()` and `usage()`;
  - a saved list row refetches `catalog()` and `usage()`, plus `professionalKeys.all` for titles and motifs (they change the licence and restricted-motif rules);
  - an archive or restore refetches `catalog()`, `usage()` and `professionalKeys.all`;
  - a reorder is optimistic on `catalog()` and rolled back on error.
  
  Records and list rows hold ids, never labels, so a rename refetches the catalogue only. A `42501` refetches the caller's access and `professionalCatalogKeys.all`, because the catalogue is nine empty lists without a professionals permission.
- **Activate / deactivate return shape.** `activateProfessional` and `deactivateProfessional` resolve with `StatusChange = { status, accountChange: 'disabled' | 'enabled' | null, profileId: string | null }`, not `void`. Both nullable fields are typed `| null` against the generated types (4a.4 note). The hooks write the status into the cached record the way the RPCs write it:
  - activation clears the deactivation reason, note and account claim, and keeps the trimmed override reason only when the file is incomplete;
  - deactivation sets the reason and the trimmed note, clears the override reason, and claims the account when `accountChange` is `'disabled'`.
- **`watchFlags(subject)`** (`lib/watch.ts`) takes a `WatchSubject` (`status`, `matchingComplete`, `emailMatchesLogin`), not `(row, catalog)`. A list row has those fields; a record goes through `recordWatchSubject`.
  - The 4a flags are `matching_incomplete` and `login_email_mismatch` « Courriel de connexion différent », both muted. `login_email_mismatch` comes from the readiness warning (4a.4) or the list's `email_matches_login`.
  - Inactive files have no flag.
- **`setPayerNumber(id, type, value: string | null)`**: `null` (or blank) deletes the number. The sketch had `value: string`. `useSetPayerNumber` removes it from the cached record.
- **View wrappers.** The API wraps only what this module's pages read: `get_professionals_catalog`, `professionals_list`, `list_professionals`, `get_professional_record`, the history, and the write RPCs.
  - Readiness comes from the record bundle through a selector, with no extra request. `fetchProfessionalReadiness` was removed, along with `fetchProfessionalPublicProfile` and its parser: no 4a page reads `get_professional_public_profile` (4a.13 edits `record.publicProfile`, and 4c.5 builds the fiche server-side).
  - The published contract (`professionals_directory`, the catalogue views, `get_professional_public_profile`) belongs to its consumers (Demandes), which read it through their own `api/` layer. The removed parser is in commit `1d69f6c` if one wants it.
- **Licence formats** are PostgreSQL regular expressions, and the client runs them as JavaScript. `lib/licence-pattern.ts` (`hasPostgresOnlySyntax`) finds the syntax the two read differently:
  - `***` prefixes, `[[:class:]]`, `[[.x.]]`, `[[=x=]]`, and a `]` first in a bracket;
  - every `(?` group;
  - `\m`, `\M`, `\y`, `\Y`, `\A`, `\Z`, `\b`, `\B`, and back-references.
  
  The order dialog refuses such a format (« Ce format utilise une syntaxe non prise en charge. »). The professions editor and the creation dialog skip their client format check for a stored format that has it, and leave the decision to the database.
- **List-dialog checks against the catalogue.** `referenceSchema(kind, { rows, current })` wraps `referenceSchemas[kind]` and adds:
  - a name another row holds, archived ones included, compared as `normalize('NFKC').toLowerCase()`, with the RPC's message;
  - a system clientèle keeping its kind (age group or not);
  - the system reason « Autre » keeping its required note.
  
  The RPCs stay authoritative, since a concurrent save can still collide. The creation dialog also refuses an archived title.
- **Filters.**
  - The setters compute the next filters from the current URL (a ref that follows every render and every write), so two changes in one event both apply. react-router 6 hands `setSearchParams`'s updater the params of the last render, so the updater alone would not do it.
  - A search of spaces alone is no filter.
  - **« profession »:** the client filter (`filterProfessionals`) matches the **primary** title, since a `professionals_list` row carries only that one. `list_professionals` (server pages) matches **any** of the professional's titles. 4a.10 picks one and labels the filter to match (« Titre principal » for the client filter).
  - **Remembered filters are not in 4a.5.** PS Hub's `useCrmUrlState` restores each user's last search through `usePersistedSearch`, which stores it per user in `user_search_preferences`. The Professionnels list gets the same per-user model in 4a.10. It is stored server-side in a core `user_preferences` table (DB lane), never in `localStorage` (decision #10), and restored when the same person signs in on any computer. See « Écarts par rapport à PS Hub » in `docs/modules/professionals.md`.
- **Public email** is capped at 254 characters, like the column check.

---

## Task 4a.6: Settings — the reference-list pattern, « Langues », « Raisons de désactivation » (lane B)

**Files:**
- Create: `src/modules/professionals/components/settings/ReferenceListCard.tsx` + test (the shared pattern)
- Create: `src/modules/professionals/components/settings/ReferenceEditDialog.tsx`, `ArchiveReferenceDialog.tsx`
- Create: `src/modules/professionals/pages/settings/LanguagesSettingsPage.tsx` + test, `DeactivationReasonsSettingsPage.tsx` + test
- Modify: `manifest.ts` (point the two sections at their pages), `fr-CA.json`

**`ReferenceListCard` (the representative settings component, used by every list section):**
```tsx
interface ReferenceListCardProps<K extends ReferenceKind> {
  kind: K
  title: string
  description?: string
  rows: ReferenceRow<K>[]                 // from the catalogue, already sorted
  usage: ReadonlyMap<string, number>      // fetchReferenceUsage
  columns: ReferenceColumn<K>[]            // extra columns (code, âges, sigle…)
  renderForm: (props: ReferenceFormProps<K>) => ReactNode   // the dialog's fields
  reorderable?: boolean
  canEdit: boolean                         // useSettingsSection().readOnly === false
}
```
- **Header:** title + description; filter « Actifs (n) · Archivés (n) · Tous (n) » as a toggle group (arrow keys move focus, Enter/Space selects, decision #36); search field (accent-insensitive, highlights the match); « + Ajouter » only with `canEdit` — teal when the page holds a single list (the screen's one coloured action, as Phase 3's « Inviter »), outline when the page stacks several cards (Professions et ordres, Spécialités), so a page never shows more than one teal button at rest.
- **Table** (design-system table): Nom, the extra columns, « Utilisé par » (« 3 professionnels », « — »), actions menu « … » (Modifier, Archiver / Restaurer). System rows show a lock icon with the tooltip « Utilisé par le jumelage : ne peut pas être archivé. » and no « Archiver ». Archived rows are muted with « Archivé ».
- **Reorder** (`reorderable`): « Monter » / « Descendre » icon buttons per row (keyboard reachable, `aria-label` with the row name), saved at once through `reorderReference`, optimistic with rollback on error. No drag and drop (keyboard parity).
- **Dialogs:** `ReferenceEditDialog` (react-hook-form + the kind's Zod schema, focus on the first field, X out of the tab order, « Annuler / Enregistrer »); `ArchiveReferenceDialog` (AlertDialog titled « Archiver « {nom} » ? »: « Cet élément est utilisé par {n} professionnels. Il reste sur leur dossier mais ne pourra plus être choisi. » or « Personne n'utilise cet élément. Il ne pourra plus être choisi. », confirm « Archiver »).
- **Read-only** (adjointe): no « Ajouter », no actions column, the section shows `ReadOnlyNotice` once (Phase 2 pattern).
- **Empty states:** « Aucun élément » / « Ajoutez le premier élément de cette liste. »; « Aucun résultat » / « Modifiez la recherche. »

**Pages:**
- « Langues »: one card, columns Code (« fr ») and Nom; `fr` is system (lock « Ajoutée par défaut à chaque nouveau dossier : ne peut pas être archivée. »); description « Le français est ajouté par défaut à chaque nouveau dossier. Ajoutez les autres langues de consultation. »; the code field is typed on create only (read-only on edit).
- « Raisons de désactivation »: columns « Note requise » (Oui/Non) and « Désactive le compte » (Oui/Non), reorderable; the dialog has two checkboxes with help « Le professionnel ne pourra plus se connecter. »

**Tests:** filter counts; search highlight; create → `saveReference('languages', …)` with `code` lower-cased; edit keeps the code read-only; archive dialog shows the usage count and calls `setReferenceActive(…, false)`; system row has no archive action; reorder buttons call `reorderReference` with the new order and roll back on error; read-only renders no buttons; a `P0001` error shows in the dialog.

**Browser check** (lane B, no reset): admin → Paramètres → Modules group shows the sections; add « Portugais (pt) », archive it, restore it; adjointe sees the sections read-only; conseillère has no Paramètres (decision #19).

**As built (the code is the reference where this sketch differs):**
- **Langues:** the code is typed when adding (`maxLength` 2, lower-cased on save) and shown **read-only** on edit with the help « Le code ne change pas une fois la langue ajoutée. » (the RPC refuses a change), rather than hidden.
- **Restore** asks for confirmation too (« Restaurer « {nom} » ? » / « Cet élément pourra de nouveau être choisi. »), in the same `ArchiveReferenceDialog`; a refusal shows inside it.
- **Props added for 4a.7–4a.9** (so they build on the card without reshaping it): `toolbar?: ReactNode` (the list's own controls after the search, e.g. the motifs' view toggle and category filter); `filterRow?: (row) => boolean` (the list's own filter, applied **before** the « Actifs · Archivés · Tous » counts, which count what can be shown; pass it only while it filters); `groupBy?: (row) => { id, label, order }` (group header rows in one table, one `<tbody>` per group, groups by `order`, « Autres » with `order: Infinity` last; with reorder, a row moves within its group); `createDefaults?: Partial<ReferenceFormValues[K]>` (what « Ajouter » starts with, e.g. the filtered category); also `labels`, `addVariant` and `headingHidden`.
- **Reorder feedback:** after a move, a polite live region says « « Congé » : position 2 sur 3 »; while the save is pending, the move buttons are `aria-disabled` (focus stays) and the table `aria-busy`, and a press does nothing (one move at a time). The buttons show only under « Actifs » or « Tous », with no search and no `filterRow`.
- **Table:** named by the card's title; the name cell is the row header (`<th scope="row">`); the scroll wrapper is a tab stop only while the table is wider than the card (`Table scrollFocus="overflow"`); « Utilisé par » and the secondary columns (`max-sm:hidden`) are hidden at phone width so the actions stay visible at 375 px.
- **Empty states** always have a second line (design system): « Aucun élément actif » / « Les éléments archivés sont sous « Archivés ». », « Aucun élément archivé » / « Un élément archivé reste sur les dossiers, mais ne peut plus être choisi. », read-only « Rien n'a encore été ajouté à cette liste. », and with `filterRow` « Modifiez la recherche ou les filtres. »
- **Shared pieces** (generic, in `src/shared/`): `components/CheckboxField` (forwards its ref to the checkbox: pass react-hook-form's `field.ref` so a failed save focuses it), `components/ListStatusFilter` (keys `common.listFilter.*`), `components/HighlightedText`, `lib/list-search` (`foldSearch`, `searchWords`, `matchesSearch`, `highlightRanges`).

**Commit:** `feat(professionals): reference-list settings pattern, Langues and Raisons de désactivation`.

---

## Task 4a.7: Settings — « Professions et ordres » (lane B)

**Files:** `pages/settings/ProfessionsSettingsPage.tsx` + test; `manifest.ts`; `fr-CA.json`.

Three `ReferenceListCard`s on one page:
1. **Ordres professionnels:** columns Sigle, « Libellé du permis »; dialog: Nom*, Sigle* (upper-cased as typed), « Libellé du permis » (default « N° de permis »), « Format du permis » (optional regex, help « Expression régulière, par exemple ^[0-9]{5}$. Laissez vide pour accepter tout numéro. »).
2. **Catégories:** name only; description « Services et tarifs fixe les prix par catégorie. »
3. **Titres:** columns Catégorie, Ordre (« — » for « Aucun ordre : permis non requis »); dialog: Nom*, Catégorie* (select of active categories), Ordre (select with « Aucun ordre » first). Changing a title's order shows the inline note « Les professionnels qui ont ce titre devront fournir un numéro de permis. » when going from none to an order.

**Tests:** the three cards render from the catalogue; the title dialog lists only active categories; « Aucun ordre » sends `null`; archive of a category with active titles shows the database message; read-only.

**As built (the code is the reference where this sketch differs):**
- **Order of the cards:** Ordres professionnels, Catégories, Titres, each with a visible heading and description and an outline « Ajouter un ordre / une catégorie / un titre ».
- **Parents count titles:** « Utilisé par » of an order or a category is its active titles (« 1 titre », « 3 titres »; `list_professionals_reference_usage`); a title counts professionals. The card gained one label for this, `labels.usageNone` (what « — » says to screen readers: « Aucun titre » here, « Personne » by default).
- **Archive confirmations:** a parent with active titles says so (« 2 titres actifs sont dans cette catégorie : archivez-les d'abord. »); « Archiver » stays available and the database's refusal (« Archivez d'abord les titres de cette catégorie. ») shows in the dialog, since the count may be stale. A title says how many professionals keep it. A title restored before its category or order shows « Restaurez d'abord sa catégorie / son ordre. ».
- **Title dialog:** the selects list active categories and orders (« Nom (SIGLE) »), plus the archived one the title already has, marked « Nom (archivée) » / « Nom (SIGLE), archivé », so a rename keeps it. The licence note shows only when an existing title that at least one professional has goes from no order to an order (a new or unused title has nobody to ask), in a polite live region that is in place before the note.
- **Titles table:** Catégorie (hidden at phone width), Ordre as the acronym (« — » read as « Aucun ordre : permis non requis »); the search also looks in the category name and the order's acronym and name. Titles are **reorderable** (coordinator decision, follow-up): a new title lands last otherwise. Orders and categories are not.
- **Order dialog:** the acronym is upper-cased in place as typed (caret kept; not while an input method composes, then on `compositionend`); « Libellé du permis » starts as « N° de permis » (`createDefaults`, the RPC's own default for an empty label); « Format du permis » is monospace and refused when it uses syntax the two regex dialects read differently (`hasPostgresOnlySyntax`); when editing, its help adds that a changed format applies to each record the next time it is edited.

**Commit:** `feat(professionals): Professions et ordres settings`.

---

## Task 4a.8: Settings — « Spécialités » (Clientèles, Approches) (lane B)

**Files:** `pages/settings/SpecialtiesSettingsPage.tsx` + test; `manifest.ts`; `fr-CA.json`.

- **Card « Clientèles »:** columns « Âges » (`clienteleLabel` bounds, « — » for couples, familles, groupes); dialog: Nom*, Âge minimum, Âge maximum (help « Laissez vide pour une clientèle sans âge, par exemple Couples. »); the 7 system rows are locked from archiving; description « Le jumelage filtre selon la clientèle : l'âge de la personne principale, ou couple, famille, groupe. »
- **Card « Approches »:** name only, reorderable; description « Les approches orientent le jumelage sans l'exclure. » (A6.1 behaviour: active/archived/all, search, usage count, restore.)
- **Fixes A10.5:** the archived filter never crashes when a list is empty or every row is archived (test it).

**Tests:** ages display and validation messages; system lock; the empty archived view renders the empty state.

**As built (the code is the reference where this sketch differs):**
- **Ages in words** (`agesLabel`, `lib/display.ts`): « 6 à 12 ans », « 12 ans », « Moins de 1 an » (0 to 0), « 18 ans et plus », « Tous les âges » (from 0, no maximum), and « Sans âge » (P4-52; muted with `text-subtle`, like the lists' « — ») instead of « — » for couples, familles, groupes; « an » under 2. `clienteleLabel` uses the same words in parentheses (« Enfants (0 à 12 ans) ») and stays the bare name for a clientèle without ages.
- **Clientèle dialog:** Âge minimum and Âge maximum side by side (digits, `inputMode="numeric"`, empty = none), each with its help (« Laissez vide pour « et plus »… » on the maximum). A system clientèle keeps its kind, as `save_clientele` requires: an age group shows the minimum as required (help « …l'âge minimum reste requis. »; clearing it gets « Cette clientèle garde son type… » before any request); a clientèle without ages shows both fields read-only under one help line that both describe (« …elle reste sans âge. »; `readOnly={… || undefined}`, so a surrounding read-only context is never overridden). A system age group's bounds stay editable (Enfants 0–12 → 0–11 saves). The database decides: its refusals show in the dialog.
- **Both lists reorderable** (Approches per the plan, Clientèles too, as titles in 4a.7: a new clientèle otherwise lands after Groupes); the lock note is feminine (« Utilisée par le jumelage : ne peut pas être archivée. »).
- **Page:** two cards with visible headings and an outline « Ajouter une clientèle / une approche »; description « Les clientèles et les approches des professionnels, qui servent au jumelage. »
- **Phone width (review fix, in `ReferenceListCard`, so every list benefits):** a reorderable list with a visible secondary column (Clientèles, Titres) was wider than its card at 375 px (364 and 362 px in 309), cutting off « … ». The list's columns now wrap, the actions cell is as narrow as its buttons (`pl-1 pr-2`), and « Monter / Descendre » are hidden below `sm` (reordering is a desk task; the menu stays). Measured at 375 px: Clientèles, Approches, Titres, Ordres, Catégories, Langues and Raisons all 309 px in 309, « … » in view.

**Commit:** `feat(professionals): Spécialités settings (clientèles and approaches)`.

---

## Task 4a.9: Settings — « Motifs » (categories, restricted switch) (lane B)

**Files:** `pages/settings/MotifsSettingsPage.tsx` + test, `components/settings/MotifCategoriesSheet.tsx` + test, `components/settings/IconPicker.tsx`; `manifest.ts`; `fr-CA.json`.

- **Motifs list:** view toggle « Par catégorie » (grouped, categories in their order, « Autres » last for no or archived category, A10.10) / « Liste A–Z »; category filter; columns Catégorie, « Réservé » (dot + « Professions réglementées » when restricted), « Utilisé par ». Dialog: Nom* (editable label, A10.10), Catégorie (select, « Autres » = none), switch « Réservé aux professions réglementées » (Space/click only, #39) with help « Seuls les professionnels qui ont un titre d'un ordre professionnel pourront choisir ce motif. »
- **Categories sheet** (« Gérer les catégories », Sheet, X out of the tab order): `ReferenceListCard` for `motif_categories`, reorderable, columns Icône (rendered Lucide icon) and Description; dialog with Nom*, Description, Icône (`IconPicker`: a radio-group grid of the 20 icons, arrow keys move, Enter/Space selects, nothing saves until « Enregistrer »). Archiving a category: « Ses {n} motifs s'afficheront sous « Autres ». »
- Copy: never « diagnostic »; the page description « Les motifs décrivent le besoin exprimé, pas un diagnostic. »

**Tests:** grouping with « Autres »; the restricted switch value is sent; the icon picker keyboard behaviour; archive message with the motif count; read-only.

**As built (the code is the reference where this sketch differs):**
- **Page** (`MotifsSettingsPage`): one list, so « Ajouter un motif » is the page's teal button and the card's heading is for screen readers; the description is the plan's « Les motifs décrivent le besoin exprimé, pas un diagnostic. » (the one place the word appears, to say what motifs are not). « Gérer les catégories » (« Voir les catégories » read-only) is an outline button in the page header (`ReferenceSettingsPage` gained `actions`, rendered once the data has loaded).
- **Toolbar** (the card's `toolbar`): « Par catégorie · Liste A–Z » as a `SegmentedToggle` (new in `src/shared/components/`, arrows move focus, Enter/Space choose; `ListStatusFilter` now uses it), and a category filter (native select: « Toutes les catégories », the active categories in order, « Autres »). The filter is the card's `filterRow` (counts follow) and seeds « Ajouter » (`createDefaults`: the category, or none for « Autres »); a category archived meanwhile falls back to « Toutes ».
- **Par catégorie:** `groupBy` on the motif's active category (its `sortOrder`), « Autres » (`Infinity`) for none or an archived one; reorder within the group (P4-54). **Liste A–Z:** sorted by name (`Intl.Collator('fr-CA')`), no reorder, plus a « Catégorie » column (an archived one reads « Nom (archivée) », none « Autres », muted) shown from `lg` only, and searched (the A–Z search finds motifs by category name).
- **« Réservé »:** dot (`info`) + « Professions réglementées », or « — » read « Non réservé »; the words wrap (one line pushed « … » out at 375 px: 364 px in 309).
- **Motif dialog:** Catégorie (« Autres (aucune catégorie) » first, sent as null; active categories plus the archived one the motif already has, marked, so a rename keeps it), the switch through a new shared `SwitchField` (label and help left, switch right, Space or click); the note of P4-55 in a polite live region when a used motif becomes restricted.
- **Categories sheet** (`MotifCategoriesSheet`): Radix `SheetTrigger` (focus returns to the button), X out of the tab order, title « Catégories de motifs » and description « Elles regroupent les motifs à l'écran, par sphère de vie. … ». The card is reorderable, columns Icône (the icon named in words, `role="img"`) and Description (hidden at phone width; « — » read « Aucune description »); « Utilisé par » counts active motifs (« 2 motifs », « Aucun motif »); « Ajouter une catégorie » outline (the page under the sheet holds the teal button). Archive: « Ses {n} motifs actifs s'afficheront sous « Autres » tant qu'elle sera archivée. ». The sheet is 640 px wide from `sm` (the default 480 px left « … » out of view with « Monter / Descendre »: 519 px in 485).
- **Icons:** `components/CategoryIcon.tsx` maps the 20 stored names to Lucide (`AlertTriangle` → `TriangleAlert`, `Home` → `House`); `motifIconLabel` (`lib/display.ts`, `modules.professionals.icons.*`) names them in French. `IconPicker`: a radio group of 4 rows of 5, one tab stop (the chosen icon; back on it once focus leaves), arrows/Home/End move focus only, Enter/Space/click choose the draft; nothing saves before « Enregistrer ».
- **Settings placeholder removed** (`ProfessionalsSettingsPlaceholder`, `modules.professionals.settingsPlaceholder`): every list section now has its page.
- **Browser check (admin, adjointe):** « … » in view everywhere; table width in available width: Motifs 309/309 at 375 (with a restricted motif), 574/574 at 640, 622/622 and 458/458 at 768 (sidebar closed / open), 862/862 at 1280; A–Z the same; the categories sheet 300/300 at 375, 565/565 at 640, 768 and 1280; no page overflow.

**Commit:** `feat(professionals): Motifs settings with categories and restricted motifs`.

---

## Task 4a.10: List and creation (lane C)

**Files:**
- Create: `pages/ProfessionalsListPage.tsx` + test, `components/list/ProfessionalsTable.tsx`, `components/list/ProfessionalsFilters.tsx`, `components/list/CreateProfessionalDialog.tsx` + test
- Modify: `manifest.ts`; delete `pages/ProfessionalsPlaceholderPage.tsx`; `fr-CA.json`

**Page (design §5.1, design system §4):**
- `usePageTitle(t('modules.professionals.name'))`. `PageHeader` « Professionnels », subtitle « {n} professionnels · {m} actifs », teal « + Ajouter » with `professionals.manage`.
- **Filter bar:** search (« Rechercher par nom, courriel ou permis… », max 280); Statut select (Tous les statuts, À inviter, Invité, À réviser, Actif, Inactif); « Filtres » popover: Profession, Langue, Clientèle, Motif (multi, searchable command list), « Accepte de nouveaux clients », « À surveiller »; active filters as removable chips; « N résultats » on the right. All state in the URL (`useProfessionalsFilters`).
- **Remembered filters (per user, PS Hub `usePersistedSearch` model, P4-39):** the list remembers each person's last search and filters, so they come back when the same person signs in on any computer.
  - **Storage:** server-side, one row per user, in a new core table `user_preferences (user_id uuid references profiles(user_id) on delete cascade, key text, value jsonb, updated_at timestamptz, primary key (user_id, key))`. RLS lets each user select, insert, update and delete only their own rows (`user_id = auth.uid()`). `key` is checked against a pattern (`^[a-z0-9_.]{1,64}$`) and `value` is capped in size (e.g. 4 KB). Key here: `professionals.list_filters`; the value is the filters without the page. **DB-lane item (lane A), before 4a.10:** no per-user preferences table exists yet. PS Hub's equivalent is `user_search_preferences (user_id, page_key, search_state jsonb)`.
  - **Built (DB lane, migration `…_core_user_preferences.sql`, pgTAP `044`):** `user_preferences (user_id, org_id, key, value, created_at, updated_at)`, primary key `(user_id, key)`, composite FK `(user_id, org_id)` → `profiles` on delete cascade (rows go with the profile). **Read** with a plain select on the table: one policy, own rows while active (`user_id = auth.uid()` and the caller's org, so a disabled user sees nothing). **Write** through two RPCs, never the table (clients get no `INSERT`/`DELETE`, conventions §3, so this departs from PS Hub's direct upsert): `set_user_preference(p_user_id, p_key, p_value)` upserts, `delete_user_preference(p_user_id, p_key)` removes (no-op when absent); both take the user and org from the session, refuse a `p_user_id` that is not the session's user (`42501`, HINT `user_mismatch`, review of 4a.10) and raise `42501` for a disabled user. Limits: key `^[a-z0-9_.:-]{1,100}$`, value a JSON object of at most 16 KB as text (named checks `user_preferences_key_format` / `_value_object` / `_value_size`, `23514`), at most 50 keys per user (`22023`); a null key or value is `22023`. Not audited (UI state; the search text may name a client), listed in the `000_invariants` exception list. « Réinitialiser » saves `{}` with `set_user_preference`.
  - **Never `localStorage`** (decision #10, shared reception computers). PS Hub also keeps a `localStorage` copy; we don't. The preference is a React Query entry keyed by user, so it is cleared with the cache when the user changes.
  - **Flow:** the URL stays the source of truth. On arrival with no filter parameter, the saved filters are written into the URL (`replace`). A link or reload that carries filters wins and is not overwritten. Changes are saved with a debounce (≈ 1.5 s), and « Réinitialiser » deletes the saved row (`delete_user_preference`, P4-61).
- **Table** in a Card (padding 0), columns `minmax(0,2fr) minmax(0,1.6fr) 96px 120px minmax(0,1.4fr)`: Nom (avatar 24 with initials, name 13/500, email 12 secondary), Profession (primary title + « OPQ 12345 »), Langues (« FR · EN »), Statut (dot + word), À surveiller (first flag of `watchFlags`, red when `danger`, else « — »). Rows 40 px, the whole row is a link to `/professionnels/:id/apercu` (an `<a>` so Ctrl-click opens a tab; hover/focus prefetches the record and the record page chunk).
- **Footer:** « {x} sur {n} professionnels » and « ‹ Page 1 sur 2 › » (`PAGE_SIZE` 25, page in the URL).
- **Data:** `useProfessionalsList()` + `useProfessionalsCatalog()` in parallel; filtering is client-side and memoised on `(rows, filters, catalog)`. When `truncated`, an Alert: « Plus de 500 professionnels : affinez la recherche. »
- **Loading:** skeleton rows; **error:** inline Alert with « Réessayer ».
- **Empty states:** no professional at all: « Aucun professionnel pour l'instant » / « Ajoutez le premier professionnel de la clinique. »; no match: « Aucun professionnel ne correspond » / « Modifiez la recherche ou les filtres. » + outline « Réinitialiser ».

**Creation dialog (design §5.2, P4-35):** Prénom*, Nom*, Courriel*, Profession (select of active titles, « Aucune pour l'instant » first); « N° de permis »* appears when the chosen title has an order (label from the order's `licence_label`). Annuler / « Créer ». On success: navigate to `/professionnels/:id/apercu`, toast « Professionnel créé. » Duplicate email: the database message under the Courriel field (`setError('email', …)`). Focus starts on Prénom; X out of the tab order.

**Tests:**
- subtitle counts; search on name, email and licence (accents ignored); each filter narrows the rows; chips remove a filter; URL round trip (reload keeps the filters); page resets on filter change;
- row link target and prefetch on hover;
- « + Ajouter » hidden for the conseillère;
- the licence field appears for `psychologue`, not for `naturopathe`; duplicate email shows under the field; success navigates;
- truncated alert at 501 rows.
- remembered filters: restored into an empty URL, not over a URL that carries filters, saved after a change (debounced), cleared by « Réinitialiser »; nothing written to `localStorage`.

**Browser check** (desktop and 375 px): the table never scrolls horizontally (ellipses), the filter popover is usable by keyboard.

**As built (the code is the reference where this sketch differs):**
- **Remembered filters (per user, never `localStorage`):**
  - Core layer `src/core/preferences/`: `fetchUserPreference` (a select on `user_preferences` by `(user_id, key)`), `saveUserPreference` / `deleteUserPreference` (the two RPCs, with the user who made the change as `p_user_id`), `onSessionUserChange` (auth events); `useUserPreference(key)` (keyed by user, read once per session, no retry; a read that resolves after a local change keeps the change: a per-(user, key) change counter) and `usePreferenceWriter(key)` (cache first, debounced 1.5 s write, writes chained so an older value never lands last, an unchanged value not rewritten, the pending value written when the list unmounts, when the page is hidden (`visibilitychange`) and on `pagehide`; failures quiet: the cache is re-read).
  - **Never on another user (review):** `schedule` captures the user id and each write sends it; `set_user_preference` / `delete_user_preference` refuse a `p_user_id` other than `auth.uid()` (42501, HINT `user_mismatch`, pgTAP `044`), and the writer drops that refusal without re-reading. On a sign-out or another user (the access's user changes, or auth reports another session, e.g. another tab), what waits and what is queued is dropped before the page unmounts, so nothing is sent for the next person (Vitest: hold the first write, change the user, release).
  - Module: `lib/remembered-filters.ts` (`useRememberedProfessionalsFilters`). The value is the query string without the page (P4-60); clearing every filter deletes the row (P4-61); only chosen filters are saved (P4-62). `useProfessionalsFilters` gained `onChange` (the person's choices only) and `restore` (no `onChange`, page 1, `replace`). Once `restore` has run, the wait ends as soon as the URL carries any filter (not only exactly the restored ones: typing during the restore transition left it stuck), and any choice ends it.
  - The list waits for the preference (read in parallel with the list and the catalogue) and for the restored URL, so it never shows every row first. A failed read shows the list with the URL's filters.
- **Table** (`components/list/ProfessionalsTable.tsx`): a grid with ARIA table roles; the name is a `<Link>` stretched over the row (Ctrl-click opens a tab). Columns follow the card's width (P4-63), with named container-query variants from `tailwind.config.js` (Tailwind 3.4 has none built in; a three-line plugin rather than `@tailwindcss/container-queries`): `container-inline` on the card, `cq-480:` / `cq-720:` / `cq-880:` on the grid and the columns. The record and its page chunk (`professionalRecordPage`, exported by the manifest) are prefetched after a 120 ms hover or on focus (P4-64).
- **Filter bar** (`components/list/ProfessionalsFilters.tsx`): the search keeps its own text while it has focus (the URL takes each keystroke in a transition and its echo can lag); « Filtres (n) » opens a popover with Titre principal, Langue, Clientèle (selects of active rows, plus the chosen one if archived), Motifs (cmdk list, accent-insensitive, grouped by category, `aria-checked`; no `aria-multiselectable`: cmdk sets `aria-selected` on the highlighted option, which a multiselectable listbox would announce as chosen), and two checkboxes. The results status (polite, atomic) also says « …, page X sur Y » when there are several pages, so ‹ › (which keep the focus) are heard. The popover's filters show as chips; a removed chip or « Réinitialiser » moves focus to « Filtres ».
- **Page** (`pages/ProfessionalsListPage.tsx`): `PageHeader level={1}`; the search text of each row is folded once per list (`searchHaystacks`, memoised on the rows), not on each keystroke; counts with French singulars (« 0 professionnel · 0 actif »); « Ajouter » with `professionals.manage`; the empty-clinic body for staff who cannot add is « Les professionnels de la clinique s'afficheront ici. ».
- **Creation dialog** (`components/list/CreateProfessionalDialog.tsx`): reads the cached catalogue itself; focus goes to Prénom once the form is there; refusals go under the field their HINT names (`createErrorField` in `schemas/create.ts`: `first_name`, `last_name`, `email`, `title`, `licence`, raised by `create_professional`, `professional_email`, `assert_professional_email_free` and `professional_professions_guard`; pgTAP `042` checks each hint), only when that field is on screen: a licence refusal with no licence field (the title gained an order meanwhile) shows above the buttons (« Ce titre demande maintenant un numéro de permis… ») and refetches the catalogue, which brings the field. Success closes, opens `recordPath(id)` (`lib/constants.ts`) and toasts « Professionnel créé. » without waiting for the lists to refetch (P4-65).
- **Placeholder:** `ProfessionalsPlaceholderPage.tsx` stays until 4a.9 and 4a.11 replace the two entries that still use it (P4-65). `AuthenticatedApp.test.tsx` now checks the placeholder on the record route.
- **Browser check** (local, lock held, 28 probe professionals, deleted afterwards): no sideways scroll at 375, 640, 768, 1024, 1280 px (document and every row as wide as the card: 343, 608, 492, 748, 1004 px), columns 2 / 3 / 3 / 4 / 5; the popover works by keyboard (Enter opens it, Tab through, type in the motif list, Enter toggles, Escape returns to « Filtres »); one `set_user_preference` per pause while typing; the admin's filters came back after a reload, after signing out and in, and in a fresh origin (`[::1]:5297`, empty storage), and never showed for the adjointe; « Réinitialiser » deleted the row; nothing in `localStorage` but the auth session. The adjointe created a professional (duplicate email shown under Courriel, then the record opened with the toast); the conseillère sees the list without « Ajouter »; the provider gets « Accès refusé ».

**Commit:** `feat(professionals): list with filters in the URL and creation dialog`.

---

## Task 4a.11: Record shell and « Aperçu » (lane C)

> **Motif density (Jonathan, 2026-10-08) — applies to 4a.11, 4a.12, 4a.13, the list filters and every later view of a professional's motifs.** Some professionals select a great many motifs, sometimes nearly all 72. Every display must stay light and easy to scan when everything is selected, never a wall of chips or a long « · » run of names. Summarise per category, as built in 4a.12 (P4-73, P4-86): **each category's title on its own line** (icon, name, « 6 / 16 » at the right) with a short summary under it — the names when there are few (≤ 3 held, so a category of two reads its two names, never « Tous »), « Tous » when every active motif of the category is selected, otherwise « Tous sauf … » or the count alone; overall, one line « Tous les motifs (72) » or « Tous sauf … » when most are selected. **Categories are collapsible rows, always expandable** (Jonathan, 2026-10-08): a disclosure (`aria-expanded`) unfolds a category in place to its **motifs, one per line, in columns** (1 to 3, by the list's width), and the overall line to the categories, still folded. « Tous » is never dead text; only a category already showing all its names has no disclosure. The Jumelage picker stays searchable, grouped and collapsible, with « Tout sélectionner » per category and a running count. Tests and the browser check cover a professional with all 72 motifs.

**Files:**
- Create: `pages/ProfessionalRecordPage.tsx` + test, `components/record/RecordHeader.tsx` + test, `components/record/RecordTabs.tsx`, `components/record/tabs/OverviewTab.tsx` + test, `components/record/MatchingDigest.tsx`, `components/record/ReadinessCard.tsx`, `components/record/WatchCard.tsx`, `components/record/NextActionCard.tsx`
- Modify: `fr-CA.json`

**Shell:**
```tsx
// Tabs are page-level views: real Radix Tabs, one tab stop, arrows switch (decision #35),
// synced with the URL so alerts can link to /professionnels/:id/<onglet>.
const OverviewTab = lazyPage(() => import('../components/record/tabs/OverviewTab'), 'OverviewTab')
const MatchingTab = lazyPage(() => import('../components/record/tabs/MatchingTab'), 'MatchingTab')
// … one lazyPage per tab

export function ProfessionalRecordPage() {
  const { id = '', onglet } = useParams()
  const record = useProfessionalRecord(id)
  const catalog = useProfessionalsCatalog()        // in parallel with the record: no waterfall
  const tabs = useVisibleRecordTabs()              // from useAccess().can(…); hidden tabs are not rendered
  // unknown or hidden `onglet` → <Navigate to="apercu" replace />
  // record.data === null → FullPageMessage « Professionnel introuvable » + link to the list
  usePageTitle(record.data ? fullName(record.data.professional) : t('modules.professionals.name'), { crumb: true })
  // …
}
```
- **Visible tabs:** Aperçu, Jumelage, Profil public, Identité et permis, Historique for `professionals.view`; Documents from 4c; « Rémunération et fiscalité » with `professionals.compensation` or `professionals.private` (4a.18).
- **Tab switching** goes through the `UnsavedChangesProvider` guard (Phase 2): a dirty card asks before leaving the tab. Hovering or focusing a tab trigger calls its `preload()` (and the history prefetch for Historique).
- **Header** (design §5.3): avatar 48 (initials until 4c), name 20/600 + status dot and word; line « Psychologue · OPQ 12345 · courriel »; quiet chips: languages (« FR · EN »), « N'accepte pas de nouveaux clients » when false. Actions: « … » menu (Désactiver / Réactiver, 4a.14; from 4b « Renvoyer l'invitation », « Demander une mise à jour »); one teal action: « Activer » when not active and (`ready` or the user has `activate_override`). The « … » trigger and items are keyboard reachable.

**Aperçu** (grid `minmax(0,2fr) minmax(240px,1fr)`, gap 20; one column under 1100 px):
- Left, **« Profil de jumelage »** (read-only digest): Clientèles (★ first), Approches (★ first), Motifs grouped by category (names joined with « · »), Langues, Disponibilités générales (« Matin · Soir »), « Accepte de nouveaux clients » (Oui/Non) and the note; « Modifier » outline → `jumelage` (only with `professionals.matching`). Empty parts say « Aucune clientèle choisie », etc.
- Right:
  - **« Dossier »** (`ReadinessCard`): while not active, `StatusIndicator` per readiness item (4a: « Profil de jumelage complet » with the missing parts, each a link to its tab); once active, one line « Dossier complet » (or « Activé sans dossier complet : {raison} » when an override was used);
  - **« À surveiller »**: `watchFlags` with jump links, or « Rien à signaler. »;
  - **« Prochaine action »**: `nextAction(record, can)` → one sentence + at most one small outline button. 4a rules: incomplete matching profile → « Complétez le profil de jumelage. » [Compléter → jumelage]; complete and not active → « Le dossier est prêt à être activé. » [no button: the header holds the teal « Activer »]; active → « Rien à faire. Le dossier est complet. »

**Tests:** tab ↔ URL sync and keyboard (arrow keys move between tabs); hidden tabs absent for a conseillère without compensation; unknown tab redirects; not-found state; record and catalogue requested in the same tick (assert both `fetch` mocks called before either resolves); the crumb shows the name; the digest groups motifs and puts ★ first; next-action rules table.

**As built (the code is the reference where this sketch differs):**
- **Page** (`pages/ProfessionalRecordPage.tsx`): an id that is not a UUID is « Professionnel introuvable » without a request (P4-75); otherwise `RecordView` starts `useProfessionalRecord(id)` and `useProfessionalsCatalog()` at mount and provides both through `RecordContext` (`components/record/record-context.ts`, `useRecordData()`), so the tab panels stay prop-less `lazyPage`s and never refetch. A null record reads « introuvable » with « Retour à la liste »; an unknown, hidden or missing tab is `<Navigate replace>` to `apercu`; a failed load shows `LoadError` and retries only the failed query; while loading, a header skeleton. The browser tab and the topbar crumb carry the name (no crumb before the record is there).
- **Tabs** (`components/record/record-tabs.ts` + `RecordTabs.tsx`): one registry, `RECORD_TAB_DEFS` (`{ tab, panel, visible(can) }`), filtered by `visibleRecordTabs(can)`. Real Radix tabs with `useGuardedTabs`; a switch `navigate(…, { replace: true })` (P4-70); hover or focus preloads the tab's chunk; only the open panel is mounted, inside a `RouteBoundary` (`professionals:record`) and `Suspense`, with an `sr-only` h2 naming the tab (cards are h3). Aperçu is in the page chunk (P4-72); Jumelage, Profil public, Identité et permis, Historique and Rémunération et fiscalité (`compensation` or `private`) are `TabInPreparation` until their tasks (P4-71); Documents is not registered (4c). **For 4a.15:** add the history prefetch (`prefetchProfessionalHistory`) to Historique's tab hover when its panel exists.
- **Header** (`RecordHeader.tsx`): avatar 48 with initials, the name as the h1, the status `Badge` (`statusTone`, moved from the list table to `lib/display.ts`), « Titre · ORDRE permis · courriel » (wraps anywhere, so a long address never widens the page), chips « FR · EN » and « N'accepte pas de nouveaux clients ». No actions yet (P4-74).
- **Aperçu** (`tabs/OverviewTab.tsx`): grid `minmax(0,2fr) minmax(240px,1fr)`, gap 20, one column under 1100 px (`min-[1100px]:`, the design system's window breakpoint).
  - `MatchingDigest`: a `<dl>` (label above the value on phones, beside it from `sm`), clientèles and approaches ★ first then the catalogue's order (`lib/matching-digest.ts`), archived items « (archivé) », languages, periods, « Accepte de nouveaux clients » Oui/Non, the note; empty parts say so; « Modifier » → Jumelage with `professionals.matching`.
  - **Motifs are summarised and always expandable (P4-73, Jonathan's requirements):** `lib/motif-summary.ts` (`summarizeMotifs`) and `MotifsSummary.tsx`. 72 held motifs read « Tous les motifs (72) »; a few missing, « Tous sauf A et B (70 sur 72) » (no overall line with ≤ 3 held: every name already shows); else one line per category: the names (≤ 3 held, checked first: « Changements de vie » with its 2 motifs reads both names), « Tous (9) », « Tous sauf … » or « 6 sur 16 ». Every summarised line is a disclosure button (chevron, `aria-expanded`, `aria-controls` on a panel kept mounted with `hidden`) unfolding in place: a category to its names, the overall line to the full list by category with archived motifs marked « (archivé) ». The separate « Voir les N motifs » button is gone (the overall line is the disclosure). Archived motifs held: « Motif archivé : … » / « Motifs archivés : … ». French lists through `listLabel` (`Intl.ListFormat`, « A, B et C »). 4a.12's Jumelage card and any later view of a professional's motifs reuse `summarizeMotifs`.
  - `ReadinessCard`: `StatusIndicator` per item (its `description` now takes a node), « Il manque : » with each gap a link to its tab (`MISSING_TAB`); « Dossier complet » only when active and complete; the override reason above the gaps (P4-76).
  - `WatchCard`: `watchFlags(recordWatchSubject(record))`, each a link to `WATCH_TAB` (`lib/watch.ts`), else « Rien à signaler. ». `NextActionCard`: `nextAction(record, can)`.
  - `TabLink`: a link to another tab of the record, `replace` like the tabs, through `useConfirmLeave()` (a later tab with a dirty card asks first; modified clicks are left to the browser).
- **Review of 4a.11:** `RecordView` is keyed by the id (another record, even from the cache, starts with fresh local state); header chips truncate on an inner `span` (`min-w-0 truncate`); Vitest only, the disclosures were not re-checked in the browser.
- **Placeholder:** the record route now loads `ProfessionalRecordPage`; `ProfessionalsPlaceholderPage.tsx` keeps only `ProfessionalsSettingsPlaceholder` (the « Motifs » section, until 4a.9) and the key `modules.professionals.placeholder` is gone. **At the 4a.9 merge** the file and `settingsPlaceholder` go entirely (4a.9 removed the other half).
- **Tests:** `ProfessionalRecordPage.test.tsx` (same-tick requests, header and crumb, URL → tab, tab → URL with REPLACE, arrow keys, no refetch on a tab switch by click or arrow key, the unsaved-changes prompt on a tab and on an in-page `TabLink`, chunk preload on hover and on focus, fresh local state on another cached record, a failed catalogue retried alone, tabs per role, redirects, not found, malformed id without a request, retry of the failed query only), `OverviewTab.test.tsx` (digest, ★ order, archived clientèle and approach marked, empty parts, « Modifier » per permission, readiness states, watch links, next action, 72 motifs in one line unfolding to every name, « Tous sauf » overall, every summarised category line unfolding to its names and none on a named line, archived singular and plural), `RecordHeader.test.tsx`, `record-tabs.test.ts`, `matching-digest.test.ts`, `motif-summary.test.ts` (the 72-motif fixture `seventyTwoMotifsCatalog()` and `motifsCatalog(sizes)` in `test/fixtures-domain.ts`; categories of 1 and 2, a single custom motif under « Autres », « Autres » from an archived category, 3 held of 6, the 5-vs-6 overall cutoff).
- **Browser check** (local, port 5297, DB token held; probes created through « Ajouter », motifs added in SQL since Jumelage is not built, deleted afterwards on 55322): cold record load issues `get_professional_record`, `get_professionals_catalog` and the bell's count in the same tick (≤ 3 requests); no sideways scroll at 375, 640, 768, 1024, 1280 px (document width = viewport, or viewport minus the scrollbar), one column below 1100 px and `656px 328px` at 1280; the tab strip scrolls inside itself at 375 px. ArrowRight moves tab and URL without adding history entries; Tab then goes into the panel. The adjointe created probes and saw the incomplete and complete Aperçu; the conseillère sees five tabs and « Modifier »; the admin also sees « Rémunération et fiscalité » (placeholder), and `/remuneration` sends the others to Aperçu; an unknown id reads « Professionnel introuvable »; the provider gets « Accès refusé ». With all 72 motifs: « Tous les motifs (72) » and « Voir les 72 motifs »; with 60: « Vie intérieure : 6 sur 16 » (unfolds), « Relations et famille : Tous sauf Adoption et Dépendance affective », six « Tous », at 375 px without overflow.

**Commit:** `feat(professionals): record shell with URL tabs and Aperçu`.

---

## Task 4a.12: « Jumelage » tab (lane C)

**Files:**
- Create: `components/record/tabs/MatchingTab.tsx` + test, `components/pickers/SetPickerSheet.tsx` + test, `components/record/AvailabilityCard.tsx` + test
- Create: `src/shared/ui/star-toggle.tsx` + test (deleted in Phase 2 as unused; rebuilt from the design system's StarToggle with labels through `t()`, inconsistency 19; `common.star.add` « Marquer comme spécialisé », `common.star.remove` « Retirer la spécialisation »)
- Modify: `fr-CA.json`

**Cards** (each a `SettingsCard`; read-only without `professionals.matching`):
1. **Clientèles** — chips (★ first, then sort order), « Modifier » → picker with stars.
2. **Approches** — same.
3. **Motifs** — grouped by category; picker without stars; a restricted motif shows « Réservé » and is disabled with the reason when the professional has no regulated title.
4. **Langues** — chips; picker; French cannot be unticked when it is the only language (« Au moins une langue est requise. »).
5. **Disponibilités générales** (`AvailabilityCard`, `useSettingsForm` + `availabilitySchema`): checkboxes Matin / Après-midi / Soir / Fin de semaine, switch « Accepte de nouveaux clients » (Space/click), note (« Par exemple : pas le vendredi. »); Annuler / Enregistrer (`FormActions`).

**`SetPickerSheet`** (the shared picker, design A2.12–A2.13, legacy behaviour kept):
```tsx
interface SetPickerSheetProps {
  title: string
  groups: { key: string; label: string; icon?: LucideIcon; items: PickerItem[] }[]   // one group = flat list
  selected: ReadonlyMap<string, { specialized: boolean }>
  withStars: boolean
  onSave: (next: Map<string, { specialized: boolean }>) => Promise<void>
}
```
- Search with highlight (accent-insensitive) filtering items and auto-expanding matching groups; « Tout déplier / Tout replier »; per-group count « 3 / 12 »; selected first within a group when `withStars` (★ then A–Z), legacy order.
- Checkboxes toggle a **local draft** only; nothing saves on a change event (#36). Footer « Annuler / Enregistrer » (teal only when the draft differs); « Enregistrer » calls `onSave` once (one transaction, one audit set), closes on success, keeps the sheet open with the error otherwise.
- Archived items already selected stay listed with « Archivé » and can be removed, not re-added.
- Closing with a dirty draft asks « Abandonner les modifications ? ». X out of the tab order; focus starts in the search field.
- Lazy: the sheet body is `lazyPage`-loaded on first open (motifs list is the heaviest UI of the module).

**Tests:** draft vs save (no API call before « Enregistrer »); one call with the full set and stars; error keeps the sheet open; search highlight and auto-expand; star keyboard toggle; archived item handling; restricted motif disabled with reason; availability card saves the periods array; read-only: a user with `professionals.view` but an override removing `professionals.matching` sees chips and no « Modifier » or footers.

**As built (the code is the reference where this sketch differs):**
- **Tab** (`components/record/tabs/MatchingTab.tsx`, a `lazyPage` in `record-tabs.ts`): Aperçu's grid (`minmax(0,2fr) minmax(240px,1fr)`, one column under 1100 px): Clientèles, Approches, Motifs on the left; Langues, Disponibilités générales on the right. Everything comes from `useRecordData()`: a cold `/jumelage` load issues `get_professional_record`, `get_professionals_catalog` and the bell's count, nothing more. Without `professionals.matching`: a `ReadOnlyNotice` (« Vous pouvez consulter le profil de jumelage, sans le modifier. »), no « Modifier », the availability card read-only without footer.
- **Set cards:** `SettingsCard as="section"`, a description each (« ★ : spécialisé » on the starred lists), « Modifier » outline in the footer, named « Modifier les clientèles » etc. Held items as wrapping chips (`components/record/Chips.tsx`, `HeldChips`, ★ first via `matchingDigest`; `RecordHeader` now uses the same `Chip`); motifs through `MotifsSummary` (P4-73, revised below).
- **Picker** (`components/pickers/SetPickerSheet.tsx` + `PickerList.tsx`, pure logic in `lib/set-picker.ts`, lists in `lib/matching-pickers.ts`): the sheet owns its trigger (`SheetTrigger`, focus back on « Modifier ») and mounts its panel on each opening, so the draft always starts from the saved set and never moves under the pointer (P4-81). Folded categories with icon, « 3 sur 16 », « Tout sélectionner / Tout désélectionner (catégorie) », « Tout ouvrir / Tout fermer »; search (accents ignored, `HighlightedText`, a category name lists its motifs) and « Sélectionnés seulement » show the matches unfolded, the category keeping its full count (P4-82); « Sélection : 72 sur 72 » above the list, announced after a bulk action only. Ticks and stars use functional updates (two fast clicks both apply). Closing rules P4-83, item rules P4-84, search only for grouped lists or more than 12 items. `onSave(draft)` resolves with null (closes; the hook toasts) or the refusal shown in the sheet: the module's schemas run first (`motifIdsSchema`, `languageIdsSchema`, `clienteleItemsSchema`, `specialtyItemsSchema`), then the set RPC through `useSet*` with `onErrorMessage` (no toast on refusal). The picker is in the tab's chunk (P4-80: `MatchingTab` 20.2 kB raw, 7.2 kB gzip).
- **`AvailabilityCard`:** a `ProfessionalCard` (4a.13) since the review: `schema={availabilitySchema}`, `toFormValues={availabilityValues}` (module level), `firstField="am"`, `useSave={useSaveMatchingProfile}` (`hooks/use-card-saves.ts`); no `record` prop. Four `CheckboxField`s in a fieldset « Moments de la semaine », `SwitchField` « Accepte de nouveaux clients » (help « Désactivé, le dossier reste actif pour les clients déjà jumelés. »), note (500, « Par exemple : pas le vendredi. »); the card's `FormActions` and tab guard. `useSaveMatchingProfile` sends « Accepte de nouveaux clients » only when it changed, so a save of the moments or the note alone keeps 4a.13's narrow rule (the lists are refetched only for new clients).
- **`StarToggle`** (`src/shared/ui/star-toggle.tsx`): P4-85; keys `common.star.add` / `.remove`.
- **Motif summary, revised at Jonathan's request** (« separate title »; shared by Aperçu and Jumelage, P4-73, P4-86): `summarizeMotifs` groups now carry `icon`, `selected`, `total` and `motifs` (`full` is gone). Each category is a header row (icon, name 13/600, « 16 / 16 ») with « Tous », « Tous sauf … » or its ≤ 3 names under the name; the others fold over a 1–3 column list; « Tout ouvrir / Tout fermer »; « Tous les motifs (72) » opens to eight folded rows. A `hidden` grid stayed visible (Tailwind's `grid` beats the attribute's `display: none`; caught in the browser, jsdom has no CSS): since the review, a base rule in `globals.css` (`[hidden]:not([hidden='until-found']) { display: none !important }`) makes the attribute always win, and the local `[&[hidden]]:hidden` is gone. Nothing shows a `hidden` element on purpose (Radix Tabs and Collapsible set `hidden` only on closed panels; the two `<input hidden>` username fields must stay hidden).
- **i18n:** `modules.professionals.record.matching.*` (cards, picker, availability) in its own block before `overview`; `common.star`; `overview.matching.motifSummary` gains `countShort`, `countSr`, `openAll`, `closeAll`, `all` is now « Tous », `count` removed.
- **Tests:** `set-picker.test.ts`, `matching-pickers.test.ts`, `SetPickerSheet.test.tsx` (draft vs save, one call with the full set, refusal kept, Enter in the search, Échap asks / « Annuler » does not, X out of the tab order, folding, bulk per category, search highlight and full counts, « Sélectionnés seulement », restricted disabled with its reason and removable when held, archived, required last item, ★ order and keyboard, fast clicks, 72 held: 8 folded rows « 9 sur 9 », one category removed in a click → 63 saved), `AvailabilityCard.test.tsx`, `MatchingTab.test.tsx` (chips, 72 motifs, read-only, one RPC on save, restricted blocked, schema refusal before the RPC, database refusal in the sheet without toast, stars saved, French locked), `star-toggle.test.tsx`; `motif-summary.test.ts` and `OverviewTab.test.tsx` rewritten for the headers (72: one line → 8 folded categories → one opened lists its 9 motifs and the archived one).
- **Browser check** (port 5297, DB token held; probes created through « Ajouter » as the adjointe, deleted by id on 55322; a DB reset by another lane wiped the first two mid-check, the third was deleted by id): the adjointe selected all 72 motifs category by category (8 rows « N / N », « Sélection : 72 sur 72 », calm), Échap asked « Abandonner les modifications ? » (« Continuer la modification » focused), saved with one `set_professional_motifs` then one record refetch, focus back on « Modifier les motifs »; clientèles saved with a ★; Nadia Côté (naturopathe, seed) sees « Idées suicidaires » and « Psychose » « Réservé », disabled with the reason. The conseillère edited availability (the tab switch asked first; saved, toast) and added a motif by search (« Anx » marked). The admin sees the four « Modifier » and the six tabs; the provider gets « Accès refusé ». Geneviève Tremblay (72 motifs, seed): Aperçu and Jumelage at 375 and 1280 px, collapsed and with a category open (2 columns in Aperçu, 3 in Jumelage, 1 at 375). No sideways scroll at 375, 640, 768, 1024, 1280 px on Aperçu and Jumelage with the summaries open, nor in the picker (480 px, 375 at 375 px, list 366/366 with all 72 rows unfolded); only the tab strip scrolls inside itself at 375 px.
- **Review of 4a.12** (after merging lane C's 4a.13, `9ca9478`): the picker's toolbar and list sit in `<fieldset disabled={saving} className="contents">` and the draft ignores changes while saving (ticks, stars, bulk buttons, search do nothing); an `sr-only` `role="status"` says the number of matches or « Aucun résultat » (the empty state's title is then `aria-hidden`), as `ReferenceListCard` does; « Sélection : N sur M » is announced only after a bulk action; the required list's last item is kept inside the functional update too (`next.size === 0` → unchanged), so two fast unticks leave one language; `useSetSave` resets its refusal per call; « Tout ouvrir / Tout fermer » in the picker and the summaries; `HeldMotif` carries the motif's id (the list key); motif columns never overflow a narrow container (P4-86); the `hidden` base rule. `AvailabilityCard` converged on `ProfessionalCard` (above). Tests: `AvailabilityCard.test.tsx` and `MatchingTab.test.tsx` moved onto `renderRecordTab` (`test/record-tab.tsx`, which now takes `permissions` and returns `invalidated`); new cases for the inert list while saving and the sheet that cannot close then, focus back on « Modifier » after « Abandonner », rows staying put after ticks and stars (P4-81), « Tout sélectionner » skipping the archived item itself and re-ticking it (P4-84), the search status, the bulk-only announcement, the fast unticks of the last two languages, search by a category's name (sheet and tab), the tab guard armed by a dirty picker (`hasUnsavedChanges`) and a dirty availability card, and the availability save without new clients leaving `lists()` alone. Vitest only; not re-checked in the browser.

**Commit:** `feat(professionals): Jumelage tab with batch-save pickers`.

---

## Task 4a.13: « Profil public » and « Identité et permis » tabs (lane C)

**Files:**
- Create: `components/record/tabs/PublicProfileTab.tsx` + test, `components/record/tabs/IdentityTab.tsx` + test, `components/record/ProfessionsEditor.tsx` + test, `components/record/ChangeEmailDialog.tsx`, `components/record/ProfessionalCard.tsx` (the `OrganizationCard` equivalent)
- Modify: `fr-CA.json`

**`ProfessionalCard`:** built like `src/core/settings/components/OrganizationCard.tsx` — a `SettingsCard` with `useSettingsForm` (flat values from the record, follows refetches, keeps typed edits) and `FormActions` (outline until dirty, teal only while dirty, #34); read-only through `FieldsReadOnlyContext` without the card's permission. Saves call the matching `update*` API.

**Profil public** (`professionals.manage` to edit, A2.11 fix: editable even when empty):
- « Portrait »: Bio (textarea, counter « 120 / 4000 »), Approche (same); help « Ces textes figurent sur la fiche remise au client. »
- « Coordonnées publiques »: courriel public, téléphone public (help « Laissez vide pour ne pas les afficher. »).
- 4c adds the photo and « Aperçu de la fiche ».

**Identité et permis** (`professionals.manage`):
- « Identité »: Prénom*, Nom*, Genre (select « Non précisé » / Femme / Homme / Autre, help « Utilisé seulement pour la préférence du client. »).
- « Coordonnées »: « Courriel de connexion » read-only with « Modifier » (opens `ChangeEmailDialog` → `setProfessionalEmail`; hidden once an account exists, replaced by « Le professionnel le change dans « Mon compte ». »); Téléphone personnel; address (line 1, line 2, ville, province select default QC, code postal) in the Phase 2 two-column grid.
- « Professions et permis » (`ProfessionsEditor`, A2.9): up to 2 rows, each « Titre » + « N° de permis » (shown and required when the title has an order) + « Principal » radio (decision #36: choosing a radio changes the draft only); « + Ajouter un titre » disabled at 2 (« Deux titres au maximum. »); « Retirer » on a row (removing the primary promotes the other in the draft, A2.9 fix); Annuler / Enregistrer sends the whole list once (`setProfessions`).
- « Expérience »: years (0–60).
- « Numéros de payeurs »: IVAC (empty = delete, help « Unique dans la clinique. »).

**Tests:** each card saves only its fields; read-only for the conseillère (fields focusable, no footers, one `ReadOnlyNotice`); email change hidden with an account; professions editor promotion, max 2, licence shown per title, one API call; IVAC duplicate message under the field.

**As built (the code is the reference where this sketch differs):**
- **`ProfessionalCard`** (`components/record/ProfessionalCard.tsx`): `OrganizationCard`'s shape on the open record (`useRecordData`): `toFormValues(record)` (module level), `useSettingsForm`, `FormActions`, the unsaved-changes guard, read-only from a prop (`!can('professionals.manage')`). Its save is a module-level hook passed as `useSave` (`hooks/use-card-saves.ts`: `useSaveProfessionalFields`, `useSavePublicProfile`, `useSaveIvac`, each a `use-professional-mutations` hook adapted to the card's output), so the card owns the mutation's feedback: `errorField(error)` (HINT) puts a refusal under its field, else a toast. After a save the form is reset from the cached record (the mutation wrote the change and awaited the refetch), so it is clean even before the context re-renders.
- **Profil public** (`tabs/PublicProfileTab.tsx`): « Portrait » (Présentation, Approche, 6 rows, counter « n / 4000 caractères » of the trimmed text as each field's description, P4-93) and « Coordonnées publiques » (email, phone regrouped on blur); two cards on the same row, each sending only its fields (`publicProfileSchema.pick`). Editable when empty (A2.11).
- **Identité et permis** (`tabs/IdentityTab.tsx`): Identité (Prénom, Nom, Genre, P4-90), Coordonnées (the login email as a read-only field with « Modifier », phone, address in the two-column grid, province required), `ProfessionsEditor`, Expérience, Numéros de payeurs (IVAC, upper-cased on blur and by the schema as `set_professional_payer_number` stores it, HINT `ivac` under the field). Forms max 640 px; one `ReadOnlyNotice` for the tab; read-only, no field help (`components/record/editing-help.ts`, one rule for both tabs) and an empty gender reads « Non indiqué ».
- **`ChangeEmailDialog`**: opens with the current address selected; HINT `email` (invalid, used in the clinic) under the field; any other refusal (an account appeared, a 42501) above the buttons and the record refetched, which hides « Modifier ». The dialog is always mounted and only its trigger follows `canChange` (no account, may edit): a refetch that brings an account, or an access that turns the tab read-only, never unmounts it under the user; the message stays above the buttons until it is closed, and focus then goes to the login email field (the trigger is gone). Inside, `FieldsReadOnlyContext` is reset: a card turning read-only behind it does not reach its form. Its form stops the submit event: React bubbles it through the portal into the Coordonnées card's form, which would save that card (Vitest proves it); `SettingsCard` also ignores a submit whose target is not its own form (review of 4a.13). With an account: no « Modifier », the field reads « Le changement se fait dans « Mon compte » du professionnel. » (editable only; read-only no help shows).
- **`ProfessionsEditor`**: `useForm` + `useFieldArray` on `{ items }` (not `useSettingsForm`: an array); the draft follows the record only while clean, and is reset to the saved list after a save; a stored licence whose title no longer has an order is dropped from the draft, so nothing hidden is sent (P4-65). Each row is a group named « Titre 1 : Psychologue » (« Titre 2 » while empty); its radio is named « Titre principal : Psychologue » (visible « Titre principal »), with the design system's focus ring (`focusRing`, round). While a save is in flight every row control, the radios, « Retirer » and « Ajouter un titre » are inactive (`aria-disabled`, changes ignored, the licence read-only), so no edit made meanwhile is lost to the reset. `professionsSchema` wrapped as `{ items }`, so list-level issues (one primary, restricted motifs held) show above « Ajouter un titre » and row issues under their field. Title change to one without order clears the hidden licence. « Retirer » promotes the other row and moves focus to « Ajouter un titre » (aria-disabled at two, described by « Deux titres au maximum. »). Server refusals by HINT + DETAIL (P4-91); a licence refusal for a row whose title shows no licence field (it gained an order) reads « Ce titre demande maintenant un numéro de permis… » above the buttons; a routed refusal refetches the catalogue.
- **Shared changes:** `FormField.help` takes a node (the counter); `rpcErrorDetail` in `core/modules/errors.ts`; `regroupPhone` in `shared/lib/format.ts` (P4-94); `Select.readOnlyEmptyLabel`; `SettingsCard` ignores a submit whose `event.target` is not its form (a portalled dialog's).
- **List refetch:** `useRecordMutation` takes `touchesList`: saving fields the list does not show (bio, approach, public contact, IVAC, experience, gender, phone, address) refetches the record and history only, not `lists()`; names, new clients, sets, email and status still refetch the lists (table in `hooks/keys.ts`).
- **Tests:** `PublicProfileTab.test.tsx`, `IdentityTab.test.tsx`, `ProfessionsEditor.test.tsx` through `test/record-tab.tsx` (the record in the query cache, refetches answered by the mocked API, the guard and a leave link; `setRole` re-renders with another role's access); review of 4a.13 added: the email dialog kept open on a P0001 without HINT while the refetch brings an account and on a 42501 that turns the tab read-only (focus back on the field once closed), a card saving while another card of the same save hook is dirty (it keeps its edits), focus moving from « Enregistrer » to the IVAC field on a duplicate, IVAC upper-cased, `licenceNowRequired`, the hidden licence dropped, the editor inactive while saving, the named row groups and radios, the read-only « Non indiqué » and no help; `professionsErrorField`, `regroupPhone`, `rpcErrorDetail` unit tests; pgTAP `042` +7 (hint and detail pairs, IVAC hint), then +4 (IVAC stored upper-case; `probe-777` refused as a duplicate of `PROBE-777`, HINT `ivac`). `ProfessionalRecordPage.test.tsx` now expects the Portrait card on `profil-public`.
- **Browser check** (local, port 5298, DB token held, two probes created through « Ajouter » and deleted by id on 55322): the adjointe added a second title (Psychologue, OPQ 12345) and made it primary in one save, saved an IVAC number, saw « Ce courriel est déjà utilisé. » under the dialog field then changed the login email, saved a bio (switching tab while dirty asked first), and on the second probe saw « Ce numéro IVAC est déjà attribué à un autre professionnel. » under the IVAC field with focus there; the admin saved Coordonnées (`4189079754` → « 418 907-9754 », stored `+14189079754`, `G1R 4P5`); the conseillère sees both tabs read-only (one notice, every field `readonly`, no button, no radio); the provider gets « Accès refusé ». No sideways scroll at 375, 640, 768, 1024, 1280 px on either tab (document width = viewport, or viewport minus the scrollbar; cards 343, 608, 640, 640, 640 px; the tab strip scrolls inside itself at 375). After `db reset` the gateway kept the auth container's old address (502 on `/auth/v1`) until `supabase_kong` was restarted.
- **Left open (closed by the review of 4a.13):** IVAC uniqueness was case-sensitive (now stored upper-case, the check `^[A-Z0-9-]{3,30}$`, migration edited in place); a read-only empty gender showed an empty field (now « Non indiqué »).

**Commit:** `feat(professionals): Profil public and Identité et permis tabs`.

---

## Task 4a.14: Activation and deactivation (lane C)

**Files:** `components/record/ActivateDialog.tsx` + test, `components/record/DeactivateDialog.tsx` + test; Modify `RecordHeader.tsx`, `fr-CA.json`.

- **« Activer »** (header teal action):
  - complete file → AlertDialog « Activer {nom} ? Il pourra recevoir de nouveaux clients et apparaîtra dans le jumelage. » [Annuler] [Activer];
  - incomplete + `activate_override` → the dialog lists what is missing (readiness labels) and asks « Raison de l'activation »* (textarea, default empty, suggestion chip « Dossier complété hors application » that fills it), confirm « Activer quand même »;
  - incomplete without override → the button is not shown; Aperçu explains what is missing.
- **« Désactiver »** (« … » menu): AlertDialog with « Raison »* (select of active reasons; only the confirm button acts, never an arrow key, #36), « Note » (required when the reason requires it), and when the reason disables the account the warning « {Prénom} ne pourra plus se connecter. » Confirm « Désactiver » (destructive, only inside the confirmation).
- **« Réactiver »** = activation (same rules).
- Toasts: « Professionnel activé. », « Professionnel désactivé. »

**Tests:** each path calls the right API with the right arguments; the note requirement follows the chosen reason; the suggestion chip fills the reason; the destructive style only on the confirm button; arrow keys in the reason select never submit.

**Commit:** `feat(professionals): activation with readiness and override, deactivation with reasons`.

---

## Task 4a.15: « Historique » tab (lane C)

**Files:** `components/record/tabs/HistoryTab.tsx` + test, `lib/history.ts` + test (entry → readable lines); Modify `fr-CA.json` (`modules.professionals.history.*`, `audit.fields.*`).

- One timeline, newest first, grouped by clinic day (`formatClinicDateFull`), each entry: time (`formatClinicTime`), actor name or « Système » / source label (`seed`, `import`, `migration:…` → « Importation », « Mise à jour du système »), a sentence (« a modifié la ville : Québec → Lévis », « a ajouté les motifs Anxiété, Deuil », « a activé le dossier (raison : …) »), expandable details with before/after per field using `audit.fields.<table>.<column>` labels (as the Journal d'audit). No raw JSON, no UUIDs (D5).
- **Readable values:** ids of motifs, clientèles, titles, languages and reasons are resolved through the catalogue (« Motif archivé » when unknown); dates through the timezone utilities; booleans « Oui/Non »; `availability_periods` mapped to labels.
- Filter « Tout · Modifications » (« Courriels » is added in 4b.3); « Charger plus » (keyset, 50).
- Private rows (4a.17) show « Coordonnées fiscales ou bancaires modifiées » or « Numéro de compte affiché » (reads), never values.

**Tests:** each table's sentence; id resolution; pagination calls with `beforeId`; private rows have no values; the filter.

**As built (the code is the reference where this sketch differs):**
- **Reading** (`lib/history.ts`, pure): `buildHistoryEvents(rows, { catalog, titleByRow })` turns the audit rows (newest first) into events `{ actor, byPerson, kind, sentence, lines, groups }`. The tab prints « {actor} {sentence} ».
  - **One save, one entry (P4-100):** set rows (motifs, languages, clientèles, approaches) are merged by transaction (`created_at`, actor, source), table and kind (added, removed, ★ on, ★ off). Up to 3 items are named in the sentence; past 3 the sentence counts them and the names unfold by category for motifs (`summarizeMotifs().full`), in one list otherwise. Unknown ids read « Motif archivé », « Clientèle archivée »…; archived ones are marked « (archivé) ».
  - **Record row (P4-102, P4-103):** creation (« a créé le dossier », the empty 1:1 rows of the same save folded in), field changes with article phrases (`history.fields.*`: « la ville », « les disponibilités générales »), status changes as actions, the note, the override reason and the account change in the details. Redacted fields never show a value (an update holds the bare string « [redacted] », not a before/after pair); an insert's redacted fields are skipped.
  - **Titles and IVAC:** « a ajouté le titre Psychologue » (the licence when there is one, « Titre principal : Oui » only for the primary, in the details), « a modifié le numéro de permis (Psychologue) : … → … », « a choisi … comme titre principal »; `professionTitlesByRow` names an updated row's title from the record and the loaded rows. « a ajouté le numéro IVAC … »; another payer « le numéro de payeur … », never its key.
  - **Values:** catalogue names for ids (reasons included), « Oui / Non », periods by label, the public phone formatted, « Lié / Aucun » for the login account; never an id or JSON: `formatValue` prints no UUID-shaped string (« (valeur non affichable) ») and no « [redacted] » (« (masqué) »), whatever the column, and an object or a list reads « (valeur non affichable) ». Technical columns (`id`, `org_id`, `professional_id`, `user_id`, timestamps, `created_by`, `updated_by`, `status_changed_*`) are not shown.
  - **Sets:** archived items after the active ones, unknown ones last, the same for motifs, languages, clientèles and approaches. A change of the ★ reads « a indiqué une spécialisation pour : … » / « a retiré la spécialisation pour : … ».
  - **Other tables:** a deleted 1:1 row reads « a supprimé le profil public / de jumelage »; a table the tab does not know « a modifié une autre section du dossier » or, for a `read` row, « a consulté une section du dossier », never the table's name.
  - **Private rows (4a.17, ready):** a change of `professional_private` reads « a modifié les coordonnées fiscales ou bancaires »; a `read` row reads its `changedFields.fields` against a fixed list (`sin` → « a affiché le NAS », `bank_account` → « a affiché le numéro de compte », both listed: « a affiché le NAS et le numéro de compte »); any other name, or none, reads « a consulté des données privées ». Never a value, even if a row carried one. (The first build read every `read` row as « a affiché le numéro de compte », a SIN reveal included.)
  - **Actors (P4-104):** the person's name; else « L'importation », « Une mise à jour du système », « Le système » (`bootstrap` included), « Une personne qui n'a plus accès ».
- **Pages (P4-101):** `settledHistoryRows(rows, hasNextPage)` holds back the last transaction on screen while more pages exist; `historyReadsOn(pages, hasNextPage)` reads on by itself while the last loaded page holds only rows of that save (first page, or after « Charger plus »: a page that added nothing to the screen), and stops on an error, an empty page or the end (the effect re-runs on each new page, since a quick fetch may never render as pending). « Charger plus » (outline, `aria-disabled` and « Chargement… » while loading or reading on) then « Début de l'historique », which takes the focus when the chain reaches the start. A failure while reading on before anything shows: « L'historique n'a pas pu être chargé. » with « Réessayer » (`fetchNextPage`); « Aucune modification à afficher » only under the « Modifications » filter. A record change refetches the first page only (`refreshProfessionalHistory`: the cache keeps page 1, then invalidates), and leaving the tab drops the other pages, so a remount reloads one. Day sections have unique keys (a day can come back when a long transaction commits after a later one). `HistoryItem` is memoised.
- **Tab** (`components/record/tabs/HistoryTab.tsx`, its own chunk, ≈ 16 kB raw / 6 kB gzip): « Afficher : Tout · Modifications » (`SegmentedToggle`, P4-105) above one card; days as `section`s named by an h3 (« Jeudi 8 octobre 2026 », `formatClinicDateFull`, clinic timezone), entries as a list (`formatClinicTime` in a `<time>`). An entry with details or names is a disclosure (`Disclosure`, now exported from `MotifsSummary.tsx`), panels kept mounted with `hidden`; values wrap anywhere. Loading, load error with « Réessayer », empty (« Aucun historique ») and filtered-empty states.
- **Prefetch (P4-106):** `RecordTabDef.prefetch` runs `prefetchProfessionalHistory` on Historique's hover or focus with its chunk; opening the tab then makes no request.
- **No echo:** an entry whose sentence already carries the values (one field, a licence) has no disclosure; the details keep only what the sentence does not say.
- **Browser check** (local, port 5299, DB token held, reset with the seed before and after; edits made through SQL and the RPCs on 55322 as the adjointe and the conseillère): Camille Roy reads the adjointe's « a modifié la ville, la province et les années d'expérience » (« Ville : (masqué) », Laval never shown), « a retiré les motifs Douance et Deuil », « a ajouté le motif Insomnie », « a retiré la langue Espagnol », « a indiqué une spécialisation : Adultes », « a modifié le numéro de permis (Psychologue) : 12873 → 12874 », « a ajouté le numéro IVAC IVAC-30311 », « a désactivé le dossier (raison : Autre) » with its note, « a réactivé le dossier », then after « Charger plus » the seed save (« a ajouté 25 motifs » unfolding by category, « a créé le dossier » with Prénom, Nom, Courriel) and « Début de l'historique ». Geneviève Tremblay (two saves of 70 motifs, then the seed's 72): « a ajouté 70 motifs », « a retiré 70 motifs », « a ajouté 72 motifs », each counted across a page boundary. Hovering Historique sent `list_professional_history` once; opening the tab sent nothing more. The conseillère sees five tabs and Julie Morin's history (« a désactivé le dossier (raison : Congé) »). Every entry unfolded: no sideways scroll at 375, 640, 768, 1024 and 1280 px (document width = viewport, or viewport minus the scrollbar). No UUID or redacted value on screen.
- **Strings:** `modules.professionals.history.*`; details reuse `audit.fields.*` and `audit.details.change` / `value`. No new `audit.fields` key was needed (4a.3 added them all).
- **Tests:** `lib/history.test.ts` (creation with redacted nulls, one field with values, redacted field, several fields, free text, periods and booleans, account link, every status sentence with the override reason in the details, unknown reason, ≤ 3 and 65 motifs, archived and unknown motifs under « Autres », archived then unknown last for motifs and languages, merge by transaction, clientèles ★ and approaches, titles through the record and the loaded rows, a non-primary title without licence, IVAC and an unknown payer, private rows without values, private reads by field (`{"fields": ["sin"]}`, both, unknown, absent), actor labels (`bootstrap` included), no UUID anywhere, an unknown-table change and read, a deleted profile row, values never a UUID, an object or « [redacted] », held-back transaction, reading on, clinic days across UTC midnight and both DST changeovers, unique day keys, the filter), `HistoryTab.test.tsx` (day regions, time and sentence, held-back save then « Charger plus » with `beforeId`, disclosure details, 4 motifs read on across two pages then grouped by category, ≤ 3 names without a disclosure, end focus, one click reading on past a page of the held-back save (A,B / B,B / B,C), end focus after reading on, a failure while reading on (retry before anything shows, « Charger plus » once entries show), no UUID or « [redacted] » in the rendered tab, first page only on refresh and remount, « a affiché le NAS », filter and its empty state, empty state, load error and retry), `ProfessionalRecordPage.test.tsx` (the Historique URL opens the tab; hover prefetches the history once).

**Commit:** `feat(professionals): Historique tab with readable changes`.

---

## Task 4a.16: Sensitive-data prerequisites (ADR 0004 « Before Phase 4 ») — **blocking for 4a.17** (lane D, SQL handed to lane A)

**Files:**
- Create: `docs/runbooks/pii-key-escrow.md`, `docs/runbooks/pii-key-rotation.md`
- Create: `supabase/migrations/<ts>_core_pii_key_versions.sql` + `supabase/tests/database/044_core_pii_key_versions.test.sql` (lane A runs it)
- Modify: `.github/workflows/supabase-migrations.yml` (health-check step), `docs/adr/0004-secrets-in-vault.md` (tick the checklist items this task covers), `docs/standards/database-conventions.md` §8 (key versions)

**Step 1: Key versions (migration, pgTAP first).**
- `private.pii_key(p_version smallint)`: version 1 → Vault `pii_encryption_key` (existing); version n ≥ 2 → `pii_encryption_key_v<n>`; null when absent. The existing `private.pii_key()` stays (= version 1).
- `private.encrypt_pii(p_value text, p_version smallint)` and `private.decrypt_pii(p_value bytea, p_version smallint)` overloads; the existing one-argument functions keep working (version 1). Same grants as today: none.
- `organization_bank_details` gains `key_version smallint not null default 1` (additive).
- **Canary:** `private.pii_canary (key_version smallint primary key, ciphertext bytea not null, created_at timestamptz)` in schema `private` (not exposed), filled for version 1 with `encrypt_pii('mana-pii-canary', 1)`.
- `public.pii_health_check() returns boolean` — `security definer`, granted to **`service_role` only**: true when every canary row decrypts to `'mana-pii-canary'`, false otherwise (decryption errors caught → false). It never returns the key or a value.
- pgTAP: version 1 round trip; an unknown version → null key → `encrypt_pii` raises `55000`; `pii_health_check()` true; after replacing the canary with garbage (as postgres, in a savepoint) → false; `function_privs_are`: `authenticated` cannot execute `pii_health_check`; bank details still decrypt.

**Step 2: Deploy health check.** In `supabase-migrations.yml`, after « Verify no drift », a step « PII key health check » that runs `select public.pii_health_check()` against staging with `psql` and fails the job unless it prints `t`. Connection: the session pooler URL built from `SUPABASE_PROJECT_ID` and `SUPABASE_DB_PASSWORD` (existing secrets; verify the exact host in the Supabase dashboard docs — read-only — and write it as a workflow `env`). It does not run on PRs (only on the deploy job). Nothing is pushed by this task.

**Step 3: Runbooks** (French headings, precise SQL, no secret values):
- `pii-key-escrow.md`: who (the owner, Jonathan or Christine), when (before the first real SIN or bank row on any environment), how: in the Supabase SQL editor of the project, `select decrypted_secret from vault.decrypted_secrets where name = 'pii_encryption_key';` → copy into the clinic's password manager entry « Clinique MANA — clé PII (staging) »; never paste it in chat, git or tickets; restore order on a new or restored project: create the secret with the same name **before** loading data (`select vault.create_secret('<valeur>', 'pii_encryption_key', '…')`), then `select public.pii_health_check()` as service role; « Ne jamais supprimer ni modifier ce secret dans le tableau de bord (Vault) » in bold; staging and production keys differ on purpose: a copy of production data into staging stays undecryptable, never « fix » it by copying the production key.
- `pii-key-rotation.md`: create `pii_encryption_key_v2`; add a canary row for v2; re-encrypt in batches with `update … set col = private.encrypt_pii(private.decrypt_pii(col, key_version), 2), key_version = 2 where key_version = 1` inside a function run by the owner; verify the health check; keep v1 until every row is v2 and backups older than the retention window are gone; then remove v1.

**Step 4: Staging logging check** — written as a Mise en service item for Jonathan with the SQL (`show log_parameter_max_length_on_error; show log_statement; show log_min_duration_statement; show auto_explain.log_min_duration; select * from pg_settings where name like 'pgaudit.%';`) and expected values (ADR 0004 consequences list). The executor does not connect to staging.

**Step 5: Commits.** Lane A: `feat(db): PII key versions, canary and health check`. Lane D: `docs(runbooks): PII key escrow and rotation; deploy health check` (workflow, runbooks, ADR, conventions).

**Gate:** 4a.17 starts only after both commits are merged and the coordinator ticks the ADR checklist items covered here. The escrow itself on staging is Jonathan's (Mise en service item 5) and must happen before any real SIN or bank row is entered there.

---

## Task 4a.17: Migration `professionals_compensation_private` (lane A)

**Files:**
- Create: `supabase/migrations/<ts>_professionals_compensation_private.sql`
- Create: `supabase/tests/database/045_professionals_compensation_private.test.sql`

**Step 1: Write the failing pgTAP test.** Fixtures + P1, P2 (org A), P3 (org B); the adjointe with an override `professionals.manage` (default) only. Assert:
- **`professional_private` privileges:** `table_privs_are` → `authenticated` and `anon` none; `service_role` none (revoked); RLS on, no policy.
- **`set_professional_private`** (admin A, P1): BN `'123456789'`, TPS `'123456789RT0001'`, TVQ `'1234567890TQ0001'`, institution `'815'`, transit `'30000'`, account `'1234567'` → stored; `get_professional_private(P1)` returns `sin_last3 null, business_number '123456789', …, bank_account_last4 '4567'`; the stored `bank_account` is `bytea` without `1234567`; `key_version = 1`.
  - SIN `'046 454 286'` while `collect_sin = false` → P0001 « La collecte du NAS n'est pas activée. »; after `set_professionals_settings('{"collect_sin": true}')`: valid SIN (Luhn) stored, `sin_last3 = '286'`; `'123456789'` (fails Luhn) → P0001 « NAS invalide. »;
  - a blank account keeps the stored one (reveal still `'1234567'`); a blank TPS clears it; invalid institution `'81'` → P0001 « Le numéro d'institution compte 3 chiffres. »; `clear_professional_private_field(P1, 'bank_account')` clears account and last4.
- **`reveal_professional_private(P1, 'bank_account')`** → `'1234567'` + one `audit_log` row `action = 'read'`, `source = 'rpc:reveal_professional_private'`, `changed_fields = {"fields": ["bank_account"]}`, `record_id = P1`; `'sin'` likewise; `'email'` → `22023`; no stored value → null and no audit row.
- **Redaction:** every audit row of `professional_private` shows each value column as `"[redacted]"` (`sin`, `sin_last3`, `business_number`, `gst_number`, `qst_number`, `bank_institution`, `bank_transit`, `bank_account`, `bank_account_last4`).
- **Permissions:** the adjointe → `42501` on all four private RPCs; the provider → `42501`.
- **History:** `list_professional_history(P1)` as the adjointe shows the private rows with `changed_fields` null (and `read` rows with field names only).
- **Compensation:**
  - `compensation_kinds` holds `consultation, workshop, late_cancellation, other_fees` (global, read by `professionals.compensation` holders);
  - each org is seeded with `compensation_defaults` from `2017-01-01`: consultation 25–30 %, workshop 25–25 %, late_cancellation 30–30 %, other_fees 15–15 %;
  - `set_professional_margin(P1, 'consultation', 28, '2026-11-01', null)` → a row; a second one from `2027-01-01` closes the first (`effective_to = 2027-01-01`); a date not after the open row's start → P0001 « La nouvelle marge doit commencer après le … »; `-1` or `101` → P0001 « La marge est comprise entre 0 et 100 %. »; `35` (outside the 25–30 % default range) is stored and returns `warning: true`;
  - overlapping rows inserted as postgres → `23P01` (exclusion constraint);
  - `recognition_rules` seeded per org: from `2017-01-01`, step 50, 50 ¢ / 50 min, 25 ¢ / 30 min, `cap_pct 25`, `cap_basis 'unconfirmed'` (P4-8);
  - `set_professional_recognition(P1, 2, 117, '2026-10-01', 'Compté dans GOrendezvous')` → a row; history kept as for margins;
  - `get_professional_compensation(P1, '2026-12-01')` → `{margins: [{kind: 'consultation', margin_pct: 28, source: 'professional'}, {kind: 'workshop', min: 25, max: 25, source: 'default'}, …], recognition: {level: 2, sessions_counted: 117, rule: {…, cap_basis: 'unconfirmed'}}}`;
  - the conseillère → `42501`; admin B sees nothing of org A.

**Step 2: Run it and check that it fails.**

**Step 3: Write the migration.**
- **`professional_private`** (PK `professional_id`; `org_id`; composite FK to `professionals` on delete cascade; columns and checks of design §3.5: `sin bytea`, `sin_last3 text` `^[0-9]{3}$`, `business_number` `^[0-9]{9}$`, `gst_number` `^[0-9]{9}RT[0-9]{4}$`, `qst_number` `^[0-9]{10}TQ[0-9]{4}$`, `bank_institution` `^[0-9]{3}$`, `bank_transit` `^[0-9]{5}$`, `bank_account bytea`, `bank_account_last4` `^[0-9]{4}$`, `key_version smallint not null default 1`, `updated_at`, `updated_by`; checks `(sin is null) = (sin_last3 is null)`, `(bank_account is null) = (bank_account_last4 is null)`). `revoke all … from anon, authenticated, service_role;` RLS on, **no policy**. Audit trigger with every value column redacted (conventions §8).
- **RPCs** (`professionals.private`, definer, lock the professional): `get_professional_private(p_id) returns table (sin_last3, business_number, gst_number, qst_number, bank_institution, bank_transit, bank_account_last4, updated_at, updated_by_name)`; `reveal_professional_private(p_id, p_field text) returns text` (`sin` | `bank_account`, audited read as `reveal_bank_account_number` does, decrypt with the row's `key_version`); `set_professional_private(p_id, p_sin, p_business_number, p_gst_number, p_qst_number, p_bank_institution, p_bank_transit, p_bank_account) returns void` (encrypted fields: null/blank keeps; plain fields: as given, blank clears; SIN digits only after stripping spaces/hyphens, 9 digits + Luhn, gated by `collect_sin`; account 7–12 digits, as `set_bank_details`; upsert); `clear_professional_private_field(p_id, p_field text) returns void` (`sin` | `bank_account`).
- **History:** `create or replace function private.professional_history_tables(…)` adds `professional_private` always, and `professional_compensation`, `professional_recognition` when `p_with_compensation`.
- **Compensation** (design §3.6):
  - `compensation_kinds (key text pk, name text, sort_order int)` — global catalogue like `roles` (no `org_id`, not audited, changed by migration; RLS `using ((select private.has_permission('professionals.compensation')))`, select only);
  - `compensation_defaults (id, org_id, kind → compensation_kinds, margin_min_pct numeric(5,2), margin_max_pct numeric(5,2), effective_from date, effective_to date, created_at, created_by)` with checks `0 ≤ min ≤ max ≤ 100`, period check, exclusion `(org_id with =, kind with =, daterange(effective_from, effective_to, '[)') with &&)`; seeded per org by trigger + existing orgs (like tax rates);
  - `professional_compensation (id, org_id, professional_id, kind, margin_pct numeric(5,2), effective_from, effective_to, note, created_at, created_by)`, PK `(professional_id, id)`, `unique (id)`, exclusion per `(professional_id, kind)`;
  - `recognition_rules (id, org_id, effective_from, effective_to, step_sessions int, bonus_per_50min_cents int, bonus_per_30min_cents int, cap_pct numeric(5,2), cap_basis text check in ('unconfirmed', 'margin_reduction', 'fee_increase'), note)` + exclusion per org; seeded;
  - `professional_recognition (id, org_id, professional_id, level int ≥ 0, sessions_counted int ≥ 0, effective_from, effective_to, note, created_at, created_by)`, PK `(professional_id, id)`, exclusion per professional;
  - all: select with `professionals.compensation` (org-scoped), no client writes, audit;
  - RPCs (`professionals.compensation`): `set_compensation_default(p_kind, p_min, p_max, p_effective_from)`, `delete_compensation_default(p_id)` (only a future row, as `delete_tax_rate`), `set_professional_margin(p_id, p_kind, p_margin_pct, p_effective_from, p_note) returns jsonb {id, warning}`, `delete_professional_margin(p_row_id)` (future rows only), `set_recognition_rule(…)`, `set_professional_recognition(p_id, p_level, p_sessions, p_effective_from, p_note)`, `get_professional_compensation(p_id, p_on date default private.clinic_today())` (read model for 4d and Facturation). All close the open row on the new start date, as `add_tax_rate` does, under the org (or professional) row lock.

**Step 4: Run the database checks** (lock; with and without seed). **Step 5: Commit** (`feat(db): professionals private data (encrypted, audited reveal) and compensation terms`).

---

## Task 4a.18: « Rémunération et fiscalité » tab and « Rémunération » settings section (lanes C and B)

**Files:**
- Create: `api/compensation.ts`, `api/private.ts` (+ tests), `hooks/use-compensation.ts`, `hooks/use-private.ts`
- Create: `components/record/tabs/CompensationTab.tsx` + test, `components/record/MarginCard.tsx`, `components/record/RecognitionCard.tsx`, `components/record/TaxIdentifiersCard.tsx`, `components/record/BankCard.tsx`
- Create: `pages/settings/CompensationSettingsPage.tsx` + test
- Modify: `manifest.ts`, `fr-CA.json`

**Tab** (visible with `professionals.compensation` or `professionals.private`; each card follows its own permission):
- **« Marge clinique »** (compensation): table per kind — Type, Marge en vigueur (« 28 % » or « 25–30 % (par défaut) »), Depuis (`formatDateOnlyShort`); « Historique » expands past rows; « Nouvelle marge » dialog (Type, Marge %, « À partir du » `type="date"`, Note), warning when outside the default range: « Hors de la fourchette par défaut (25–30 %). »; « Supprimer » on a future row.
- **« Programme de reconnaissance »** (compensation): level, sessions counted, since, note, history; « Mettre à jour » dialog; a permanent info line « Calcul automatique à venir. Les montants ne sont pas encore calculés. » and, while `cap_basis = 'unconfirmed'`, « Interprétation du plafond de 25 % à confirmer. » (P4-8).
- **« Fiscalité »** (private): NE, TPS, TVQ (displayed grouped as in « Fiscalité » of Phase 2), NAS « •••286 » with « Afficher » (only when stored); when `collect_sin = false`, the NAS line reads « Non recueilli » with help « La collecte du NAS est désactivée. »
- **« Banque »** (private): institution, transit, compte « ••••4567 » with « Afficher »; edit form as Phase 2 Task 2.14 (account placeholder « Inchangé »; strip only spaces, tabs, line breaks and hyphens; other characters are an error).
- **Reveal rules (Phase 2 rule):** never cache a revealed value in React Query; component state only, cleared on unmount and after 60 s; the reveal button says « Afficher » / « Masquer ». PageHeader-level note: « Chaque affichage est inscrit à l'historique du dossier. »

**Settings « Rémunération »** (`/parametres/remuneration`, visible and editable with `professionals.compensation`):
- « Marges par défaut »: one row per kind with the dated history (« Nouvelle fourchette » dialog), like « Fiscalité ».
- « Programme de reconnaissance »: the dated rules (step, bonuses in « 0,50 $ », cap %, « Base du plafond » select: « À confirmer » / « Réduction de la marge » / « Augmentation des honoraires »).
- « Renseignements fiscaux » (shown with `professionals.private` and `professionals.settings`): switch « Recueillir le NAS » (Space/click; confirm dialog when turning on: « Activez seulement si votre comptable confirme que le NAS est requis (T4A / relevé). ») → `saveProfessionalsSettings({ collect_sin })`.

**Tests:** cards hidden per permission; reveal not in the query cache (`queryClient.getQueryCache().findAll()`), cleared after 60 s (fake timers); margin dialog sends a date string unchanged (date-only); default-range warning; NAS « Non recueilli » state; settings switch confirm.

**Commit:** `feat(professionals): Rémunération et fiscalité tab and Rémunération settings`.

---

## Task 4a.19: Import tooling for the ~50 existing professionals (lanes A and D) — **running it on staging is Jonathan's go-ahead**

**Files:**
- Create: `supabase/migrations/<ts>_professionals_import.sql` + `supabase/tests/database/046_professionals_import.test.sql` (lane A)
- Create: `scripts/import-professionals.mjs` + `scripts/import-professionals.test.mjs` (Vitest, node environment) + `scripts/fixtures/professionals-sample.csv` (fake people) (lane D)
- Create: `docs/runbooks/import-professionals.md`

**Step 1: RPC (pgTAP first).** `public.import_professional(p_row jsonb, p_dry_run boolean default true) returns jsonb` — `professionals.manage` (and `professionals.activate_override` when `activate` is true); audit source `import`:
- input keys: `first_name, last_name, email, personal_phone?, city?, province?, postal_code?, years_experience?, professions: [{title_key, licence_number?, is_primary?}], languages: [code], clienteles: [{key, specialized?}], approaches: [{key, specialized?}], motifs: [key], ivac?, activate?: boolean`;
- resolves keys to the org's ids (unknown key → `{"status": "error", "errors": [{"field": "motifs", "message": "Motif inconnu : anxite"}]}`, never an exception for data errors);
- an email that already exists → `{"status": "skipped", "reason": "Courriel déjà présent"}` (idempotent re-runs);
- otherwise calls the same internal paths as the RPCs (create, sets, payer number; activation with override reason « Dossier complété hors application » when `activate`) inside a sub-block; with `p_dry_run` the block ends with a caught exception, so nothing is written and the result is `{"status": "ok", "dry_run": true, "id": null}`;
- tests: a valid row (dry run writes nothing; real run creates everything, audit `source = 'import'`); unknown keys reported per field; skipped duplicate; activation with override; permission refusals.

**Step 2: Script** (`node scripts/import-professionals.mjs --file <csv> [--commit] [--url <api>]`):
- CSV columns: `prenom, nom, courriel, telephone, ville, province, code_postal, annees_experience, titre_1, permis_1, titre_2, permis_2, langues (fr|en|es séparés par ;), clienteles (clés ; « * » pour spécialisé, ex. adults*;couples), approches (même format), motifs (clés séparées par ;), ivac, activer (oui|non)`;
- parses with a small RFC 4180 parser (quotes, commas, UTF-8 BOM), validates each row with the module's Zod schemas compiled for Node (or duplicated minimal checks — prefer importing `src/modules/professionals/schemas/*` through `tsx`), prints a table of errors by line;
- signs in **as the person running it**: prompts for email and password on the TTY (hidden input), never reads them from files or env, never logs them; uses the anon key from `--anon-key` or `VITE_SUPABASE_ANON_KEY` (public by design);
- refuses any URL other than `http://127.0.0.1:55321` / `http://localhost:55321` unless `--url` is given **and** the operator types the project ref back when asked (« Tapez la référence du projet pour confirmer : »);
- dry run by default (every row through `import_professional(row, true)`); `--commit` runs for real, row by row, and writes a report `import-report-<date>.csv` (status per line, no personal data beyond the line number and email);
- tests: CSV parsing (quotes, BOM, empty cells), row → payload mapping (`*` → specialized), refusal of a remote URL without confirmation, dry run by default.

**Step 3: Runbook** `docs/runbooks/import-professionals.md`: how to export from the clinic's source (GOrendezvous / spreadsheet) into the CSV, the key lists to use (export from Paramètres or `select key, name from …` locally), the mapping trap of legacy document type `license` (= image-rights consent, inconsistency 12; documents are not imported in 4a), dry run locally with the sample, then — **with Jonathan's go-ahead only** — dry run on staging, review the report, `--commit`, spot-check five records.

**Step 4: Commits** (`feat(db): import_professional with dry run` · `feat(scripts): CSV import of existing professionals (dry run by default)`).

---

## Task 4a.20: 4a wrap-up — seed, docs, Playwright path, review

**Files:**
- Modify: `supabase/seed.sql` (professionals in every status; the provider linked to one; a complete matching profile for two)
- Create: `e2e/professionals.spec.ts`
- Create/rewrite: `docs/modules/professionals.md`
- Modify: `CLAUDE.md` (§1 built so far, §4 module structure, §8 « record tabs are lazy pages », reference to this module's published contract), `docs/standards/database-conventions.md` (§5b example → the real `professionals_directory`; « child rows: PK starts with the parent id » rule from P4-36; composite org FKs from P4-40), `docs/plans/2026-10-06-legacy-feature-inventory.md` §A (tick items built in 4a, point the others to 4b–4d), `docs/plans/2026-10-07-decisions-log.md` (append « Phase 4 decisions (déléguées, 2026-10-08) » listing P4-1…P4-50 by id and title, linking here), `docs/plans/2026-10-07-status.md`

**Step 1: Seed.** Seven local professionals in the seed org: one per status (`draft`, `invited`, `in_review`, `active` ×2, `inactive` with reason `leave`), one `active` linked to `provider@mana.test`, two with a full matching profile (one English-speaking, adolescents ★, anxiété); values fake and obviously local (`@exemple.test`). The seed sets `app.audit_source = 'seed'` (already) and uses the RPCs where it can (as the seed admin through `set_config('request.jwt.claims', …)`), so the seed exercises the same paths.

  **As built (2026-10-08, ahead of the rest of 4a.20, at Jonathan's request):** ten professionals, fixed ids `5eed0000-0000-0000-0000-0000000000NN`, in one data-driven `do` block at the end of `supabase/seed.sql` (the CLI sends the seed as one batch, so a statement cannot call a function created earlier in the file; `pg_temp` helpers fail with « schema "pg_temp" does not exist »). Statuses: 7 `active`, 1 `draft` (Naturopathe, gaps clientèle + motif), 1 `in_review` (complete), 1 `inactive` (« Congé » + note). No `invited`: it needs the 4b secure link. Professions: psychologue ×3, psychothérapeute, travailleur social, sexologue, coach (no order), naturopathe (no order), psychoéducatrice, and one with two titles (Travailleuse sociale + Psychothérapeute). Motif density: 72 (all), 65 (« Tous sauf … »), 25 across 7 categories, 15, 12, 8, 7, 6, 3, 0. « Psychose » and « Idées suicidaires » are marked restricted (local seed only; P4-16 keeps none by default) and only titles from an order carry them. FR / EN / ES, ★ clientèles and approaches, availability periods, two not accepting, public profiles on every non-draft, one IVAC number. `provider@mana.test` is linked to 04 Félix Gauthier (active sexologue, email = the login, so no `login_email_mismatch`). Written through the set, payer, activation and deactivation RPCs as Admin Local (audit source `seed`); plain writes only for the record row (fixed id; mirrors `create_professional`), plain fields, and `in_review`. Seeded orders carry no `licence_pattern`; licences follow the usual shapes (OPQ 5 digits, OTSTCFQ « TS » + 5, OPSQ « SX » + 4, OPPQ 4). No pgTAP test needed a change: every test already filters by its own fixtures.

**Step 2: Playwright path** (`e2e/professionals.spec.ts`, local only): adjointe signs in → Professionnels → « + Ajouter » (Prénom, Nom, Courriel, Psychologue + permis) → record opens on Aperçu showing « Complétez le profil de jumelage » → Jumelage: pick 2 clientèles (one ★), 3 motifs, English → Aperçu shows « Le dossier est prêt à être activé » → « Activer » → status « Actif » → list filter « Langue : Anglais » finds the professional → Historique shows the activation. Second test: conseillère sees no « + Ajouter », edits a motif, cannot edit Identité. Run inside the lock after `db:reset`.

**Step 3: Module doc** `docs/modules/professionals.md`: tables, RPCs, views and helpers (the published contract of §3.8 as built; « Ce que Demandes doit faire » says that the matcher must not use `sort_order` as a hidden tie-breaker when age clientèles overlap: it is a display order anyone with the settings can change), permissions and role defaults, settings sections, routes, readiness items by phase, « Écarts par rapport à PS Hub » (P4-39), known follow-ups: motif list v2 (P4-21; the swap strategy and what must be decided), Google Places (P4-12), feminine titles (P4-5), cap interpretation (P4-8).

**Step 4: Full checks.**
```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run build
scripts/with-db-lock.sh bash -c 'npm run db:reset && npm run db:test && supabase db reset --no-seed && supabase test db && npm run db:reset && npm run e2e'
BASE_REF=origin/main npm run lint:migrations
git diff --stat src/core/supabase/database.types.ts
```
Expected: all green; no uncommitted type drift.

**Step 5: Browser walkthrough** (local, the four accounts, desktop and 375 px; record results in the status doc):
- **admin:** every settings section (add, rename, archive, restore, reorder); create a professional; complete Jumelage; activate with and without override; deactivate « Fin de collaboration » on the provider's professional → `provider@mana.test` can no longer sign in → reactivate → can again; Rémunération: a margin, a recognition level; private: enter bank details, reveal, check Historique shows « Numéro de compte affiché »;
- **adjointe:** same record work; settings read-only; no Rémunération tab;
- **conseillère:** list filters (« adolescents en anglais sur l'anxiété »), Jumelage edits, everything else read-only, no Paramètres;
- **professionnel:** no Professionnels menu (Mon profil arrives in 4b);
- **efficiency probes** (the checklist above): the network list on a cold record load (≤ 3 requests, started together); then re-run `supabase/scripts/perf-professionals.sql` and compare with 4a.4's timings (the 200-row fixture lives in a rolled-back transaction, so it cannot be seen from the browser);
- **module off:** Paramètres → Modules → disable Professionnels → menu, routes and sections disappear; re-enable.

**Step 6: Final review.** Dispatch `superpowers:code-reviewer` on the branch diff against `feat/phase-2-core-settings` with the design, this plan and the efficiency checklist; fix findings and have them re-reviewed.

**Step 7: Report to Jonathan** (what was built, screenshots) and ask, separately: push + PR for 4a; then, once green and reviewed, merging deploys the 4a migrations to staging (module stays **disabled** on staging until he enables it, Mise en service item 10).

**Commit(s):** `chore(seed): local professionals in every status`, `test(e2e): create, match and activate a professional`, `docs(professionals): module doc, decisions and inventory ticks` — each staging its own paths.

---
# Batch 4b — Invitation, questionnaire, review (after Phase 3 Tasks 3.1–3.8, 3.10, 3.12–3.13, 3.17–3.21; 3.24–3.27 for the photo and insurance steps)

**Additional decision for 4b** (also listed with the others at the top):

| # | Decision | Rationale |
|---|---|---|
| P4-43 | **Displayed status of `in_review`:** « À réviser » (yellow) while a submission waits for review; « En préparation » (neutral) once it is approved and the file is not yet active. The stored status stays `in_review` until activation. | Design §3.4 defines no status between approval and activation; « À réviser » would be wrong after approval. No new stored status, so no lifecycle change. |

## Task 4b.0: Sync with Phase 3 and confirm its names

**Depends on:** Phase 3 Tasks 3.1–3.8, 3.10, 3.12, 3.13, 3.17, 3.19, 3.20, 3.21 merged to `main` (and 3.24–3.27 for 4b.4's upload steps).

**Steps:**
1. `git merge main` into `feat/phase-4-professionals` (or the Phase 3 branch if Jonathan has not merged it yet and the coordinator says so); resolve; run the full checks inside the lock.
2. Check the built code against the names this plan uses (Phase 3 plan wording): `sendTemplatedEmail` (`_shared/email/`, Task 3.8), `list_subject_emails` (3.6), `private.notify` / `_shared/notifications.ts` (3.12–3.13), `generateToken` / `hashToken` / `linkUrl` (3.19), `private.issue_secure_link` / `revoke_secure_links` / `consume_secure_link` (3.17), the purpose columns `resolve_rpc`, `accept_rpc`, `creates_account` (3.17), the `accept-invite` contract (3.20: `resolve_rpc(p_link_id) → display` with `email`; `accept_rpc(p_token_hash, p_user_id, p_payload) → {status, …}`; user deleted when `status ≠ 'accepted'`), `consume_rate_limit` (3.2), `list_job_orgs` / `start_job_run` / `finish_job_run` (3.3), the `users-set-status` ban (3.20). Write any difference in the commit body; the built code wins.
3. Apply those names in 4b–4d as you go.

**Commit:** `merge: Phase 3 batches 3a–3d into Phase 4` (merge commit), then `docs(plan): Phase 3 names confirmed for 4b`.

---

## Task 4b.1: Migration `professionals_onboarding` (lane A)

**Files:** `supabase/migrations/<ts>_professionals_onboarding.sql`, `supabase/tests/database/047_professionals_onboarding.test.sql`.

**Contents:**
- **Permissions:** `professionals.invite` « Inviter les professionnels et demander des mises à jour », `professionals.review` « Réviser et appliquer les soumissions »; defaults admin + admin_assistant.
- **Secure link purpose** (Phase 3 catalogue, Task 3.17, `on conflict do nothing`): `professional_invite` (module `professionals`, `default_ttl '7 days'`, `max_ttl '30 days'`, `max_uses 1`, `requires_session false`, `creates_account true`, `resolve_rpc 'resolve_professional_invitation'`, `accept_rpc 'link_professional_account'`, `view_permission 'professionals.view'`). No `profile_update` purpose (P4-44).
- **Email template defaults** (Phase 3 catalogue `email_template_defaults`, Task 3.6, P4-50; `module_key 'professionals'`, `view_permission 'professionals.view'`, `recipient_mode 'subject'`, `allows_attachments false`, a `why_line`, `variables` with `kind` text/date/datetime/url; FR copy, vous, warm, no clinical word; variables such as `professional.first_name`, `clinic.name`, `invitation.expires_at`):
  - `professionals.invite` « Bienvenue dans l'équipe de {{clinic.name}} » — button « Créer mon accès »;
  - `professionals.invite_reminder` « Votre invitation vous attend » — same button;
  - `professionals.profile_update` « Une petite mise à jour de votre profil » — button « Mettre mon profil à jour » (action URL `APP_URL/mon-profil/questionnaire`, no token, P4-44);
  - `professionals.submission_received` (staff) « {{professional.full_name}} a envoyé son profil » — button « Réviser le dossier ».
- **Module settings keys** (`create or replace` the defaults/validation functions of 4a.2): `invitation_expiry_days` int 1–30 (default 7), `invitation_reminder_after_days` int 1–29 (default 3, `null` = no reminder).
- **Tables** (all audited, org-scoped, composite FKs, staff select with `professionals.view`, self select with `professionals.self`, no client writes):
  - `professional_submissions`: PK `(professional_id, id)`, `unique (id)`; `kind` (`onboarding` | `update`), `status` (`draft` | `submitted` | `approved` | `rejected`), `requested_sections text[]` (⊆ the 12 section keys below; `onboarding` = all), `prefill jsonb` (snapshot of current values at creation, object, `pg_column_size` ≤ 64 KB), `submitted_values jsonb` (object; per-section objects; ≤ 64 KB; **never** SIN or account numbers), `secure_link_id uuid` (FK to core `secure_links(id)` on delete set null, indexed; onboarding only), `created_at, updated_at, submitted_at, reviewed_at, reviewed_by, decision_note`; partial unique index « one open submission per professional » `where status in ('draft', 'submitted')`;
  - `professional_submission_private` (P4-38): PK `submission_id` → `professional_submissions(id)` on delete cascade, `org_id`, `professional_id`, same columns as `professional_private` (encrypted SIN and account, plain BN/TPS/TVQ/institution/transit), `key_version`; no client privilege, `service_role` revoked, every value redacted in the audit;
  - `consent_versions`: `org_id, key ('image_rights'), version int, title, body text, published_at, published_by`, unique `(org_id, key, version)`; seeded v1 « Consentement au droit à l'image » with the legacy text (12 months, automatic renewal, 3-month withdrawal notice; copy the wording from `_legacy/src/professionals/` consent step, adapted to vous);
  - `professional_consents`: PK `(professional_id, id)`, `unique (id)`; `consent_version_id`, `signer_name`, `signed_at timestamptz`, `expires_on date` (signed date + 12 months, clinic date), `withdrawn_at`, `withdrawal_effective_on date` (+3 months), `submission_id`.
- **The 12 section keys:** `personal`, `professional` (titles, licences, years), `portrait` (bio, approach, public contact), `languages`, `clienteles`, `approaches`, `motifs`, `availability`, `photo`, `insurance`, `tax_bank`, `consent`.
- **RPCs:**
  - `create_professional_invitation(p_actor uuid, p_id uuid, p_token_hash bytea) returns jsonb` (**service role only**, actor model of Task 3.18 commit 5f64972: the edge function verifies the user with `verifyAuth` (`professionals.invite`), generates the token in memory, and calls this with the **service** client and `p_actor = auth.access.user_id`; the function checks the actor is an active member holding `professionals.invite` via `private.permission_keys_for(p_actor)`, takes the org from the actor's profile, and sets `app.audit_actor` for its writes, so the inviter never learns the token): status `draft` or `invited`, no account yet; `private.issue_secure_link(org, 'professional_invite', 'professional', p_id, p_token_hash, p_actor, make_interval(days => invitation_expiry_days))` (which revokes the previous live link), sets status `invited`, creates or reuses the onboarding draft submission (prefill from the current record) with the link id; returns `{link_id, email, first_name, expires_at}` (what the email needs, as `renew_staff_invitation` does);
  - `revoke_professional_invitation(p_id uuid) returns void` (`invite`): `private.revoke_secure_links(…)`;
  - `request_professional_update(p_id uuid, p_sections text[]) returns jsonb` (`invite`): account required (« Ce professionnel n'a pas encore de compte. »); no other open submission (« Une soumission est déjà en cours. »); creates the `update` submission (no link, P4-44); returns `{submission_id, email, first_name}`;
  - `resolve_professional_invitation(p_link_id uuid) returns jsonb` (**service role only**, the purpose's `resolve_rpc`): `{clinic_name, display_name, email, expires_at}` (minimum display, Task 3.20 step 8 needs `email`);
  - `link_professional_account(p_token_hash bytea, p_user_id uuid, p_payload jsonb) returns jsonb` (**service role only**, the purpose's `accept_rpc`): `private.consume_secure_link(p_token_hash, 'professional_invite')` first (null → `{status: 'link_used'}`, so `accept-invite` deletes the user it created); from the link row (never from the caller) finds the professional and org; refuses if `profile_id` is set (`{status: 'link_used'}`); inserts `profiles` (display name « Prénom Nom », the link's email, `active`), `user_roles` (`provider`; this module owns the role, decision #28), sets `profile_id`; returns `{status: 'accepted', redirect: '/mon-profil/questionnaire'}`; one transaction;
  - provider side (`professionals.self`, own professional only, via `current_professional_id()`): `get_my_submission() returns jsonb` (open submission, requested sections, prefill, saved values, consent text, `collect_sin`); `save_my_submission_draft(p_section text, p_values jsonb) returns timestamptz` (validates the section's shape and rules — same checks as the staff RPCs: titles ≤ 2 with licence when regulated, years 0–60, bio required, at least one language, restricted motifs…; unknown keys → `22023`; private keys refused → `22023`); `save_my_submission_private(p_sin, p_business_number, p_gst_number, p_qst_number, p_bank_institution, p_bank_transit, p_bank_account) returns void` (encrypts at once; SIN refused unless `collect_sin`); `sign_my_consent(p_version_id uuid, p_signer_name text) returns void` (typed name must equal « Prénom Nom », accent- and case-insensitive); `submit_my_submission() returns void` (every requested section complete; `onboarding` → professional `in_review`; `update` → status unchanged);
  - staff review (`professionals.review`): `get_submission_review(p_submission_id uuid) returns jsonb` — per section, per field `{field, label_key, current, submitted, changed}` (ids resolved to keys; private fields as `{changed: true}` only, never values); `apply_professional_submission(p_submission_id uuid, p_fields text[] default null) returns void` — **one transaction**: applies all fields, or the chosen ones, through the same internal code paths as the staff RPCs (refactor them into `private.apply_*` helpers called by both), consent → `professional_consents`, private → `professional_private` (encrypted bytes copied with their `key_version`, never decrypted), staged files → kept attached until 4c promotes them; sets `approved`, `reviewed_*`; `reject_professional_submission(p_submission_id uuid, p_note text) returns void` (note required; the professional can edit and resubmit: status back to `draft`);
  - read helpers (definer, because `secure_links` has no client privilege): `list_professional_invitation_states() returns table (professional_id uuid, state text, sent_at timestamptz, expires_at timestamptz, opened_at timestamptz, used_at timestamptz)` for the whole org in **one** grouped query (list page); `private.professional_invitation_state(p_id)` used once by `get_professional_record`. State precedence (A2.5): `used` > `opened` > `sent`; `expired` when pending past `expires_at`; `revoked`.
- **Readiness:** replace `professionals_readiness` (append `account_created`, `submission_approved`; `ready` now also requires both). `get_professional_readiness` adds the items « Compte créé (invitation acceptée) » and « Questionnaire approuvé ».
- **History:** `professional_history_tables` adds `professional_submissions`, `professional_consents` (and never `professional_submission_private`, which shows as « Renseignements fiscaux ou bancaires transmis » from the submission's own row).
- **Tests:** privileges (incl. `function_privs_are` for `resolve_professional_invitation` and `link_professional_account`: `service_role` only); every new `public` function in the `functions_are` list (P4-47); the invitation issues/revokes a link and sets `invited`; the accept RPC consumes the link, creates profile + provider role + link, returns `link_used` on a second call or a used token; provider RLS (own submission only); each section validator; private values encrypted, never in `submitted_values`, redacted in audit; submit transitions; diff output (no private values); apply all and apply some, in one transaction (a failure in one field rolls back all); reject → draft; invitation states precedence; readiness items; isolation; the adjointe without `professionals.private` can apply a private section without seeing values.

**Commit:** `feat(db): professional invitation, questionnaire submissions and review`.

---

## Task 4b.2: Edge functions — invite, update request, submit notice, reminders (lane A)

**Depends on:** Phase 3 Tasks 3.2 (`consume_rate_limit`), 3.3–3.4 (jobs, `_shared` foundations), 3.8 (`sendTemplatedEmail`), 3.13 (`_shared/notifications.ts`), 3.19 (`_shared/links.ts`), 3.20 (`accept-invite`), 3.21 (`/invitation`).

**Files:** `supabase/functions/professionals-invite/{index.ts,handler.ts,handler.test.ts}`, `supabase/functions/professionals-submit/{…}`, `supabase/functions/professionals-invitation-reminders/{…}` (Phase 3 shape, P4-48), `supabase/functions/_shared/professionals.ts` (template values builder) + test; `supabase/config.toml` (`verify_jwt = false` for the three, each calling `verifyAuth` / `verifyServiceRoleAuth` first); migration `<ts>_professionals_invitation_reminder_job.sql` + `048_professionals_invitation_reminder_job.test.sql`: `scheduled_jobs` row `professionals.invitation_reminders` (kind `function`, `function_name 'professionals-invitation-reminders'`, `local_hour 8`, business job, P4-45) and its hourly `cron.schedule` calling `private.invoke_job_function`, as Task 3.3 does; **core change, reviewed as such:** `accept-invite` passes an optional `redirect` (app path) from the `accept_rpc` result to its 200 response, and `/invitation` navigates there through `safeRedirect` instead of `/accueil` (inconsistency 22), with tests in their Phase 3 files.

- **`professionals-invite`** — `verifyAuth(req, { module: 'professionals', permission: 'professionals.invite' })`; body (`readJson`, Zod) `{ action: 'send' | 'resend' | 'new_link' | 'revoke' | 'request_update', professional_id, sections? }`; `generateToken` / `hashToken`; RPC with the **user** client (RLS and checks apply); `sendTemplatedEmail` with `professionals.invite` (action URL `linkUrl(APP_URL, '/invitation', token)`) or `professionals.profile_update` (action URL `APP_URL/mon-profil/questionnaire`), subject `professional` / id, to the email the RPC returned (never from the body), `explicitResend` for « Renvoyer »; response `{ ok, expires_at, link? }` — `link` only for `send` and `new_link` (P3-7, D6: shown once for « Copier le lien »), never logged. Email failure → 502 `provider_error` / 503 `not_configured` with the ids, and the UI says « Invitation créée, mais le courriel n'a pas pu être envoyé. Utilisez « Renvoyer ». » (Task 3.20 pattern).
- **`professionals-submit`** — provider (`verifyAuth(req, { module: 'professionals', permission: 'professionals.self' })`): calls `submit_my_submission` with the user client (which also calls `private.notify(… 'professionals.submission_received', 'normal', …, recipient_permission 'professionals.review', dedupe 'submission:<id>')` in SQL, so the notice exists even if the email fails), then sends `professionals.submission_received` to every active user of the org holding `professionals.review` (service-role RPC `list_professionals_reviewers_for_service(p_org)`, one call, then the sends in parallel with `Promise.all`, at most 20).
- **`professionals-invitation-reminders`** — `verifyServiceRoleAuth`; for each org of `list_job_orgs('professionals.invitation_reminders')` (module and job enabled, local hour 8): `start_job_run` (null → already ran today, skip); one service-role RPC `list_professionals_invitations_to_remind_for_service(p_org)` (pending, unopened, older than `invitation_reminder_after_days`, no `professionals.invite_reminder` in `email_log` for the subject yet); for each: re-issue the link (new token, the old one revoked: the raw token is gone) and send `professionals.invite_reminder`, in batches of 25; `finish_job_run` with counts only.
- **Accept path:** `accept-invite` (core, Task 3.20) calls `link_professional_account` for purpose `professional_invite`; a module Deno test checks the handler JSON (`status`, `redirect`) against what the core function expects.
- **Tests (Deno, `_shared/testing` fakes):** auth and module gate (disabled module → 403 `module_disabled`); body validation; recipient never taken from the body; link returned only for send/new_link and the token in the email URL hashes to `p_token_hash`; email failure path; reminders run once per local day (`start_job_run` null), dedupe and new token; reviewers list; no address or token in logs or reports (spy on `console` and `report`).

**Commit:** `feat(functions): professional invitations, submission notice and reminders`.

---

## Task 4b.3: Staff UI — invitations, readiness items, « Invitations » settings, « Courriels » in Historique (lane C, B for settings)

**Files:** `api/invitations.ts` (+ test, calls `professionals-invite` through `supabase.functions.invoke`), `hooks/use-invitations.ts`; Modify `CreateProfessionalDialog.tsx`, `RecordHeader.tsx`, `ReadinessCard.tsx`, `NextActionCard.tsx`, `lib/watch.ts`, `lib/readiness.ts`, `HistoryTab.tsx`, `ProfessionalsListPage.tsx`; Create `components/record/InvitationLinkDialog.tsx`, `components/record/RequestUpdateDialog.tsx`, `pages/settings/InvitationsSettingsPage.tsx` + tests; `manifest.ts` (section `invitations`, path `invitations`, edit `professionals.settings`); `fr-CA.json`.

- **Creation dialog** (design §5.2 with 4b): description « Une invitation lui sera envoyée par courriel pour compléter son profil. », checkbox « Envoyer l'invitation maintenant » (checked, shown with `professionals.invite`), button « Créer et inviter » / « Créer »; on success with invitation → `InvitationLinkDialog` « Invitation envoyée à {courriel}. » with « Copier le lien » (the only time the link exists, D6) and « Fermer » → record.
- **Header « … » menu:** « Renvoyer l'invitation » (resend), « Nouveau lien » (new_link → `InvitationLinkDialog`), « Révoquer l'invitation » (confirm), « Demander une mise à jour » (`RequestUpdateDialog`: checklist of the 12 sections, at least one, confirm « Envoyer la demande ») — each shown by state and permission.
- **Aperçu:** readiness items « Compte créé », « Questionnaire approuvé »; invitation line « Invitation envoyée le … · ouverte le … · expire le … » (precedence A2.5); « Prochaine action »: draft → « Envoyez l'invitation. » [Envoyer]; invited & expired → « L'invitation a expiré. » [Nouveau lien]; submitted → « Le profil est prêt à être révisé. » [Réviser → documents#questionnaire].
- **List:** « À surveiller » gains « Invitation sans réponse · {n} j » (sent ≥ 3 days, not opened), « Invitation expirée », « Dossier à réviser », « Mise à jour à réviser »; the list fetches `list_professional_invitation_states()` **in parallel** with the list view (one request) and joins in memory. Status label rule P4-43.
- **Accueil (provider):** with an open submission, a card « Complétez votre profil » → `/mon-profil/questionnaire` (fallback for inconsistency 22).
- **« Invitations » settings:** « Durée de validité du lien » (1–30 jours, défaut 7), « Rappel automatique » (switch + « après {n} jours »), `useSettingsForm` card.
- **Historique:** filter « Tout · Modifications · Courriels »; email rows from `list_subject_emails('professional', id)` (Task 3.6, P3-26: template label, status « Envoyé / Livré / Adresse introuvable / Échec », « Renvoyer » on failure); requested in parallel with the audit page, each source paginated (keyset), merged client-side by time.
- **Tests:** dialog states and the one-time link; menu items per state/permission; readiness and next-action rules; list flags; settings validation; history merge order and the filter.

**Commit:** `feat(professionals): invitations, update requests and email history`.

---

## Task 4b.4: Provider questionnaire `/mon-profil/questionnaire` (lane C)

**Depends on:** 4b.1, 4b.2; Phase 3 Tasks **3.24–3.27** for the « Photo » and « Assurance » steps (if they are not merged yet, those two steps show « Vous pourrez téléverser ce document bientôt. » and become required in 4c.2).

**Files:** `pages/self/QuestionnairePage.tsx` + test, `components/questionnaire/*` (one component per step + `QuestionnaireNav`, `AutosaveStatus`), `api/self.ts` + test, `hooks/use-my-submission.ts`; `manifest.ts` (route `mon-profil/questionnaire`, permission `professionals.self`); `fr-CA.json`.

- **Steps** (A3.3 + additions; update requests show only requested sections, « Révision » always): Renseignements personnels (name and login email read-only, phone, address) · Profil professionnel (≤ 2 titles with licence when regulated, years 0–60) · Portrait (bio required, approach, public contact) · Langues · Clientèles · Approches · Motifs · Disponibilités générales · Photo (JPEG/PNG ≤ 5 MB, required for onboarding) · Assurance (PDF/JPEG/PNG ≤ 10 MB, required; expiry date proposed as the next March 31, editable) · Fiscalité et banque (NE, TPS, TVQ, institution, transit, compte; NAS only when `collect_sin`) · Consentement (text v1, « J'ai lu et j'accepte » + typed full name) · Révision (summary by section with « Modifier »).
- **Navigation:** the step list on the left is section navigation inside a form: buttons with `tabIndex={-1}` (CLAUDE.md §10); keyboard users move with « Retour » / « Continuer ». Each step validates on « Continuer ».
- **Autosave:** server save 2.5 s after the last edit, on « Continuer » and on « Enregistrer le brouillon »; `AutosaveStatus` « Enregistré à 14:32 » (`formatClinicTime`) / « Enregistrement… » / error banner « Vos dernières modifications n'ont pas été enregistrées. Vérifiez votre connexion. » with « Réessayer ». No localStorage copy (D4). Private values go through `save_my_submission_private` on « Continuer » of that step only, then the fields clear and show « Enregistré (•••• 4567) ».
- **Pickers:** reuse `SetPickerSheet` (motifs, clientèles, approches) with the provider's catalogue (RLS `self`).
- **Uploads:** Phase 3 upload widget (Task 3.27): `storage-upload` → direct upload → `storage-confirm`, purpose `professional_submission_file` (`documents` bucket, `upload_permission` and `owner_permission` `professionals.self`, `view_permission` `professionals.review`, `retain_days 60`: a staged upload, P3-17; seeded in 4b.1's migration if Task 3.24 is merged, else in 4c.2), subject = the submission; « Remplacer » / « Retirer » (`private.soft_delete_stored_file`). On approval, `apply_professional_submission` calls `private.attach_stored_file(file, array['professional_submission_file'], …, p_uploaded_by => the provider's user id)` to re-point the file to the professional's document (clears `retain_until`; `attach_stored_file` itself checks the purpose and the uploader); abandoned uploads are purged by core `storage-cleanup`.
- **Submit:** « Envoyer mon profil » → `professionals-submit` → confirmation « Merci ! L'équipe de la clinique va réviser votre profil. Vous recevrez un courriel si une précision est nécessaire. »
- **States** (A3.2): no open submission → « Rien à compléter pour l'instant. » with a link to « Mon profil »; submitted → read-only summary « Profil envoyé le … »; rejected → the staff note on top and the form editable again.
- **Tests:** steps shown per requested sections; validation per step; autosave timing (fake timers) and failure banner; private fields never in the draft payload; consent name check; upload states; submit; states.

**Commit:** `feat(professionals): provider onboarding questionnaire with server autosave`.

---

## Task 4b.5: Review and apply; « Mon profil » (lane C)

**Files:** `components/record/SubmissionsCard.tsx`, `components/record/SubmissionReviewSheet.tsx` + tests; `pages/self/MyProfilePage.tsx` + test; Modify `DocumentsTab` placeholder (a minimal Documents tab hosting « Questionnaire et mises à jour » until 4c fills it), `manifest.ts` (nav « Mon profil » `/mon-profil`, permission `professionals.self`, order after Accueil), `fr-CA.json`.

- **« Questionnaire et mises à jour »** (Documents tab, `professionals.view`; actions with `professionals.review`): submissions newest first (type, status, dates, reviewer); « Réviser » opens `SubmissionReviewSheet`.
- **Review sheet** (A2.14–A2.16): sections with a table « Champ · Actuel · Soumis », changed rows highlighted, a checkbox per changed field (all checked by default), private rows « Renseignements transmis (non affichés) »; footer « Refuser » (note required), « Appliquer la sélection » (teal); one call; toast « Profil mis à jour. »; « Voir la soumission originale » shows the readable answers (no raw JSON, D5).
- **« Mon profil »** (provider, read-only): Profil de jumelage, Profil public, Identité et permis, Fiscalité/Banque masked (`get_my_professional_private()` — add to 4b.1: masked values of the caller's own row, never reveal); « Proposer une modification » → choose sections → creates an `update` submission (`start_my_profile_update(p_sections)`, add to 4b.1) and opens the questionnaire.
- **Tests:** diff rendering, selection, apply payload, reject note; « Mon profil » renders own data only, masked; propose flow.

**Commit:** `feat(professionals): submission review with field-by-field apply; Mon profil`.

---

## Task 4b.6: Account disable ends open sessions (lane A)

**Depends on:** Phase 3 Task 3.20 (`users-set-status` ban).

**Files:** `supabase/functions/professionals-set-status/index.ts` + test; Modify `api/record.ts` (`deactivateProfessional` / `activateProfessional` go through the function), `config.toml`.

- `verifyAuth(req, { module: 'professionals', permission: 'professionals.manage' })`; calls `deactivate_professional` / `activate_professional` with the user client; when the account was disabled (or re-enabled) by the call, applies the same ban as Task 3.20 (`auth.admin.updateUserById(id, { ban_duration: '876000h' })`, or `'none'` to lift it) for that **provider** profile only (role checked server-side through the RPC result). A ban failure after a disable → 200 `{ signin_blocked: false }` + `reportError` (`signin_blocked` covers the Auth ban only: since P3-32 the sessions end in the database with the disable, so only new sign-ins can still get through), and the UI says « Compte désactivé. Le blocage de connexion n'a pas pu être appliqué ; réessayez. »; an unban failure → 502 and « Réessayez » (a banned user cannot sign in).
- **Tests:** permission and module gate; provider-only ban; failure path; re-enable lifts the ban.

**Commit:** `feat(functions): deactivating a professional's account ends its sessions`.

---

## Task 4b.7: 4b wrap-up

- pgTAP, Deno and Vitest green; `000_invariants` green.
- **Playwright** (`e2e/onboarding.spec.ts`, local, Mailpit at `http://127.0.0.1:55324` through its API): adjointe creates and invites → the test reads the invitation email in Mailpit → opens the link → sets a password → questionnaire (all steps; photo/insurance with fixture files if 3e is merged) → submit → adjointe reviews and applies → readiness shows « Questionnaire approuvé ».
- Browser walkthrough with the four accounts (invitation states, expired link, update request, provider « Mon profil »).
- Docs: `docs/modules/professionals.md` (4b objects), inventory §A3 ticks, status doc.
- Review: `superpowers:code-reviewer` on the 4b diff with the efficiency checklist.
- Report to Jonathan; push/PR/merge only with his go-ahead.

---

# Batch 4c — Documents, insurance, notifications, fiche (after Phase 3 Tasks 3.3, 3.8, 3.12–3.13, 3.24–3.27; 3.29–3.30 for the fiche)

## Task 4c.0: Sync with Phase 3 storage, jobs and renderer

As 4b.0, for Phase 3 Tasks 3.24–3.27 (storage) and 3.29–3.30 (renderer: the spike's choice, pdfmake or Gotenberg, behind `PdfRenderer`). Check the names used below: `upload_purposes` (`owner_permission`, `retain_days`), `stored_files` (`retain_until`), `create_pending_upload`, `private.attach_stored_file` (takes `p_purposes text[]` and an optional `p_uploaded_by`, checked inside), `private.soft_delete_stored_file`, `register_system_file`, the 5-min signed read URL, `_shared/pdf/` (`PdfDocument`, `fillTemplate`, `loadAssets`, `pdfRendererFromEnv`), and `sendTemplatedEmail` attachments for templates with `allows_attachments` (P3-18).

---

## Task 4c.1: Notification kinds for Professionnels (lane A) — the notifications themselves are Phase 3 (P3-15)

**Depends on:** Phase 3 Tasks 3.12 (`notifications`, `private.notify`, `create_notification`) and 3.13 (bell polling every 60 s, Accueil « À surveiller », `_shared/notifications.ts`).

**Files:** `supabase/functions/_shared/professionals-notices.ts` + test (typed builders over `_shared/notifications.ts`); `src/i18n/fr-CA.json` only if the bell renders kind-specific labels (it renders the stored `title` / `body`, so expect no change).

Kinds (`module_key 'professionals'`; French `title` / `body` with names and dates only, never clinical content; `link_path` app-relative; `dedupe_key` so jobs never duplicate):

| Kind | Importance | Recipient permission | Title / body | Link | Dedupe key |
|---|---|---|---|---|---|
| `professionals.submission_received` | normal | `professionals.review` | « Profil à réviser » / « {Prénom Nom} a envoyé son profil. » | `/professionnels/:id/documents` | `submission:<submission_id>` |
| `professionals.insurance_expiring` | important | `professionals.manage` | « Assurance bientôt échue » / « L'assurance de {Prénom Nom} prend fin le {date}. » | `/professionnels/:id/documents` | `insurance:<document_id>:<expires_on>:expiring` (the date is in the key so a corrected expiry raises a new notice instead of returning the old, possibly expired one: Task 3.12 review) |
| `professionals.insurance_expired` | important | `professionals.manage` | « Assurance expirée » / « L'assurance de {Prénom Nom} est échue depuis le {date}. Le professionnel reste actif. » | same | `insurance:<document_id>:expired` |
| `professionals.document_to_review` | normal | `professionals.documents.review` | « Document à vérifier » / « {Prénom Nom} a téléversé {type}. » | same | `document:<document_id>:uploaded` |

*Resolution (Task 3.12 review):* permission-addressed work notices must not stay unread for every reviewer after one acts. `apply_professional_submission` / `reject…` expire `professionals.submission_received` for that submission, and `verify_professional_document` / `reject_professional_document` expire `professionals.document_to_review` for that document, through `private.expire_notifications(org, subject_type, subject_id, kinds)`. Module notices are addressed only by `professionals.*` permissions (the notifications module gate requires the recipient permission to belong to the notice's module).

- Dates in `body` are date-only values formatted with the same rule as `formatDateOnly` (`_shared/format.ts`, Phase 3 Task 3.30), never shifted by time zone.
- `expires_at` on `insurance_*`: 60 days after creation, so stale notices leave the bell; verifying a new valid insurance also stops new ones (no due notice any more).
- **Tests:** each builder's payload (kind, permission, link, dedupe key), the date formatting, and that no builder accepts a motif or note field.

**Commit:** `feat(professionals): notification kinds for submissions, documents and insurance`.

---

## Task 4c.2: Migration `professionals_documents` (lane A)

**Files:** `supabase/migrations/<ts>_professionals_documents.sql`, `supabase/tests/database/050_professionals_documents.test.sql`.

- **Permissions:** `professionals.documents.review` (admin, admin_assistant), `professionals.documents.delete` (admin).
- **`document_types`** (per org, the reference-table pattern + `required boolean`, `expiry_rule text check in ('none', 'next_march_31', 'months_12')`, `reminder_days int[] default '{7}'`, `weekly_after_expiry boolean`, `accepted_mime text[]`, `max_bytes int`): seeded `photo` « Photo professionnelle » (required, none, jpeg/png, 5 MB), `insurance` « Preuve d'assurance responsabilité » (required, next_march_31, {7}, weekly, pdf/jpeg/png, 10 MB), `image_consent` « Consentement droit à l'image » (required, months_12; satisfied by an e-consent too), `cv` « CV », `diploma` « Diplôme », `licence_attestation` « Attestation de permis », `other` « Autre » (pdf/doc/docx/jpeg/png/webp, 10 MB). Never the word `license` (inconsistency 12). Section « Documents requis » edits name, required, rule, reminders, types, size; system rows (`photo`, `insurance`, `image_consent`) cannot be archived.
- **Upload purposes** (Phase 3 catalogue `upload_purposes`, Task 3.24; bucket `documents`): `professional_document` (upload `professionals.manage`, view `professionals.view`, 10 MB, the types of `document_types`, `retain_days 1`), `professional_self_document` (upload `professionals.self`, view `professionals.view`, `owner_permission 'professionals.self'`: the provider reads their own files through the core owner branch, P4-49; `retain_days 1`), `professional_submission_file` (if 4b.4 did not seed it). **Every client-upload purpose that a module RPC must attach gets a `retain_days`** (1 for these two: `attach_professional_document` follows the upload at once), so an upload never attached is purged by core `storage-cleanup` instead of staying forever. All three name `professionals.*` permissions only (the core module gate refuses another module's or a core permission on a module purpose). No storage policy is added by the module (P4-49).
- **`professional_documents`:** PK `(professional_id, id)`, `unique (id)`; `document_type_id` (composite FK), `stored_file_id uuid` (FK to `stored_files(id)`, unique), `status` (`pending` | `verified` | `rejected` | `expired`), `expires_on date` (last valid day, P4-2), `metadata jsonb` (object, validated per type: insurance `{insurer?, policy_number?}`), `uploaded_by`, `uploaded_at`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `submission_id`; check `status <> 'rejected' or rejection_reason is not null`; index `(org_id, document_type_id, status, expires_on)` for the job and the list.
- **`professional_public_profiles.photo_document_id`** (composite FK, the newest verified photo; set by `verify_professional_document`).
- **Expiry helpers:** `private.next_march_31(p_today date) returns date` (today ≤ March 31 → this year's, else next year's; tests on 2026-03-31, 2026-04-01, 2027-02-28); `private.clinic_today_for_org(p_org uuid) returns date` (Phase 2 follow-up; service role variant).
- **RPCs:** `attach_professional_document(p_id, p_type_key, p_file_id, p_expires_on date default null, p_metadata jsonb default '{}') returns uuid` (staff `manage`, or the provider for their own record with a `self` purpose file; computes the default expiry from the rule; a provider-uploaded insurance stays `pending`); `verify_professional_document(p_doc_id, p_expires_on date default null)` (`documents.review`; may correct the date, audited; photo → public profile; insurance → `private.expire_notifications(org, 'professional', professional_id, array['professionals.insurance_expiring', 'professionals.insurance_expired'])`, a small core helper this migration adds next to Phase 3's notifications (sets `expires_at = now()` on matching rows; core change, reviewed as such), so the old notices leave the bell); `reject_professional_document(p_doc_id, p_reason)` (`documents.review`; called by the edge function `professionals-documents` (`{ action: 'reject', document_id, reason }`, Phase 3 shape), which then sends `professionals.document_rejected`; the same function's `uploaded` action creates the `professionals.document_to_review` notice for provider uploads); `set_professional_document_expiry(p_doc_id, p_expires_on)` (`documents.review`); `delete_professional_document(p_doc_id)` (`documents.delete`; `private.soft_delete_stored_file`, core cleanup purges later); `promote_submission_files(p_submission_id)` called by `apply_professional_submission` (replace the 4b.1 function to call it): for each staged file, creates the `professional_documents` row and calls `private.attach_stored_file(file, array['professional_submission_file'], 'professional', professional_id, 'professionals.view', profile_id, 'professionals.self', profile_id)` (`p_purposes` and the expected uploader are checked by `attach_stored_file` itself; clears `retain_until`, P3-17). `attach_professional_document` also calls `attach_stored_file` so the file's subject is the professional: `p_purposes` `array['professional_document']` for staff, `array['professional_self_document']` with `p_uploaded_by = auth.uid()` for the provider.
- **Service-role:** `professionals_mark_expired_documents(p_org uuid, p_today date) returns int` (verified, `expires_on < p_today` → `expired`); `list_professionals_due_document_notices(p_org uuid, p_today date) returns table (document_id, professional_id, kind 'expiring'|'expired'|'expired_weekly', expires_on, …)` — **one** query over the index for the job.
- **Readiness** (replace the view; items from the compliance check, Q21): `photo_ok` (a verified photo), `insurance_ok` (verified, `expires_on >= clinic today`), `consent_ok` (verified `image_consent` document not expired, **or** a `professional_consents` row not withdrawn with `expires_on >= today`), `documents_ok`; `ready` requires them. Directory `insurance_status`: `valid` / `expiring` (within the type's largest `reminder_days`) / `expired` / `missing`; list gains `documents_done`, `documents_required`, `insurance_status`, `insurance_expires_on`.
- **Email templates** (P4-50; `view_permission 'professionals.view'`, `recipient_mode 'subject'`): `professionals.document_rejected` (« Un document est à reprendre », variable `document.rejection_reason`), `professionals.document_expiring` (« Votre assurance prend fin le {{document.expires_on}} », `kind: date`), `professionals.document_expired` (expiry day: « Votre assurance est échue »), `professionals.document_expired_reminder` (weekly after expiry: « Rappel : votre preuve d'assurance est attendue »). `document.expires_on` is declared `kind: date`, so `_shared/email` formats it as a date-only value.
- **History:** adds `professional_documents`.
- **Tests:** privileges; default expiry per rule; verify/reject/delete permissions; provider attaches own only; promotion of submission files; readiness items (missing vs expired); `mark_expired` and `due_notices` on fixed dates (J-7, J, J+7, J+14, renewed); date-only behaviour (no time zone: `expires_on = '2027-03-31'` is valid all day on 2027-03-31 clinic time and expired on 2027-04-01).

**Commit:** `feat(db): professional documents, expiry rules and readiness`.

---

## Task 4c.3: Documents tab, « Documents requis » and « Consentements » settings (lanes C and B)

**Files:** `supabase/functions/professionals-documents/{index.ts,handler.ts,handler.test.ts}` (lane A: actions `reject` and `uploaded`, `verifyAuth` with the module and `professionals.documents.review` / `professionals.self`; tests for permissions, email and notice); `api/documents.ts` (+ test; upload via Phase 3 functions), `hooks/use-documents.ts`, `components/record/tabs/DocumentsTab.tsx` + test, `components/record/RequiredDocumentCard.tsx`, `components/record/UploadDocumentDialog.tsx`, `components/record/DocumentPreview.tsx`; `pages/settings/RequiredDocumentsSettingsPage.tsx`, `pages/settings/ConsentsSettingsPage.tsx` + tests; `manifest.ts` (sections `required-documents` → `documents-requis`, `consents` → `consentements`); Modify `RecordHeader.tsx` (photo avatar), `PublicProfileTab.tsx` (photo, « Aperçu de la fiche » link from 4c.5), list (« Documents 3 / 3 » column), `fr-CA.json`.

- **Documents tab** (A4.3–A4.4): summary « 2 / 3 documents requis valides »; one card per required type with status (dot + word: « Valide », « Expire le 31 mars 2027 » in red within the reminder window, « Expiré », « Manquant », « À vérifier », « Refusé »), expiry `formatDateOnlyShort`, actions by permission: Aperçu (signed read URL of 5 min through the core read policy, P3-20, in a sheet for images and PDFs), Télécharger, Vérifier (with the date for insurance, prefilled), Refuser (reason, emailed), Modifier l'échéance, Remplacer, Supprimer (`documents.delete`, hidden without it — A10.7); the consent card also shows the e-consent (« Signé électroniquement le … par … »); « Autres documents » table + « Téléverser un document » (type select: CV, Diplôme, Attestation de permis, Autre — fixes A10.7). Top of tab: « Questionnaire et mises à jour » (4b.5); 4d adds « Contrat » above.
- **Upload dialog:** type, file (accepted types and size from `document_types`, checked client-side and again server-side by Phase 3), expiry date for types with a rule (prefilled, date input, date-only), « Téléverser »; progress; errors in French (« Ce fichier n'est pas du type annoncé. »).
- **Settings « Documents requis »:** `ReferenceListCard` for `document_types` with columns Requis, Échéance (« Aucune », « 31 mars suivant », « 12 mois »), Rappels (« 7 jours avant · chaque semaine après »); dialog fields accordingly.
- **Settings « Consentements »:** versions of « droit à l'image » (title, body, published date); « Nouvelle version » (draft → publish; signing always uses the latest published version; existing consents keep their version).
- **Tests:** card states by date (fake « today » via `getClinicDateString` mock), permissions per action, upload flow with mocked functions, the signed URL never cached beyond its use, settings dialogs.

**Commit:** `feat(professionals): Documents tab, required documents and consent versions`.

---

## Task 4c.4: Insurance expiry job and notices (lane A)

**Depends on:** 4c.1, 4c.2; Phase 3 Tasks 3.3 (jobs, `local_hour`), 3.4 (`_shared/jobs.ts`), 3.8 (`sendTemplatedEmail`), 3.13 (`_shared/notifications.ts`).

**Files:** `supabase/functions/professionals-insurance-expiry/{index.ts,handler.ts,handler.test.ts}`; migration `<ts>_professionals_insurance_expiry_job.sql` + `051_professionals_insurance_expiry_job.test.sql`: `scheduled_jobs` row `professionals.insurance_expiry_notice` (kind `function`, `function_name 'professionals-insurance-expiry'`, business job, **`local_hour 6` = 06:00 clinic time all year**, P3-22 / P4-45), its hourly `cron.schedule` calling `private.invoke_job_function`, as Task 3.3 does; `config.toml`.

- `verifyServiceRoleAuth`; for each org of `list_job_orgs('professionals.insurance_expiry_notice')` (job and module enabled, clinic hour 6): `start_job_run` (null → already ran this clinic day, skip), `requireModuleForOrg`, `today = clinic_today_for_org(org)`; `professionals_mark_expired_documents(org, today)`; `list_professionals_due_document_notices(org, today)` (one query); for each notice:
  - **J-7** (`reminder_days`): email `professionals.document_expiring` to the professional; notification kind `professionals.insurance_expiring` (4c.1);
  - **expiry day:** email `professionals.document_expired`; notification `professionals.insurance_expired`; **the professional stays active** (P4-1);
  - **weekly after** (when `weekly_after_expiry` and no newer valid insurance): email `professionals.document_expired_reminder` (no new notification: the expired one stays until it expires or a valid insurance is verified).
  Notifications dedupe on their key (4c.1); emails are skipped when `email_log` already holds the same template for the same subject on the same clinic date (one service-role check per batch, not per row). Sends go out in batches of 25 (`Promise.all` per batch). `finish_job_run` with counts only (no names or addresses). « Exécuter maintenant » runs through `run_scheduled_job_now` and the same dedupe, so it never double-sends.
- **Resolution:** verifying a new valid insurance expires the professional's open insurance notices (`private.expire_notifications`, 4c.2) and stops the reminders (no due notice any more).
- **Demandes contract (documented, not built):** `professionals_directory.insurance_status = 'expired'` → Demandes shows « Assurance expirée » in suggestions and asks for confirmation before assigning a **new** client (P4-1). Record it in `docs/modules/professionals.md` under « Ce que Demandes doit faire ».
- **Tests (Deno, fake clock and fakes):** date matrix (J-8, J-7, J-1, J, J+6, J+7, J+14, renewed on J+3); `start_job_run` null → nothing sent; dedupe on a manual re-run; module disabled → skipped; one org failing does not stop the others (its run is `error`, detail = code); no personal data in run details or reports.

**Commit:** `feat(functions): insurance expiry notices (J-7, expiry day, weekly) without deactivation`.

---

## Task 4c.5: Fiche PDF (download and email) (lane A + lane C)

> **Superseded in part by P4-58 (Jonathan, 2026-10-08): the fiche uses PS Hub's PDF base.** It is built with `@react-pdf/renderer` in the browser, like PS Hub's quotes, invoices and contracts (`NEW PS Hub/src/components/calculator/pdf/react-pdf/`): React page components (`<Document>` / `<Page>`), one `fonts.ts` that registers the font (Inter here, hyphenation off for French), a `loadImages.ts` that turns the logo and the photo (a signed URL from `storage-sign`) into data URLs, and a `generateFichePDF.ts` that maps the record to props and returns a Blob. The whole renderer is a lazy chunk loaded on « Fiche PDF » only, never on the entry path (`check:entry-chunk`). It does **not** use `_shared/pdf/` (pdfmake, ADR 0008), which stays for contracts, whose signing fields need fixed, server-side coordinates. Changes to the bullets below:
> - **Download:** generated and saved in the browser (« Fiche - Prénom Nom.pdf »); no edge function involved. `professionals.fiche_generated_at` is set by a small RPC.
> - **Email:** the browser renders the PDF, uploads it through the storage pipeline (purpose `professional_fiche`, PDF only, ≤ 10 MB, retained 1 day, view permission `professionals.view`), then `professionals-fiche` (action `email` only) checks the caller, the module, the professional and that the stored file is that upload, and sends `professionals.fiche` with it attached. The email goes out with the exact file the person saw.
> - **Data:** read with the caller's own client (`get_professional_record`, the catalogue, clinic identity and the « Honoraires » from Services et tarifs when enabled); the service-role data RPC is not needed.
> - **Tests:** Vitest renders the document (`@react-pdf/renderer`'s `renderToBuffer` / text extraction as PS Hub's `generateReactPDF.test.ts` does): glyphs é à ç « » ’, a long bio, many motifs (the motif-density rule: summarised per category, never a wall), two titles, no photo, no honoraires; plus the email function's gates.


**Depends on:** Phase 3 Tasks 3.29–3.30 (`_shared/pdf/`, P3-19), 3.8 (`sendTemplatedEmail` with attachments, P3-18), 3.24 (`stored_files`, `register_system_file` not needed: nothing is stored, P4-19).

**Files:** `supabase/functions/professionals-fiche/{index.ts,handler.ts,handler.test.ts}`, `supabase/functions/_shared/professionals-fiche.ts` (builds the `PdfDocument` blocks) + test; migration `<ts>_professionals_fiche.sql` + `052_professionals_fiche.test.sql` (`professionals.fiche_generated_at timestamptz`, email template `professionals.fiche` with **`recipient_mode 'free'` and `allows_attachments true`** (P3-18, P4-50), service-role `get_professional_fiche_data_for_service(p_id, p_title_id)` returning everything in one call, including the photo and logo `stored_files` ids for `loadAssets`); UI `components/record/FicheMenu.tsx` + test, `components/record/SendFicheDialog.tsx`; Modify `RecordHeader.tsx` (« Fiche PDF » outline), `PublicProfileTab.tsx` (« Aperçu de la fiche »).

- **Content** (A2.19, per profession title): logo and clinic identity from Settings (no hard-coded phone or URL), photo (newest verified), name + title, order and licence, bio + approach, motifs by category, clientèles, approaches, « Honoraires » from Services et tarifs when that module is enabled, else « À confirmer », clinic blurb from Settings. Rendered server-side with the one shared renderer (`_shared/pdf/`, `pdfRendererFromEnv`, P3-19): the fiche is a `PdfDocument` (no HTML), the photo and logo fetched in parallel by `loadAssets`; Inter embedded.
- **Function:** `verifyAuth(req, { module: 'professionals', permission: 'professionals.view' })` (conseillères send fiches after the discovery call); body `{ professional_id, title_id, action: 'download' | 'email', to?, message? }`; `download` returns the PDF (`Content-Disposition` with a safe file name « Fiche - Prénom Nom.pdf »); `email` sends `professionals.fiche` with the PDF attached to `to` (a free-recipient template: `_shared/email` enforces the PDF-only, ≤ 3 files, ≤ 10 MB and 20-per-user-per-hour rules of P3-18; logged in `email_log` with `subject_type = 'professional'`); sets `fiche_generated_at`. Only `active` professionals can be emailed (« Seuls les professionnels actifs peuvent être proposés. »). No copy kept (P4-19).
- **UI:** « Fiche PDF » menu: « Télécharger » / « Envoyer par courriel » (dialog: Courriel du client*, message optionnel, profession title select when 2 titles); from 4c the header's teal action is « Envoyer au client » when active (design §5.3).
- **Tests:** permission and module gate, inactive refusal, recipient validation and rate limit, no honoraires when Services et tarifs is off, attachment present (mocked transport), file name sanitised; UI dialog and download trigger.

**Commit:** `feat(professionals): fiche PDF generated server-side, download and email`.

---

## Task 4c.6: « Mes documents » (provider) (lane C)

**Files:** `pages/self/MyDocumentsPage.tsx` + test; `manifest.ts` (nav « Mes documents » `/mes-documents`, `professionals.self`); `fr-CA.json`.

- Required documents with status and expiry (date-only), « Téléverser » (purpose `professional_self_document`; insurance date prefilled with the next March 31), « Autres documents » read-only list; banner when insurance is expiring (« Votre assurance expire le {date}. Téléversez la nouvelle preuve dès que possible. ») or expired (« Votre assurance est expirée. Téléversez la nouvelle preuve pour continuer à recevoir de nouveaux clients. »).
- **Tests:** banners by date, upload attaches to own record only, no access to staff-only actions.

**Commit:** `feat(professionals): Mes documents for professionals`.

---

## Task 4c.7: 4c wrap-up

Same shape as 4b.7: all suites green; Playwright `e2e/documents.spec.ts` (adjointe uploads and verifies an insurance with a correction of the date; the job run « Exécuter maintenant » on a fixture expiring in 7 days produces the email in Mailpit and the bell notification); walkthrough (provider uploads renewed insurance; expired flag on list and directory); docs; review with the efficiency checklist (the job's single query, batch sends); report; no push without go-ahead.

---

# Batch 4d — Service contract (after Phase 3 Tasks 3.29–3.34; 3.24)

## Task 4d.0: Sync with Phase 3 signing

As 4b.0 for Phase 3 Tasks 3.29–3.34: `create_document_template` and the version RPCs (Task 3.31), `create_signature_request`, `list_subject_signature_requests` (P3-26), `_shared/signing.ts` `createSignatureRequest` (Task 3.33, input `CreateSignatureRequestInput`), `signing-webhook` transitions, `signing-sync`, the renderer's initials boxes (`header.initialsFor`, Task 3.30) and the 3.29 spike's finding on Documenso `INITIALS` fields (P4-17).

---

## Task 4d.1: Migration `professionals_contracts` (lane A)

**Files:** `supabase/migrations/<ts>_professionals_contracts.sql`, `supabase/tests/database/053_professionals_contracts.test.sql`.

- **Permission:** `professionals.contracts.send` (admin).
- **Template seed:** per org (trigger on organizations + existing orgs), through `create_document_template` semantics: `document_templates` row **`professionals.service_contract`** (P3-20) « Contrat de service » (module `professionals`, `view_permission 'professionals.view'`, `edit_permission 'professionals.settings'`) with a **draft** version: a `PdfDocument` body (headings, paragraphs, the Annexe A table, a `signaturePage`, `header.initialsFor: ['professional']`), `signers` (professional, then the optional clinic signer), French `email_subject` / `email_message` for Documenso, built from the legacy contract structure with variables (`{{clinic.*}}`, `{{professional.*}}` — `professional.email` = login email, A5.3 —, `{{today}}`, `{{pricing.annexe_a}}`) and a banner line « Texte à faire valider par la direction avant publication »; nothing is published by the migration (Mise en service item 11).
- **`get_professional_contract_variables_for_service(p_id uuid) returns jsonb`** (service role): clinic identity and signatory (Phase 2), professional identity and address (contract format A2.8), primary profession, order, licence, `today` (clinic date, long format), Annexe A rows from Services et tarifs (when enabled; otherwise the function refuses with « Les tarifs ne sont pas encore configurés. ») and the margins in force (`get_professional_compensation`): one row per category, 60 min couple / 50 min / 30 min / évaluation initiale, portion = price × (1 − margin) or the default range, wording « avant taxes » (P4-18), « Autres frais ».
- **Readiness:** `contract_ok` (latest `signature_requests` row for subject `professional` / purpose `professionals.service_contract` is `signed`; requests carry `view_permission 'professionals.view'`, so the security-invoker view can read them); `ready` requires it.
- **History:** `list_professional_history` also returns the professional's `signature_requests` / signers audit rows (by `subject_id`, joined once).
- **Tests:** variables (with and without Services et tarifs), Annexe A arithmetic on fixed prices and margins, readiness with each request status (rejected / expired / cancelled do not count, A10.9), permissions, isolation.

**Commit:** `feat(db): professional service contract template, variables and readiness`.

---

## Task 4d.2: Edge function `professionals-contract-send` (lane A)

**Files:** `supabase/functions/professionals-contract-send/index.ts` + test; `config.toml`.

- `verifyAuth(req, { module: 'professionals', permission: 'professionals.contracts.send' })`; body `{ professional_id, action: 'send' | 'regenerate', idempotency_key }`; reads the **published** version of `professionals.service_contract` (« Aucun modèle de contrat publié. » otherwise), the variables (service role), signers: the professional (login email), then the clinic signer from Settings « Signataire » when configured (optional second signer, A5.8); `regenerate` cancels the previous open request first (Phase 3 `cancel`); calls `createSignatureRequest({ orgId, moduleKey: 'professionals', purpose: 'professionals.service_contract', templateVersionId, subject: { type: 'professional', id }, title: 'Contrat de service — Prénom Nom', viewPermission: 'professionals.view', values, signers, idempotencyKey, sentBy })` (Task 3.33); Documenso sends the French signing email (P3-3), expiry from « Signature électronique » (default 7 days). Result codes `not_configured` / `missing_variable` / `provider_error` map to the P3-28 error codes and French UI texts.
- **Tests:** permission/module gate, no published template, idempotency (double click → one request), regenerate cancels then creates, second signer optional, variables never from the body.

**Commit:** `feat(functions): send and regenerate the professional service contract`.

---

## Task 4d.3: Contract card and « Contrats » settings (lanes C and B)

**Files:** `components/record/ContractCard.tsx` + test; `pages/settings/ContractsSettingsPage.tsx` + test, `components/settings/TemplateEditor.tsx` (+ preview, variables cheat-sheet) + test; `manifest.ts` (section `contracts` → `contrats`, visible `professionals.manage`, edit `professionals.settings`); `fr-CA.json`.

- **Contract card** (top of Documents; A5.1, A10.9): states « Aucun contrat » [Préparer et envoyer], « Envoyé le … » / « Consulté le … » [Synchroniser · Renvoyer · Régénérer], « Signé le … » [Voir le PDF signé · Journal de signature], « Refusé : {raison} » / « Expiré » / « Annulé » [Régénérer]; signers with their progress; version of the template. Statuses come from `list_subject_signature_requests('professional', id)` (P3-26); « Synchroniser » calls Phase 3 `signing-sync`. Signed PDF through a 5-min signed read URL (P3-20).
- **« Contrats » settings** (A5.7; Phase 3 builds the tables and RPCs, the UI is owed to 4d): templates with key prefix `professionals.` (`list_document_templates('professionals')`); filters (statut), search; editor: title, body (structured markup accepted by the renderer), variables cheat-sheet with French labels, live preview (sample values, sandboxed iframe), draft / published / archived, « Publier » (confirm: « Les prochains contrats utiliseront cette version. »), « Nouvelle version »; « Signataire de la clinique » (optional, from Settings « Signataire », with a link to it).
- **Initials (P4-17):** on by default (`header.initialsFor`); when the Task 3.29 spike found per-page initials unsupported by the clinic's Documenso, the editor shows « Signature et date seulement » and 4d.4 lists the Drop for approval.
- **Tests:** card states and actions per status and permission; editor publish flow; preview iframe `sandbox=""`; read-only for the adjointe.

**Commit:** `feat(professionals): contract card and contract templates settings`.

---

## Task 4d.4: Phase 4 wrap-up

**Step 1: Documentation.** `docs/modules/professionals.md` (complete: objects by batch, published contract, jobs, templates, permissions, « Écarts par rapport à PS Hub », « Ce que Demandes doit faire »); `CLAUDE.md` (§1 built so far, §4, §7 the module's functions, §8 any new frontend rule); `docs/plans/2026-10-06-legacy-feature-inventory.md` §A fully ticked or pointed (Services tab → Services et tarifs, Calendrier → Rendez-vous); `docs/plans/2026-10-07-status.md` rewritten for Phase 4; ADR 0004 status line (« professional_private built »); if initials are unsupported, the Drop « initiales par page » listed for Jonathan.

**Step 2: Full checks.**
```bash
npm run typecheck && npm run lint && npm run lint:supabase && npm run test:run && npm run build
npm run check:functions && npm run lint:functions && npm run test:functions
scripts/with-db-lock.sh bash -c 'npm run db:reset && npm run db:test && supabase db reset --no-seed && supabase test db && npm run db:reset && npm run e2e'
BASE_REF=origin/main npm run lint:migrations
```
Expected: all green, no type drift.

**Step 3: Browser walkthrough** (four accounts, desktop and 375 px, Mailpit, Documenso mock): the full lifecycle — create → invite → accept → questionnaire → review/apply → documents verified → contract sent and signed (mock webhook) → readiness complete → « Activer » without override → fiche emailed to a test address → insurance expiring (fixture date) → J-7 email and bell → expiry day flag, still active → renewed insurance verified → flag cleared. Denials with the conseillère and the provider. Module off → everything disappears, jobs skip the org.

**Step 4: Final review.** `superpowers:code-reviewer` on the whole Phase 4 diff against `main` with the design, this plan and the efficiency checklist; fix and re-review.

**Step 5: Report to Jonathan** with screenshots, then the « Mise en service » list below; ask separately for push, PR and merge.

---

# Mise en service (Jonathan)

Nothing below is done by the executor. Each item needs Jonathan (or Christine, or the accountant) and is reversible unless said otherwise.

1. **Review the adopted decisions** P4-1…P4-50 and the Drops D1–D7 (P4-22…P4-28); reverse any in chat, the task named in the decision changes.
2. **Accountant:** is the SIN needed (T4A / relevé)? If yes, an admin turns on « Recueillir le NAS » in Paramètres → Rémunération (P4-7). Confirm « avant taxes » on Annexe A (P4-18). Confirm how the 25 % cap of the recognition program applies, then set « Base du plafond » (P4-8); amounts stay uncomputed until then.
3. **Profession list and orders:** confirm the 9 titles and 6 orders (P4-6); adjust in Paramètres → Professions et ordres if needed.
4. **Motif list:** keep legacy-v1 (seeded) or adopt v2 from the untracked `20260207000001_motifs_v2_categories_and_items.sql` (Q21 section). If v2: say so, and a follow-up migration applies it with the soft-delete strategy, non-diagnostic category names and an extended icon set.
5. **Before any real SIN or bank number is entered on staging** (ADR 0004, 4a.16): export `pii_encryption_key` to the clinic's password manager following `docs/runbooks/pii-key-escrow.md`; run the staging logging check (SQL in 4a.16 step 4) and confirm the expected values.
6. **Import:** provide the CSV of the ~50 professionals (format in `docs/runbooks/import-professionals.md`); give the go-ahead for the staging dry run, review the report, then the go-ahead for `--commit`, run by you (the script asks for your own login). Then spot-check five records.
7. **Phase 3 prerequisites on staging** (the Phase 3 plan's « Mise en service ») before the 4b–4d smoke tests: Resend key and webhook, storage buckets deployed, Documenso instance, API token and webhook secret, `pg_net` Vault secrets (`project_url`, `internal_function_secret`), `APP_URL`. Then enable the business jobs `professionals.insurance_expiry_notice` and `professionals.invitation_reminders` in « Tâches planifiées » (business jobs start disabled, Task 3.3).
8. **Push / PR / merge** go-aheads, separately: the 4a PR; later the 4b–4d PR(s). Merging deploys the migrations to staging.
9. **Staging smoke tests** after each merge (the walkthrough of the batch, with your admin account and a test professional address you control).
10. **Enable the module on staging:** Paramètres → Modules → « Professionnels » (it starts disabled in every clinic).
11. **Contract template:** Christine validates the text of « Contrat de service » and publishes it (Paramètres → Contrats); configure the clinic signer email (Signataire) if a second signature is wanted.
12. **Consent text:** Christine confirms version 1 of « Consentement au droit à l'image » (Paramètres → Consentements).
13. **Loi 25:** Christine (privacy officer) acknowledges the new personal data held for professionals (bank, possibly SIN) and the processors (Resend, Documenso host) in the EFVP and the privacy policy.
14. **Untracked legacy migrations in the main checkout** (`supabase/migrations/20260207000001_…`, `…000003_…`): move them out of `supabase/migrations/` (for example into `_legacy/wip/`) or delete them; a `supabase db reset` run from the main checkout would apply them and fail against the rebuilt schema. Not done by this plan.
15. **Initials on contract pages:** if the Task 3.29 spike shows the clinic's Documenso cannot take per-page initials, approve the Drop « signature et date seulement » (P4-17).

---

# Task index

| Task | One line | Lane | Needs |
|---|---|---|---|
| 4a.0 | Branch, DB lock script, shared field schemas, `useShellCrumb`, time-zone remount, Playwright | coordinator | Task 2.20 merged |
| 4a.1 | Migration: 7 permissions + defaults, 9 per-clinic reference lists, seeding trigger | A | 4a.0 |
| 4a.2 | Migration: settings RPCs (save, archive, reorder), catalogue RPC and views, module settings | A | 4a.1 |
| 4a.3 | Migration: professionals + 1:1 tables, professions, junctions, set RPCs, provider link, email sync | A | 4a.2 |
| 4a.4 | Migration: readiness, activate/deactivate, list and directory views, record and history RPCs, perf probe | A | 4a.3 |
| 4a.5 | Frontend foundation: types, API, hooks, schemas, lib, manifest | coordinator | 4a.4 |
| 4a.6 | Settings pattern `ReferenceListCard`, Langues, Raisons de désactivation | B | 4a.5 |
| 4a.7 | Settings: Professions et ordres | B | 4a.6 |
| 4a.8 | Settings: Spécialités (clientèles, approches) | B | 4a.6 |
| 4a.9 | Settings: Motifs with categories and restricted switch | B | 4a.6 |
| 4a.10 | List with URL filters and creation dialog | C | 4a.5 |
| 4a.11 | Record shell (URL tabs, header) and Aperçu | C | 4a.10 |
| 4a.12 | Jumelage tab with batch-save pickers | C | 4a.11 |
| 4a.13 | Profil public and Identité et permis tabs | C | 4a.11 |
| 4a.14 | Activation (readiness, override) and deactivation (reasons) | C | 4a.11 |
| 4a.15 | Historique tab | C | 4a.11 |
| 4a.16 | ADR 0004 « Before Phase 4 »: key versions, canary, deploy health check, runbooks (blocking 4a.17) | D (+A) | 4a.0 |
| 4a.17 | Migration: encrypted private data with audited reveal, compensation and recognition terms | A | 4a.4, 4a.16 |
| 4a.18 | Rémunération et fiscalité tab, Rémunération settings, NAS switch | C + B | 4a.17 |
| 4a.19 | Import RPC with dry run and CSV script (staging run = Jonathan's go-ahead) | A + D | 4a.4 |
| 4a.20 | Seed, Playwright path, docs, decisions log, walkthrough, final review | coordinator | all 4a |
| 4b.0 | Merge Phase 3, confirm names and the `accept_rpc` contract | coordinator | 3.1–3.8, 3.10, 3.12–3.13, 3.17–3.21 |
| 4b.1 | Migration: invitation, submissions (+ encrypted private), consents, review and apply | A | 4b.0 |
| 4b.2 | Functions: invite / update request, submit notice, reminders job (08:00 clinic); `redirect` pass-through in `accept-invite` | A | 4b.1, 3.2–3.4, 3.8, 3.13, 3.19–3.21 |
| 4b.3 | Staff UI: invitations, readiness items, Invitations settings, Courriels in Historique | C + B | 4b.2 |
| 4b.4 | Provider questionnaire with server autosave, staged uploads | C | 4b.2 (+ 3.24–3.27 for uploads) |
| 4b.5 | Review sheet with field-by-field apply; Mon profil | C | 4b.4 |
| 4b.6 | Deactivation ends the provider's sessions | A | 4b.1, 3.20 |
| 4b.7 | 4b wrap-up (Playwright with Mailpit, docs, review) | coordinator | 4b.* |
| 4c.0 | Merge Phase 3 storage and renderer, confirm names | coordinator | 3.24–3.27, 3.29–3.30 |
| 4c.1 | Notification kinds for submissions, documents and insurance (notifications are Phase 3) | A | 3.12–3.13 |
| 4c.2 | Migration: document types, documents, expiry rules, readiness, directory insurance status | A | 4c.0 |
| 4c.3 | Documents tab, Documents requis and Consentements settings | C + B | 4c.2 |
| 4c.4 | Insurance expiry job at 06:00 clinic time: J-7, expiry day, weekly; no deactivation | A | 4c.1, 4c.2, 3.3–3.4, 3.8 |
| 4c.5 | Fiche PDF with the shared renderer: download and email (free-recipient template) | A + C | 4c.2, 3.8, 3.29–3.30 |
| 4c.6 | Mes documents for professionals | C | 4c.3 |
| 4c.7 | 4c wrap-up | coordinator | 4c.* |
| 4d.0 | Merge Phase 3 signing, confirm initials support | coordinator | 3.29–3.34 |
| 4d.1 | Migration: contract template seed, variables (Annexe A), readiness | A | 4d.0 |
| 4d.2 | Function: send / regenerate contract | A | 4d.1 |
| 4d.3 | Contract card and Contrats settings (template editor) | C + B | 4d.2 |
| 4d.4 | Phase 4 wrap-up: docs, full checks, lifecycle walkthrough, final review | coordinator | all |
