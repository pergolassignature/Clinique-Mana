# Phase 4 — Professionnels: design

**Date:** 2026-10-08 · **Status:** Draft for Jonathan's review (nothing built) · **Branch:** `feat/phase-2-core-settings`
**Builds on:** [foundation design §5–7](2026-10-06-foundation-rebuild-design.md#5-module-1--professionnels), [legacy inventory §A](2026-10-06-legacy-feature-inventory.md#a-professionnels-incl-onboarding-documents-contrats-spécialités-motifs), [decisions log](2026-10-07-decisions-log.md) (#1–40), [Phase 2 design](2026-10-07-phase-2-core-settings-design.md), [database conventions](../standards/database-conventions.md), [ADR 0004](../adr/0004-secrets-in-vault.md), [ADR 0005](../adr/0005-documenso-replaces-docuseal.md), [business context](../standards/business-context.md) (incl. « Product notes from Jonathan (2026-10-07) »), [design system](../design-system/README.md) §4–5.

Where this document and foundation design §5 differ, this document is the proposal. Once Jonathan approves it, it replaces §5.

---

## 1. Context and goals

MANA is a dispatch clinic. Conseillères take every request and match the client with one of ~50 independent professionals. **Matching is the heart of the app** (Jonathan, 2026-10-07), and Professionnels is the module that holds what matching needs:
- motifs;
- spécialités;
- clientèles;
- languages;
- general availability;
- whether the professional is insured and ready to take clients.

Every later module reads the professional through what this module publishes:
- Services et tarifs: services per profession title;
- Clients: the primary professional;
- Demandes: matching;
- Rendez-vous: the agenda;
- Facturation: receipts with order and licence.

**Goals**
1. The bank of professionals as clean, curated data. Motifs, spécialités, clientèles and languages are first-class and stable, so Demandes can match on them.
2. A professional record designed for its readers. Conseillères read it to match. The adjointe uses it for onboarding and compliance. The admin uses it for compensation.
3. The whole professional lifecycle: creation → invitation → questionnaire → review → documents → contract → activation, with soft insurance expiry.
4. Phase 1–2 patterns, unchanged:
   - `org_id` on every table;
   - RLS through `has_permission`;
   - RPC writes;
   - audit;
   - encrypted private data (ADR 0004);
   - settings sections;
   - `useSettingsForm` / `FormActions` cards.

**Non-goals:** recruitment (outside the app, business context §5), the agenda and availability slots (Rendez-vous), prices (Services et tarifs), the matching algorithm itself (Demandes), clinical notes (D8).

### Phasing

| Batch | Content | Needs |
|---|---|---|
| **4a** | Data model, reference data and their settings sections, list, creation, record (identity, professions/licences, specialties, clientèles, motifs, languages, general availability, public profile), lifecycle with manual activation/deactivation, Rémunération et fiscalité, history | Phase 2 only. **Independent of Phase 3.** |
| **4b** | Invitation, account creation on acceptance, onboarding questionnaire, profile-update requests, review (diff + apply), « Mon profil » | Phase 3: emails, secure links, accept-invite |
| **4c** | Documents (required + others), review, expiry rules, insurance notices (J-7, expiry day), fiche PDF (download + email), « Mes documents », the first cron job | Phase 3: storage, emails, notifications, cron |
| **4d** | Service contract through Documenso (Annexe A from compensation), contract templates section, full readiness checklist | Phase 3: signing |

**4a on its own is useful.** Staff can enter the existing ~50 professionals with their full matching profile, and conseillères get a filterable directory (« who works with adolescents, in English, on anxiety? »). Demandes does not exist yet.

---

## 2. Keep / Change / Drop (inventory §A)

**Keep** = same behaviour. **Change** = behaviour changes on purpose; the reason is given. **Drop** = removed; needs Jonathan's OK (list in §2.1). The « Phase » column says where the item lands. Visual layout is free to change (inventory, « How to use »).

### A1. List & creation

| # | Item | Mark | Phase | Reason / how |
|---|---|---|---|---|
| A1.1 | Card grid (initials, name, status, email, specialty and document counts, pending invitation flag) | Change | 4a | A dense table, as in the design system. Same information: profession and licence, languages, status, « À surveiller » (invitation pending, file to review, insurance). The document count arrives in 4c. |
| A1.2 | Search name/email, status filter, empty state with reset | Keep + Change | 4a | Kept. Added filters: profession, langue, clientèle, motif, « Accepte de nouveaux clients », « À surveiller ». Filtering works on a flat list row (§3.8), which fixes A10.6. |
| A1.3 | « Ajouter un professionnel » (name, email, invite checkbox, duplicate check, admin/staff) | Change | 4a / 4b | Separate Prénom* and Nom* fields (sorting, contracts, fiche). Email is trimmed and lowercased. The duplicate check runs against the clinic's professionals and all profiles (« Ce courriel est déjà utilisé »). Profession is optional. Needs `professionals.manage`. The « Envoyer l'invitation » checkbox appears with 4b. |
| A1.4 | `create-professional` edge function (auth user, profile, professional, invite, rollback) | Change | 4a / 4b | RPC `create_professional` creates only the professional (`draft`). The auth user and profile are created when the invitation is accepted (4b, design §2). No random password and no `listUsers()`. |

### A2. Detail page

| # | Item | Mark | Phase | Reason / how |
|---|---|---|---|---|
| A2.1 | Header: photo, status, email, titles « • », activate/deactivate with confirm | Keep + Change | 4a / 4c | Kept. The photo is the newest verified photo (4c), with initials until then. Activation goes through the readiness checklist (fixes A10.1). |
| A2.2 | Tabs Aperçu, Profil, Profil public, Services, Documents, Calendrier, Historique | Change | 4a | Rethought layout (§5.3). « Services » moves to Services et tarifs, « Calendrier » to Rendez-vous. |
| A2.3 | « À compléter » alerts with jump buttons (bio/approach, specialties, missing or expired documents; error when > 2) | Keep, generalised | 4a / 4c | Shown in Aperçu as « À compléter » and « À surveiller ». Each alert links to its tab (`/professionnels/:id/<onglet>`). The document thresholds are kept in 4c. |
| A2.4 | Quick actions: fiche PDF, send or renew the form, copy link, request an update, view submission, manage documents, activate/deactivate | Keep, by phase | 4a–4c | Activate/deactivate in 4a. Form, new link and update request in 4b. Fiche and documents in 4c. « Copier le lien » only right after creation: tokens are stored hashed (see Drop D6). |
| A2.5 | Steps Formulaire → Documents → Activation; form state precedence (approved > reviewed > submitted > opened > sent > expired/revoked > « à envoyer ») | Change | 4a–4d | Becomes the readiness checklist (§3.4). Invitation states come from `secure_links` (sent, opened, used, expired, revoked) with the same precedence. A pending link past its expiry shows as expired. |
| A2.6 | Activation blockers (form not approved, each missing/expired document, contract not signed), `canActivate`, completion % | Change | 4a | Activation is allowed from **any** non-active status once the checklist is complete. An admin can override, with a written reason (audited). Completion % = items done / items available in the current phase. Fixes A10.1 (the header could reactivate without checking blockers). |
| A2.7 | Inline edit (Enter saves, Esc cancels): personal phone E.164, years of experience, IVAC number (empty = delete, unique, one per professional); login email read-only | Change | 4a | Same fields and rules, in cards with « Annuler / Enregistrer » (Phase 2 pattern, decision #34) instead of inline editing. The IVAC number is unique **per clinic**: a check across clinics would reveal other orgs' data. It is written with `professionals.manage` (legacy: admin only), since the adjointe handles IVAC billing. See Q14. |
| A2.8 | Address with Google Places autocomplete + manual fields, 13 provinces, Canada; multi-line format | Change | 4a | The same columns and rules as Identité légale: `address_line1/2`, city, province (default QC, decision #38), normalised postal code. The contract format is kept. Places autocomplete comes later (Q12). |
| A2.9 | Professions editor: max 2, title + licence required, first is primary, set primary, edit licence, remove | Keep + Change | 4a | Max 2 and exactly one primary, both **enforced in the database**. Removing the primary promotes the other one (fixes the legacy bug). A licence is required only when the title belongs to a professional order (Q6). Services per title belong to Services et tarifs (FK to the profession row). |
| A2.10 | Dates card: created, updated, questionnaire submitted, fiche generated (never written) | Keep | 4a–4c | `fiche_generated_at` is actually written (4c). |
| A2.11 | Profil public: bio, approche, public email, public phone (empty → null) | Keep | 4a | Editable even when empty (fixes A10.7). |
| A2.12 | Specialties drawer: accordion per category, search + highlight, expand/collapse all, immediate add/remove, star = `is_specialized`, counts, specialized first then A–Z | Keep + Change | 4a | All kept. **Clientèles become their own list** (Q3), and the drawer shows « Clientèles » and « Approches » sections. Changes save in one batch (« Annuler / Enregistrer » in the sheet, one transaction, one audit set) instead of on every checkbox. |
| A2.13 | Motifs drawer grouped by active categories in display order + « Autres », icon per category | Keep | 4a | Same batch save as A2.12. |
| A2.14 | Questionnaire review card: « ce qui sera remplacé », « Appliquer au profil » | Change | 4b | A field-by-field diff (submitted vs current), applied all at once or field by field, **in one transaction** (fixes « not transactional »). |
| A2.15 | Provenance banner + « Voir la soumission originale » (all answers, raw JSON toggle) | Keep + Drop (part) | 4b | The readable submission view is kept. The raw JSON toggle goes (D5). |
| A2.16 | Apply mapping (bio, approach, contact, years, professions, specialties by code, motifs by key, approved + reviewer, audit; not applied: education, languages, availability notes, consent, name) | Change | 4b | Same mapping, plus languages and the general availability (now collected). Consent goes to `professional_consents`. Education is still not collected (Q15). |
| A2.17 | Services tab per profession title | Change (moved) | Services et tarifs | That module adds `professional_services` and the tab (foundation design §5.2 integration points). |
| A2.18 | Historique: timeline by date, relative time, actor or « Système », short event id, expandable JSON, colour per action, FR labels for 24 actions | Keep + Change | 4a | Read from core `audit_log` through `list_professional_history` (§3.9), with readable before/after values as in the Journal d'audit. Every change is audited now, including motifs, professions and languages. The raw JSON and UUID copy buttons go (D5). |
| A2.19 | Fiche PDF per profession title (logo, photo, name + title, licence, bio + approach, motifs by category, clientèles, honoraires, clinic blurb; phone hardcoded) | Keep + Change | 4c | Same content. Generated **server-side**. Clinic identity comes from Settings (no hardcoded phone or URL). Honoraires come from Services et tarifs, « À confirmer » until that module is enabled. « Télécharger » and « Envoyer par courriel ». |

### A3. Onboarding invite & questionnaire (4b)

| # | Item | Mark | Reason / how |
|---|---|---|---|
| A3.1 | Invite types `onboarding` / `update_request` (any of 8 sections, prefill, parent invite), 7-day expiry | Keep + Change | Both kept. A link is a `secure_link` (purpose `professional_invite` / `profile_update`); the requested sections live in its `scope`. The expiry is configurable (« Invitations », default 7 days). |
| A3.2 | Load order (invalid, already submitted, expired, revoked, completed, draft restore, opened) | Keep + Change | Same states and messages. The link is resolved by an edge function; anon reads no table (fixes the listable tokens and A10.4). |
| A3.3 | Steps: personnel, professionnel, portrait, spécialités, motifs, photo, assurance, consentement, révision | Change | Added: **langues**, **clientèles** (own step), **disponibilités générales**, **fiscalité et banque** (foundation design §5.4). Update requests still skip unrequested sections; review is always reachable. |
| A3.4 | Field rules (name/email read-only; ≤ 2 titles with licence; years 0–50; bio required; photo JPEG/PNG ≤ 5 MB required; insurance PDF/JPEG/PNG ≤ 10 MB required; consent required) | Keep | The licence rule follows Q6. |
| A3.5 | Consent « droit à l'image » v1 (12 months auto-renew, 3-month withdrawal notice, « j'ai lu » + typed name) | Keep | Stored in `professional_consents` (version, signer, `signed_at`). |
| A3.6 | Saving: localStorage at once + server draft after 2.5 s idle, on « Continuer », manual, retry | Keep + Drop (part) | Server autosave kept. The browser copy goes (D4): the questionnaire now holds SIN and bank data, and PCs may be shared. |
| A3.7 | Uploads straight to storage + `professional_documents`; file removed if the insert fails; update-request uploads create documents before submit | Change | Uploads are attached to the submission and become profile documents only when approved (fixes the leak). Storage paths follow core §4.5. |

### A4. Documents & insurance (4c)

| # | Item | Mark | Reason / how |
|---|---|---|---|
| A4.1 | Types cv, diploma, license, insurance, photo, fiche, other (+ `service_contract`) | Change | A `document_types` table (settings « Documents requis »), seeded cv, diplôme, attestation de permis, assurance, photo, autre. The contract is a signing request (4d). `fiche` goes (D2). |
| A4.2 | Required: photo (no expiry), insurance (next March 31, auto-set and locked), consent (12 months), contract (4th) | Keep + Change | Rules move to `document_types.expiry_rule` (`none`, `next_march_31`, `months:12`). The insurance date defaults to the next March 31 and can be corrected by a reviewer (Q2). Expiry is a `date`, the last valid day (see A4.4). |
| A4.3 | Status per type (newest doc): missing → expired → verified → pending; completeness = verified / 3 | Keep + Change | Same precedence. Explicit `status` (pending / verified / rejected / expired) with a rejection reason that is emailed. |
| A4.4 | Documents tab: summary, required cards, upload, preview/download (1 h signed URL), verify/unverify, edit expiry, replace, delete; e-consent signer; « Autres documents »; 10 MB; pdf/doc/docx/jpg/png/webp; expiry stored `…T23:59:59.999Z` | Keep + Change | All actions kept, plus a general upload for CV, diplôme and autre (fixes A10.7). Delete needs `professionals.documents.delete` and is hidden without it. Expiry becomes a `date`: the legacy UTC end-of-day meant 19:59 in Québec. |
| A4.5 | `deactivate_professionals_with_expired_insurance()` daily + automatic reactivation trigger | **Change (approved by Jonathan, 2026-10-07)** | No automatic deactivation or reactivation. Email 7 days before, important in-app notification, and a defined expiry-day behaviour (§3.4). The job's schedule lives in a migration and shows in « Tâches planifiées ». |

### A5. Contracts (4d)

| # | Item | Mark | Reason / how |
|---|---|---|---|
| A5.1 | Contract card: none → generate and send; sent → sync / view / regenerate; signed → preview, PDF, signature log; version, dates, signers | Keep + Change | Same states and actions, read from core `signature_requests`, including rejected, expired and cancelled (fixes A10.9). « Régénérer » cancels the previous request. |
| A5.2 | Generation: published template + professional and pricing snapshots → render `{{path}}` → send, initials per page, 7-day expiry, FR email → `sent` + `render_data` | Keep + Change | Rendered server-side by `signing-create` and sent through Documenso. Initials on every page are kept if Documenso supports them as DocuSeal did (Q17). |
| A5.3 | Variables `clinic.*`, `professional.*` (email = public email), `today`, `pricing.annexe_a_html` | Keep + Change | Same variables. Clinic values come from Phase 2 Settings (identity, signatory). `professional.email` becomes the login email: a contract goes to the person, not to the public contact. |
| A5.4 | Annexe A: one row per category; 60 min couple, 50 min, 30 min, évaluation initiale; portion = price × (1 − 30 %) to × (1 − 25 %); « Autres frais » | Keep + Change | Same table. The portion uses the professional's own margin (§3.6) when one is set, the default range otherwise. Prices come from Services et tarifs. The « taxes incluses » wording is fixed (open item in foundation design §8, Q18). |
| A5.5 | Margin model (consultation 25–30 %, ateliers 25 %, late cancellation 30 %, other fees 15 %); bonus rates defined, unused | Change | Dated defaults in settings « Rémunération » and a per-professional margin history (4a data). The bonus rates become the **programme de reconnaissance** (§3.6). |
| A5.6 | Completion: re-fetch, all signers done, store signed PDF + audit log PDF, `signed`; manual sync | Keep | Done by the core signing webhook (ADR 0005). « Synchroniser » is kept as a fallback. |
| A5.7 | Templates admin (filters, search, create with immutable key, content/preview/variables, draft/published/archived, publish and new-version RPCs, one published per key, admin write, staff read) | Keep (moved to core signing) | Built in Phase 3 `core/signing`. The module's « Contrats » section shows the templates whose key starts with `professional.`. |
| A5.8 | Signature block: static clinic representative + `{{today}}`; professional's city, signature, date | Change | The clinic signer comes from Settings « Signataire » and is an optional second signer (fixes « clinic signer always null »). The professional's fields are kept. |

### A6–A7. Spécialités, motifs (4a, settings)

| # | Item | Mark | Reason / how |
|---|---|---|---|
| A6.1 | Spécialités: filter active/archived/all + counts, by category or flat A–Z, search, create (name, code, category), archive with « N professionnels utilisent », restore | Keep + Change | All kept. The key is generated from the name and immutable (fixes A10.5, where the code was checked before normalisation). Clientèles get their own card (Q3). |
| A6.2 | Categories `therapy_type`, `clientele`; clientèle keys stable for matching; codes unique; add/remove audited with name and star | Keep + Change | Keys `children`, `adolescents`, `adults`, `seniors`, `couples`, `families`, `groups` stay stable and immutable. Clientèles carry age bounds, so matching no longer hardcodes ≤ 12 / ≤ 17 / ≤ 64. (The inventory's « 1, 2, 3, 4, 5, 5, 6 » are legacy `sort_order` values, where `groups` and `couples` collide at 5. They are not codes.) |
| A7.1 | Motifs: filter active/archived/all, category filter, grouped or flat, search | Keep | — |
| A7.2 | Create (label, snake_case key ≤ 50 chars, unique, optional category), archive, restore, change category | Keep + Change | The label becomes editable; the key stays immutable (fixes A10.10). |
| A7.3 | Categories drawer (label, key, description, one of 20 icons, archive with count, restore); seed of 72 motifs and 8 categories; no hard delete | Keep + Change | Categories can be reordered. Motifs of an archived category show under « Autres » (fixes A10.10). |
| A7.4 | `is_restricted` motif flag (enforced only in one picker, no UI) | Change | Its legacy meaning, « only licensed professionals can select this motif », is kept and enforced in `set_professional_motifs`: a restricted motif needs a regulated profession. A switch in settings sets it (Q16). |

### A8–A10

| # | Item | Mark | Phase | Reason / how |
|---|---|---|---|---|
| A8.1 | Google Calendar per professional (connect, sync, reconnect, disconnect) | Change (moved) | Rendez-vous | As planned in the inventory. That module adds the « Calendrier » tab. |
| A9.1 | Audit actions (professionals, documents, invites, submissions, specialties; not motifs, professions, services) | Change | 4a–4d | Generic `audit_log` on every table, so motifs, professions, languages and compensation are audited too. History labels in French. |
| A9.2 | `professionals` fields (profile_id, status, deactivation_reason, portrait, public contact, phone, license_number dup, years, address, fiche_generated_at, fiche_version) | Keep + Change + Drop (part) | 4a | Kept, split over the tables of §3.3. The deactivation reason becomes a reference table plus a note (fixes A10.8). `license_number` and `fiche_version` go (D1, D2). |
| A9.3 | Permissions: admin/staff manage all, provider reads/updates own, only admin deletes documents | Change | 4a | The permission catalogue of §4. The provider's own record is reached through `current_professional_id()` + `professionals.self`. The UI hides what the database refuses. |
| A10.1 | `invited` can't be activated; header reactivates without checks | Change (fix) | 4a | §3.4. |
| A10.2 | No invite email ever sent | Change (fix) | 4b | Phase 3 email, logged in `email_log`. |
| A10.3 | Calendar functions and DocuSeal webhook unprotected; OAuth state unsigned | Change (fix) | 4d / Rendez-vous | `verifyAuth` / signature check (CLAUDE.md §7). |
| A10.4 | Anon grants missing for questionnaire reads | Change (fix) | 4b | No anon grants at all; edge functions resolve links. |
| A10.5 | Specialties page crash (grouped archived view); uniqueness before normalisation | Change (fix) | 4a | — |
| A10.6 | List search on embedded columns; `specialty_ids` filter unused | Change (fix) | 4a | Flat list row, client-side filters (§5.1). |
| A10.7 | Profil public uneditable when empty; « reviewed » never set; no general upload; staff see a delete they can't do | Change (fix) | 4a / 4b / 4c | — |
| A10.8 | Manual deactivation never writes a reason | Change (fix) | 4a | A reason is required in the database. |
| A10.9 | Contract `generated` has no actions; declined/expired ignored; clinic signer null; « taxes incluses » | Change (fix) | 4d | — |
| A10.10 | Motifs of archived categories vanish; categories not reorderable; labels not editable | Change (fix) | 4a | — |
| A10.11 | `education`, `languages`, `availability_notes` never collected → languages needed | Change | 4a / 4b | Languages and general availability are first-class (§3.3). Education: Q15. |

### Items from inventory B–E that touch professionals

| Item | Mark | How Professionnels serves it |
|---|---|---|
| B: `clients.primary_professional_id`; a provider reads clients whose primary professional is theirs | Keep | FK to `professionals.id`; `private.current_professional_id()` is published for other modules' policies (§3.8). |
| C: `demandes.assigned_professional_id`; a provider reads demandes assigned to them | Keep | Same helper. |
| C: motif keys hardcoded (12) in the demande picker | Change (fix) | Demandes reads the motifs list from this module (§6). |
| D: matcher candidates = active professionals with professions, specialties, motifs, services; hard clientèle filter by age / demand type; motif score; availability | Keep (data) | `professionals_directory` (§3.8, §6). |
| D: dormant scorer uses years of experience and profession fit | Keep (data) | Exposed in the directory; Demandes decides. |
| E: professional selector (active pros), profession category per appointment | Keep (data) | Directory + professions. |
| F: receipts need name, profession, order, licence; preview used `professions[0]` instead of the primary | Keep + fix | The directory exposes the primary profession explicitly, with order and licence. |

### 2.1 À approuver par Jonathan (proposed Drops)

| # | Drop | Why | Risk |
|---|---|---|---|
| D1 | Column `professionals.license_number` (a legacy duplicate) | The licence lives only on the profession row (one per title). Two sources drifted in legacy. | None: no real data (staging was reset). |
| D2 | Column `fiche_version` and the `fiche` document type | Fiches are generated on demand from current data, never uploaded. Each email send is logged in `email_log`; `fiche_generated_at` is kept. | A fiche sent last month cannot be re-downloaded as it was. If that matters, store a copy with each email (Q19). |
| D3 | Column `professional_specialties.proficiency_level` (primary / secondary / familiar) | Legacy schema only, never used: the « spécialisé » star replaced it. | None. |
| D4 | Browser (localStorage) copy of the questionnaire draft | The questionnaire now holds SIN and bank details, and PCs may be shared. Server autosave every few seconds remains. | A draft typed while offline is lost if the tab closes before the server save; the page warns when saving fails. |
| D5 | Raw JSON views: expandable JSON with shortened UUIDs and copy buttons (Historique), raw-JSON toggle (original submission) | Replaced by readable before/after values, as in the Journal d'audit. They were debugging tools. | Developers read `audit_log` directly. |
| D6 | « Copier le lien » at any time | Tokens are stored hashed (secure links): the link exists only when it is created. The copy button stays on the creation confirmation; later, « Nouveau lien ». | None: the invitation is emailed now (A10.2). |
| D7 | Not re-seeding reference data that legacy had already archived: specialty categories `issue` / `modality` and their rows, clientèles `lgbtq`, `indigenous`, `newcomers` | Archived in legacy; issues are covered by motifs; the clinic is online only, so `modality` does not apply. They can be re-added in settings if wanted. | None: staging holds no real data. |

---

## 3. Data model (proposal)

### 3.1 Principles

All conventions apply:
- `org_id` and audit trigger on every table;
- revoke all, then `select` plus column `update` grants only;
- RLS with a `has_permission` term on every policy (the module gate);
- inserts, deletes and checked writes through `security definer` RPCs that check permissions first;
- French `P0001` messages;
- FK indexes;
- soft delete (`is_active`) for reference data;
- lookup tables rather than enums;
- `[0-9]`, never `\d`.

Reference lists are **per clinic** (D3). A trigger on `organizations` insert seeds them, as for tax rates, and the migration seeds existing orgs (`on conflict do nothing`). Keys are English snake_case, immutable, unique per org; labels are French and editable.

### 3.2 Reference data (settings)

| Table | Columns (beyond `id`, `org_id`, `key`, `name`, `sort_order`, `is_active`, timestamps) | Seed |
|---|---|---|
| `professional_orders` | `acronym`, `licence_label` (« N° de permis »), `licence_pattern` (optional regex) | OPQ, OTSTCFQ, OPPQ, OPSQ, OCCOQ, ODNQ (Q6) |
| `profession_categories` | — (Services et tarifs prices by category) | legacy 8: psychologie, psychothérapie, travail social, psychoéducation, sexologie, naturopathie, orientation, coaching professionnel (Q6) |
| `profession_titles` | `category_id`, `order_id` (null = not regulated → no licence required) | legacy 8 titles (Q6) |
| `clienteles` | `min_age`, `max_age` (null for couples/families/groups); keys of the 7 system rows are locked | children 0–12, adolescents 13–17, adults 18–64, seniors 65+, couples, families, groups |
| `specialties` | — (therapeutic approaches; the legacy `therapy_type` rows) | legacy 10: TCC, psychodynamique, humaniste, systémique, Gestalt, EMDR, ACT, DBT, art-thérapie, thérapie par le jeu |
| `motif_categories` | `description`, `icon` (one of the 20 Lucide names) | legacy 8 |
| `motifs` | `label`, `category_id`, `is_restricted` | legacy 72, with their category assignments |
| `languages` | `code` (ISO 639-1) instead of `key` | fr « Français », en « Anglais », es « Espagnol » |
| `deactivation_reasons` | `requires_note`, `disables_account` | `leave` « Congé », `collaboration_ended` « Fin de collaboration » (disables the account, Q11), `insurance_expired` « Assurance expirée », `other` « Autre » (note required) |
| `compensation_kinds` | global catalogue (like `roles`), changed by migration | `consultation`, `workshop`, `late_cancellation`, `other_fees` |

4b–4d add `document_types` (`required`, `expiry_rule`, `reminder_days int[]`, accepted MIME types, max size) and consent versions. Scalar settings (invitation expiry days, reminder cadence) go in `org_module_settings` (`professionals`), validated by a Zod schema the module exports.

### 3.3 The professional record

| Table | Purpose and key columns | Writes |
|---|---|---|
| `professionals` | `first_name`, `last_name`, `email` (login and invitation; `lower`, unique per org), `personal_phone` (E.164), `address_line1/2`, `city`, `province` (default QC), `postal_code`, `country` (CA), `years_experience` (0–60), `gender` (null; Q5), `status`, `deactivation_reason_id`, `deactivation_note`, `status_changed_at/by`, `activation_override_reason`, `profile_id` (null until the account exists; composite FK `(profile_id, org_id)` → `profiles(user_id, org_id)`, unique) | Column grants on identity, phone, address, years and gender, with policy `professionals.manage`. RPCs for create, email, status. |
| `professional_public_profiles` (1:1) | `bio`, `approach`, `public_email`, `public_phone`, `photo_document_id` (4c) | Column grants, `professionals.manage` |
| `professional_matching_profiles` (1:1) | `accepting_new_clients` (default true), `availability_periods text[]` ⊆ {am, pm, evening, weekend} (same values as the demande's `schedule_preferences`), `availability_note` | Column grants, `professionals.matching` (Q4) |
| `professional_professions` | `profession_title_id`, `licence_number`, `is_primary`. Unique (professional, title); one primary (partial unique index); ≤ 2 rows and « licence required if the title has an order » enforced by trigger | RPC `set_professional_professions` (upserts by title, so row ids survive for Services' FKs; promotes the remaining row when the primary is removed) |
| `professional_clienteles` | PK (`professional_id`, `clientele_id`), `is_specialized` | RPC `set_professional_clienteles` |
| `professional_specialties` | PK (`professional_id`, `specialty_id`), `is_specialized` | RPC `set_professional_specialties` |
| `professional_motifs` | PK (`professional_id`, `motif_id`) | RPC `set_professional_motifs` (refuses restricted motifs without a regulated profession) |
| `professional_languages` | PK (`professional_id`, `language_id`); French added at creation | RPC `set_professional_languages` (at least one language) |
| `professional_payer_numbers` | `payer_type` (`ivac`), `number`; unique (org, type, number) and (professional, type) | RPC `set_professional_payer_number` (empty = delete) |

- **Junction keys start with `professional_id`**, so the audit `record_id` begins with the professional's id and history can find the rows (§3.9).
- **Email after the account exists:** `profiles.email` (from `auth.users`) becomes the source. A trigger copies it to `professionals.email`, the same pattern as `profiles` ← `auth.users`. `set_professional_email` works only while `profile_id` is null; afterwards the professional changes it in « Mon compte ».
- **4b–4d tables** (outline only, designed in their batch):
  - `professional_submissions`: draft / submitted / reviewed / approved, requested sections, prefill snapshot, field values, reviewer;
  - `professional_documents`: type, path, status, `expires_on date`, `metadata jsonb` validated per type, reviewer, rejection reason;
  - `professional_consents`;
  - contracts as core `signature_requests` with `subject_type = 'professional'`.

### 3.4 Lifecycle

| Status | Label (dot) | Meaning | Enters by |
|---|---|---|---|
| `draft` | « À inviter » (neutral) | Created, no invitation sent | `create_professional` |
| `invited` | « Invité » (neutral) | Invitation sent, questionnaire not submitted | 4b: `invite_professional` |
| `in_review` | « À réviser » (yellow) | Questionnaire submitted, staff review | 4b: questionnaire submit |
| `active` | « Actif » (teal) | Can receive clients; in matching | `activate_professional` |
| `inactive` | « Inactif » (red) + reason | Not in matching | `deactivate_professional(reason, note)` |

- **Transitions only through RPCs.** A check ties `inactive` to a reason: inactive ⇔ `deactivation_reason_id` is set. A professional update request does **not** change the status: an active professional with a submission to review stays active, flagged « Mise à jour à réviser ».
- **Readiness checklist** (`get_professional_readiness(p_id)`): it grows with the phases, and items of phases not yet built are absent.

  | Item | From |
  |---|---|
  | **Profil de jumelage complet:** a profession (+ licence if regulated), ≥ 1 language, ≥ 1 clientèle, ≥ 1 motif | 4a, new: a professional nobody can match should not be active |
  | Compte créé (invitation acceptée) · Questionnaire approuvé | 4b |
  | Documents requis valides (photo, assurance, consentement) | 4c |
  | Contrat signé | 4d |

- **`activate_professional(p_id, p_override_reason default null)`:**
  - allowed from any non-active status when the checklist is complete;
  - otherwise, `professionals.activate_override` with a reason, which is stored and audited.

  This override is how the ~50 existing professionals are activated in 4a, before 4b–4d exist: « Dossier complété hors application ».
- **Deactivation** always records a reason from `deactivation_reasons`, plus a note when the reason requires one. A reason with `disables_account` also disables the professional's profile (Q11). Reactivation = activation.
- **Insurance expiry (4c; Change approved by Jonathan, settled here).** The insurance document's `expires_on` is its last valid day (default: the next March 31).

  | When | What happens |
  |---|---|
  | **J-7** (configurable, `reminder_days`, default `{7}`) | Email `professional.document_expiring` to the professional. Important in-app notification to staff with `professionals.manage`. « À surveiller » on the list. |
  | **Expiry day** (first day after `expires_on`, clinic timezone; daily job at 06:00) | Document → `expired`. The professional **stays active**, flagged « Assurance expirée » on the list, the record and in `professionals_directory`. Email `professional.document_expired` and a staff notification. Demandes shows the flag in suggestions and asks for confirmation before assigning a **new** client (Q1). Existing clients are unaffected. |
  | **Afterwards** | A weekly reminder email until a valid insurance is verified (configurable). |
  | **New valid insurance verified** | The flag and reminders stop. No reactivation is needed, since nothing was deactivated. |

### 3.5 Sensitive data (ADR 0004, Phase 2 pattern)

`professional_private` (PK `professional_id`, `org_id`):

| Column | Stored as | Why |
|---|---|---|
| `sin` | `bytea` encrypted + `sin_last3` | Highly sensitive; collected only if the accountant confirms it is needed (Q7) |
| `business_number`, `gst_number`, `qst_number` | text, checked `^[0-9]{9}$`, `^[0-9]{9}RT[0-9]{4}$`, `^[0-9]{10}TQ[0-9]{4}$` | Business identifiers printed on the professional's invoices; not secret |
| `bank_institution`, `bank_transit` | text, `^[0-9]{3}$`, `^[0-9]{5}$` | Same as `organization_bank_details` |
| `bank_account` | `bytea` encrypted + `bank_account_last4` | Same as the clinic account |
| `key_version` | int | ADR 0004 « key versions » |

- **No client privilege**, revoked from `service_role` too. The audit trigger redacts **every** column of the table (decision #31).
- **RPCs:**
  - `get_professional_private(p_id)` returns masked values;
  - `reveal_professional_private(p_id, p_field)` decrypts and writes an `audit_log` row with action `read`, `source = 'rpc:reveal_professional_private'` and `{"fields": [...]}`;
  - `set_professional_private(p_id, …)`: a blank value keeps the stored one; validation as in `set_bank_details`.
- **Who:** `professionals.private` for any professional. A provider sets their own values only through the questionnaire (4b), never reveals them, and sees the masked form in « Mon profil ».
- **Blocking before the first SIN or bank row, even in local tests with real data:** ADR 0004's « Before Phase 4 » checklist (escrow runbook, known-ciphertext health check at deploy, key versions and re-encryption procedure, staging-key note, dashboard warning) and the staging logging check (Phase 2 follow-ups). It is task 4a.10 (§9).

### 3.6 Compensation and the programme de reconnaissance

> **Superseded (2026-10-08):** the clinic's program replaced this model: retention grids per profession, cumulative sessions, dated applied rates and client agreements. See the plan's « The retention program » (P4-180–P4-194). The text below is the original design.

Legacy contract clause 3.1 sets the clinic's share as a % of fees by service type, and clause 3.5 defines the recognition program:
- « 0,50 $/50 min et 0,25 $/30 min pour chaque tranche de 50 rendez-vous réalisés jusqu'à concurrence de 25 % »;
- 3.5.1: a demarche ended after the first session does not count;
- 3.5.2: late cancellations get no bonus.

| Table | Columns | Rules |
|---|---|---|
| `compensation_defaults` | `kind` → `compensation_kinds`, `margin_min_pct`, `margin_max_pct`, `effective_from`, `effective_to` | No overlap per (org, kind) (exclusion constraint, as for `tax_rates`). Seeded with the legacy values. |
| `professional_compensation` | `professional_id`, `kind`, `margin_pct`, `effective_from`, `effective_to`, `note` | No overlap per (professional, kind). `set_professional_margin` closes the open row, as `add_tax_rate` does. With no row, the default range applies. |
| `recognition_rules` | `effective_from/to`, `step_sessions` (50), `bonus_per_50min_cents` (50), `bonus_per_30min_cents` (25), `cap_pct` (25) | Dated, settings « Rémunération » (Q8) |
| `professional_recognition` | `professional_id`, `level` (completed tranches), `sessions_counted`, `effective_from/to`, `note` | **Entered by hand** while sessions are counted in GOrendezvous. Rendez-vous computes it later. |

- **Read model:** `get_professional_compensation(p_id, p_on date)` returns the margins and recognition level in force on a date. Annexe A (4d) and Facturation (payouts) read it.
- **Who:** `professionals.compensation` (admin only by default).
- **No money is computed in 4a.** These tables only record the terms.

### 3.7 The provider link

- `profile_id` is set when the invitation is accepted (4b). The function is service role only: `link_professional_account(p_professional_id, p_user_id)`, called by core `accept-invite`. It creates the profile, sets `user_roles.role = 'provider'` (this module owns the role, decision #28) and links the row in one transaction.
- **`private.current_professional_id()`:** security definer, stable. It returns the caller's professional id, or null unless the profile is active. Provider policies combine it with the gate:

  ```sql
  using (id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')))
  ```

  Other modules' policies (Clients, Demandes, Rendez-vous) call this helper too: it is part of the module's published contract.

### 3.8 What the module publishes (no raw-table reads from other modules)

| Object | For | Content |
|---|---|---|
| view `professionals_directory` (`security_invoker`) | Demandes (matching), Rendez-vous, Facturation, Clients pickers | One row per professional: id, org, status, `accepting_new_clients`, `availability_periods`, display name, primary title (key, label), category key, order acronym, licence, every profession, `language_codes[]`, `clienteles jsonb [{key, specialized}]`, `specialties jsonb [{key, specialized}]`, `motif_keys[]`, years of experience, gender, `insurance_status` (`valid` / `expiring` / `expired` / `unknown` before 4c), `ready` (checklist complete), `updated_at` |
| view `professionals_list` (`security_invoker`) | the list page | Flat row: names, email, primary profession + order + licence, status, languages, clientèle/motif keys for filters, « À surveiller » flags |
| RPC `get_professional_public_profile(p_id)` | Demandes profile dialog, fiche | Portrait, public contact, motifs by category, clientèles, approaches |
| RPC `get_professional_compensation(p_id, p_on)` | 4d, Facturation | §3.6 |
| helper `private.current_professional_id()` | every module's provider policies | §3.7 |
| reference views `motifs_catalog`, `clienteles_catalog`, `languages_catalog` | Demandes (picker, mapping) | Active rows with keys, labels, categories, age bounds |

Because the views are `security_invoker`, readers need `professionals.view`; conseillères, the adjointe and the admin have it. Providers do not see the directory.

### 3.9 Writes, history, audit

- **RPCs (4a):**
  - `create_professional(first, last, email, title_id)`;
  - `set_professional_email`;
  - `set_professional_professions`;
  - `set_professional_clienteles`, `_specialties`, `_motifs`, `_languages` (each replaces the whole set in one transaction, validates the ids belong to the org and are active, and returns the new set);
  - `set_professional_payer_number`;
  - `activate_professional`, `deactivate_professional`;
  - the private and compensation RPCs (§3.5–3.6);
  - settings RPCs per reference table: `save_<thing>` (create or rename, key generated from the name on create), `set_<thing>_active`, `reorder_<thing>`; archiving returns the number of professionals still using the row, for the warning.
- Concurrent edits: as in Phase 2, last write wins and the audit shows both. Writes on one professional lock its row (`for no key update`) so set replacements never interleave.
- **`list_professional_history(p_id, p_before_id, p_limit)`** (`professionals.view`; providers do not see history in 4a):
  - returns the `audit_log` rows of the professional, of its 1:1 tables and of its child rows, newest first, with keyset pagination;
  - finds child rows by `record_id` prefix `<professional_id>:` (junctions), or by child ids for tables with their own id (professions now, documents later);
  - private rows show « Coordonnées fiscales ou bancaires modifiées » with no values;
  - actor names and French labels come from i18n `audit.fields.<table>.<column>`, as in the Journal d'audit.

---

## 4. Permissions

Keys follow foundation design §5.3, refined. Admins hold every permission (conventions §9). Role defaults are per clinic and editable (decision #40), so changing a default later needs no migration.

| Key | Gives | admin | counselor | admin_assistant | provider | Phase |
|---|---|:-:|:-:|:-:|:-:|---|
| `professionals.view` | List, records, directory, history (no compensation or private data) | ✓ | ✓ | ✓ | | 4a (exists) |
| `professionals.manage` | Create, edit identity, public profile, professions, IVAC; activate/deactivate when ready; see module settings read-only | ✓ | | ✓ | | 4a |
| `professionals.matching` | Edit clientèles, approaches, motifs, languages, general availability, « accepte de nouveaux clients » | ✓ | ✓ | ✓ | | 4a (Q10) |
| `professionals.activate_override` | Activate without a complete checklist, with a reason | ✓ | | | | 4a |
| `professionals.settings` | Edit the module's reference lists and settings | ✓ | | | | 4a |
| `professionals.compensation` | See and change margins and recognition level; « Rémunération » settings | ✓ | | | | 4a |
| `professionals.private` | See masked tax/bank data, reveal (audited), change | ✓ | | | | 4a |
| `professionals.self` | Own record (« Mon profil », « Mes documents ») through `current_professional_id()` | ✓ | | | ✓ | 4a (RLS), 4b (screens) |
| `professionals.invite` | Send, renew and revoke invitations and update requests | ✓ | | ✓ | | 4b |
| `professionals.review` | Review and apply submissions | ✓ | | ✓ | | 4b |
| `professionals.documents.review` | Verify or reject documents, correct expiry dates | ✓ | | ✓ | | 4c |
| `professionals.documents.delete` | Delete documents | ✓ | | | | 4c |
| `professionals.contracts.send` | Prepare, send, regenerate contracts | ✓ | | | | 4d |

**Settings sections.** Each module section is visible with `professionals.manage` and editable with `professionals.settings` (« Rémunération »: `professionals.compensation` for both). This matches the design system: the adjointe sees Paramètres read-only, and the conseillère has no Paramètres (decision #19 still holds).

**What changes from foundation design §5.3:**
- `private.view` / `private.manage` merge into `professionals.private`, like `settings.bank_manage`: seeing masked values without being able to change them serves no one.
- `settings.manage` becomes `professionals.settings`.
- Added: `matching`, `activate_override`, `compensation`, `self`, `review`.

---

## 5. Screens

### 5.1 List (`/professionnels`)

Design system §4 (PageHeader, filter bar, table in a Card, footer pagination, empty state), with:
- **Subtitle** « N professionnels · M actifs »; teal « + Ajouter » (`professionals.manage`).
- **Filters:**
  - search (name, email, licence);
  - Statut (5 statuses);
  - « Filtres » popover: profession, langue, clientèle, motif (multi), « Accepte de nouveaux clients », « À surveiller ».

  Active filters show as removable chips.
- **Columns:**

  | Column | Content |
  |---|---|
  | Nom | avatar 24 + name + email |
  | Profession | primary title + « Ordre permis » |
  | Langues | « FR · EN » |
  | Statut | dot + word |
  | À surveiller | one phrase, red when it matters: « Assurance expire le 31 mars », « Invitation sans réponse · 6 j », « Dossier à réviser », « Profil de jumelage incomplet », else « — » |

  « Documents 3 / 3 » is added in 4c.
- **Data:** the whole `professionals_list` (< 200 rows), filtered client-side. Filters and page are kept in the URL.

### 5.2 Creation

Dialog « Ajouter un professionnel »:
- fields: Prénom*, Nom*, Courriel*, Profession (select);
- buttons: Annuler / « Créer »;
- on success, open the record on Aperçu, toast « Professionnel créé. ».

From 4b, the description is « Une invitation lui sera envoyée par courriel pour compléter son profil. », the checkbox « Envoyer l'invitation maintenant » is checked, and the button is « Créer et inviter ». Errors (duplicate email) show under the field.

### 5.3 The record (`/professionnels/:id/:onglet`) — rethought layout

**Who opens a record, and why:**
- **Conseillère** (most often, many times a day): « does this person fit this client? » She needs clientèles, motifs, approaches, languages, availability and whether the professional takes new clients, at a glance.
- **Adjointe:** onboarding, documents, insurance, contract.
- **Admin:** the same, plus compensation.

The legacy order (Aperçu, Profil, Profil public…) put identity first and scattered the matching data across two tabs (Profil public held specialties and motifs; languages had no place). Proposed:

| # | Tab | Content | Why here |
|---|---|---|---|
| 1 | **Aperçu** | Left: **« Profil de jumelage »**, a read-only digest of clientèles (★ first), approaches, motifs by category, languages, general availability, « Accepte de nouveaux clients », with « Modifier » → tab 2. Right: **« Dossier »** (readiness checklist with StatusIndicators while the professional is not active, one line « Dossier complet » once active), **« À surveiller »** (insurance, update to review, incomplete profile, with jump links), **« Prochaine action »** (one sentence + one button). | The matching question is answered without clicking. The onboarding state stays visible but takes little space once done. |
| 2 | **Jumelage** | Cards: Clientèles (★), Approches (★), Motifs (by category), Langues, Disponibilités générales (am/pm/soir/fin de semaine + note) and « Accepte de nouveaux clients ». Each list opens a picker sheet with search and « Annuler / Enregistrer ». | Matching is the heart of the app: its data gets one curated place, editable by conseillères (`professionals.matching`). |
| 3 | **Profil public** | Portrait (bio, approche), public contact, photo (4c), « Aperçu de la fiche » (4c). | Everything the client sees, together: what the fiche prints. |
| 4 | **Identité et permis** | Identité (prénom, nom, genre), Coordonnées (login email read-only, phone, address), Professions et permis (≤ 2, primary), Expérience, Numéros de payeurs (IVAC). | Stable administrative data, edited rarely. |
| 5 | **Documents** (count) | 4c: required documents (photo, assurance, consentement) with status and expiry, then « Autres documents ». 4d adds the **Contrat** card at the top. 4b adds « Questionnaire et mises à jour » (submissions, provenance). | One compliance tab: every checklist item except the matching profile lives here. The contract is a document the professional signs; a separate tab would split the checklist in two places. |
| 6 | **Rémunération et fiscalité** (`professionals.compensation` or `professionals.private`) | Marge clinique by kind (current + history), Programme de reconnaissance (level, history), Fiscalité (BN, TPS, TVQ, NAS masked), Banque (masked, « Afficher » logged). | Admin only; its own tab so nobody else ever sees an empty or locked tab. |
| 7 | **Historique** | One timeline: changes (audit) and, from 4b, emails sent (`email_log`), with a filter « Tout · Modifications · Courriels ». | « What happened, when, by whom » in one place. The design system's separate « Courriels » tab would show 0–3 rows for most professionals (Q13). |

- **Header** (design system §5):
  - avatar 48, name 20/600 and status dot;
  - « Profession · Ordre permis · courriel »;
  - quiet chips for languages and « N'accepte pas de nouveaux clients » when relevant.
- **Header actions:**
  - « … » menu: Désactiver / Réactiver, and from 4b « Renvoyer l'invitation » and « Demander une mise à jour »;
  - « Fiche PDF » (outline, 4c);
  - one teal action by state: « Activer » when the checklist is complete and the professional is not active; from 4c, « Envoyer au client » when active.
- **Tabs** are page-level views. They use real Radix `Tabs`, reachable by keyboard (decision #35), and are synced with the URL so alerts can link to a tab. Tabs a user may not see are not rendered.
- **Topbar:** « Professionnels / {Nom} », through the `useShellCrumb` follow-up from Phase 2.
- **Unsaved changes:** a tab switch with unsaved changes confirms (the `UnsavedChangesProvider` from Phase 2).

### 5.4 UI patterns reused from Phase 2

- **Cards:** a `ProfessionalCard` built like `OrganizationCard`. It is a `SettingsCard` with `useSettingsForm` (flat values, follows refetches, keeps typed edits) and `FormActions` (outline until dirty, teal only on dirty cards, decision #34).
- **Read-only:** without `professionals.manage`, the record renders through `FieldsReadOnlyContext`: focusable, copyable fields; no footers; one `ReadOnlyNotice`.
- **Set pickers** (motifs, clientèles…): a Sheet with search, checkboxes, `StarToggle` and « Annuler / Enregistrer ». Nothing saves on a keyboard-navigation change event (decision #36).
- **Activation and deactivation** use an AlertDialog. Deactivation offers a reason select (only the confirm button acts, never an arrow key, decision #36) and a note when required. The override asks for a reason.
- **Errors** go through `moduleErrorMessage(…, 'professionals')`. All dates use the timezone utilities. Expiry dates use `formatDateOnly*`.

### 5.5 Provider views

| Route | Phase | Content |
|---|---|---|
| « Mon profil » `/mon-profil` | 4b | Read-only view of their own Profil de jumelage, Profil public, Identité et permis, and masked fiscal/bank data. « Proposer une modification » starts an update submission (same review flow). |
| « Mes documents » `/mes-documents` | 4c | Required documents with status and expiry, « Téléverser » (e.g. renewed insurance), the J-7 / expired notice as a banner |

Both nav items are gated on `professionals.self`. Today the provider menu shows Accueil only.

### 5.6 Module settings sections (group « Modules », French paths)

| Section | Path | Phase | Content |
|---|---|---|---|
| Professions et ordres | `professions` | 4a | Orders (name, acronym, licence label/pattern) · Categories · Titles (category, order) |
| Spécialités | `specialites` | 4a | Card « Clientèles » (labels, age bounds; system keys locked) · card « Approches » (A6.1 behaviour) |
| Motifs | `motifs` | 4a | A7 behaviour + categories (icon, reorder) + « Réservé aux professions réglementées » switch |
| Langues | `langues` | 4a | Languages offered (fr, en, es seeded; add, archive) |
| Raisons de désactivation | `raisons-desactivation` | 4a | Label, « note requise », « désactive le compte » |
| Rémunération | `remuneration` | 4a | Dated default margins by kind; recognition rules |
| Invitations | `invitations` | 4b | Link expiry (default 7 days), automatic reminders |
| Documents requis | `documents-requis` | 4c | Document types: required, expiry rule, reminders (default J-7, then weekly after expiry), accepted types, max size |
| Consentements | `consentements` | 4b/4c | Versions of the « droit à l'image » text |
| Contrats | `contrats` | 4d | Contract templates (core signing, filtered to this module), default signer |

---

## 6. Matching readiness (what Demandes will rely on)

| Dimension | What Professionnels stores | How Demandes uses it |
|---|---|---|
| **Motifs** | Curated `motifs` (stable `key`, label, category, `is_restricted`) + `professional_motifs` | The demande stores motif ids (FK to `motifs.id`, the owner's stable PK), never hardcoded keys (fixes inventory C). Score = matched / requested. |
| **Spécialités** (approaches) | `specialties` + `professional_specialties.is_specialized` | Soft scoring (★ weighs more, dormant scorer 1.0 / 0.6) |
| **Clientèles** | `clienteles` with stable keys + age bounds, `professional_clienteles.is_specialized` | **Hard filter.** Couple → `couples`, famille → `families`, groupe → `groups`, otherwise the age band of the principal participant, read from the bounds rather than code |
| **Languages** | `languages` (ISO codes) + `professional_languages`; French present by default | **Hard filter** on the client's language (`clients.language`, default fr) |
| **Availability** | Interim: `availability_periods` ⊆ {am, pm, evening, weekend}, the same vocabulary as `demandes.schedule_preferences`, plus `accepting_new_clients`. Later: Rendez-vous publishes `available_slots(professional, from, to)` | Interim: overlap with the demande's preferences. Professionals not accepting new clients are excluded. Slots replace this once Rendez-vous exists (legacy contract clause 4.2: availability lives in GOrendezvous today). |
| **Readiness** | `status`, `ready`, `insurance_status` | Only `active` professionals are candidates. « Assurance expirée » is shown and confirmed (§3.4). |
| **Profession** | Primary and secondary titles, category, order, licence; years of experience | Profession fit, price via Services et tarifs (by category), receipts |
| **Gender** (Q5) | Optional `gender` | The client preference « Femme / Homme » shown in the design-system Demandes mock |

Everything is in `professionals_directory`, one row per professional. Demandes scores in its own RPC or edge function; ~50 rows make performance a non-issue. The directory's `updated_at` lets a stored recommendation snapshot say « profil modifié depuis ».

---

## 7. What 4b–4d need from Phase 3

Phase 3 should be designed with these consumers in mind.

| Need | Used by | Details |
|---|---|---|
| **Email** (Resend, `send-email`, templates, `email_log`) | 4b, 4c, 4d | Templates `professional.invite`, `professional.profile_update`, `professional.submission_received` (staff), `professional.document_rejected`, `professional.document_expiring`, `professional.document_expired`, `professional.fiche` (**PDF attachment**, any recipient), `contract.sent`. `email_log` keyed by `subject_type = 'professional'` + `subject_id`, with an RPC to list a subject's emails (Historique). Variables come from clinic identity (Phase 2) and the module. |
| **Secure links + accept-invite** | 4b, staff invites (decision #22) | Purposes `professional_invite`, `profile_update` (scope: requested sections, submission id). Configurable expiry, revoke, « Nouveau lien », opened/used timestamps for the precedence of A2.5. **Pluggable purpose handlers:** accept-invite (core) creates the auth user with the chosen password, then calls the purpose's handler, here `link_professional_account` (service role), in one flow with rollback. A logged-in professional can also be sent to the update flow with a magic link. |
| **Storage** | 4b, 4c | Private bucket, paths `{org_id}/professionals/{professional_id}/{uuid}-{name}`, signed URLs (1 h), MIME and size checked server-side and in storage policies. Storage policies may call `private.has_permission` / `private.current_professional_id()`. **Staged uploads** attached to a submission, promoted on approval, cleaned up when abandoned. |
| **In-app notifications** | 4c (insurance), 4b (submission received) | **Not in the Phase 3 list yet; please add it.** A core `notifications` table (recipient by permission or user, importance, link, read state) and the topbar bell with its dot (design system). « Important » notifications also show on Accueil « À surveiller ». |
| **Scheduled jobs** | 4c | `pg_cron` (removed by the staging reset) re-added by migration. Schedules in migrations. Job runs logged and shown in « Tâches planifiées » (deferred from Phase 2 to Phase 4). Jobs resolve each org and call `requireModuleForOrg`; they run at clinic local time. |
| **Server-side PDF** | 4c (fiche), 4d (contract preview, Annexe A) | One rendering path in edge functions, shared by signing and the fiche (logo from storage, Phase 2 identity). |
| **Signing** (`document_templates`, `signature_requests`, Documenso, webhook) | 4d | `subject_type = 'professional'`. Variables from a module RPC (service role) `get_professional_contract_variables(p_id)`, including Annexe A from §3.6 and Services prices. Optional clinic second signer. Statuses including rejected / expired / cancelled. The webhook ticks the checklist through a module RPC. |
| **Auth admin** (sign out a disabled user's sessions) | 4a's « désactive le compte » (Q11) | Planned with the Phase 3 invitation function (Phase 2 design §3.5). Until then, disabling blocks data access at the next request. |

---

## 8. Open questions for Jonathan

1. **Expiry day.** On the day after the insurance expires, the professional stays active and is flagged everywhere. Demandes asks for confirmation before assigning a **new** client, and a weekly reminder goes out until renewal (§3.4). **Recommendation:** yes, as described. A stricter option: hide them from suggestions until renewed (still no deactivation).
2. **Insurance expiry date.** Always the next March 31 (legacy: locked in the UI), or editable? Some professionals may hold private insurance with another end date. **Recommendation:** default to the next March 31, correctable by a reviewer (`documents.review`), audited.
3. **Clientèles as their own list** (with age bounds), separate from approaches, instead of a `clientele` category inside spécialités. **Recommendation:** separate. Clientèles are a hard filter with fixed meaning; approaches are soft scoring. The UI still shows both under « Spécialités ».
4. **Interim availability and « accepte de nouveaux clients ».** Rendez-vous comes after Demandes in the roadmap, so matching would have no availability data at first. **Recommendation:** store general periods (am / pm / soir / fin de semaine + note) and the « accepte de nouveaux clients » switch now; slots replace the periods later.
5. **Gender.** The design-system Demandes mock offers a client preference « Femme / Homme ». **Recommendation:** an optional field (« Femme », « Homme », « Autre / non précisé »), visible to staff only, used only for that preference. Should titles also get feminine forms (« Psychoéducatrice ») for the fiche?
6. **Profession list.** Legacy titles: psychologue, psychothérapeute, travailleur·euse social·e, psychoéducateur·trice, sexologue, naturopathe, conseiller·ère en orientation, coach professionnel·le. The website also lists nutritionnistes / diététistes and coachs (parental, gestion des écrans); the design-system mock shows « Nutritionniste (ODNQ) ». Legacy required a licence for every title, even unregulated ones. **Recommendation:** seed the 8 legacy titles plus nutritionniste (ODNQ); a licence is required only when the title belongs to an order (naturopathe and coach have none). Please confirm the list and orders.
7. **SIN.** Is it needed at all (T4A / relevé)? Open item in foundation design §8. **Recommendation:** ask the accountant before 4b. Without confirmation, collect only BN / TPS / TVQ and bank details (Loi 25: collect the minimum). The encrypted column costs nothing to keep ready.
8. **Programme de reconnaissance.** Clause 3.5: « 0,50 $/50 min et 0,25 $/30 min pour chaque tranche de 50 rendez-vous réalisés jusqu'à concurrence de 25 % ». Is the 25 % cap a share of the base fee? Is this still the program, or has it changed? **Recommendation:** store the rule as dated settings and each professional's level by hand (with history) until Rendez-vous counts sessions.
9. **Margin per professional.** One value per professional (e.g. 28 %, as in the design-system « Tarifs » card), or only the 25–30 % range on the contract? **Recommendation:** one value per professional and kind, with history; Annexe A shows that value, or the range if none is set.
10. **Conseillères edit matching data.** They « know every professional's specialties ». **Recommendation:** `professionals.matching` for counselors by default; identity, status and documents stay with the adjointe and the admin.
11. **Deactivated professionals' login.** **Recommendation:** an inactive professional keeps access to « Mon profil » and « Mes documents » (to renew insurance, for example). Only a reason marked « désactive le compte » (« Fin de collaboration ») disables the account.
12. **Address autocomplete.** **Recommendation:** manual address in 4a, as in Identité légale. Google Places (secret kept on staging) comes with Clients, which needs it more, and is then reused here.
13. **Fewer tabs.** Merge « Contrats » into « Documents » and « Courriels » into « Historique » (§5.3), going against the design-system tab list. **Recommendation:** yes. Please confirm the order Aperçu · Jumelage · Profil public · Identité et permis · Documents · Rémunération et fiscalité · Historique.
14. **IVAC number.** Writable by the adjointe (`professionals.manage`) rather than admin only (legacy)? **Recommendation:** yes, since she handles IVAC billing.
15. **Education.** Typed in legacy, never collected. **Recommendation:** leave it out (not used by matching or documents) unless the fiche should show it.
16. **`is_restricted` motifs.** Legacy meaning: « only licensed professionals can select this motif »; no motif is restricted today. **Recommendation:** keep it, enforce it (a regulated profession is required), and let the admin choose which motifs, if any.
17. **Initials on every contract page.** Legacy DocuSeal did it. **Recommendation:** keep it if the clinic's Documenso supports an initials field per page; otherwise signature + date only. (That would become a Drop, listed for approval in 4d.)
18. **Annexe A wording.** Legacy says « taxes incluses » on pre-tax prices. **Recommendation:** « avant taxes » unless the accountant says otherwise.
19. **Sent fiches.** Keep a copy of each fiche emailed to a client (proof of what was sent), or regenerate on demand only (D2)? **Recommendation:** no copy; the email log records what was sent and when.
20. **Importing the existing ~50 professionals.** **Recommendation:** a one-time CSV import (identity, professions, licences, languages, clientèles, motifs) through a reviewed script, run with your go-ahead. Then the readiness override with the reason « Dossier complété hors application ». Alternatively, staff type them in (roughly 15 min each).
21. **Uncommitted motif work.** The main checkout (not this worktree, not `legacy-v1`) has two untracked migrations: `20260207000001_motifs_v2_categories_and_items.sql` and `20260207000003_professional_compliance_check.sql`. Were they a motif redesign or a compliance rule that this design should include? **Recommendation:** you review them; this design seeds the `legacy-v1` lists until told otherwise.

---

## 9. Proposed task breakdown for 4a

Each task goes through subagent-driven development: pgTAP first, implementer, spec review, quality review with live probes, as in Phases 1–2. `000_invariants` stays green; `npm run db:types` after each migration.

| # | Task | Content |
|---|---|---|
| 4a.0 | Prerequisites | `useShellCrumb` breadcrumb hook (Phase 2 follow-up); clinic timezone propagation follow-up; Playwright set-up (the module DoD needs one happy path from Phase 4) |
| 4a.1 | Migration `professionals_reference_data` | Permissions of §4 (4a keys) + role defaults; the reference tables of §3.2 with per-org seeding trigger and seeds; RLS, grants, audit; settings RPCs (`save_*`, `set_*_active`, `reorder_*`, usage counts); catalog views |
| 4a.2 | Migration `professionals_core` | `professionals`, the 1:1 tables, professions (≤ 2 / one primary / licence trigger), junctions, payer numbers; `private.current_professional_id()`; RPCs of §3.9; status RPCs and readiness; `professionals_list`, `professionals_directory`, `get_professional_public_profile`, `list_professional_history`; profile-email sync trigger |
| 4a.3 | API + hooks | `api/` (typed), `hooks/` (`professionalKeys`), Zod schemas mirroring the DB checks, error allow-list area `professionals` |
| 4a.4 | Settings sections | Professions et ordres · Spécialités (Clientèles, Approches) · Motifs (+ categories, reorder, restricted) · Langues · Raisons de désactivation; manifest `settingsSections` with `permission` / `editPermission` |
| 4a.5 | List + creation | §5.1–5.2; filters in the URL; empty states |
| 4a.6 | Record shell + Aperçu | Route `/professionnels/:id/:onglet`, header, Radix tabs, breadcrumb, unsaved-changes guard, Aperçu (Profil de jumelage digest, Dossier, À surveiller, Prochaine action) |
| 4a.7 | Jumelage tab | Pickers (search, ★, batch save), languages, general availability, « accepte de nouveaux clients » |
| 4a.8 | Profil public + Identité et permis tabs | Cards, professions editor, IVAC |
| 4a.9 | Activation / deactivation | Dialogs, reasons, override with reason, checklist |
| 4a.10 | Sensitive-data prerequisites (**blocking for 4a.11**) | ADR 0004 « Before Phase 4 » checklist (escrow runbook, known-ciphertext deploy check, `key_version` + re-encryption procedure, staging-key and dashboard notes) and the staging logging check |
| 4a.11 | Migration `professionals_compensation_private` + tab | §3.5–3.6 tables and RPCs (reveal audited, all columns redacted); « Rémunération et fiscalité » tab; « Rémunération » settings section |
| 4a.12 | Historique tab | Timeline from `list_professional_history`, readable diffs, filter (Courriels added in 4b) |
| 4a.13 | Seed, docs, tests, review | Local seed (pros in every status, the provider account linked), `docs/modules/professionals.md`, CLAUDE.md, inventory §A ticks; pgTAP (privileges, cross-org, each role, gate, audit + redaction, ≤ 2 professions, restricted motifs), Vitest, one Playwright path (create → complete Jumelage → activate); browser walkthrough with the four accounts; final branch review |

**Order:** 4a.0 → 4a.1 → 4a.2 → 4a.3. Then two lanes: settings (4a.4) and screens (4a.5–4a.9, 4a.12). 4a.10 → 4a.11 can run beside them. 4a.13 comes last.
