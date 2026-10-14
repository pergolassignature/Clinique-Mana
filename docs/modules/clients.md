# Module `clients` (« Clients »)

The clinic's client files (~7 400 active and ~1 080 archived in GOrendezvous): one row per person, the relations between people and what each may do for the other, insurance, payers (IVAC, PAE), tags, and which professionals may see a client. Plan: [coding plan §6](../plans/2026-10-11-modules-coding-plan.md#6-clients-clients--full-task-detail); roadmap §2.2 and §2.2 bis; data: [GOrendezvous tour §2](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); decisions R-5, R-7 … R-10, R-48, R-54, R-61, R-64 and **CL-1 … CL-29** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| C1 | Schema: registry, tables, RLS, audit, published views and helpers, the agreements' FK | built |
| C2 | RPCs: duplicates, create / update / archive, relations, insurance, payers, tags, merge, search, summary, Loi 25 export and anonymisation, `client_contacts_for` | built |
| C3 | List, « Nouveau client », record (with C5a's « Consentements » tab), « Mes clients » | built |
| C4 | Merge UI, « Confidentialité » (Loi 25 export and anonymisation), ⌘K, the record's « Historique », remembered list filters, the client picker and the referral sources for other modules | built |
| C5a | Client consents: schema, RPCs, functions (part 1); UI (part 2) | built |
| C5b | Withdrawal, copy to the client, reports, re-sign campaign | planned |
| I1 | GOrendezvous import: clients, relations, price gap report (`import_client`, `import_client_relation`) | built (runs on Jonathan's go-ahead) |

- **Registry:** `modules.key = 'clients'` (migration `20261012213428_clients_module`), depends on `professionals`. It **starts disabled** in every clinic; the local seed enables it.
- **Migrations:** (Demandes' handlers: `20261013022645_demandes_client_handlers`) `20261012213428_clients_module`, `20261012213431_professionals_client_agreements_client_fk` (Professionnels: `professional_client_agreements.client_id → clients`); C2: `20261013022637_clients_duplicates`, `20261013022641_clients_rpcs`; C3: `20261013034343_clients_list`, `20261013040106_clients_email_match_partial_update`; C4: `20261013052242_clients_merge_privacy_history`.
- **Tests:** pgTAP `104_clients_module`, `110_clients_duplicates` (the import library's cases), `111_clients_rpcs`, `113_clients_list`, `114_clients_email_match_partial_update`, `117_clients_merge_privacy_history`; Vitest `src/modules/clients/**/*.test.ts(x)` (manifest, form schema, payloads, list page with the creation sheet and remembered filters, record page, merge, anonymisation, history, the picker, the export's content, ⌘K); Playwright `e2e/clients.spec.ts` (duplicate refused, creation, a parent with rights, « Mes clients », a merge then the export and anonymisation, ⌘K); the audit labels checked by `src/app/audit-labels.test.ts`.
- **Local seed:** five fictional files (« …-Fictive »), Léa with her two parents, an IVAC payer, an insurance, the tags Atelier and Visio; Félix (`provider@mana.test`) is the primary professional of Alice and Léa, so « Mes clients » has rows.

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
| `clients` | identity (names, prénom à la naissance, pronoms, sexe, naissance), contacts (email in lower case, phones E.164, poste), language `fr` / `en`, fuseau, **reminder channels of this person** (`reminders_by_sms`, `reminders_by_email`), address, provenance (`referral_source_id`), « Référé par » (typed `referred_by`, or `referred_by_client_id`: a file of the clinic, one or the other, CL-30), custom field, primary professional, fields from tags (`rate_variant` student / reduced, `tax_exempt` « Statut Indien », `is_banned`, `file_incomplete`, `special_agreement`), `shared_custody`, `external_ref` (GOrendezvous ClientId), archived / merged into / anonymised | `client_number` given in order per clinic at creation (trigger, org row locked), never changed; province a code in Canada, free abroad; one `external_ref` per clinic. Redacted: names, pronouns, sex, birthday, contacts, time zone, address, « Référé par », custom field, `tax_exempt` |
| `client_notes` | staff-only notes: `admin_notes`, `special_agreement_note` | never read by a professional; both redacted |
| `client_relations` | a pair of clients, stored once with `client_a_id < client_b_id` (a trigger swaps a reversed write: ids, types and rights), `type_a_to_b` / `type_b_to_a` (parent / child, guardian / ward, spouse, sibling, other), and per direction `*_main_contact`, `*_manages_appointments` (books and signs forms for the other: the 14-year consent rule, R-48), `*_receives_communications`, `*_receives_invoices` (may be chosen as the invoice's payer, R-61) | one relation per pair; never with oneself; inverse types only |
| `client_insurances` | rank 1 / 2, insurer, policy and certificate numbers, holder | redacted but the rank |
| `client_payers` | `ivac` (file number) or `pae` (provider), amount per session or covered percentage (FP), max sessions or amount, dates, the yearly renewal day, what was used before the app at a date, `is_stub` (the import's tag, to complete), active | one active per kind and client; an active IVAC file number once per clinic; file number and note redacted. No employer program (Christine). Facturation reads them through `private.client_payer_terms` / `client_payer_facts` / `client_payers_of` (FP-1) |
| `client_tags` / `client_tag_links` | the clinic's list of free tags; ≤ 5 per client (trigger) | tag names are not personal |
| `referral_sources` | « Comment avez-vous entendu parler de MANA ? »: the website's list, seeded per clinic (source `seed:clients_reference`) | reference list (immutable key, soft delete) |
| `client_professional_links` | which professionals may see a client (R-8): `created`, `primary`, `appointment`, `demande`, `import`; first and last link | written by `private.clients_link_professional` |
| `client_merges` | the trail of a merge (kept, merged, counts moved) | one merge per merged client |

## What the module publishes

Other modules read these, never the raw tables (CLAUDE.md §5):

- **`clients_directory`** (security invoker, `clients.view`): `id, org_id, client_number, first_name, last_name, display_name, pronouns, sex, birthday, language, email, mobile_e164, reminders_by_sms, reminders_by_email, primary_professional_id, referral_source_id, rate_variant, tax_exempt, is_banned, file_incomplete, special_agreement, shared_custody, external_ref, is_archived, archived_at, merged_into_id, is_anonymized, created_at, updated_at`. Later batches only append columns.
- **`my_clients`** (security invoker over the definer `private.my_clients_rows()`, which checks `clients.self` first): the professional's linked clients (anonymised ones left out) with `display_name`, pronouns, birthday, language, email, mobile, `is_primary`, the link's reason and dates, `is_archived`; never notes, insurance, payers or tags. **A professional has no policy on any client table** (only on her own rows of `client_professional_links`): `my_clients` is her only read (CL-5).
- **`private.clients_link_professional(p_org, p_client_id, p_professional_id, p_reason)`**: for definer callers (Rendez-vous on booking, Demandes on assignment, C2, the import), after their own permission check, with the org they verified; keeps the first reason. Granted to no role.
- **`private.clients_fill_primary_professional(p_org, p_client_ids, p_professional_id, p_replace)`** (migration `20261013210942_clients_primary_from_match`, Demandes D-41): the files among `p_client_ids` with no primary professional get `p_professional_id`, and so do those whose primary professional is `p_replace` (the caller's previous match: a request matched again); a file with another primary professional keeps it; merged and anonymised files are left alone. Returns how many changed. For definer callers (Demandes' match, through `private.demandes_link_clients`), after their own permission check, with the org they verified. Granted to no role.
- **`private.client_visible_to_professional(p_client_id, p_professional_id)`**: for the provider reads of Rendez-vous and Facturation. Granted to no role.
- **`private.clients_import_match(p_org, p_ref, p_name)`** → (status `ok` | `not_found` | `ambiguous`, client_id): for Facturation's GOrendezvous import (I3, BI-20). It finds an imported file by its reference, or by the words of its name among the files « gorendezvous:… » (any order, case, accents; index `clients_org_import_name_idx`). A merged file leads along its merges to the one kept; an anonymised file, found or kept, is never returned. Granted to no role.
- **For Services et tarifs' prices:** a client's `rate_variant` is the `p_variant` and `tax_exempt` the `p_tax_exempt` of `service_price` (S-1, S-2).
- **Coming in C2:** `search_clients`, `get_client_summary`, `client_payers_active` (Facturation), `private.client_contacts_for(client, right)` (who receives communications or invoices, on which channels).

## RPCs (C2)

All definer, permission first, French `P0001` with a HINT naming the field (the form puts the message under it). A merged or anonymised file refuses every write (HINT `merged` / `anonymized`).

| RPC | Permission | What |
|---|---|---|
| `find_client_duplicates(first, last, email, phones[], birthday, exclude)` | `clients.view` | HIGH / MEDIUM candidates with reasons (I-5, CL-12), at most 10, with number, name, birthday, email, mobile, archived |
| `create_client(client jsonb, confirm_medium)` | `clients.manage` | normalises (names trimmed, email lower case, phones to E.164, postal code `A1A 1A1`, province code), refuses a HIGH duplicate (HINT `duplicate`, « n° X »), needs `confirm_medium` for a MEDIUM one (HINT `duplicate_medium`), saves the notes, links the primary professional |
| `update_client(id, client jsonb)` | `clients.manage` | changes the keys it is sent, the others kept as stored (since C3: a record card sends its own fields), the whole file checked again; duplicates not re-checked; the notes only when their keys are present |
| `set_client_notes(id, admin_notes, special_agreement_note)`, `archive_client`, `unarchive_client` | `clients.manage` | |
| `set_client_relation(client, related, type, related_rights, client_rights)`, `remove_client_relation` | `clients.manage` | `type` is what the related person is to the client; rights `{main_contact, manages_appointments, receives_communications, receives_invoices}` per direction; one main contact per client (CL-14) |
| `upsert_client_insurance(client, rank, …)`, `delete_client_insurance` | `clients.manage` | deleting the main one promotes the secondary |
| `save_client_payer(client, id, kind, …)`, `end_client_payer(id)` | `clients.manage` | one active per kind (a second save updates it), an active IVAC file once per clinic; ended payers stay |
| `set_client_tags(client, tag_ids[])`, `save_client_tag(id, name)`, `set_client_tag_active` | `clients.manage` | ≤ 5 active tags of the clinic's list |
| `merge_clients(keep, merge, take text[] default null)` | `clients.merge` | CL-15, CL-16; `take` (C4): the keys of the merged file's values to keep (`private.clients_merge_take_columns`: identity, contacts, the address as a block, provenance, primary professional, rate; never notes or flags); the database copies them from the locked merged row, then runs C2's merge (`private.clients_merge_core`) |
| `list_clients(query, status, professional, tag, after…, limit)` (C3) | `clients.view` | the list page: active / archived / all, by primary professional or tag, the search words of `search_clients`; keyset by the folded last name, first name, id (50 a page); merged and anonymised files never |
| `search_clients(query, limit)` | `clients.view`, or `clients.self` (her linked clients) | ⌘K: every word in the name (accents ignored), the email, the number or a phone's digits; never merged or anonymised files |
| `get_client_summary(id)` | `clients.view`; `clients.self` linked: the `my_clients` columns | the record's bundle: file, notes, relations both ways, insurance, payers, tags, professionals, merges |
| `export_client_privacy(id)` | `clients.privacy` | the summary, the files merged into it, the consents (C4) + `exported_at`; an `audit_log` read row (sections, never values) |
| `list_client_history(id, before, limit)` (C4) | `clients.view` | the record's « Historique »: the audit rows of the file and its notes, relations (either side), insurance, payers, tags, professionals, merges and consents, newest first, keyset on the audit id |
| `anonymize_client(id)` | `clients.privacy` | CL-17; the files merged into it too, every module's copies through its handler |

**For other modules** (all `private`, granted to no role: called from the caller's definer RPC, after its own permission check, with the org it verified; signatures kept stable):

- **`private.clients_find_duplicates(p_org uuid, p_first text, p_last text, p_email text, p_phones text[], p_birthday date, p_exclude uuid) returns table (client_id uuid, level text, reasons text[])`**: the I-5 rules (CL-12), the same as `find_client_duplicates` and the import. `level` is `high` or `medium`; `reasons` among `email`, `phone`, `same_name`, `similar_name`, `birthday`, `birthday_differs`, `shared_contact`, `partial_email`, `partial_phone`. HIGH first, then by file number; merged and anonymised files never; `p_exclude` leaves one file out (the one being edited). Used by `create_client` and by Facturation's QuickBooks customer matching (lane B, FQ).
- **`private.clients_match_email(p_org uuid, p_emails text[]) returns table (email text, client_id uuid, match_kind text)`**: which files an address belongs to (Communications' Gmail thread linking, CM2b, CM-12). The addresses are trimmed and folded to lower case (I-5); `match_kind` is `client` (her own file) or `relation` (a file she is related to, whatever the rights: the caller filters). An address on 6 or more files is a placeholder and matches nothing; merged and anonymised files never match, archived ones do. Ordered by email, `client` before `relation`, then file number (CL-23).
- **`referral_sources_catalog`** (view, security invoker; C4): `id, org_id, name, sort_order` of the clinic's active referral sources, read with `clients.view` or `demandes.view` (Demandes' intake form; Demandes depends on Clients).
- **`ClientPicker`** (`@/modules/clients`, a lazy component: render it inside `<Suspense>`; C4): a search over `search_clients` and « Nouveau client » (clients.manage) with the live duplicate check. Props (`ClientPickerProps`): `onSelect(clientId, client | null)` (a search result, or a similar file chosen in the creation sheet), `onCreated?(clientId)` (a new file; defaults to `onSelect`), `label?` (« Client »), `excludeIds?`, `initialValues?` (`firstName`, `lastName`, `email`, `mobile`: what « Nouveau client » starts with). It never navigates. The page's own « Nouveau client » still opens the new record.
- `private.client_contacts_for(org, client, right)` (`communications`, `invoices`, `appointments`: the client herself and each relation holding the right, with her own language and channels; the caller decides what age means), `private.clients_unlink_professional(org, client, pro)` (Demandes' reassignment; a primary professional's link stays), the view **`client_payers_active`** (Facturation), and the catalogue **`client_merge_handlers`**: a module adds a row naming `private.<module>_reassign_client(old, new) → int` and the merge runs it (Professionnels' moves the « Ententes particulières », Demandes' its requests, participants and waiting-list entries; Rendez-vous and Facturation add theirs), and **`client_anonymize_handlers`** the same way for an anonymisation (`private.<module>_anonymize_client(id) → int`: Professionnels turns an agreement's label into « CLI-n » and drops its note; Demandes blanks the contact typed before the file and the participants' names).

## Screens (C3)

- **« Clients »** (`/clients`, `clients.view`, nav order 20): search (name, email, number, phone; 250 ms), « Actifs / Archivés / Tous », primary professional, tag; the filters live in the URL (`q`, `statut`, `professionnel`, `etiquette`); « Afficher plus » loads the next 50 (`list_clients`). Columns: name and number, birthday and age, email and mobile, primary professional, the flags (banned, incomplete, agreement, Statut Indien, rate) and tags.
- **« Nouveau client »** (`clients.manage`): a sheet in sections (Identité, Coordonnées, Adresse with `AddressAutocomplete`, Dossier with the staff note). The similar files show while typing (400 ms, `find_client_duplicates`) with their reasons and « Ouvrir le dossier existant »: a HIGH one blocks « Créer le dossier », a MEDIUM one needs « C'est une autre personne » (CL-13, CL-20). A refusal goes under its field (the HINT). The new file opens on « Aperçu ».
- **The record** (`/clients/:id/:onglet`): the header (name, pronouns, number, age, state, flags, tags; « Archiver / Restaurer »; a merged file links to the kept one) and six page-level Radix tabs, each its own chunk reading the one bundle (`get_client_summary`): « Aperçu » (read-only), « Informations » (cards Identité, Coordonnées, Adresse, Dossier, Tarif et indicateurs, Notes, Étiquettes; CL-21), « Proches » (relations with both directions' rights), « Assurance et payeurs », « Consentements » (C5a's `ClientConsentsPanel`), « Visites et paiements » (empty until Rendez-vous and Facturation), « Courriels » (slot `client.messages`: Communications' panel, CM3; empty without it). Read-only without `clients.manage`, or for a merged or anonymised file. « Historique » since C4 (below).
- **« Mes clients »** (`/mes-clients`, `clients.self`, shown to an account linked to a professional file): `my_clients` with a local search; nothing but what CL-5 allows.

## Merge, Loi 25, history, ⌘K (C4)

- **« Fusionner »** (`clients.merge`): from « Doublons possibles » on « Aperçu » (`find_client_duplicates` with this file excluded, its reasons, « Ouvrir », « Fusionner ») or the record's « … » menu (search another file). The older file is kept by default (its number is the one people quote); the person may keep the other. Side by side, each value the two files hold differently is a choice (the kept file's first); the merged file's values where the kept one is empty are taken; the address is one block. Before « Fusionner les dossiers »: what moves (counts), that the notes are appended, that a merge is never undone. The kept file opens after (CL-24).
- **« Confidentialité »** (`clients.privacy`, in the « … » menu):
  - « Exporter le dossier (PDF) »: `export_client_privacy` (logged), made into a PDF in the browser (react-pdf's Helvetica, US Letter, its own chunk), saved as `dossier-CLI-000123.pdf` (the number, never the name), never cached (CL-25).
  - « Anonymiser le dossier… »: what goes, what stays, never undone; the file number typed to confirm (CL-26).
- **« Historique »** (tab, `clients.view`): `list_client_history` (a relation removed while the file was its second side shows in the other file's history only), by clinic day, « {qui} · {action} · {table} » and the changed fields in the Journal d'audit's words (`clientsAuditLabels`); personal values « (masqué) », ids and timestamps left out (a professional, source or tag by its name), a creation lists only what was given; 50 a page, « Charger plus » (CL-27).
- **⌘K** (`clients.view`, 2 characters): `search_clients`, « CLI-000123 · birthday », « Archivé ». A professional finds « Mes clients » among the pages, never a record (CL-28).
- **Remembered filters:** the list's `statut`, `professionnel` and `etiquette` per person (`user_preferences`, key `clients.list_filters`), applied on arrival without filters; a link with filters wins; never the search words (CL-28).

## Keep / Change / Drop (from the plan, §6.1)

| Item | Mark | Where |
|---|---|---|
| List filters (status, search, primary pro, tags), deep link | Keep | C3 (URL), C4 (remembered); the search words stay out of the URL. Not yet: a sort choice and a column picker (name order only) |
| New client form in sections + Google address | Keep | C3 |
| Duplicate detection (HIGH blocks, MEDIUM confirms) | Keep | C2 (SQL, I-5), C3 (live panel) |
| Duplicate merge | Add | C2 (`merge_clients`, `client_merges` report; never undone), C4 (screen) |
| Identity, contacts, language, reminders, birth first name, pronouns, time zone, « Référé par », custom field, primary pro, notes | Keep | C1, C3 (the time zone has no field yet: imported values are kept) |
| Referral source | Add | C1 (list), C3 (field), C4 (catalogue for Demandes) |
| Relations, main contact, 3 rights per direction | Keep + Change | C1, C3 |
| Guardian `responsible_client_id` | Change | a relation with the rights |
| Primary and secondary insurance | Keep | C1, C3 |
| TELUS eRéclamations consents, RAMQ number | Drop (Jonathan's OK) | — |
| Tags | Change | useful ones became fields; ≤ 5 free tags (C3) |
| Signed, versioned consents | Keep + Add | C5a |
| Visits & payments, receipts | Keep | tab waits for Rendez-vous and Facturation |
| Provider visibility | Keep | `client_professional_links`, « Mes clients » |
| Delete with first name + password | Change | anonymisation, `clients.privacy`, the number typed (C4) |
| Archive, `CLI-` number, history | Keep | C2, C3, « Historique » (C4) |
| Client balance | Change | Facturation's published view (later) |

## Rules for the other lanes

- A child, each parent and a spouse are each a client; never store a guardian on the child's row. Who signs, books or pays for someone is read from the relation's rights.
- Reminders go to each person on her own channels (`reminders_by_sms`, `reminders_by_email`); the SMS consent and « ARRÊT » are Communications' (R-54, R-73).
- An invoice is never split: Facturation chooses one payer per invoice among the client and the relations with `*_receives_invoices` (R-61).
- `special_agreement`: the invoices wait in the morning queue for validation (R-56); the note is staff-only.
- Testing in production uses dry-run-imported clients and named testers only (R-72; « core: module testers », next PR).

## For C2 and the import (from the C1 review)

- **Merge** (`merge_clients`, built in C2): delete the relation between the two files first; for a person related to both, OR the rights into the kept file's row and drop the merged one; resolve `client_insurances` (rank), `client_payers` (one active per kind), tags (shared, > 5 combined) and links (primary key) before moving the rest; follow `merged_into_id` chains. Moving a relation side re-sorts the pair and swaps it whole (the trigger), which keeps who holds which right.
- **Ententes particulières:** `set_professional_client_agreement` finds the open agreement by label when `client_id` is null, and the no-overlap key is `coalesce(client_id, label)`: I1 fills `client_id` on every row of a series at once, and the RPC learns to match on `client_id` or the label in the same release; a merge re-points agreements through a Professionnels hook.
- **Links:** `private.clients_unlink_professional` (C2) ends a link on reassignment, except the primary professional's. `clients_link_professional` moves `last_linked_at` at most once a day.
- **Anonymisation** (built in C2): `anonymize_client` deletes the relations and tag links (their audit rows would still tie the person to a relative), blanks the identity and `external_ref`; `anonymized_at` can never be cleared (trigger).
- **File numbers:** a transaction-level advisory lock per clinic (not the org row), also for an explicit number (the import's).
- **Search:** at ~8 500 rows a scan is fine (measured in C3: a `list_clients` page in about 70 ms locally over 8 500 files); C2 may add an `unaccent` expression index (Professionnels' immutable normaliser) for accent-insensitive search and the phone digit matches.

## Consents (batch C5a)

Migrations `20261013020443_core_signing_second_client_signer` (core: the `client_2` role), `20261013020447_clients_consents` and `20261013031103_clients_consents_handlers`; pgTAP `108_clients_consents`, `112_clients_consents_handlers`; decisions R-46 … R-51, **CC-1 … CC-12**.

- **Tables:** `client_consent_types` (the 7 consents and their clauses), `client_consent_rules`, `client_consent_settings` (one row per clinic), `client_consent_requests` (one open per client and consent; the version, the language and the clauses are fixed when it is sent; the answers are redacted in the audit), `client_consent_request_signers` (`client` / `client_2`, each with her own link), `client_consents` (the consent in force: not superseded, not withdrawn; signer names, answers and note redacted). Read with `clients.view`; every write is an RPC.
- **Templates:** `clients.consent_<key>_fr` / `_en` (core templates of the module, view `clients.view`, edit `clients.manage`), seeded as drafts « Texte provisoire »; the clauses print through the block placeholder `{{consent.clauses}}`.
- **Staff RPCs** (`clients.manage`): `set_client_consent_rule`, `set_client_consent_settings`, `cancel_client_consent_request`, `publish_client_consent_version(version, 'new_clients' | 'all_active')` (core's publish, then the « À signer de nouveau » flag for every active consent of that consent and language, R-49).
- **Service RPCs:** `prepare_client_consent_request_for_service` (actor model: two token hashes, one per signer), `open_client_consent_for_service`, `start_client_consent_signing_for_service`, `client_consent_reminders_for_service`, `import_client_consent_fact_for_service` (I1). Link purpose `client_consent` with `resolve_client_consent_link`.
- **Functions:** `clients-consent-send` (user, `clients.manage`: send or resend, emails `clients.consent_request` / `_en` with `/consentement#t=…`), `clients-consent-sign` (public token: open, then answers and embedded signing; renders), `clients-consent-reminders` (job `clients.consent_reminders`).
- **Published for other modules:** `private.required_consents_for(org, client, service_code, payer_kind, professional_status, situations, context_type, context_id)` → (consent_key, frequency, state) for Rendez-vous (R1, R2, R5) and Demandes (D3); views `client_consents_status` (staff), `client_consents_to_obtain` (« Consentements à obtenir »), `my_client_consents` (the professional's linked clients, clients.self).
- **Merge and anonymisation (with C2):** the handlers `private.clients_consents_reassign_client` and `private.clients_consents_anonymize_client` (module key `clients` in `client_merge_handlers` / `client_anonymize_handlers`, CC-9, CC-10). Who signs reads `private.client_contacts_for(…, 'appointments')` (CC-8). Core's copies are redacted too (CC-10, `private.signing_redact`): her signer rows and her requests' titles and PDF names; Documenso keeps its own copy (core doc, « Signing »).
- **Placeholder texts:** « Publier » is never offered while a draft is still the seeded « Texte provisoire » (CC-11).
- **Texts (CC-12):** each text opens in core's shared editor (« Modifier le texte », or « Voir le texte » read-only) under the cards of Paramètres → Consentements (`components/consents/ConsentTextEditor`): the block `{{consent.clauses}}` is required (the answers' table, with a sample in the preview), the « Texte provisoire » line is flagged until removed, and the editor has no « Publier »: a text is published from « Textes », which asks who must sign again (R-49). Every write refreshes « Textes ».
- **Clauses (CC-13):** each text version's « Oui / Non » clauses (`client_consent_version_clauses`, migration `…_clients_consent_clauses`, pgTAP `141`), shown under the text's editor (`components/consents/ConsentClausesCard`): a draft's are changed there (add, reword, reorder, « Accord requis » / « Oui ou non », at most 20; `set_client_consent_clauses`, clients.manage), a published version's are read only. `get_client_consent_clauses(version)` reads them (its own, else its published version's, else the consent's). `publish_client_consent_version` freezes them; a trigger gives each request its version's clauses (made, or moved unanswered by a publication).
- **Mise en service (texts):** Christine's 14 texts and their clauses are entered in that editor, then published in Paramètres → Consentements.
- **Screens (part 2):**
  - « Consentements à obtenir » (`/clients/consentements`, nav « Consentements », `clients.view`): the open requests, overdue first; a row opens the client's consents in a side sheet.
  - « Payeurs à compléter » (`/clients/payeurs-a-completer`, `clients.view`, FP-9; linked from Facturation's « Payeurs tiers »): the active IVAC and PAE payers the split cannot use yet (the import's stubs, a missing file number, provider or coverage), each with what is missing; a row opens « Assurance et payeurs ».
  - `components/consents/ClientConsentsPanel`: per consent, its state, the sealed PDF (`useSignedFileUrl`), and « Envoyer » / « Renvoyer » / « Annuler la demande » (`clients.manage`); since C5b « Retirer le consentement » and « Envoyer la copie signée ». The record's « Consentements » tab (C3) mounts it.
  - Paramètres → Consentements (`consentements`, seen with `clients.view`, changed with `clients.manage`): the 14 texts with « Publier » and who must sign again; the rules (a switch, enabled once the text is published; « Une fois » or « À chaque rendez-vous »); the delays; the retention policy and, since C5b, its duration.
  - The public page `/consentement#t=…` (`consentPublicPage`, registered in `src/app/public-pages.ts`): identity, the « Oui / Non » clauses, Documenso inside the page (`@/core/signing/components/EmbeddedSigning`, shared; Professionnels still has its own copy), « Merci ! ». French or English, the request's language.
- **Tests:** Vitest for the three screens, the panel and `lib/consents`; `e2e/consents.spec.ts` (publish; then, with the functions and the fake Documenso, send, sign on the public page, no longer to obtain). The local seed holds one fictitious client, « Camille Exemple ».

## Consents, part 2 (batch C5b: withdrawal, signed copy, retention)

Migrations `20261013205008_core_stored_files_retention` (core: `private.set_stored_files_retention`) and `20261013205013_clients_consents_withdrawal_copy`; pgTAP `169_core_stored_files_retention`, `170_clients_consents_withdrawal_copy`; decisions R-50, **CC-16 … CC-18**.

- **« Retirer le consentement »** (CC-16): `withdraw_client_consent(id, note)` (`clients.manage`; the note, 3 to 500 characters, is redacted in the audit and removed by an anonymisation). The consent in force becomes « Retiré le … » from now; its row and sealed PDF stay. `required_consents_for` then answers `missing` (or `pending` once a new request is out), so every appointment and waiting-list entry that needs it shows it missing again, live; an `each_time` request whose consent was withdrawn no longer counts. The panel offers « Envoyer » again (a new signature is a new consent in force).
- **« Envoyer la copie signée »** (CC-17): `clients-consent-send` action `copy` (`consent_id`): `prepare_client_consent_copy_for_service` (service role, the caller as actor) names who signs for the client today (R-48: the client from 14, else the authorised parents), with an address, in the client's language, and the sealed PDF's object; the function attaches the PDF to `clients.consent_signed_copy` / `_en` (one email each, no button) and `mark_client_consent_copy_sent_for_service` records `copy_sent_at` / `copy_sent_by` (« Copie envoyée le … », Historique). Refused in French while Clients is reserved for its testers (P3-40), for an anonymised file, an imported signature (no PDF) or a PDF no longer kept, or when no one has an address. Offered for a withdrawn consent too (the client may ask for what she signed).
- **Retention** (CC-18): `client_consent_settings.signed_pdf_retention_years`, **empty by default: nothing is purged**. Once Christine sets it (1 to 50 years, Paramètres → Consentements, « Conservation des consentements signés », confirmed first), the sealed and source PDFs of every ended consent (withdrawn, replaced by a newer signature, or of an anonymised file) get `retain_until` = end + N years, through core's `private.set_stored_files_retention`; `storage-cleanup` purges them then. A consent in force is never limited. Kept current by triggers (a consent withdrawn or replaced, a file anonymised) and recomputed when the duration changes; cleared, everything is kept again.
- **Status view:** `client_consents_status` gains `consent_id`, `withdrawn_at`, `signed_file_id`, `source`, `copy_sent_at` and `in_force` (the panel reads the PDF from it; `fetchClientConsentFiles` is gone).
- **Tests:** Vitest (the panel through « Consentements à obtenir »: withdrawal, its refusal, the withdrawn state, the copy and its refusal, a counselor without `clients.manage`; the settings card; the API), Deno (`clients-consent-send/copy.test.ts`), Playwright (`consents.spec.ts`: the withdrawal on the seed's imported consent of « Amélie Tremblay », always; the copy in Mailpit after the local signature). The local seed holds that imported consent.

## Consents, part 3 (batch C5b: the report)

Migrations `20261013233508_clients_consent_report_facts` (Clients) and `20261013233513_reports_consents` (Rapports); pgTAP `174`, `175`; decision **CC-19**.

- **Published for Rapports:** `private.client_consent_state_facts(org)` (one row per active file and active consent: the file's primary professional and the state as the record's tab shows it, `client_consents_status`, or `none`) and `private.client_consent_event_facts(org, from, to)` (the signatures, app or import, and the withdrawals of a period, with the request's first send for the app's).
- **Rapports → « Consentements »:** see [reports doc](reports.md). The counts are the record tabs' (C5b acceptance).

## Consents, part 4 (batch C5b: the re-sign campaign)

Migration `20261013234708_clients_consent_campaigns`; pgTAP `176_clients_consent_campaigns`; function `clients-consent-campaign` (job); decision **CC-20**.

- **What it asks:** « Demander une nouvelle signature à tous les clients actifs » (Paramètres → Consentements, card « Nouvelles signatures », `clients.manage`, confirmed first). `start_client_consent_campaign(consent)` targets every active file whose consent in force is not on a version published now (an older version, or GOrendezvous's), with no request already out. Their consent is flagged « À signer de nouveau » at once (R-49's flag), and each gets an item in `client_consent_campaign_items`. There is one running campaign per consent. Refused in French while Clients is reserved for its testers (P3-40), with no published text, or when nobody is left to ask.
- **The sends:** the job `clients.consent_campaign` (function `clients-consent-campaign`, daily at 9 h, **off by default**) takes at most **100 items a day per clinic**, oldest first (`client_consent_campaign_batch_for_service`). It sends each one through the same path as « Envoyer » (`prepare_client_consent_request_for_service`, with the campaign's author as the actor, then the request email). Each item ends `sent` or `failed`, with the refusal's HINT (`client`, `signer_email`, `template`…, `email` when no email left, `permission` when the author lost `clients.manage`). The campaign is `done` once none is left. A claim older than an hour goes back to the queue. Nothing is sent while the module is reserved (the items wait).
- **« Arrêter la campagne »** (`cancel_client_consent_campaign`): the queued items are `skipped`; what was sent stays.
- **Read model:** `client_consent_campaigns_summary` (counts per state, `clients.view`).
- **Tests:** pgTAP 176; Deno (`clients-consent-campaign/handler.test.ts`); Vitest (the card: start confirmed, running counts, « Arrêter »).

## GOrendezvous import (batch I1)

Migration `20261013043434_clients_import`; pgTAP `115_clients_import`; decisions I-7 … I-14; runbook [`import-gorendezvous.md`](../runbooks/import-gorendezvous.md).

- **`import_client(row, dry_run)`** (clients.manage and clients.merge): one file with C2's checks, its `external_ref` (« gorendezvous:<ClientId> »), archived state, primary professional (linked « import »), free tags (the clinic's list, created when missing), main insurance and agreement note; a duplicate is imported and named (level, file number); a file already imported is `skipped`; a dry run rolls back.
- **`import_client_relation(row, dry_run)`**: a relation between two imported files by their external refs, through `set_client_relation`.
- **Tombstone (I-13):** trigger `clients_import_tombstone` keeps « anon: » + SHA-256 of the reference when a file is anonymised; `import_client` skips it.
- **The script** `scripts/import-gorendezvous.mjs` (`clients`, `prix`) and its readers in `scripts/import-gorendezvous/` (mappings, payloads, price gaps), with synthetic fixtures and tests.

