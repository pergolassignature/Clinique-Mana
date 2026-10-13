# Module `clients` (« Clients »)

The clinic's client files (~7 400 active and ~1 080 archived in GOrendezvous): one row per person, the relations between people and what each may do for the other, insurance, payers (IVAC, PAE), tags, and which professionals may see a client. Plan: [coding plan §6](../plans/2026-10-11-modules-coding-plan.md#6-clients-clients--full-task-detail); roadmap §2.2 and §2.2 bis; data: [GOrendezvous tour §2](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); decisions R-5, R-7 … R-10, R-48, R-54, R-61, R-64 and **CL-1 … CL-11** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| C1 | Schema: registry, tables, RLS, audit, published views and helpers, the agreements' FK | built |
| C2 | RPCs: duplicates, create / update / archive, relations, insurance, payers, tags, merge, search, summary, Loi 25 export and anonymisation, `client_contacts_for` | built |
| C3 | List, « Nouveau client », record, « Mes clients » | planned |
| C4 | Merge UI, « Confidentialité », ⌘K, e2e, this doc completed | planned |
| C5a / C5b | Client consents (lane C) | planned |

- **Registry:** `modules.key = 'clients'` (migration `20261012213428_clients_module`), depends on `professionals`. It **starts disabled** in every clinic; the local seed enables it.
- **Migrations:** `20261012213428_clients_module`, `20261012213431_professionals_client_agreements_client_fk` (Professionnels: `professional_client_agreements.client_id → clients`); C2: `20261013022637_clients_duplicates`, `20261013022641_clients_rpcs`.
- **Tests:** pgTAP `104_clients_module`, `108_clients_duplicates` (the import library's cases), `109_clients_rpcs`; Vitest `src/modules/clients/manifest.test.ts`; the audit labels checked by `src/app/audit-labels.test.ts`.

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

## RPCs (C2)

All definer, permission first, French `P0001` with a HINT naming the field (the form puts the message under it). A merged or anonymised file refuses every write (HINT `merged` / `anonymized`).

| RPC | Permission | What |
|---|---|---|
| `find_client_duplicates(first, last, email, phones[], birthday, exclude)` | `clients.view` | HIGH / MEDIUM candidates with reasons (I-5, CL-12), at most 10, with number, name, birthday, email, mobile, archived |
| `create_client(client jsonb, confirm_medium)` | `clients.manage` | normalises (names trimmed, email lower case, phones to E.164, postal code `A1A 1A1`, province code), refuses a HIGH duplicate (HINT `duplicate`, « n° X »), needs `confirm_medium` for a MEDIUM one (HINT `duplicate_medium`), saves the notes, links the primary professional |
| `update_client(id, client jsonb)` | `clients.manage` | replaces every editable field (the form sends them all; duplicates not re-checked); the notes only when their keys are present |
| `set_client_notes(id, admin_notes, special_agreement_note)`, `archive_client`, `unarchive_client` | `clients.manage` | |
| `set_client_relation(client, related, type, related_rights, client_rights)`, `remove_client_relation` | `clients.manage` | `type` is what the related person is to the client; rights `{main_contact, manages_appointments, receives_communications, receives_invoices}` per direction; one main contact per client (CL-14) |
| `upsert_client_insurance(client, rank, …)`, `delete_client_insurance` | `clients.manage` | deleting the main one promotes the secondary |
| `save_client_payer(client, id, kind, …)`, `end_client_payer(id)` | `clients.manage` | one active per kind (a second save updates it), an active IVAC file once per clinic; ended payers stay |
| `set_client_tags(client, tag_ids[])`, `save_client_tag(id, name)`, `set_client_tag_active` | `clients.manage` | ≤ 5 active tags of the clinic's list |
| `merge_clients(keep, merge)` | `clients.merge` | CL-15, CL-16 |
| `search_clients(query, limit)` | `clients.view`, or `clients.self` (her linked clients) | ⌘K: every word in the name (accents ignored), the email, the number or a phone's digits; never merged or anonymised files |
| `get_client_summary(id)` | `clients.view`; `clients.self` linked: the `my_clients` columns | the record's bundle: file, notes, relations both ways, insurance, payers, tags, professionals, merges |
| `export_client_privacy(id)` | `clients.privacy` | the summary + `exported_at`; an `audit_log` read row (sections, never values) |
| `anonymize_client(id)` | `clients.privacy` | CL-17 |

**For other modules:** `private.client_contacts_for(client, right)` (`communications`, `invoices`, `appointments`: the client herself and each relation holding the right, with her own language and channels; the caller decides what age means), `private.clients_unlink_professional(org, client, pro)` (Demandes' reassignment; a primary professional's link stays), the view **`client_payers_active`** (Facturation), and the catalogue **`client_merge_handlers`**: a module adds a row naming `private.<module>_reassign_client(old, new) → int` and the merge runs it (Professionnels' moves the « Ententes particulières »; Rendez-vous, Facturation, Demandes add theirs).

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
- **Search:** at ~8 500 rows a scan is fine; C2 may add an `unaccent` expression index (Professionnels' immutable normaliser) for accent-insensitive search and the phone digit matches.
