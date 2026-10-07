# Clinique MANA — Legacy Feature Inventory

**Date:** 2026-10-06
**Source:** legacy code at tag `legacy-v1` (commit `7d5d48c`), moved to `_legacy/` during the rebuild.
**Purpose:** the parity checklist for the foundation rebuild ([design](2026-10-06-foundation-rebuild-design.md) §6.2). Nothing the old app does may be lost silently.

## How to use this document

- Visual design, layout and navigation are **free to change completely**. This list covers **behaviour**: features, business rules, calculations, automations, data and integrations.
- Before a module is built, its design doc copies the relevant section and marks every item:
  - **Keep** — same behaviour in the new module.
  - **Change** — behaviour changes on purpose (say how).
  - **Drop** — removed. Requires Jonathan's explicit OK.
- Items under **Half-built / broken** are known defects. They are listed so the rebuild fixes them instead of copying them.
- File references point to legacy paths (prefix `_legacy/` after Phase 0). `mig/` = `supabase/migrations/`.

## Module map (legacy → rebuild)

| Legacy area | Rebuild module | Section |
|---|---|---|
| professionals, invite, documents, contracts, document-templates, specialties, motifs | **Professionnels** (module 1) + core signing | A |
| clients, external payers (client side) | Clients | B |
| demandes | Demandes | C |
| recommendations | Demandes (matching) | D |
| availability, Google Calendar | Rendez-vous | E |
| facturation | Facturation | F |
| external payers (billing side), IVAC report | Facturation / Payeurs externes | G |
| services-catalog, prices, taxes | Services et tarifs | H |
| settings, scheduled tasks, dashboard, auth, i18n | Core | I |

---

## A. Professionnels (incl. onboarding, documents, contrats, spécialités, motifs)

### A1. List & creation
- [ ] Card grid: initials, name, status badge, email, specialty count, document count, "invitation en attente" flag (`pages/professionals.tsx:49-111`).
- [ ] Search name/email; status filter all/pending/invited/active/inactive; empty state with reset.
- [ ] "Ajouter un professionnel": name, email, "envoyer l'invitation" (checked by default) → detail page. Name required; email regex, trimmed + lowercased; duplicate check against `profiles.email` and `auth.users` ("Ce courriel est déjà utilisé"); admin/staff only.
- [ ] `create-professional` (edge): auth user → profile (provider, active) → professional (pending) → optional invite (64-hex token, 7-day expiry, status → invited), with rollback. ⚠ random password; `listUsers()` unpaginated.

### A2. Detail page
- [ ] Header: photo (⚠ uses first photo doc, should be newest/verified), status badge, email, profession titles joined " • ", activate/deactivate with confirm.
- [ ] Tabs: Aperçu, Profil, Profil public, Services, Documents, Calendrier, Historique.

**Aperçu**
- [ ] "À compléter" alerts with jump buttons: missing bio + approach; no specialties; N missing/expired required documents (error when > 2).
- [ ] Quick actions: download fiche PDF (title picker if 2 titles); "Envoyer le formulaire" / "Nouveau lien" (no invite or expired/revoked); copy link; "Demander une mise à jour" (invite completed); "Voir la soumission"; "Gérer les documents"; activate/deactivate.
- [ ] Onboarding steps Formulaire → Documents requis → Activation; formulaire display precedence approved > reviewed > submitted > completed/opened ("consulté") > sent > expired/revoked > "à envoyer" (pending past expiry = expired).
- [ ] Activation blockers: formulaire not approved; each missing ("À téléverser") or expired ("À renouveler") required doc; contract not signed ("À signer" / "À envoyer"). `canActivate` = no blockers and not active. Completion % = done steps / 3.

**Profil**
- [ ] Inline edit (Enter saves, Esc cancels): personal phone (E.164), years of experience (int), **IVAC number** (empty = delete; unique globally; one per pro). Login email read-only.
- [ ] Address: Google Places (≥ 3 chars, 300 ms, CA, fr, Québec bias) + manual street number, street, apartment, city, province (13 codes), postal code; country fixed Canada; autocomplete keeps apartment. Format "{no} {street}, app. {apt}\n{city}, {prov}\n{postal}".
- [ ] Professions editor: max 2; title + licence required; first = primary; set primary unsets other; edit licence; remove (⚠ doesn't promote remaining primary, leaves services rows).
- [ ] Dates card: created, updated, questionnaire submitted (via invitation?), fiche generated (never written).

**Profil public**
- [ ] Editable: bio, approche, courriel public, téléphone public (empty → null).
- [ ] Specialties drawer: accordion per category (therapy_type, clientele), search + highlight, expand/collapse all, checkbox adds/removes immediately, **star = `is_specialized`**, counts per category; display specialized first then A–Z fr-CA.
- [ ] Motifs drawer: grouped by active `motif_categories` in `display_order` + "Autres"; Lucide icon per category.
- [ ] Questionnaire review card (latest submission `submitted`): professions, years, portrait, contact, specialties, motifs; "ce qui sera remplacé" summary; "Appliquer au profil" with confirm.
- [ ] Provenance banner + "Voir la soumission originale" (all responses incl. education, languages, availability notes; raw JSON toggle).
- [ ] Apply mapping: bio → `portrait_bio`, approach → `portrait_approach`, public_email, public_phone, years_experience (present fields only; empty → null); professions replaced (exactly one primary); specialties replaced by code / motifs by key (only if ≥ 1 resolves); submission → approved (+ reviewer, time); audit `questionnaire_approved` with before/after. Not applied: education, languages, availability_notes, consent, full_name. ⚠ not transactional.

**Services**
- [ ] One card per profession title with assigned services + durations; edit dialog lists services for that title's `profession_category_key` (pre-select all when none), activate-all / deactivate-all; save replaces rows keeping the other title's selections; unique (pro, title, service).

**Historique**
- [ ] Timeline grouped by date, relative time (full date on hover), actor or "Système", short event id, expandable JSON with shortened UUIDs + copy buttons, colour per action type, FR labels for 24 actions.

**Fiche PDF** (`utils/fiche-data.ts`, `components/fiche-pdf-document.tsx`)
- [ ] One per profession title, file `{Name}_{Profession}.pdf`: clinic logo; photo (verified first, else newest) or initials; "{name}, {title lowercase}"; "Permis : {licence}"; bio + approach paragraphs or "Information à venir."; motifs grouped by category A–Z, "Autres" last; clientèle specialties by sort_order or "Tous types de clientèles"; **Honoraires** = prices of services assigned to that title (category or category-less prices) as `{$}/{min} min` longest → shortest, or "À confirmer"; clinic blurb, URL, phone (hardcoded 418 907-9754).

### A3. Onboarding invite & questionnaire (`pages/invite.tsx`, `/invitation/$token`)
- [ ] Invite types: `onboarding`; `update_request` (choose any of 8 sections, select-all; current data copied into `pre_populated_data`; `parent_invite_id` = latest completed invite). Default expiry 7 days.
- [ ] Load order: invalid → invalid page; onboarding already submitted/reviewed/approved → "déjà soumis" (draft cleared); expired; revoked → invalid; completed; else restore draft (localStorage + submission id); update requests start at first requested section, prefilled; pending → mark `opened`.
- [ ] Steps: personnel, professionnel, portrait, spécialités, motifs, photo, assurance, consentement, révision (update requests skip unrequested sections; review always reachable).
- [ ] Fields/validation: name + email read-only (name required); ≤ 2 titles × (title + licence required), first primary, removing primary promotes other, ≥ 1 complete title; years 0–50; bio required, approach, public email, public phone; specialties optional; motifs optional (+ disclaimer); **photo required** JPEG/PNG ≤ 5 MB; **insurance required** PDF/JPEG/PNG ≤ 10 MB; **consent required**.
- [ ] Consent (droit à l'image) v1: 12 months, auto-renew, 3-month withdrawal notice, "j'ai lu" checkbox + typed signature name → `{version, signed, signer_full_name, signed_at, renewal_policy:'12_months_auto_renew', withdrawal_notice:'3_months'}`.
- [ ] Saving: localStorage immediately + server draft after 2.5 s idle, on "Continuer", manual save, retry on error. Draft = `professional_questionnaire_submissions` status `draft`; submit → `submitted`, invite → `completed`.
- [ ] Uploads go straight to storage `professionals/{id}/{type}/{ts}_{safeName}` + `professional_documents` (no expiry); file removed if DB insert fails. ⚠ update-request uploads create documents before submit.

### A4. Documents & insurance
- [ ] Types: cv, diploma, license, insurance, photo, fiche, other (+ DB `service_contract`).
- [ ] Required (3 + contract): **Photo** (no expiry); **Assurance responsabilité** (expires next **March 31**, auto-set + locked in UI; DB `next_insurance_expiry_date()`); **Consentement droit à l'image** (12 months auto-renew, 3-month withdrawal; questionnaire signature counts as verified until signed_at + 12 months); **Contrat de service** counted as 4th on the Documents tab.
- [ ] Status per type (newest doc): missing → expired (`expires_at` past) → verified (`verified_at`) → pending. Completeness = verified / 3.
- [ ] Documents tab: summary (verified / 4, missing, expired, "Complet"); required cards with upload, preview/download (1 h signed URL), verify / unverify, edit expiry, replace, delete (confirm); e-consent shows signer + date; "Autres documents" list. Limits 10 MB; pdf, doc, docx, jpg, png, webp (bucket enforces too). Expiry stored `YYYY-MM-DDT23:59:59.999Z`.
- [ ] `deactivate_professionals_with_expired_insurance()`: active pros whose latest **verified** insurance is missing / no expiry / past → inactive, reason `insurance_expired` (never overrides `manual`). Reactivation trigger: insurance doc becomes verified with future expiry + pro inactive for `insurance_expired` → active, reason cleared. Daily `0 6 * * *` UTC (schedule set by hand, not in migrations).

### A5. Contracts (DocuSeal today → Documenso)
- [ ] Contract card: none → "Générer et envoyer"; sent → "Synchroniser", "Voir", "Régénérer" (confirm); signed → preview, download PDF, signature log (stored copy first), regenerate. Shows version, sent date, signed date, clinic signer, provider id. Status = newest `document_instances` with key `contrat_service`.
- [ ] Generation: published template → professional snapshot + pricing snapshot for their categories → render `{{path}}` (missing → "") → provider sends signing email, initials on each page header, expires 7 days, FR subject/body → `document_instances` (`sent`, `render_data` snapshot).
- [ ] Variables: `clinic.name/address/representative/representative_title/legal_form`, `professional.full_name/email (public email!)/phone/address/profession (titles joined " et ")/license_number (first profession)`, `today`, `pricing.annexe_a_html`.
- [ ] **Annexe A**: one row per category; columns 60 min couple, 50 min, 30 min, évaluation initiale ("-"); each shows the professional's portion = price × (1 − 30 %) to price × (1 − 25 %); "Autres frais" rows from `DEFAULT_AUTRES_FRAIS`.
- [ ] **Clinic margin model** (`contracts/constants/pricing-margin.ts`): consultation 25–30 %, ateliers/conférences 25 %, annulation tardive 30 %, autres frais 15 %; bonus rates defined, unused.
- [ ] Completion: on `completed` event re-fetch, require all signers done, store signed PDF `documents/{subject}/{id}_signed.pdf` + audit log `…_audit_log.pdf`, status `signed`. Manual sync does the same.
- [ ] Templates admin (Settings › Gabarits): status filter (all/published/draft/archived) + counts, search title/key; create (key immutable, title, description, HTML), tabs content / preview with sample data / variables cheat-sheet; draft = edit/publish/archive; published = new version/preview/archive; archived = preview. `rpc_publish_template` (admin, draft only, archives previous published), `rpc_create_new_template_version` (admin, refuses if a draft exists, clones, bumps version). One published version per key. Admin write, staff read.
- [ ] Signature block: clinic representative (static today) + `{{today}}`; professional fields city, signature, date.

### A6. Spécialités (Settings)
- [ ] Filter active/archived/all + counts; view by category (clientele, then therapy_type; sort_order then name) or flat A–Z; search name/code; create (name, code, category); archive with "N professionnels utilisent" warning (associations kept); restore.
- [ ] Categories `therapy_type`, `clientele` only for new rows. Clientèle codes used by matching — **keep stable**: children 1, adolescents 2, adults 3, seniors 4, groups 5, couples 5, families 6. Codes unique. Add/remove on a pro audited with `specialty_name`, `is_specialized`.

### A7. Motifs (Settings)
- [ ] Filter active/archived/all, category filter (all / sans catégorie / one), grouped or flat, search label.
- [ ] Create: label required; key auto snake_case without accents, ≤ 50 chars, `^[a-z][a-z0-9_]*$`, unique; optional category. Archive, restore, change category.
- [ ] Categories drawer: label, key, description, one of 20 Lucide icons; archive with motif-count warning; restore. Seed: 70+ motifs, 8 categories (inner_life, relationships, dependencies, work, development, identity, trauma, life_changes). No hard delete.
- [ ] `is_restricted` motif flag (enforced only in one picker, no UI to set).

### A8. Google Calendar (professional › Calendrier) → moves to Rendez-vous module
- [ ] Connect / sync now / reconnect (expired/revoked) / disconnect (confirm) / link to agenda; shows Google email, status, last sync, last error. Flow detailed in section E. No automatic sync job.

### A9. Automations & fields
- [ ] Audit: professionals (created, status_changed incl. reason, deactivation_reason_changed, portrait_updated, fiche_generated, deleted); documents (uploaded, verified, rejected, expiry_updated, deleted); invites (created, status changes, sent, deleted); submissions (started, submitted, reviewed, approved); specialties. Not audited: motifs, professions, services.
- [ ] `professionals`: profile_id, status, deactivation_reason (manual / insurance_expired), portrait_bio, portrait_approach, public_email, public_phone, phone_number, license_number (legacy dup), years_experience, address fields, fiche_generated_at, fiche_version.
- [ ] Permissions: admin/staff manage all; provider reads/updates own; only admin deletes documents.

### A10. Half-built / broken (do not port as-is)
1. `invited` professionals can't be activated; header reactivates without checking blockers.
2. No invite email ever sent (UI says it is); links copied by hand.
3. Calendar functions + DocuSeal webhook unprotected; OAuth state unsigned; `docuseal-create-template` auth removed.
4. Anon grants missing in migrations for questionnaire reads — verify against live DB before wipe.
5. Specialties page crashes in grouped archived view; code uniqueness checked before normalisation.
6. List search on embedded columns doesn't filter; `specialty_ids` filter unused.
7. Profil public uneditable until data exists; "reviewed" never set; no general upload for CV/diploma/other; staff see delete they can't do.
8. Manual deactivation never writes `deactivation_reason`.
9. Contract: `generated` shows no actions; declined/expired ignored; clinic signer always null; Annexe A says "taxes incluses" on pre-tax prices.
10. Motifs of archived categories vanish in grouped view; categories can't be reordered; motif labels not editable.
11. `education`, `languages`, `availability_notes` typed but never collected.

---

## B. Clients

### Features
- [ ] List: filters status (all/active/archived), debounced search (first, last, `client_id`, email), primary professional, tags (any-match). Hidden date-range filter on `last_appointment_at` (`clients/hooks.ts:62-82`).
- [ ] Sort: name (last, first — default asc), clientId, birthday, lastAppointment, createdAt (`hooks.ts:85-107`).
- [ ] Column picker (9 columns, tags + primary pro hidden by default, reset) (`client-table.tsx:25-82`). Archived rows dimmed. ID shown without `CLI-` prefix.
- [ ] Deep link `?clientId=` opens the client (`pages/clients.tsx:31-36`).
- [ ] New client form, 4 sections: identité, coordonnées, adresse, admin (`new-client-drawer.tsx:289`). Google address autocomplete. Tags from fixed list `VIP, Nouveau, Famille, Urgent, Assurance`. Primary professional (active pros). Live duplicate detection. On success open the new client.
- [ ] Client record sections: header (avatar initials, name, `CLI-` id, status badge, balance "0,00 $", tags edit, "Responsable : …" banner if `responsible_client_id`), info (sex, language, birthday + age, contact mailto/tel with +1 (xxx) xxx-xxxx format, address multi-line — country only if not Canada, primary pro; each block editable), payeurs externes, relations, visites, notes, consentements, demandes, historique, footer archive/unarchive + delete.
- [ ] Relations: add (search or picker), delete with confirm, click opens related client; self + already-related excluded.
- [ ] Visits: balance, upcoming (first 3), past (first 5); status upcoming/completed/cancelled (past created/confirmed = completed); payment badges; click → appointment in agenda.
- [ ] Demandes list on client: id, type, urgency, role, participant count, assigned pro + primary profession, banner if any `toAnalyze` (`clients/api.ts:583-662`).
- [ ] History: last 50 audit rows, 3 shown + expand, FR field labels, old → new diffs, relation events.

### Business rules
- [ ] Required: `first_name`, `last_name`, `language` (default `fr`). `sex` ∈ {male, female, other}. `province` ∈ 13 Canadian codes; country default Canada.
- [ ] Name validation: ≤ 100 chars, ≥ 1 letter `[a-zA-ZÀ-ÿ]` (`shared/lib/client-validation.ts:144-151`). Email optional, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`. Cell optional, 10 digits or 11 starting with 1.
- [ ] Quick-create (from pickers) requires 5 fields: first, last, DOB (not future), email, phone.
- [ ] Phones stored E.164 (`clients/api.ts:18-50`): 11 digits starting 1 → `+digits`; 10 → `+<cc><digits>`; ≥ 7 → cc prepended; shorter → raw.
- [ ] Duplicate gating: HIGH blocks submit; MEDIUM requires confirm checkbox; submit disabled while checking.
- [ ] Relations: types parent, child, spouse, sibling, guardian, ward, other. Inverse parent↔child, guardian↔ward; spouse/sibling/other symmetric. No self relation; one relation per pair. `relationType` = what the related client is to the source. Stored once with `client_a_id < client_b_id` (trigger swaps ids + types); read via view `client_relations_expanded` (one row per perspective).
- [ ] Guardian: `responsible_client_id` self-FK (on delete set null) — displayed only, no UI to set.
- [ ] Archive = soft delete `is_archived`; archived excluded from pickers and relation lists.
- [ ] RLS: admin/staff read/insert/update all; provider read/update only clients whose `primary_professional_id` is theirs; delete admin only; audit admin read. ⚠ `client_relations` currently open to any authenticated user (regression, `mig/20260122000004:150-172`).

### Payeurs externes (IVAC / PAE) — on the client
- [ ] Max one active payer per type per client (partial unique index). Add disabled when both exist.
- [ ] IVAC: `file_number` required + globally unique; `event_date`, `expiry_date` optional; flat rate **9450 ¢** (`external-payers/types.ts:8`); shows the professional's IVAC number + clinic provider number.
- [ ] PAE: `file_number`, `pae_provider_name`, `expiry_date` required; `employer_name`, `reimbursement_percentage` 0-100, `maximum_amount_cents`, `file_opening_fee`, `coverage_rules` (ordered JSON: `free_appointments{appointment_count}`, `shared_cost{pae_percentage}`, `fixed_client_amount{client_amount_cents}`, `included_services{services}`); unique (provider, file_number); counters `appointments_used`, `amount_used_cents`.
- [ ] Badges: "Expiré" when expiry < today; "Budget bas" when used ≥ 80 %.
- [ ] Deactivate (`is_active=false`) from UI; reactivate/delete API only. Create rolls back base row if detail insert fails.

### Calculations
- [ ] Age = `differenceInYears` on date-only birthday. Status = archived ? archived : active.
- [ ] `balance_cents` signed: negative = client owes, positive = credit.
- [ ] Consent rollup: any valid unexpired → `valid`; else any expired → `expired`; else `missing`.
- [ ] Tag universe = distinct union of all clients' tags.

### Duplicate detection algorithm (`shared/hooks/use-duplicate-detection.ts`)
- [ ] Normalize: email lower/trim; phone digits; names lower/trim/collapse spaces; DOB `YYYY-MM-DD`.
- [ ] Trigger: debounce 400 ms, 30 s cache; runs when email > 3 chars, phone ≥ 10 digits, or first+last > 1 char each.
- [ ] Q1: `email ilike` OR `cell_phone ilike %last10%` (limit 10). Q2 (if first+last+DOB): name ilike + birthday = (limit 10).
- [ ] HIGH: exact email | exact last-10 phone | exact first+last+DOB. MEDIUM: exact first+last | both name similarities > 0.8 + partial contact (email local parts contain each other & len > 5, or last-7 phone digits contain each other).
- [ ] Similarity: equal → 1; containment → max(0.7, short/long); else common-prefix / long.
- [ ] Output sorted high > medium, reasons: email, phone, name+dob, same_name, similar_name, partial_email, partial_phone; "select existing".

### Automations
- [ ] `generate_client_id`: `CLI-` + 7-digit sequence.
- [ ] `audit_client_changes`: created / archived / unarchived / updated (old/new of changed fields) / deleted.
- [ ] `enforce_client_relation_ordering`, `audit_client_relation_changes` (logs on both clients with perspective type).
- [ ] `update_client_last_appointment`: on appointment_clients + appointment status change → `last_appointment_at` = max(start) where status ∈ (created, confirmed, completed) and start ≤ now.
- [ ] `recalculate_client_balance`: `balance_cents = Σ(−invoice.balance_cents)` over non-void invoices (invoice balance excludes external-payer coverage).

### Data fields
- [ ] `clients`: client_id, first_name, last_name, sex, language, birthday, email, cell_phone (+country_code), home_phone (+cc), work_phone (+cc), work_phone_extension, street_number, street_name, apartment, city, province, country, postal_code, last_appointment_at, primary_professional_id, referred_by, custom_field, tags[], is_archived, responsible_client_id, balance_cents. (`last_appointment_service/professional` never populated.)
- [ ] `client_notes` (content, author). `client_consents` (consent_type, status valid/expired/missing, signed_at, expires_at, signed_by, document_path). Consent types: Consentement aux soins, Consentement parental, Consentement pour mineur, Télépsychologie, Autorisation de communication.

### Integrations
- [ ] Google Places (New) via `google-places-autocomplete` / `google-places-details`: ≥ 3 chars, 300 ms debounce, `includedRegionCodes:['ca']`, `languageCode:'fr'`, location bias (44.5,-75.5)-(47.5,-71.0); details FieldMask `addressComponents,formattedAddress`; maps street_number, route, locality/sublocality, admin_area_1 → province code, country, postal_code. Secret `GOOGLE_PLACES_API_KEY`.

### Half-built / broken (do not port as-is)
- Archive/Delete only `console.log` (`pages/clients.tsx:58-68`); role checks hardcoded true.
- Tag edits never saved; notes & consents never fetched or written; `updateClient` drops `customField`/`responsibleClientId`; no UI for guardian / custom field / referred_by.
- Add-relation "new client" uses fake id `CLI-NEW-<ts>`; client → demande link uses wrong route.
- Search debounce not cancelled; duplicate check Q1 returns arbitrary rows when only name+DOB; name-only never checks; commas break PostgREST `.or()`.

---

## C. Demandes

### Features
- [ ] List: status segmented control with counts (all, toAnalyze, assigned, closed); search on `demande_id`; sort id/createdAt (default desc)/status/urgency; columns id, status, type, clients (principal + count), motifs (first 2 + count), createdAt (relative), urgency; column picker.
- [ ] Intake form (`pages/request-detail.tsx`): type (individual, couple, family; group "bientôt"), motifs + description + "autre" text, `besoin_raison`, enjeux yes/no → {coparentalité, autre} + comment, diagnostic yes/no → detail, consulté avant yes/no → {psychologue, travailleur social, psychoéducateur, médecin, autre} + comment, contexte légal yes/no → {ordonnance du tribunal, DPJ} + detail, schedule preferences (am, pm, soir, fin de semaine, autre → detail). "Non" clears dependent fields.
- [ ] Internal: notes, urgency low/moderate/high.
- [ ] Participants: add from picker (search or quick-create with duplicate check), crown for principal, consent badge + version + signed date, link to client, remove (only `toAnalyze`) with confirm.
- [ ] Save (draft → creates, navigates to id), Analyser → analysis page; everything read-only when closed. Context-aware back link (`?from=…&fromId=`).

### Business rules
- [ ] Status `toAnalyze` (default) → `assigned` → `closed`. Save only draft/toAnalyze; Analyze only toAnalyze.
- [ ] Participants by type: individual = 1, couple = 2, family ≥ 2, group ≥ 3 (disabled). Add hidden when no type / max reached / closed. Violations warn, don't block.
- [ ] Roles principal | participant; one row per client; first added = principal; removing principal promotes next.
- [ ] Participant consent snapshot (`consent_status`, `consent_version`, `consent_signed_at`) copied from client rollup at add time; banner all-valid vs warning; does not block.
- [ ] Assign: status=assigned, `assigned_professional_id`, `assigned_at`, `assigned_by`; then sets `primary_professional_id` on participants that have none.
- [ ] RLS: admin/staff full; provider reads demandes assigned to them; delete admin; participant delete admin/staff; audit admin/staff.
- [ ] `schedule_preferences <@ {am,pm,evening,weekend,other}`.

### Automations
- [ ] `generate_demande_id`: `DEM-<year>-` + 4-digit **global** sequence (does not reset yearly).
- [ ] `audit_demande_changes`: created, assigned, closed, status_changed (field edits not audited).

### Data fields
- [ ] `demandes`: demande_id, status, demand_type, selected_motifs[], motif_description, other_motif_text, urgency, notes, assigned_professional_id, assigned_at, assigned_by, closed_at, closed_by, closure_reason, besoin_raison, enjeux_has_issues, enjeux_demarche[], enjeux_comment, diagnostic_status, diagnostic_detail, has_consulted, consultations_previous[], consultations_comment, has_legal_context, legal_context[], legal_context_detail, schedule_preferences[], schedule_preference_detail.
- [ ] `demande_participants`: demande_id, client_id, role, consent_status, consent_version, consent_signed_at.

### Half-built / broken
- Close button has no handler; `closed_*` never written. Analyze on a draft doesn't save first. Detail never shows the assigned pro.
- Motif keys hardcoded (12) in `motif-selector.tsx` instead of the motifs table — must align with `motifs.key` for matching. Urgency sorts as text. Orphan `demande_motifs` table.

---

## D. Recommandations / matching

### Features
- [ ] Analysis page: read-only intake summary; recommendations panel (stored result or "Générer"; refresh = force regenerate); input summary (total analysed, filtered by clientèle, filtered by availability, eligible); top **3** cards shown (top 5 stored); generated at / processing time / model version.
- [ ] Card: name, titles, score %, ≤ 3 matched motifs (green), ≤ 2 unmatched (red) + "+N", next slot + slot count, "Voir profil", "Sélectionner". Profile dialog: bio, motifs, specialties.
- [ ] Slot selection: service = pro's services, default by type (individual → `intervention_web_50`, couple/family → `intervention_couple_famille_60`), else first; duration = service default or 50; 14-day window; 30-min steps inside `available` blocks, skip overlaps with created/confirmed appointments; grouped by date and morning/afternoon/evening; flagged matching preferences ("N selon préférences / M autres").
- [ ] Confirm: create appointment (all participants, status `created`) → assign demande → back to demande.

### Live algorithm (`simple-matcher.ts`, `simple-matcher-v1`)
1. [ ] Candidates: all active professionals with professions, specialties, motifs, services.
2. [ ] Age category of principal (or first participant): ≤ 12 children, ≤ 17 adolescents, ≤ 64 adults, 65+ seniors, unknown → adults.
3. [ ] Hard clientèle filter: couple → specialty `couples`; family → `families`; group → `groups`; else the age-category specialty.
4. [ ] Motif score = matched / requested (1 if none requested); keep matched/unmatched lists.
5. [ ] Availability: today → +14 days; 50-min slots stepping 30 min from max(block start, now), must fit in block and not overlap a booking; must match **any** preference (am < 12 h; pm 12–17 h; evening ≥ 17 h; weekend Sat/Sun; empty or contains `other` = no filter). 0 slots → dropped. ⚠ uses browser time, not clinic timezone.
6. [ ] Rank: motif score desc, then slot count desc; keep top 5.
7. [ ] Persist: previous `is_current` → false + `superseded_at`; insert `demande_recommendations` (input snapshot, results, timing), `recommendation_professional_details`, audit 'generated'. Without force, existing current result returned.

### Dormant but designed (decide Keep/Drop per module design)
- [ ] `deterministic-scorer.ts`: config in `recommendation_configs` (weights sum 100; seed 30/25/20/15/10, window 14 d, motif overlap + clientèle required, max 40 h, max 20 yrs). Hard constraints no_availability / no_motif_overlap / no_clientele_match / no_demand_type_specialty → eligible / near-eligible (1 failure) / excluded. Scorers: motif ratio; specialty Σ(specialized 1.0 : 0.6)/|relevant| (empty → 0.5); availability min(h, max)/max; profession fit (base 0.7; naturopath / clinical override / legal context rules); experience min(y, max)/max (missing 0.5).
- [ ] `holistic-classifier.ts`: keyword categories body/energy/lifestyle/global/clinical override; weighted score + multi-category bonus; `recommendNaturopath` = score ≥ 0.5 and no clinical keyword. Has tests.
- [ ] `schedule-interpreter.ts`: Claude parses free-text schedule preference into `{days, timeRanges}`. Must move to an edge function if kept (currently uses `process.env` in browser).
- Unused DB columns: `ai_summary_fr`, `ai_extracted_preferences`, `ai_ranking_adjustment`, `ai_reasoning_bullets`, `matched_specialties`.

### Shared
- [ ] Command palette ⌘/Ctrl+K: navigation only (8 routes). No record search yet.

---

## E. Rendez-vous / Disponibilités

### Features
- [ ] Two modes: booking (default) and availability; toggle to overlay availability in booking mode (`pages/availability.tsx:77,538`).
- [ ] Professional selector (active pros, first auto-selected). Week view starting Monday; day + list views exist but not exposed.
- [ ] Deep link `?appointmentId=&date=` → select pro, jump to week, open appointment.
- [ ] Grid 06:00–22:00, 30-min slots. Drag on empty column (availability mode) creates a block (min 30 min). Move/resize blocks (min 30 min). Move/resize appointments (not cancelled), duration clamped 15–240 min. Drag a service from the sidebar onto the grid → new appointment draft (status `created`, mode `video`, service duration).
- [ ] Slot click: availability mode → new 30-min "available" block; booking mode → new appointment, first service, default 50 min.
- [ ] Availability block editor: types available / break / blocked / vacation; label (non-available types); date; start/end (30-min step); "Visible aux clients" (default true); delete with confirm; warns when non-cancelled appointments overlap.
- [ ] Availability sidebar: quick-create "Disponible" / "Bloqué" 9:00–17:00 today; this week's blocks; last 20 audit events.
- [ ] Booking sidebar: service palette filtered to the pro's services (all if none assigned); profession-category picker when pro has several professions; next 8 upcoming appointments grouped by day.
- [ ] Appointment editor (Participants / Rendez-vous / Facturation / Historique): client picker limited to clients whose primary pro is this pro; clients editable only before first save; client count by service key (`couple` → exactly 2; `famille/familiale` → 2–6; else 1; save disabled outside); date, time (30-min step), duration (15–240 step 5), mode in_person / video / phone (default video), status created/confirmed + "Confirmer"; internal notes; profession selector (default primary).
- [ ] Cancel dialog: optional reason; if start < 24 h → choose "Aucun frais" or "Appliquer des frais" with % (default 50, step 5, 0–100). Cancelled banner shows reason + fee, Restore, fee editable afterwards.
- [ ] Bookable service = active and (duration > 0 or hourly prorata); default duration 30 (hourly) else 50; default colour `#7FAE9D`.

### Rules
- [ ] Statuses `created → confirmed → completed`, or `cancelled`. No-show = cancellation with reason "Client absent". DB checks: cancelled ⇔ `cancelled_at`; completed ⇔ `completed_at`; duration > 0.
- [ ] Restore → `confirmed`, clears `cancelled_at`, `cancellation_reason`.
- [ ] `appointment_clients.role`: first = `primary`, others `other`; `attended` unused.
- [ ] `availability_blocks.allowed_service_ids` (null = all; no UI), `visible_to_clients`.
- [ ] RLS: admin/staff full; provider read/update own only, cannot create.

### Automations
- [ ] Audit triggers on blocks, appointments, appointment_clients → `appointment_audit_log` with context (service/pro names, slot, cancellation fee).
- [ ] `update_client_last_appointment` (see Clients).

### Google Calendar (freeBusy)
- [ ] Connect: state `{professionalId, nonce, timestamp}` (5 min), scopes `calendar.readonly email profile`, offline + consent; refresh token required; tokens AES-256-GCM encrypted; one connection per pro; audit `calendar_connected`.
- [ ] Sync (manual button): refresh token if < 5 min left (fail → status `expired`); freeBusy now → +21 days, `America/Toronto`, calendar `primary`; full replace of busy blocks; shown as "Occupé" (type `imported`).
- [ ] Disconnect: revoke at Google, delete blocks + connection, audit `calendar_disconnected`.

### Half-built / broken (do not port as-is)
- `profession_category_key` never saved on appointments; booking validation (`utils/validation.ts`: within availability, allowed service, conflicts) never called → overlaps allowed.
- Google busy blocks draggable/editable by mistake. Grid uses browser time while DnD writes clinic time.
- `completed` never set; no automation completes past appointments; `last_appointment_at` goes stale. Restore doesn't reset fee and audits as confirmed.
- Recurrence not implemented. Google functions don't verify caller/ownership. Parallel dead API layer.

---

## F. Facturation

### Features
- [ ] Billing tab on the appointment: existing invoice summary (status, total, balance, open) or "Facturer à" (participants + parents/guardians of first client), price preview, "Prix non configuré" warning, cancellation-fee info, new-client alert (file-opening fee), active external payers, "Créer la facture" (disabled if cancelled without fee).
- [ ] Creation dialog: lines, file-opening fee toggle (pre-checked for new clients), client notes + internal notes. QuickBooks button (disabled).
- [ ] Invoice view: client / appointment / professional; lines (removable unless paid/void); totals subtotal, discount, TPS, TVQ, total, "Couvert par tiers payeur", "Total client", paid, balance; IVAC "Appliquer"; allocations (removable); payments (removable); actions Finaliser (draft → pending), Annuler (void, with reason appended to internal notes `[Annulé: …]`), Enregistrer un paiement (if not void/paid and balance > 0), Imprimer; QuickBooks-synced banner.
- [ ] Add line: service (auto price) or free adjustment; qty ≥ 1, unit price > 0.
- [ ] Payment: amount default = balance, > 0 and ≤ balance; date default today (clinic tz); methods cash (Comptant), debit (Débit), credit (Crédit), etransfer (Virement Interac), cheque (Chèque), other (Autre); reference; notes.

### Rules & calculations
- [ ] Statuses `draft`, `pending`, `partial`, `paid`, `void`. One non-void invoice per appointment (⚠ couples: only one client invoiced).
- [ ] Tax per line: TPS = round(base × 0.05), TVQ = round(base × 0.09975), each rounded separately; base = line after discount; invoice taxes = Σ lines.
- [ ] Discount (model only): percent → round(qty × unit × pct/100); fixed → cents. Line `subtotal_cents` stored after discount; check `total = subtotal + tps + tvq`. Invoice `subtotal_cents = Σ(line.subtotal + line.discount)` (before discount), `discount_cents = Σ discounts`.
- [ ] Taxable: service `is_taxable_override` (can only force on) else category `tax_included` else not taxable. All prices stored pre-tax.
- [ ] Hourly prorata: per-minute = round(hourly_rate_cents / 60); price = per-minute × minutes; stored `quantity_unit='minute'`.
- [ ] Cancellation fee: round(full service price × fee% / 100) (hourly price for prorata services); single line `line_type='cancellation_fee'`, name `"<service> - Frais d'annulation (X%)"`, same tax flag; cancelled with 0 % / no fee → no line.
- [ ] File-opening fee: `ouverture_dossier` service price (4349 ¢ pre-tax, taxable override → 5000 ¢ incl. taxes); never on cancelled appointments.
- [ ] `client_amount = total − external_payer_amount`; `balance = client_amount − paid`. Status: paid ≥ client_amount → `paid`; paid > 0 → `partial`; else keep.
- [ ] Client balance = −Σ invoice.balance over non-void invoices (drafts included).
- [ ] Invoice number `INV-YYYY-NNNNNN`, one global sequence (no yearly reset).
- [ ] New-client detection: any non-void invoice → not new; else no relations → new; else a related client has a non-void invoice → `existing_relation` (no fee); else new.

### Automations
- [ ] `create_invoice_with_line_item(appointment, client, notes_client, notes_internal, add_file_opening_fee)` (final = `20260125000005`): validate, reject if non-void invoice exists, resolve category (appointment → primary profession), price lookup (hourly → `profession_category_rates`; else `service_prices` category match > null, newest), insert service or cancellation line, then file-opening line, totals, audit.
- [ ] Triggers: `recalculate_invoice_totals` (lines, payments), allocations → `update_invoice_payer_amount`, `recalculate_client_balance`, `generate_invoice_number`.
- [ ] `invoice_audit_log` (written from frontend): finalized, updated, voided, line added/updated/removed, payment recorded/removed, payer allocated/reported/paid.
- [ ] RLS: provider reads own invoices; staff insert/update; admin delete (invoices, payments, allocations).

### Half-built / broken (do not port as-is)
- Server never applies category `tax_included` for non-hourly services → naturopathie/coaching untaxed although preview shows taxes.
- Creation-dialog line edits discarded (RPC rebuilds lines). Preview shows hardcoded $35 untaxed file fee vs real $50.
- Total 0 → `void` (free "Appel découverte"). Removing all payments doesn't revert status. Full IVAC coverage → `paid`. `payer_removed` audit fails silently.
- Preview uses `professions[0]` vs RPC primary profession. `due_date` never set. Staff see "remove payment" but RLS denies.

---

## G. Payeurs externes (IVAC / PAE) — billing side

- [ ] PAE coverage-rule builder with 5 templates: 3 free then 50/50; 4 free + evaluation & follow-up; 3 free then client pays $50; 6 fully covered; 70/30 from the start.
- [ ] IVAC report (`/rapports/ivac`): totals (count, amount, pending/reported/paid), status filter, sort date/client/pro, columns incl. pro IVAC number, client IVAC file number, service, invoice link. CSV export disabled; date/pro filters API-only.
- [ ] Professional IVAC number: unique per pro and globally; admin-only write.
- [ ] Allocations: `amount_cents > 0`, `ivac_rate_applied_cents`, `pae_rule_type_applied`, `pae_percentage_applied`; status `pending → reported → paid` (+ timestamps).
- [ ] IVAC: payer covers min(9450, invoice subtotal before tax/discount); expired payers hidden; one allocation per payer per invoice.
- [ ] PAE algorithm (designed, **never called**): remaining = max − used (≤ 0 → 0); first matching rule by `order`: free_appointments (session ≤ count → min(total, remaining)); shared_cost (session ≥ from → min(round(total × pct/100), remaining)); fixed_client_amount (session ≥ from → client pays min(amount, total), payer min(total − client, remaining)); included_services no-op; fallback `reimbursement_percentage` capped.
- Half-built: PAE never applicable, usage counters never move, reported/paid workflow has no UI.

---

## H. Services, tarifs et taxes

### Features
- [ ] Services list: search name/description; filter active/archived/all with counts; sort order/name/duration/price; grouped by pricing model; create/edit/archive/restore.
- [ ] Service fields: name (required), description, duration, pricing model, base price (required for `fixed` and hourly prorata), colour, `requires_consent`, "toujours taxable" override. Key = slug of name (accents stripped, non-alnum → `_`; no duplicate handling).
- [ ] Tarifs per profession category: "Offert" checkbox + pre-tax price per category-priced service; category taxable toggle (`tax_included`); hourly rate; after-tax preview (× 1.14975).

### Rules
- [ ] Pricing models: `fixed` (global price), `by_profession_category`, `by_profession_hourly_prorata` (`profession_category_rates`), `rule_cancellation_prorata` (unused).
- [ ] Profession categories → titles: psychologie (psychologue), psychothérapie, travail social, psychoéducation, sexologie, naturopathie, orientation, coaching professionnel. Taxable: naturopathie, coaching.
- [ ] Seed prices pre-tax (30 / 50 / 60 couple): Psychologie & Psychothérapie 120/160/185; Sexologie & Psychoéducation 96/130/155; Travail social 80/110/130; Orientation 96/130/—; Naturopathie —/130/—; Coaching 70/110/—. Hourly rate = (50-min price / 50) × 60.
- [ ] 12 seeded services incl. Appel découverte (fixed $0) and Ouverture de dossier (fixed $43.49, taxable).
- [ ] Professional services assigned per profession title (`20260125000004`). Writes admin/staff only.

### Broken
- Duplicate price rows on every save (NULL `duration_minutes` in unique key). Hourly base price saved but ignored. Tax rates in table but hardcoded in code.

---

## I. Paramètres, tâches planifiées, tableau de bord, auth

- [ ] Settings tabs today: Motifs, Spécialités, Services, Clinique, Tâches planifiées, Gabarits (Profil, Notifications, Sécurité, Apparence disabled).
- [ ] Clinic settings: IVAC provider number (admin), timezone (6 NA zones, default `America/Toronto`) — ⚠ saved timezone not used anywhere (hardcoded).
- [ ] Scheduled tasks: lists pg_cron jobs + last 20 runs; card `check-insurance-expiry-daily` (`0 6 * * *` UTC) with "Exécuter" and setup SQL (schedule not in migrations).
- [ ] Insurance deactivation: active pros whose latest **verified** insurance doc has `expires_at` null or past → `inactive`, reason `insurance_expired` (never overrides `manual`). Reactivation trigger when a new insurance doc is verified with future expiry and reason was `insurance_expired`. `next_insurance_expiry_date()` = next March 31. ⚠ functions callable by any authenticated user.
- [ ] Dashboard = placeholder; Reports = link to IVAC report.
- [ ] Auth: email/password; requires `profiles` row with status active (else signed out with `profile_not_found` / `profile_disabled`); redirect `/connexion?redirect=` → back or `/dashboard`. Roles admin/staff/provider; staff/providers update own `display_name` only; staff can create only provider profiles; `profile_audit_log` admin read.
- [ ] i18n: single `fr-CA.json`, typed `t()` dot-paths returning key when missing; namespaces app, auth, nav, topbar, roles, professionals, pages, common, filters, clients, demandes, externalPayers, settings, commandPalette, errors, audit, facturation, recommendations. Many components hardcode French.
