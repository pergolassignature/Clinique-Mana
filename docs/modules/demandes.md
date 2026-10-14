# Module `demandes` (« Demandes »)

The counselors' work: a request comes in (phone, email, the website's form, the booking page that replaces Calendly), a discovery call, a professional proposed, the first appointment confirmed, with the 24–48 h callback promise visible; and the **waiting list** (psychologie, psychothérapie, or a professional). Replaces the counselors' workbook and the fake « conseillère » appointments of GOrendezvous. Plan: [coding plan §10](../plans/2026-10-11-modules-coding-plan.md#10-demandes-demandes--batches); roadmap §2.3 and §2.3 bis; [Christine's answers](../research/2026-10-12-christine-answers.md) (21, 19, 22); decisions R-66, R-74 and **D-1 … D-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| D1 | Schema (requests, states, events, tasks, proposals, waiting-list tables), RPCs (create, edit, state, assign, contact attempts, tasks, note, participants), pgTAP | built |
| D2 | Inbox (the 24–48 h promise, « sans réponse », filters), quick entry, record (Accueil, Participants, Suivi, Historique), « Je m'en occupe », core realtime | built |
| D3 | Waiting list part 1 | built |
| D3b | Discovery-call tasks, proposals with acceptance link | built |
| D3c | Public discovery-call booking page with source tracking (lane C) | built |
| D4 | Matching panel; waiting list part 2 (« Place disponible », compatible registrants, « Offrir la plage ») | built |
| D5 | Places and the availability board (nightly snapshots) | built |
| Parity | The audit's gaps before the cutover: participants' files, intake follow-ups, « Jumelée » by hand, consents per file, the primary professional at the match | built |
| D6 | KPIs feeding Rapports (« Indicateurs des demandes ») | built |
| A | After-cutover audit, lane B: the client's « Demandes » tab (L18), the inbox's sort and columns (L17), the next free slot in Jumelage and the proposal's slots (L20) | built |

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

## D2: the inbox and the record

Migrations `20261013062721_core_realtime` (core, see the [core doc](core.md#realtime-between-staff-d2)) and `20261013062727_demandes_inbox`; pgTAP `120`, `121`; decisions D-12 … D-14.

### RPCs

| RPC | Permission | Does |
|---|---|---|
| `list_demandes(p_view, p_assigned, p_flags, p_search, p_offset, p_limit)` | `demandes.view` | the inbox: `open` (new, evaluating, accepted, proposed), `matched`, `waitlist`, `closed`, `all`; `me` / `none` / `any`; flags `late`, `no_answer`, `urgent`, `due` (all must hold); the search on the number, a name or an email (accents ignored) or 4+ digits of a phone. Open views: the urgent, then the late, then the oldest. Each row: the person (the file's name, else the contact), the promise and the waiting business hours, the last attempt and its outcome, the next try, who handles it, the open tasks |
| `demandes_counts()` | `demandes.view` | open, late, no answer, due now, mine, unassigned, waiting list |
| `get_demande(p_id)` | `demandes.view` | the record's bundle: the request (no internal numbering), its file (`clients_directory`), the matched professional, motifs, participants, tasks, events with the people's names, the note (only with `demandes.notes`), what the caller may do. Null for another clinic's |
| `get_demandes_reference()` | `demandes.view` | the people who work requests (`demandes.manage`), the referral sources, Professionnels' motifs (by category), titles and clientèles |
| `set_demande_handler(p_id, p_take, p_expected)` | `demandes.manage` | « Je m'en occupe » / « Je laisse » (one's own hold only); taking over needs the handler the person saw (`p_expected`), else a French refusal naming who has it (D-13) |

- **The promise (D-12):** « nous vous rappelons en 24 à 48 h ouvrables » (the website's words), measured in business hours (Monday–Friday, the clinic's time zone) from reception to the first contact attempt (any event with a channel: « Noter un appel » or a call task done): `ok` under 24 h, `soon` from 24 h, `late` from 48 h; once contacted, `met` or `met_late`; a request no longer open and never called has `none`.
- **« Sans réponse »:** an open request whose latest attempt did not reach the person.
- **Forms and realtime:** a form being edited keeps its edits when another counselor saves; « Recharger » takes the new values (`useServerDraft`).
- **Realtime:** `demandes`, `demande_tasks`, `demande_participants`, `demande_notes` and `demande_motifs` announce `{ module: 'demandes', table: 'demandes', record_id: <the request>, op }` on `org:<org>:demandes`; the inbox and the record read again (`useDemandesRealtime`).

### Screens

- **`/demandes`** (« Demandes », nav, `demandes.view`): real tabs for the views (decision #35) with their counts; filters « En retard », « Sans réponse », « Urgentes », « À rappeler maintenant » and « Toutes / Les miennes / Non assignées » in the address (`?vue=`, `?filtres=`, `?pour=`), the search in the history state (Loi 25: never in the URL). Each row: the person and the number, when it came in and how, the promise in words, the state, the counselor, the follow-up; « Noter un appel » (`demandes.manage`). « Nouvelle demande » is the quick entry (a name, a phone or an email, the channel, urgent, « Je m'en occupe », the note with `demandes.notes`), then the record opens.
- **`/demandes/:id/:onglet`** (`accueil`, `participants`, `suivi`, `historique`): the header (the person, the number, the state and its moves (closing asks for the reason), the counselor, « Je m'en occupe », « Noter un appel »); **Accueil** the file (« Rattacher un dossier »), the contact and the intake, saved together (only the changed keys); **Participants** who the request is for, one main person; **Suivi** the attempts, the dated tasks (the discovery call, a callback, a follow-up; done with an outcome, cancelled), the internal note; **Historique** the events in words, by whom and when. Read-only without `demandes.manage` or once closed. « Jumelée » is not offered here: the matching panel (D4) and the proposals (D3b) set it.
- **Clients (D-14):** « Rattacher un dossier » opens Clients' `ClientPicker` (`@/modules/clients`, lazy) in the Accueil card: a search result, « Choisir ce dossier » in its duplicates panel or a file made through « Nouveau client » (prefilled with the request's contact) becomes the request's file; `get_demandes_reference()` reads the referral sources from Clients' view `referral_sources_catalog`, as do the booking page, the booking's check and `demandes_sources` (D-25, migration `…_demandes_sources_catalog`, pgTAP `140`).

## D3b: the discovery calls

Migration `20261013084345_demandes_discovery_calls`; pgTAP `124_demandes_discovery_calls`; decision D-20.

A discovery call is a dated task of its request (D1, kind `discovery_call`), made by the public booking page (D3c) or by a counselor (Suivi, « Ajouter une tâche »). « Appels découverte » replaces the fake appointments of GOrendezvous's shared « conseillère » agenda.

| RPC | Permission | Does |
|---|---|---|
| `list_discovery_calls(p_from, p_to, p_overdue)` | `demandes.view` | the calls of a period (32 days at most) in time order, and with `p_overdue` the open ones due before it: the request, the person (the file's name, else the contact), the number to call (the file's mobile, else the request's), booked online, urgent, who calls, done (outcome, by whom); cancelled ones left out |
| `reschedule_demande_task(p_demande_id, p_task_id, p_due_at)` | `demandes.manage` | an open task moved, never into the past; a call booked online keeps its cancel link, valid until the time first booked |
| `assign_demande_task(p_demande_id, p_task_id, p_assigned_to)` | `demandes.manage` | who does an open task (someone who works the requests), or nobody: the first one free |

- **`/demandes/appels`** (« Appels découverte », nav, `demandes.view`): real tabs « Aujourd'hui » (with the calls not made since, « En retard »), « Demain », « 7 prochains jours » (`?vue=`), grouped by day; each call: the time, the person (to the request's Suivi), the number (`tel:`), « Réservé en ligne », « Urgente », « En anglais »; with `demandes.manage`: « Qui appelle », « Jointe », « Pas de réponse » (D1's `complete_demande_task`: the request's contact attempts count it), « Reporter… », « Annuler » (asks first; nothing is sent to the person: she is told by phone).
- Done and cancelled calls follow the clinic's Demandes channel (the inbox and the record too).

## D3b: the proposals

Migrations `20261013095543_professionals_display_facts` (Professionnels: `private.professional_display_facts`) and `20261013095548_demandes_propositions`; pgTAP `125_demandes_propositions`; functions `demandes-propose` (user) and `demandes-proposition-answer` (public token); decisions D-22 … D-24; Rendez-vous R1b (AP-15, held appointments).

| RPC | Permission | Does |
|---|---|---|
| `proposition_services(p_professional_id)` | `demandes.manage` | the services she may be booked for (active, with a duration, one of her titles or a clinic service); her free slots come from Rendez-vous' `get_open_slots` (`appointments.view`) |
| `create_proposition_for_service(p_actor, p_demande_id, p_professional_id, p_service_id, p_starts_at[], p_mode, p_token_hash)` | service role (`demandes-propose`, the actor verified there and again here) | refuses while Demandes is reserved for its testers (P3-40, HINT `module_reserved`), without Rendez-vous, a client file, an address, or with a proposal pending, and unless the request is « Acceptée », on the waiting list or « Proposée » (HINT `state`); holds 1–3 slots (`private.appointments_hold`: every booking rule, in her availability, until 48 h — or until the last slot starts when all start sooner — or the slot's own start), snapshots what the person is shown (`professional_display_facts`, the service's name), issues the link (purpose `proposition`, 48 h, one use); the request moves to « Proposée » |
| `resolve_proposition_link(p_link_id)` / `answer_proposition_for_service(p_token_hash, p_appointment_id, p_decline_reason)` | service role (`resolve-link`, `demandes-proposition-answer`) | the clinic, the professional, the service, the mode and the slots still to come; accepted → `appointments_confirm_hold` (every rule again; a slot no longer possible answers `unavailable` with R1b's HINT and the link stays), the others released `other_accepted`, the request matched (`waitlist_place`: its waiting-list entries « Placée »); declined → all released, the reason; Demandes off or reserved for its testers (P3-40: a link sent before shows and books nothing), Rendez-vous off → invalid |
| `withdraw_proposition(p_id)` | `demandes.manage` | a pending proposal withdrawn (slots released `withdrawn`, link revoked) |
| `list_demande_propositions(p_demande_id)` | `demandes.view` | the record's proposals: the professional and service as proposed, the slots, the answer and when, the slot chosen, who proposed |

- **After a proposal that did not place the person** (declined, expired, withdrawn): a request still « Proposée » goes back to « Liste d'attente » when it has an open entry, else to « Acceptée ». Matching or closing the request withdraws a pending proposal (slots released `demande_closed`), through `set_demande_state` or through the waiting list (`waitlist_place`); any other move by hand waits until it is withdrawn (« Retirez-la d'abord »).
- **Locks:** every path takes the request, then the proposal, then its link; the answer reads the link first without a lock and checks it again once locked.
- **Expiry:** the SQL job `demandes.propositions_expire` (every 10 minutes, maintenance) expires the proposals past 48 h (slots released `expired`; R1b's own `appointments.holds_release` frees them too). Notices `demandes.proposition_accepted`, `_declined`, `_expired` to `demandes.manage`, linking the request's Suivi.
- **The email** `demandes.proposition` / `_en` (the recipient's language): Clients' published contacts of the file (`client_contacts_for`, right `appointments`: the client, else who manages her appointments), the slots in the clinic's time, the button « Choisir ma plage » → `/proposition#t=…`. A failed email leaves the proposal standing: the counselor is told and calls, or withdraws it.
- **No user** in the job and the link: the names come from Professionnels' `private.professional_display_facts` (the name as on the fiche, the primary title, the status), never `professionals_directory` (it needs `professionals.view`). The waiting list's follow-up email (D3) names a professional's list the same way.

### Screens

- **Suivi → « Propositions »**: each proposal with its state (« En attente de réponse (jusqu'au …) », « Acceptée : premier rendez-vous le … », « Refusée : … », « Sans réponse en 48 h », « Retirée »), its slots, who proposed; « Retirer la proposition » (asks first). « Proposer un professionnel » (a request « Acceptée » or on the waiting list, nothing pending, `demandes.manage` and `appointments.view`; the slots of another professional or service are never offered while the new ones load, and are read again after a refusal): the professional, the service, video or phone, 1 to 3 of her free slots over 14 days; « Envoyer la proposition (N plages) ».
- **`/proposition#t=…`** (public, `propositionPublicPage`): the clinic, the professional and her title, the service, the mode, « réservées jusqu'au … »; « Choisir cette plage », « Aucune ne me convient » with an optional reason. A slot no longer possible is said plainly (« vient d'être prise », « solde à régler »…) and the other slots stay. In French (D-11).

## D3: the waiting list, part 1

Migration `20261013064427_demandes_waitlist`; pgTAP `123_demandes_waitlist`; functions `demandes-waitlist-followup` (job) and `demandes-waitlist-answer` (public token); decisions D-15 … D-19 ([roadmap §2.3 bis](../plans/2026-10-11-next-modules-roadmap.md)).

### RPCs

| RPC | Permission | Does |
|---|---|---|
| `register_waitlist(p_demande_id, p_targets, p_priority, p_priority_reason)` | `demandes.waitlist` | one entry per target: `{title_id}` (an active profession) and / or `{professional_id}` (an active professional), at most one of each, once per list; needs the request's client file; « Prioritaire » needs its reason; the criteria are copied from the request; the request moves to « Liste d'attente » (D-15) |
| `update_waitlist_entry(p_id, p_patch)` | `demandes.waitlist` | priority and reason, the criteria (periods, days, mode, language, gender, clientèle, payer, motifs from the catalogue), the bridge professional, the next call |
| `invoice_waitlist_fee(p_id)` → the invoice's number | `demandes.waitlist`, Facturation enabled | « Facturer l'inscription »: an entry with its client's dossier and a fee « À facturer »; Facturation invoices `waitlist_registration` (50100) to the dossier's payer and sends it (migration `20261013152344`); the entry follows the invoice through Facturation's hook (`private.demandes_waitlist_billing_changed`): paid → « Payés » (then active), refunded → « Facturés » (a promotion stays), credited → « À facturer » (BI-19) |
| `set_waitlist_fee(p_id, p_status, p_reason)` | `demandes.waitlist` | `to_invoice`, `paid`, `waived` (with a reason); `invoiced` belongs to Facturation; back to « à facturer », an active entry is incomplete again |
| `log_waitlist_contact(p_id, p_kind, p_outcome, p_next_contact_at)` | `demandes.waitlist` | a call, email or text; `reached` is the contact the follow-up counts from (« À rappeler » → « Active ») |
| `add_waitlist_offer(p_id, p_professional_id, p_slots)` / `answer_waitlist_offer(p_id, p_offer_id, p_response)` | `demandes.waitlist` | an offer made by phone, noted by hand (0–3 slots), one pending at a time, a complete entry only; `accepted` places the person (every open entry of the request « Placée », the request matched with that professional), `declined` / `withdrawn` → « Active » |
| `exit_waitlist(p_id, p_reason, p_professional_id)` | `demandes.waitlist` | `placed` (needs the professional: as an accepted offer), `referred_elsewhere`, `withdrew`, `no_answer`, `other`; a request left with no open entry closes with the twin reason (`referred_out`, `withdrew`, `no_answer`, `other`) |
| `list_waitlist(p_title_id, p_professional_id, p_states, p_demande_id)` | `demandes.view` | one list in its order (open entries: priority, then the oldest, then the id), every open entry, or a request's entries; each with its rank and the list's size, the days waited, the consent's state, the fee, the last contact and next call, the bridge, a pending offer, « Sans réponse au courriel de suivi ». Settled incomplete entries become active first (D-16) |
| `waitlist_lists()` | `demandes.view` | every active profession and professional with its open, incomplete, « à rappeler » and offered counts and its average wait (registration → « Placée », 12 months, D-19) |
| `get_waitlist_entry(p_id)` | `demandes.view` | the side sheet: the entry and its criteria, the follow-ups, the offers, the fee's price for the client today (`private.service_price`, Services et tarifs' « Inscription à la liste d'attente », key `waitlist_registration`) |
| `get_` / `set_demandes_waitlist_settings` | `demandes.view` / `demandes.waitlist` | `{followup_weeks 1–26 (8), followup_email (off), answer_days 3–30 (14)}` (`org_module_settings`, demandes, `waitlist`) |
| `waitlist_followup_for_service(p_org_id, p_limit)` / `prepare_waitlist_followup_for_service(p_org_id, p_entry_id, p_token_hash)` / `mark_waitlist_followup_sent_for_service(p_org_id, p_entry_id, p_sent)` | service role (the job) | the pass, one email's link (P3-40 in both), then the send noted (or its link revoked) |
| `resolve_waitlist_followup_link(p_link_id)` / `answer_waitlist_followup_for_service(p_token_hash, p_answer)` | service role (`resolve-link`, `demandes-waitlist-answer`) | the page's clinic and list; `stay` / `leave` once, for the whole request (Demandes switched off: invalid) |

- **`set_demande_state` follows the list (D-15):** « Liste d'attente » only with an open entry (registration is `register_waitlist`); matched → the open entries « Placée »; closed → the closing reason's twin. « Proposée » and « Acceptée » keep the entries (and their rank).
- **Complete (D-16):** `incomplete` until the « liste d'attente » consent is in force (`signed`, or `resign`: in force with a new version to sign) or not required (its rule off: Paramètres → Consentements), and the fee paid or waived; then `active`. Clients has no hook when a consent is signed, so `private.waitlist_promote` runs after every write, when the list is read and in the daily job. The consent is sent from the client's file (Clients' panel, with its own P3-40 check); the sheet links there.
- **Rank:** computed, never stored: per list (`target_profession_title_id` or `target_professional_id`), open entries only. The professional's `my_waitlist_entries` uses the same order.
- **Realtime:** `waitlist_entries` announces its request (`record_id` = the request), so the record and the list follow.

### The follow-up (D-17)

- **Job `demandes.waitlist_followup`** (function `demandes-waitlist-followup`, hourly, due at 7 h clinic time, off until the clinic switches it on): settled entries become active; active entries without a conversation for `followup_weeks` (or whose next call is due) → « À rappeler », with one notice `demandes.waitlist_to_call` (`demandes.waitlist`, link `/liste-attente?etat=a-rappeler`, one per day); a « still waiting? » email unanswered after `answer_days` → a follow-up « Pas de réponse » (« Sans réponse au courriel de suivi »).
- **The email** (`demandes.waitlist_still_waiting` / `_en`, the recipient's language; when `followup_email` is on and Demandes is open to everyone): one per request (its oldest « À rappeler » entry), the request not emailed during the last `followup_weeks`; the address from Clients' published `private.client_contacts_for(…, 'communications')` (the client herself, else her main contact or another related person who receives her communications; never a merged or anonymised file), the request's own only without a file; noted in the follow-ups only once sent (`mark_waitlist_followup_sent_for_service`; a failed send revokes its link and the next pass tries again); a link (purpose `waitlist_followup`, valid `answer_days`, one use) to `/liste-attente/reponse#t=…`. The answer covers the whole request: « Oui, je reste » → its « À rappeler » entries « Active » (no call needed); « Non, retirez-moi » → every entry out « Ne souhaite plus » (the request closes), notice `demandes.waitlist_left`. The page is in French (as D3c's, D-11).
- **P3-40:** while Demandes is reserved for its testers, `waitlist_followup_for_service` lists no email and `prepare_waitlist_followup_for_service` prepares none (pgTAP 123).

### Screens

- **`/liste-attente`** (« Liste d'attente », nav, `demandes.view`): one list (« Liste »: professions, then professionals, each with its count; `?liste=t-<id>` / `p-<id>`) or every open entry; states as filters (`?etat=incompletes`, `actives`, `a-rappeler`, `offres`, `sorties`); the list's average wait; each row: the rank (« 1re sur 12 »), the person (the request's Suivi), « Prioritaire » and its reason, registered and days waited, the state (« Sans réponse au courriel de suivi », a pending offer), the consent and the fee; « Ouvrir » the side sheet.
- **The side sheet** (`components/waitlist/EntrySheet`): state, rank, registered, criteria, links to the request and the client's consents; with `demandes.waitlist` while open: priority and bridge professional, « Frais payés » / « Exonérer les frais… » / « Remettre à facturer » (the price « plus taxes »), « Noter le suivi » (with an optional next call) and the follow-ups, « Noter une offre faite par téléphone » and its answer, « Sortir de la liste » with a reason. « Facturer l'inscription » (with Facturation enabled, a dossier and a fee « À facturer »: the invoice's number in a toast; while « Facturés », the fee follows the invoice).
- **The record:** « Passer à Liste d'attente » opens « Inscrire sur la liste d'attente » (a profession and / or a professional, « Normale » / « Prioritaire » with its reason; the client file first); **Suivi** shows the request's entries (list, rank, state, consent, fee) and the same button. **Accueil** shows D3c's « Provenance » card.
- **Paramètres → Liste d'attente** (`liste-attente`, seen with `demandes.view`, changed with `demandes.waitlist`): the weeks, the email, the days.
- **`/liste-attente/reponse#t=…`** (public, `waitlistAnswerPublicPage`): the clinic and the list, « Oui, je reste sur la liste » / « Non, retirez-moi de la liste », once.

## D4: the matching panel

Migration `20261013181604_demandes_matching` (pgTAP `164`, with Professionnels' published facts as a fixture); Professionnels' `20261013181559_professionals_matching_exclusions` (pgTAP `163`); decisions D-27 … D-30, P4-551, P4-552, R-66.

- **`match_professionals_for_demande(demande)`** (definer; `demandes.view` and `professionals.view`, both first): the request's criteria and every professional of the clinic, in the documented order, each with why. It reads:
  - Professionnels only through `private.professional_matching_facts` (active reference rows only, rule 7);
  - Clients through `private.clients_booking_facts`. The person seen is the main participant when the request has participants: her file, else the birthday given, never the caller's file in her place. Otherwise it is the request's file;
  - Rendez-vous through `private.first_appointments` and `private.appointment_absence_facts`.

  An archived profession or clientèle on the request is not applied, and the criteria say so (`ignored`): it would leave everyone out.
- **Hard filters (D-27)**, each one a reason when a professional is left out:
  - `inactive`, `not_ready`;
  - `not_accepting` (unless the client's first appointment is already with her);
  - `title` (the profession asked);
  - `clientele` (the clientèle asked, else a couple's `couples`, a family's `families`, else the age's);
  - `min_age`, `women_only`, `language`;
  - `gender` (only when one is asked).
- **Warnings, never filters:**
  - `refused_motif`: a motif she refuses is in the request (R-66: « ça dépend »);
  - `insurance_expired`: a proposal is always for a first appointment, so it asks first on both paths (rule 8). From the panel, « Proposer » asks in a dialog. From Suivi, « Proposer un professionnel » asks with a checkbox. Also `insurance_expiring` and `insurance_missing`;
  - `age_unknown` / `sex_unknown`: a limit nobody can check yet (« à vérifier », never assumed);
  - `clientele_unknown`: no age, no clientèle asked, neither a couple nor a family. The clientèle is not checked and no ★ is scored;
  - `no_places`: 0 place left.
- **The order (D-28):**
  1. eligible first;
  2. then the fit: 100 per request motif she holds, 10 for a ★ clientèle, 1 per request period she has;
  3. then places left: a number first, most first; then « non suivi »; then 0;
  4. then the name, then the id.

  Never `sort_order`, never the priority. The panel says the order in words.
- **« À prioriser » (D-29, P4-552):** the workbook's name colours, written down with a reason in Professionnels' Jumelage tab. A badge in the panel, never the order.
- **Places left (D-30, rule 11):** `private.demandes_places_left(org, ids[])` is `new_client_places` minus the requests matched to her since `new_client_places_set_at`.
  - A match is the first appointment booked: the proposal accepted, or « Jumelée » by hand. A match not booked yet keeps its place.
  - The place comes back when her appointment with the client was cancelled since the match and the client has no other appointment with her.
  - It is null when she tracks none. D5's snapshots and board read it.
- **Screen: the record's tab « Jumelage »** (`/demandes/:id/jumelage`, shown with `professionals.view`):
  - « Ce que la demande indique »: the language, who the request is for, the age and sex, the profession, the clientèle, the motifs (every name), the periods, a preferred gender;
  - « Admissibles (N) »: rank, name and title, « À prioriser » and its reason, the places, the fit in words (« Motifs : Anxiété et Deuil (2 sur 3) », « ★ Clientèle spécialisée », « Disponibilités : Soir »), the warnings, « Bon à savoir », « Voir le dossier » and « Proposer » (the proposal of D3b with her preset, when the request can receive one);
  - « Non admissibles (N) », folded, each with its reasons.
  - The panel is its own query, a child of the record's key: every write on the request reads it again.

## D4, part 2: the waiting list meets the matching

Migration `20261013200947_demandes_waitlist_offers` (pgTAP `168`); decisions D-34 … D-36.

- **Compatible registrants (D-36):** `private.demandes_waitlist_compatible(org, professional)` lists the open entries she could be offered.
  - Which entries: those on her own list and her professions' lists, « Active » or « À rappeler » (consent and fee settled), with no proposal pending.
  - Which criteria: D4's hard filters, applied to the entry's own criteria (its language, periods, gender, clientèle, motifs), with the person's age and sex taken from the request. Her own list keeps the request's profession, as the request's panel does.
  - One row per request, her own list first. The order is the list's: « Prioritaire » first, then the oldest.
  - Complete entries are settled first (`waitlist_promote`), as the list does.
  - `list_waitlist_compatible(professional)` (`demandes.view` and `professionals.view`) shows them with the match's warnings.
- **« Place disponible » (D-34):** D5's nightly photo compares each professional with her last one.
  - It compares with the clinic's previous photo. A place has opened when she has more places left than then, she accepts new clients again, or she is active again or newly active.
  - If someone compatible waits, one notice `demandes.waitlist_slot_available` goes to `demandes.waitlist`, once per professional per day, pointing to `/liste-attente?liste=p-<her>`.
  - Nothing is sent on the clinic's first photo, because there is nothing to compare.
  - Rendez-vous availability changes are not watched: a place is what the clinic declares (the workbook's model).
- **« Offrir la plage » and the next one (D-35):**
  - From a compatible row, « Offrir la plage » (with `demandes.manage` and `appointments.view`) opens the request's « Jumelage » with the proposal to her preset (`?proposer=`): 1 to 3 of her slots held 48 h, one link (D3b, P3-40 included). An expired insurance asks first. When the proposal cannot open (no longer eligible, a proposal pending, the request not open), a toast says why.
  - When a proposal of hers is declined or unanswered for a person on the list, and someone else compatible waits, the notice `demandes.waitlist_offer_next` (« Plage à offrir au suivant ») goes to `demandes.waitlist`. It is sent from `demandes_end_proposition`.
- **Screen:** on a professional's list (`/liste-attente?liste=p-<id>`, with `professionals.view`), the card « Personnes compatibles avec … » shows each person in order, which list she is on, « Prioritaire », the days waited, the warnings, and « Offrir la plage ».
- **No message leaves the clinic:** the notices are internal, and the proposal keeps D3b's checks.

## D5: places and the availability board

Migrations `20261013191827_demandes_capacity` (pgTAP `166`) and Professionnels' `20261013191821_professionals_places_restart`; decisions D-31 … D-33, P4-553.

- **`list_professional_capacity()`** (definer; `demandes.view` and `professionals.view`, both first). For every active professional of the clinic, by name:
  - her places: declared, taken, left (D-30), since when;
  - whether she accepts new clients;
  - her periods and languages;
  - « À prioriser » and « Bon à savoir »;
  - her matches of the last 30 days.

  The totals come with it: places left across the tracked ones (the workbook's « TOTAL DES DISPONIBILITÉS »), how many are tracked, how many have places, and the day of the last snapshot. The order is the name (D-31): the board is never a ranking, because a request's panel ranks for it (D4).
- **`capacity_snapshots`** (D-32): one row per active professional per clinic day, with declared, taken, left and accepting.
  - It is written by the SQL job `demandes.capacity_snapshots` (maintenance, every night at 8:45 UTC, « Photo des places des professionnels »): each row is the state at the start of the clinic's day. « Exécuter maintenant » replaces the day's row and never doubles it.
  - Staff read it (`demandes.view`). It is not audited: these are figures computed from audited facts (000_invariants).
  - D6's indicators and D4's « Place disponible » read it.
- **Setting the places from the board (D-33, P4-553):** Professionnels' `set_professional_new_client_places(id, places, restart)` (`professionals.matching`, 0–99, null when not tracked).
  - « Recommencer le décompte aujourd'hui » stamps today even when the number is the same. This is rule 11's action « recommencer le décompte », which belongs to Demandes' screen of places.
  - Audited on the matching profile, with its source.
- **Screen: `/demandes/places`** (« Places des professionnels »; nav « Places restantes »; `demandes.view`, shown and opened with `professionals.view` too):
  - the total and the snapshot's day;
  - real tabs « Tous », « Avec des places », « Complets », « Non suivis » with their counts (`?vue=`);
  - one row per professional: her name (to her file's Jumelage tab), title and « À prioriser »; « 2 sur 3 restantes » (0 is a warning) and « Depuis le … : N prises »; « Accepte » or « N'accepte pas »; the periods, the languages, her matches of 30 days, « Bon à savoir »;
  - « Modifier » (`professionals.matching`): the number and « Recommencer le décompte ».

## The parity gaps before the cutover

Migrations `20261013210942_clients_primary_from_match` (Clients) and `20261013210953_demandes_parity`; pgTAP `169`, `170`; decisions **D-37 … D-41**; [parity audit](../plans/2026-10-13-parity-audit.md) P6–P9 and L19.

- **Participants' files (B-1, D-37):**
  - « Ajouter un dossier de la clinique » in « Participants » opens Clients' picker (search, or « Nouveau client » with its duplicate check). The file joins the list, as « Conjoint ou conjointe » on a couple request; it is saved with the set.
  - A couple request that does not count two people, or a family that counts fewer than two, is said in plain words. It is never blocked, as in legacy.
  - A proposal books the request's file and the participants' other files, the main person first: all of them, two at most (an appointment counts two clients). A couple service with one file asks for the second person's; three files or more are refused in plain words (book in the agenda). Before, a family's proposal booked the main file alone; Christine is asked whether the refusal suits her (status doc, « À confirmer »). The helper is `private.demandes_booking_clients`.
- **The intake's follow-ups (B-2, D-40)**, legacy's questions, labels « déléguée — révisable » until Christine confirms the wording:
  - « Enjeux » oui / non → Coparentalité, Autre, and « Précisions sur les enjeux »;
  - « Déjà consulté » (the existing `previous_therapy`) → « Professionnels consultés » (Psychologue, Travailleuse sociale ou travailleur social, Psychoéducatrice ou psychoéducateur, Médecin, Autre) and « Précisions sur les consultations »;
  - « Contexte légal » oui / non → Ordonnance du tribunal, DPJ, and « Précisions sur le contexte légal »;
  - « Autre motif » (a motif not in the list) and « Autres disponibilités ».

  The issue « Coparentalité » sits beside the motif of the same name: the groups are « Enjeux nommés » and « Contexte légal nommé », and the wording is on Christine's list. « Non », or no answer, clears what follows: the screen at once, and the database before every write (`private.demandes_clear_followups`, with a check). The comments and « Autre motif » are redacted in the journal like `concerns`. No diagnostic field (D8). `create_demande` and `update_demande` accept the new keys.
- **« Jumelée » by hand (B-3, D-38):** for a person matched and booked by phone.
  - « Passer à Jumelée » (from « Acceptée », « Proposée » or the waiting list) asks for the professional: any active one of the clinic. « Jumeler » on a row of « Jumelage » presets her.
  - It calls `set_demande_state(…, 'matched', …, p_professional_id)`. A pending proposal is withdrawn and the waiting list closes, as before.
- **Consents per file (B-4, D-39):** `demande_consents(p_id)` (`demandes.view`) gives, for the request's file and each participant's, the consents its situation requires and their state.
  - The requirements are Clients' rules: `general`, the payer kind (IVAC, PAE), and once matched the professional's status (an intern, one with a supervisor: Professionnels' `professional_receipt_facts`).
  - The states are signed, « à signer de nouveau », sent, late (`client_consents_status`), and to be signed.
  - It is read live each time; nothing is copied onto the request. A state Clients adds later reads as « à faire signer » on the screen.
  - « Participants » shows a badge per file, and one line for the request: « Tous les consentements requis … sont valides », or what to settle, file by file. It never blocks the match or the proposal.
- **The primary professional (A-6, D-41):** at the match, and when a file is added to a matched request, the files without a primary professional get her. A request matched again moves to the new professional the files whose primary is the previous match (the last `matched` event): a mistaken « Jumeler » is undone by matching again. This goes through Clients' `private.clients_fill_primary_professional`; a file with another primary professional keeps it, merged and anonymised files are left alone. Clients' screens read again after the match and after any write on a matched request.
- **Not yet in `my_demandes`:** the professional's read keeps its columns; whether she sees « Autre motif » and « Autres disponibilités » is asked of Christine.

## D6: the intake indicators

Migrations `20261013233833_demandes_report_facts` (Demandes), `20261013233844_appointments_first_after` (Rendez-vous), `20261013233851_reports_demandes` (Rapports), then `20261014035807_demandes_received_index` (every state by date received, for the report and the closed or all views; pgTAP `186`); pgTAP `172_reports_demandes`; decisions **D-42 … D-45**; the workbook's KPIs ([intake workbook §8.3](../research/2026-10-08-intake-workbook.md)).

- **Where (D-42):** Rapports « Indicateurs des demandes » (`/rapports/demandes`, `reports.view`, admin by default), listed only while Demandes is enabled; `report_demandes` refuses in French otherwise. Demandes publishes the facts and computes nothing for the screen ([Rapports doc](reports.md)).
- **Published facts** (granted to no role, for definer code that checked its own permission):
  - `private.demandes_report_requests(org, from, to)`: each request received in the period: channel, who took it, the declared source, campaign, utm_source / utm_medium, the referrer's host (lower case, no `www.`), state and closing reason, clientèle (its id), first contact attempt and its business hours, the promise's state (`contact_status`: on_time, late, pending, overdue, no_attempt), first proposal, first match, ever on the waiting list. Never a person's name, a contact, the concerns or the note.
  - `private.demandes_report_matches(org, from, to)`: each « Jumelée » event (by hand or an accepted proposal), with the request's file, the professional and the clientèle.
  - `private.demandes_report_waitlist(org, from, to)`: entries open now, registered or exited in the period, with the list's target (ids: the caller asks Professionnels for the names).
  - `private.demandes_report_capacity(org, from, to)`: D5's photos between two clinic dates.
- **Definitions (D-43):**
  - received = the requests received in the period, except those closed « En double » (counted apart, shown in the outcomes);
  - activity rate = the matches of the period ÷ the requests received in the period (the workbook's figure);
  - cohort rate = the share of the period's requests matched since;
  - the promise is the first contact attempt (call or message) within 2 business days, i.e. 48 business hours (D-12); never contacted reads « délai en cours », « en retard » (as the inbox counts now) or, matched or closed, « sans appel ni message »;
  - delays are medians and averages over the requests that reached the step;
  - weeks start on Monday, months on the 1st, in the clinic's zone; a week or month the period cuts reads « (partielle) » / « (partiel) »;
  - names come from their owners with retired rows (a past period keeps them); groups are by id, so two namesakes stay apart;
  - « conseillère » is who took the request.
- **First appointments cancelled (D-44):** the first appointment of the request's file with the matched professional, starting at or after the match (not one only held). It counts once when cancelled in the period, whatever the match's date (the latest match before it gives the lead time). Only the pairs (client, professional) with a cancellation in the period are looked at. The rate is ÷ the period's matches (it can pass 100 %); the notice is in hours, the lead time (match → appointment) in days; per week of cancellation, per reason, per professional.
- **Waiting list and places (D-45):**
  - the waiting list counts people (requests), not entries: a request on a profession's list and a professional's counts once; an incomplete registration (consent or fee) is apart; who waits now per list, registered in the period, exits per reason, and the wait of those placed in the period (first registration to placement);
  - places: the period's last photo (places left across the tracked professionals who accept new clients) and the first photo of each week.

## Accueil: « Demandes à traiter » (L29)

`homeCards` `demandes-queue` (`demandes.manage`, `components/DemandesHomeCard.tsx`): the inbox's counts (`demandes_counts`, its cache), each figure that is not zero a link to the inbox filtered on it: « en retard (plus de 2 jours ouvrables sans contact) » (`?filtres=en-retard`), « sans réponse au dernier essai » (`sans-reponse`), « à rappeler maintenant » (`a-rappeler`), « sans conseillère » (`?pour=personne`), then « à moi » (`?pour=moi`). Nothing when the queue is clear (« à moi » alone is not work to flag).

## The GOrendezvous import of the waiting list (I2 prep, I-16)

`import_waitlist_entry(row, dry_run)` (`demandes.manage`, `demandes.waitlist`, `clients.manage`, `clients.merge`; migration `*_demandes_waitlist_import.sql`, pgTAP `179_demandes_waitlist_import`): one person on one list (`profession_key` or `professional_id`), `external_ref` « gorendezvous:… ». A client's imported entries share one request (`external_ref` « gorendezvous:waitlist:<client id> », channel « Autre », « Liste d'attente »); the entry keeps its GOrendezvous date and fee (`fee_paid` → « payée »), and `waitlist_promote` makes it active as any entry. The same list again, or a request matched or closed since: `skipped`.

## After the cutover audit: the file's requests, the inbox's order, the slots (A-1, A-4, A-7, A-8)

Migration `20261014010723_demandes_audit_followups` (pgTAP `182`); decisions **D-46 … D-49**; [parity audit](../plans/2026-10-13-parity-audit.md) L17 (Demandes' part), L18, L20.

- **The client's « Demandes » tab (L18, D-46):** Clients' record shows a « Demandes » tab after « Consentements » only when a module fills the core slot `client.demandes`. Demandes adds `demandes.client` (`demandes.view`, `pages/ClientDemandesPanel.tsx`): the file's requests and those it is a participant of, newest first, each with its number (a link to the record), received date, state (with the closing reason), « Son dossier » or « Participante ou participant », and the matched professional. `list_client_demandes(client)` (definer, `demandes.view` first) returns only those columns.
- **The inbox's order and columns (L17, D-47):**
  - « Trier par »: « Priorité » (the default: urgent, late, then the oldest; on the open requests; otherwise the most recent first), the received date either way, « Attente la plus longue d'abord », « État » (the workflow's order). In the address (`?tri=recentes|anciennes|attente|etat`). `list_demandes(…, p_sort)` orders in SQL (an unknown sort is refused, 22023), then received date and id.
  - « Colonnes »: État, Conseillère, Suivi (the defaults), Pour qui, Motifs (the count). Her choice is a user preference (`demandes.inbox_columns`), so it follows her from one computer to another. The person, the received date and « Noter un appel » always show.
- **The next free slot in « Jumelage » (L20, D-48):** each eligible professional (the first 15 in the panel's order) shows « Prochaine plage libre : <date et heure> (<service>) », or none in the coming 4 weeks. `demande_next_slots(demande)` (definer; `demandes.view`, `professionals.view` and `appointments.view`) reads Rendez-vous' `get_open_slots` with her default service for the request (`private.demandes_default_service`): a couple's service for a couple, else the 50-minute session, else the first by code, among the services her title allows. The panel asks only when the user holds `appointments.view` and Rendez-vous is enabled; a professional whose slots cannot be read is left without a line.
- **The proposal's slots (L20, D-48, D-49):** « Proposer un professionnel » chooses her default service once her services are read (the same rule; the counselor may change it). When the person gave moments (Matin, Après-midi, Fin de journée, Soir, Fin de semaine), « Seulement aux moments indiqués par la personne » is on and the free slots at other moments are hidden until it is unchecked; each day's slots are grouped by moment.

## « Exporter (CSV) » on the waiting list (parity audit L7)

« Liste d'attente » exports the entries shown (the list and the state chosen), in their order: rank, reference, person, file number, list, priority, registration day, days waited, state, exit reason, consent, fee, last and next contact. Never a free text (the priority's reason stays in the app). Built in the browser (`lib/waitlist-csv.ts`), nothing stored.

## What the module publishes

For the professional: `my_demandes` and `my_waitlist_entries` (above). For definer code: `private.demandes_places_left(org, ids[])` (D4, places left per professional); for Rapports, D6's `private.demandes_report_requests`, `_matches`, `_waitlist`, `_capacity` (above). The view `demandes_sources` (D3c, below).

## Messages to people outside the clinic (P3-40)

D1 sends nothing. Every send path the module adds (the proposal's acceptance link D3b, the waiting-list follow-up email D3 (`waitlist_followup_for_service`, `prepare_waitlist_followup_for_service`), the booking page's confirmations D3c) checks `module_open_to_all_for_org(org, 'demandes')` first, in SQL at its choke point: while Demandes is « Réservé aux testeurs », a manual send is refused in French and an automatic one is not queued; the admin's test still goes. Its pgTAP covers the refusal ([core doc](core.md), « Modules reserved for testers »).

## The discovery-call booking page (D3c)

Migration `20261013045323_demandes_booking`; pgTAP `116_demandes_booking`; function `demandes-book-call`; decisions R-74, **D-7 … D-11**.

- **Public pages:**
  - `/appel-decouverte?clinique=<org>`: one screen. The person chooses a day, then a time (the clinic's time zone), and gives a name, an email and a phone, the call's language, « Comment avez-vous entendu parler de MANA ? » and optionally a few words.
  - `/appel-decouverte/annuler#t=…`: the confirmation's cancel link.
  - Both are never indexed.
- **The function** (`demandes-book-call`, public):
  - `page` returns the slots, the list and a signed proof-of-work ticket (D-7);
  - `book` books the call: per-IP limit first, the ticket checked and spent once, the cancel token hashed, the confirmation email sent;
  - `cancel` cancels by the link, once.
- **Database:**
  - the rule: `get_` / `set_demandes_booking_settings` (org_module_settings, `booking`);
  - service RPCs `demandes_booking_page_for_service`, `book_discovery_call_for_service`, `cancel_discovery_call_for_service`;
  - `resolve_discovery_call_link` (secure-link purpose `discovery_call`);
  - the new column `demandes.source_landing_page` (redacted in the audit).
  - The booking writes through D1's `private.demandes_insert`.
- **Source (R-74):** captured by the page and stored on the request:
  - `referral_source_id`, `source_campaign` (from `utm_campaign`), `source_utm` (utm_* only), `source_referrer` and `source_landing_page`;
  - shown to the counselor by `components/DemandeSourceCard` (D2 mounts it on the record): the channel and « Provenance déclarée » (the full question in its help), then only the capture lines that hold something (« Aucune donnée de campagne » once, for a request not booked on the page);
  - **corrected** (D-26, migration `20261013125941_demandes_source_edit`, pgTAP 146): « Modifier » on the card (`demandes.manage`, a closed request too) changes the channel and the declared source (« Non précisé », or the clinic's `referral_sources_catalog`) through `set_demande_source` (audited before and after); the booking page's capture is a fact the system recorded and is never edited;
  - reportable through the view **`demandes_sources`** (security invoker, staff with `demandes.view`; D6).
- **Paramètres → Appels découverte** (`appels-decouverte`, seen with `demandes.view`, changed with `demandes.manage`): the page's address for the website's button, « Réservation en ligne ouverte », and the weekly ranges.
- **Tests:**
  - pgTAP 116;
  - Deno `demandes-book-call/handler.test.ts`;
  - Vitest: the pages, the card, `lib/booking`;
  - `e2e/booking.spec.ts`: book, the email, cancel.
  - The local seed opens booking every day from 8 h to 20 h.

## Security review (2026-10-14)

Migration `20261014042310_demandes_security_fixes`; pgTAP `186_demandes_security_fixes` (and 116 updated); Deno `demandes-book-call/handler.test.ts`; decisions **D-50, D-51**.

- **The booking page never tells whether an address already has a call** (D-50). A second booking with the same address answers like any booking: no request, no call, no refusal. The earlier call gets a fresh cancel link (the first one stops working). The function sends the usual confirmation to that address, with the call's own time, first name and language, never the text typed this time. The page shows the slot asked for (`requested_starts_at`), never the earlier call.
- **A professional stops seeing the files she loses** (D-51). This happens when a participant is removed or the request's file changes on a matched request, and when the request leaves « Jumelée » (unmatched or closed). Demandes' `private.demandes_release_clients` keeps any file that another request still matched to her holds. For the others it calls Clients' `private.clients_unlink_professional_reason(org, client, professional, 'demande')`, which:
  - removes only a link whose first reason is `demande`;
  - never removes one while she has an appointment with the file (Rendez-vous' `private.appointments_professional_has_client`: held, booked, confirmed, completed, or cancelled late);
  - also clears the file's primary professional when it is her (the match had set it).
  Clients' older `clients_unlink_professional` stays unused.
- **The anonymisation** (`private.demandes_anonymize_client`) now blanks more on the person's requests: the free text (concerns, comments, legal detail, « Autre motif », « Autres disponibilités »), the legal context, the insurer and the source (referrer, landing page, utm). It also deletes their internal note. On the waiting list, the priority and waiver reasons become « Anonymisé »: the checks keep a reason with the priority and the waiver. Journal rows written before this migration keep the values the audit did not redact then.
- **Audit:** `demandes_audit` also redacts `availability_other`, `insurer`, `legal_context`, `issues`, `has_legal_context` and `has_issues`.
- **The cancel link** does nothing while Demandes is off for the clinic.
- **« Facturer l'inscription »** is refused (`module_reserved`) while Demandes is reserved for its testers (P3-40).
- **The booking's names:** each name is 99 characters at most (the function's schema and the page's fields), in letters. A digit, `/ : @ < > …` or a period followed by a letter (a web address) is refused in French with hint `name`, so a name written in the confirmation can never be a link.
- **An offer noted by hand** stores each slot rebuilt (`starts_at`, `ends_at` only).
- **The « still waiting? » link** names a professional's list through `private.professional_display_facts`. It runs without a user, and the directory returned nothing that way.
- **Deferred:** per-clinic and per-address booking caps, and Cloudflare Turnstile on top of the proof of work. D-7 already plans them if spam gets through. The duplicate's answer now sends an email as a booking does, so its timing matches a booking's.

