# Module `demandes` (« Demandes »)

The counselors' work: a request comes in (phone, email, the website's form, the booking page that replaces Calendly), a discovery call, a professional proposed, the first appointment confirmed, with the 24–48 h callback promise visible; and the **waiting list** (psychologie, psychothérapie, or a professional). Replaces the counselors' workbook and the fake « conseillère » appointments of GOrendezvous. Plan: [coding plan §10](../plans/2026-10-11-modules-coding-plan.md#10-demandes-demandes--batches); roadmap §2.3 and §2.3 bis; [Christine's answers](../research/2026-10-12-christine-answers.md) (21, 19, 22); decisions R-66, R-74 and **D-1 … D-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| D1 | Schema (requests, states, events, tasks, proposals, waiting-list tables), RPCs (create, edit, state, assign, contact attempts, tasks, note, participants), pgTAP | built |
| D2 | Inbox, intake, record, core realtime hook | planned (gate: C3) |
| D3 | Waiting list part 1 | planned |
| D3b | Discovery-call tasks, proposals with acceptance link | planned |
| D3c | Public discovery-call booking page with source tracking (lane C) | planned |
| D4–D6 | Matching panel and waiting list part 2, places, KPIs (after the cutover) | planned |

- **Registry:** `modules.key = 'demandes'` (migration `20261012223803_demandes_module`), depends on `clients` and `professionals`. It **starts disabled** in every clinic; the local seed enables it.
- **Migrations:** `20261012223803_demandes_module` (registry, tables, RLS, audit), `20261012223807_demandes_rpcs` (RPCs).
- **Tests:** pgTAP `106_demandes_module`, `107_demandes_rpcs`; Vitest `src/modules/demandes/manifest.test.ts`; the audit labels checked by `src/app/audit-labels.test.ts`.

## Permissions

| Permission | Default roles | Gives |
|---|---|---|
| `demandes.view` | admin, conseillère, adjointe | read every request and the waiting list of the clinic |
| `demandes.manage` | admin, conseillère, adjointe | create and work requests (the RPCs below) |
| `demandes.notes` | admin, conseillère, adjointe | read and write a request's internal note |
| `demandes.waitlist` | admin, conseillère, adjointe | manage the waiting list (D3) |
| `demandes.self` | admin, professionnel | read, through `my_demandes` and `my_waitlist_entries` only, the requests matched to her and the open waiting-list entries naming her; no table policy |

The conseillère and the adjointe hold the same set (D-1): core's role guard refuses, to a manager, a role carrying a permission she does not hold.

## Tables

All per clinic (`org_id`), RLS on, `select` only for clients (every write is an RPC), audited with `private.audit_trigger`, personal values redacted.

| Table | What | Rules |
|---|---|---|
| `demandes` | the request: `reference` « DEM-AAAA-NNNN » (year of reception in clinic time, then in order; frozen), received at / by, `channel`, source (`referral_source_id` → Clients' list, `source_campaign`, `source_utm` utm_* only, `source_referrer`: R-74), the person (`client_id` once known, else `contact_name` / `_email` / `_phone_e164`), intake (`beneficiary`, `previous_therapy`, `language`, `modality`, `availability_periods` (Professionnels' periods: am, pm, end_of_day, evening, weekend) / `_days`, `preferred_pro_gender`, `profession_title_id`, `clientele_id`, `concerns`, `payer_kind`, `insurer`), `state` (D-2), `closed_reason` / `closed_at`, `is_urgent`, `assigned_to`, `matched_professional_id`, contact attempts (`last_contact_at`, `next_contact_at`, `contact_attempts`), `external_ref` | someone to call back (a file, a name, an email or a phone); closed ⇔ reason and date; matched ⇒ a professional (kept when the request is closed). `received_at` never in the future. Open = neither matched nor closed (the inbox's indexes). Redacted: contact, concerns, referrer and UTM |
| `demande_motifs` | the request's motifs (Professionnels' catalogue: orientation tags, never a diagnosis) | composite FK to `motifs` |
| `demande_notes` | the internal note | `demandes.notes` only; redacted; never copied into an event, a notice or an AI prompt |
| `demande_participants` | who the request is for (a couple, a family, a child and a parent): a client or a name, the relationship, one main person | name and birthday redacted |
| `demande_events` | the history in codes: created, state changed, assigned, contact attempt (channel, outcome), task done, urgent set / cleared | no free text; the KPIs read it (D6) |
| `demande_tasks` | dated work: the discovery call (not a fake appointment), a callback, a follow-up; open / done (outcome) / cancelled | |
| `demande_propositions` | a professional proposed: by, at, response, decline reason, the acceptance link (`secure_link_id`, `expires_at`), the directory snapshot shown and its `directory_updated_at` (« profil modifié depuis ») | written from D3b |
| `waitlist_entries` | a place on the list (§2.3 bis): one target per entry (a profession or a professional; a request may hold one of each), one open entry per request and target, priority (with its reason) then `registered_at`, the criteria copied from the request, a bridge professional, `state` incomplete → active → to_call → offered → closed (exit reason), the fee (`to_invoice` / `invoiced` / `paid` / `waived` with a reason, `fee_invoice_id` without FK until Facturation), consent signed at, contacts | the rank is computed, never stored; written from D3 |
| `waitlist_contacts` | each follow-up of an entry (call, the « still waiting? » email, the answer) | D3 |
| `waitlist_offers` | a slot offered (by phone in part 1, a 48-h link in part 2) | D3, D4 |

The professional reads no table of the module. Two read models, definer functions behind `security_invoker` views that check `demandes.self` and her own professional file first, give her only what she needs:

- `my_demandes`: the requests matched to her while they are matched: reference, dates, `client_id`, the intake, `motif_ids`, `participants` (jsonb). Never the contact details (Clients' `my_clients` gives those), the source, the counselor, the history, the tasks or the note.
- `my_waitlist_entries`: the open entries naming her, with the criteria and her `rank` (priority first, then the oldest). Never the priority's reason or the fee.

Not in D1 (D-6): `first_appointment_cancellations` (with Rendez-vous), `capacity_snapshots` (D5).

## RPCs (D1)

All `security definer`, permission first, the caller's clinic only, the request's row locked, the journal naming the RPC, an event row for what the KPIs read. Refusals in French (P0001); malformed input 22023.

| RPC | Permission | Does |
|---|---|---|
| `create_demande(p_data)` | `demandes.manage` (+ `demandes.notes` for `internal_note`) | the full intake or the « saisie rapide » (a name and a phone): intake keys, `received_at`, `channel`, the source (utm_* keys only; the campaign taken from `utm_campaign` when not given), `assigned_to` (someone who works requests), `motif_ids`, `internal_note`. Returns the id |
| `update_demande(p_id, p_patch)` | `demandes.manage` | the intake keys given only; motifs replaced; urgent set / cleared logged; a file added to a matched request is linked to the professional; a closed request is not edited |
| `set_demande_state(p_id, p_state, p_closed_reason, p_professional_id)` | `demandes.manage` | the moves of D-2; closing needs a reason; matching needs an active professional of the clinic, links the request's client and the participants' clients to her (Clients' `clients_link_professional`, reason `demande`) and lets her read the request in `my_demandes`; leaving matched takes that away (closing keeps who was matched); reopening clears the closing |
| `assign_demande(p_id, p_assignee)` | `demandes.manage` | the counselor in charge (null: the shared inbox) |
| `log_demande_contact(p_id, p_channel, p_outcome, p_next_contact_at)` | `demandes.manage` | a contact attempt (channel and outcome required): counted, the last contact, the next try (in the future) |
| `add_demande_task`, `complete_demande_task`, `cancel_demande_task` | `demandes.manage` | tasks; a call done counts as a contact attempt; reaching the person clears the next try |
| `set_demande_note(p_id, p_note)` | `demandes.notes` | the internal note (empty removes it) |
| `set_demande_participants(p_id, p_participants)` | `demandes.manage` | who the request is for, as a set (≤ 10, exactly one main person, each id once; an id of another request is a new row); not on a closed request; on a matched request the clients added are linked to the professional |

## What the module publishes

For the professional: `my_demandes` and `my_waitlist_entries` (above). Coming: `demandes_summary`, `get_places_remaining(professional)` and `waitlist_summary` (Rapports), the public booking function's write path (D3c).

## Messages to people outside the clinic (P3-40)

D1 sends nothing. Every send path the module adds (the proposal's acceptance link D3b, the waiting-list follow-ups D3, the booking page's confirmations D3c) checks `module_open_to_all_for_org(org, 'demandes')` first, in SQL at its choke point: while Demandes is « Réservé aux testeurs », a manual send is refused in French and an automatic one is not queued; the admin's test still goes. Its pgTAP covers the refusal ([core doc](core.md), « Modules reserved for testers »).
