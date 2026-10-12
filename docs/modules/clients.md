# Module `clients` (« Clients »)

The clinic's client files (~7 400 active and ~1 080 archived in GOrendezvous): one row per person, the relations between people and what each may do for the other, insurance, payers (IVAC, PAE), tags, and which professionals may see a client. Plan: [coding plan §6](../plans/2026-10-11-modules-coding-plan.md#6-clients-clients--full-task-detail); roadmap §2.2 and §2.2 bis; data: [GOrendezvous tour §2](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); decisions R-5, R-7 … R-10, R-48, R-54, R-61, R-64 and **CL-1 … CL-11** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| C1 | Schema: registry, tables, RLS, audit, published views and helpers, the agreements' FK | built |
| C2 | RPCs: duplicates, create / update / archive, relations, insurance, payers, tags, merge, search, summary, Loi 25 export and anonymisation, `client_contacts_for` | planned |
| C3 | List, « Nouveau client », record, « Mes clients » | planned |
| C4 | Merge UI, « Confidentialité », ⌘K, e2e, this doc completed | planned |
| C5a | Client consents: schema, RPCs, functions (part 1); UI (part 2) | part 1 built |
| C5b | Withdrawal, copy to the client, reports, re-sign campaign | planned |

- **Registry:** `modules.key = 'clients'` (migration `20261012213428_clients_module`), depends on `professionals`. It **starts disabled** in every clinic; the local seed enables it.
- **Migrations:** `20261012213428_clients_module`, `20261012213431_professionals_client_agreements_client_fk` (Professionnels: `professional_client_agreements.client_id → clients`).
- **Tests:** pgTAP `104_clients_module`; Vitest `src/modules/clients/manifest.test.ts`; the audit labels checked by `src/app/audit-labels.test.ts`.

## Permissions

| Permission | Default roles | Gives |
|---|---|---|
| `clients.view` | admin, conseillère, adjointe | read every file of the clinic (staff) |
| `clients.manage` | admin, conseillère, adjointe | create and change files (C2's RPCs) |
| `clients.merge` | admin, adjointe | merge duplicates |
| `clients.privacy` | admin | Loi 25 export and anonymisation |
| `clients.self` | admin, professionnel | read her own clients (`my_clients`) |

## Tables

All per clinic (`org_id`), RLS on, `select` only for clients (every write is an RPC, C2), audited with `private.audit_trigger`, personal values redacted (the journal shows that a field changed, never its value).

| Table | What | Rules |
|---|---|---|
| `clients` | identity (names, prénom à la naissance, pronoms, sexe, naissance), contacts (email in lower case, phones E.164, poste), language `fr` / `en`, fuseau, **reminder channels of this person** (`reminders_by_sms`, `reminders_by_email`), address, provenance (`referral_source_id`), « Référé par », custom field, primary professional, fields from tags (`rate_variant` student / reduced, `tax_exempt` « Statut Indien », `is_banned`, `file_incomplete`, `special_agreement`), `shared_custody`, `external_ref` (GOrendezvous ClientId), archived / merged into / anonymised | `client_number` given in order per clinic at creation (trigger, org row locked), never changed; province a code in Canada, free abroad; one `external_ref` per clinic. Redacted: names, pronouns, sex, birthday, contacts, time zone, address, « Référé par », custom field, `tax_exempt` |
| `client_notes` | staff-only notes: `admin_notes`, `special_agreement_note` | never read by a professional; both redacted |
| `client_relations` | a pair of clients, stored once with `client_a_id < client_b_id` (a trigger swaps a reversed write: ids, types and rights), `type_a_to_b` / `type_b_to_a` (parent / child, guardian / ward, spouse, sibling, other), and per direction `*_main_contact`, `*_manages_appointments` (books and signs forms for the other: the 14-year consent rule, R-48), `*_receives_communications`, `*_receives_invoices` (may be chosen as the invoice's payer, R-61) | one relation per pair; never with oneself; inverse types only |
| `client_insurances` | rank 1 / 2, insurer, policy and certificate numbers, holder | redacted but the rank |
| `client_payers` | `ivac` (file number) or `pae` (provider), amount per session, max sessions or amount, dates, active | one active per kind and client; an active IVAC file number once per clinic; file number and note redacted. No employer program (Christine) |
| `client_tags` / `client_tag_links` | the clinic's list of free tags; ≤ 5 per client (trigger) | tag names are not personal |
| `referral_sources` | « Comment avez-vous entendu parler de MANA ? »: the website's list, seeded per clinic (source `seed:clients_reference`) | reference list (immutable key, soft delete) |
| `client_professional_links` | which professionals may see a client (R-8): `created`, `primary`, `appointment`, `demande`, `import`; first and last link | written by `private.clients_link_professional` |
| `client_merges` | the trail of a merge (kept, merged, counts moved) | one merge per merged client |

## What the module publishes

Other modules read these, never the raw tables (CLAUDE.md §5):

- **`clients_directory`** (security invoker, `clients.view`): `id, org_id, client_number, first_name, last_name, display_name, pronouns, sex, birthday, language, email, mobile_e164, reminders_by_sms, reminders_by_email, primary_professional_id, referral_source_id, rate_variant, tax_exempt, is_banned, file_incomplete, special_agreement, shared_custody, external_ref, is_archived, archived_at, merged_into_id, is_anonymized, created_at, updated_at`. Later batches only append columns.
- **`my_clients`** (security invoker over the definer `private.my_clients_rows()`, which checks `clients.self` first): the professional's linked clients (anonymised ones left out) with `display_name`, pronouns, birthday, language, email, mobile, `is_primary`, the link's reason and dates, `is_archived`; never notes, insurance, payers or tags. **A professional has no policy on any client table** (only on her own rows of `client_professional_links`): `my_clients` is her only read (CL-5).
- **`private.clients_link_professional(p_org, p_client_id, p_professional_id, p_reason)`**: for definer callers (Rendez-vous on booking, Demandes on assignment, C2, the import), after their own permission check, with the org they verified; keeps the first reason. Granted to no role.
- **`private.client_visible_to_professional(p_client_id, p_professional_id)`**: for the provider reads of Rendez-vous and Facturation. Granted to no role.
- **For Services et tarifs' prices:** a client's `rate_variant` is the `p_variant` and `tax_exempt` the `p_tax_exempt` of `service_price` (S-1, S-2).
- **Coming in C2:** `search_clients`, `get_client_summary`, `client_payers_active` (Facturation), `private.client_contacts_for(client, right)` (who receives communications or invoices, on which channels).

## Rules for the other lanes

- A child, each parent and a spouse are each a client; never store a guardian on the child's row. Who signs, books or pays for someone is read from the relation's rights.
- Reminders go to each person on her own channels (`reminders_by_sms`, `reminders_by_email`); the SMS consent and « ARRÊT » are Communications' (R-54, R-73).
- An invoice is never split: Facturation chooses one payer per invoice among the client and the relations with `*_receives_invoices` (R-61).
- `special_agreement`: the invoices wait in the morning queue for validation (R-56); the note is staff-only.
- Testing in production uses dry-run-imported clients and named testers only (R-72; « core: module testers », next PR).

## For C2 and the import (from the C1 review)

- **Merge** (`merge_clients`): delete the relation between the two files first; for a person related to both, OR the rights into the kept file's row and drop the merged one; resolve `client_insurances` (rank), `client_payers` (one active per kind), tags (shared, > 5 combined) and links (primary key) before moving the rest; follow `merged_into_id` chains. Moving a relation side re-sorts the pair and swaps it whole (the trigger), which keeps who holds which right.
- **Ententes particulières:** `set_professional_client_agreement` finds the open agreement by label when `client_id` is null, and the no-overlap key is `coalesce(client_id, label)`: I1 fills `client_id` on every row of a series at once, and the RPC learns to match on `client_id` or the label in the same release; a merge re-points agreements through a Professionnels hook.
- **Links:** they never end today; add an end (or an unlink helper) before Demandes writes links on reassignment. `clients_link_professional` moves `last_linked_at` at most once a day.
- **Anonymisation:** `anonymize_client` deletes the relations and tag links (their audit rows would still tie the person to a relative), blanks the identity and `external_ref`; `anonymized_at` can never be cleared (trigger).
- **File numbers:** a transaction-level advisory lock per clinic (not the org row), also for an explicit number (the import's).
- **Search:** at ~8 500 rows a scan is fine; C2 may add an `unaccent` expression index (Professionnels' immutable normaliser) for accent-insensitive search and the phone digit matches.

## Consents (batch C5a)

Migrations `20261012214959_core_signing_second_client_signer` (core: the `client_2` role) and `20261012215154_clients_consents`; pgTAP `105_clients_consents`; decisions R-46 … R-51, **CC-1 … CC-7**.

- **Tables:** `client_consent_types` (the 7 consents and their clauses), `client_consent_rules`, `client_consent_settings` (one row per clinic), `client_consent_requests` (one open per client and consent; the version, the language and the clauses are fixed when it is sent; the answers are redacted in the audit), `client_consent_request_signers` (`client` / `client_2`, each with her own link), `client_consents` (the consent in force: not superseded, not withdrawn; signer names, answers and note redacted). Read with `clients.view`; every write is an RPC.
- **Templates:** `clients.consent_<key>_fr` / `_en` (core templates of the module, view `clients.view`, edit `clients.manage`), seeded as drafts « Texte provisoire »; the clauses print through the block placeholder `{{consent.clauses}}`.
- **Staff RPCs** (`clients.manage`): `set_client_consent_rule`, `set_client_consent_settings`, `cancel_client_consent_request`, `publish_client_consent_version(version, 'new_clients' | 'all_active')` (core's publish, then the « À signer de nouveau » flag for every active consent of that consent and language, R-49).
- **Service RPCs:** `prepare_client_consent_request_for_service` (actor model: two token hashes, one per signer), `open_client_consent_for_service`, `start_client_consent_signing_for_service`, `client_consent_reminders_for_service`, `import_client_consent_fact_for_service` (I1). Link purpose `client_consent` with `resolve_client_consent_link`.
- **Functions:** `clients-consent-send` (user, `clients.manage`: send or resend, emails `clients.consent_request` / `_en` with `/consentement#t=…`), `clients-consent-sign` (public token: open, then answers and embedded signing; renders), `clients-consent-reminders` (job `clients.consent_reminders`).
- **Published for other modules:** `private.required_consents_for(org, client, service_code, payer_kind, professional_status, situations, context_type, context_id)` → (consent_key, frequency, state) for Rendez-vous (R1, R2, R5) and Demandes (D3); views `client_consents_status` (staff), `client_consents_to_obtain` (« Consentements à obtenir »), `my_client_consents` (the professional's linked clients, clients.self).
- **Coming in C5a part 2 (UI):** the record tab « Consentements », Paramètres → Consentements (rules, settings, publishing the texts), the public page `/consentement`, the list « Consentements à obtenir ». The template text editor lives in Professionnels today; for the clinic's texts, either it moves to core or the texts are pasted by a migration (decision to take with Jonathan).
