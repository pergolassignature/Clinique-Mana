# Module `appointments` (« Rendez-vous »)

The clinic's agenda: each professional's availability (weekly windows in clinic time, exceptions), the appointments with their clients and presence, cancellations with a reason, the business hours. Plan: [coding plan §7](../plans/2026-10-11-modules-coding-plan.md#7-rendez-vous-appointments--batches); data: [GOrendezvous tour §1 and §18](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); legacy inventory [§E](../plans/2026-10-06-legacy-feature-inventory.md#e-rendez-vous--disponibilités); decisions R-11 … R-16, R-52, R-53, R-55, R-58, R-59, **AP-1 … AP-27** and **RZ-1 … RZ-8** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| R1 | Schema, booking RPCs, business hours, open slots, the Clients merge and anonymisation handlers | built |
| R1b | Held appointments: the slots a Demandes proposal keeps for a client until accepted, withdrawn or expired (AP-15) | built |
| R2 | Agenda UI (Jour, Semaine, Prochains jours, Mois; all pros, a service's, one), availability mode, the staff's « Hors disponibilités » (AP-12) | built |
| R3 | Series (every 1–12 weeks, conflicts listed then refused or skipped), cancel the rest of a series, personal appointments, the `mark_completed` job (AP-16 … AP-18) | built |
| R4 | Confirmations, reminders (the business day before), changes and cancellations by email and text, the confirmation link and « OUI », « Clients sans rappel » (AP-19 … AP-22) | built |
| R5 | « Mon agenda », the client's appointments in « Visites et paiements » (slot `client.visits`), publications for Demandes and Facturation (AP-23 … AP-25) | built |
| RZ | Video links: Zoom per professional, or a fixed personal link (lane C) | built |

- **Registry:** `modules.key = 'appointments'`, depends on `clients`, `services`, `professionals`. It **starts disabled** in every clinic.
- **Migrations:** `20261013055753_appointments_module` (registry, tables, RLS, audit, seeds), `20261013055754_professionals_booking_facts`, `20261013055755_clients_booking_facts` and `20261013055756_services_booking_facts` (the owning modules' published facts), `20261013055757_appointments_booking` (RPCs, handlers); R2: `20261013064650_clients_display_names` (Clients' published names), `20261013064653_appointments_agenda` (AP-12, `set_appointment_details`, `list_agenda`); R1b: `20261013075644_appointments_holds` (the `held` state, the hold helpers, the job `appointments.holds_release`); R3: `20261013081107_appointments_series` (`appointment_series`, the series RPCs, `book_personal_appointment`, the job `appointments.mark_completed`, `list_agenda` with `series_id`); R4: `20261013091533_appointments_messages` (`appointment_messages`, the deferred trigger, the reminders, the job's and the link's RPCs, « OUI », « Clients sans rappel », eight email templates); R5: `20261013100856_appointments_publications` (`get_my_agenda_reference`, `list_client_visits`, `appointments_for_billing`, `first_appointments`), `20261013100859_appointments_messages_reserved` (P3-40 for the messages, AP-26), `20261013104956_appointments_messages_core_held` (core's CC-14: the texts name their module, an email core holds is set aside).
- **Tests:** pgTAP `118_appointments`, `122_appointments_agenda` (R2: the override, the details, the agenda read), `130_appointments_holds` (R1b: a hold takes its slot, the staff's RPCs refuse it, confirm checks again with the balance rule, release, expiry and the job, anonymisation), `131_appointments_series` (R3: the preview across the March change, conflicts refused then skipped, every date at the same local time, cancel the rest, personal appointments, completion and a no-show), `132_appointments_messages` (R4: each recipient by her own channel, the job's pass and an email with its link, the link's page and « Confirmer ma présence » once, a move, « OUI », a cancellation, the reminders once and not right after a confirmation, no consent, three tries, personal and held appointments), `133_appointments_publications` (R5: « Mon agenda »'s reference, a client's visits for the staff and for a linked professional, the publications), `140_availability_windows` (AP-27: the defaults, merges and a chain, other settings refused or kept apart, the week's exception, a move, appointments left outside, one week only, the professional's own), `134_appointments_messages_reserved` (P3-40: Communications reserved → texts skipped; Rendez-vous reserved → nothing queued, pending emails set aside, nothing sent at the reopening; an imported appointment sends no confirmation) (97 tests: privileges, RLS per role, seeds, availability, a 50 min session blocking 60, overlap and « pause après », outside availability, the two 2027 daylight-saving Sundays, services and titles, couples, the professional's limits, archived files, the balance rule (HINT `balance_due`) and its override, a retired service, personal appointments, move, presence, cancellation and its late flag, open slots (also under a Montréal session), the consents read, the handlers); Vitest `src/modules/appointments/**/*.test.ts(x)` (manifest; `lib/agenda.test.ts`: calendar days and placement at both 2027 change Sundays, 15-minute snapping, lanes; `lib/availability-edit.test.ts`: snapping, moves, resizes, merge previews, labels; `AgendaPage.test.tsx`: the views, click to book, AP-12, drag to move, availability mode (draw, move, resize, « Seulement cette semaine », « Supprimer » and « Annuler », « Bloquer », the vacation week, « Ajouter une plage »), a held slot, a series with a conflict skipped, cancelling the rest of a series); Playwright `e2e/appointments.spec.ts` (book, drag, cancel; « Hors disponibilités »; a weekly series with a conflict skipped, then the rest cancelled; « Disponibilités »: draw, undo, move, resize, undo, delete); the audit labels checked by `src/app/audit-labels.test.ts`. Local seed: Félix available Monday–Friday 9:00–17:00, three appointments next week, and Alice's completed session last week's Wednesday (to invoice).

## Permissions

| Permission | Default roles | Gives |
|---|---|---|
| `appointments.view` | admin, conseillère, adjointe | read the clinic's agenda and availability |
| `appointments.manage` | admin, conseillère, adjointe | book, move, cancel, note presence, manage every professional's availability |
| `appointments.self` | admin, professionnel | the same on one's own agenda only (`private.current_professional_id()`) |
| `appointments.balance_override` | admin, adjointe | book a client who owes money, with a reason (R-58) |
| `appointments.settings` | admin | the business hours and reminder settings |

## Tables

All per clinic (`org_id`), RLS on, `select` only for clients (every write is an RPC), audited with `private.audit_trigger` (notes, messages, cancellation details, the override's reason, the video link and an exception's label redacted).

| Table | What | Rules |
|---|---|---|
| `appointment_settings` | one row per clinic: business days (ISO, 1 = Monday) and hours (Monday–Friday 8:00–17:00), reminders `reminder_business_days` (1) before at `reminder_local_hour` (8) | rules when reminders go out (R4), **never** when one may book (R-52); seeded per clinic |
| `cancellation_reasons` | GOrendezvous's list minus COVID-19: Non spécifiée, Plus requis, Urgence personnelle, Urgence familiale, Urgence au travail, Insatisfaction, Autre | seeded per clinic (`seed:appointments_reference`) |
| `availability_rules` | a professional's weekly window: weekday, local start and end (clinic time zone), `service_ids` (empty: every service she offers), visible to clients, overflow allowed (may end after the window), valid from / until | two windows of a weekday never overlap over overlapping validity |
| `availability_exceptions` | holiday, vacation or other, as instants, with a label | no booking overlaps one |
| `appointments` | professional, service, `starts_at`, `ends_at` (the session), `blocks_until` (+ « pause après »), mode `video` / `phone`, state `booked` / `confirmed` / `completed` / `cancelled`, personal and work flags, `internal_note` and `client_message` (R-11), cancellation (reason, details, by, at, `cancel_late`, `kept_on_schedule`), balance override (reason, by), video fields (R4, RZ), `external_ref` (the import) | **no two active appointments of a professional overlap, pause included** (exclusion constraint; a cancelled one kept on the schedule still counts); cancelled ⇔ `cancelled_at`, completed ⇔ `completed_at` |
| `appointment_series` (R3) | the rule of a series: professional, service, first start, every `interval_weeks` (1–12) on `weekdays` (ISO), `occurrences` (2–52) or `until_on`, `skipped_on` (dates skipped for a conflict) | its appointments carry `series_id`; a moved or cancelled one stays in it |
| `appointment_participants` | the clients: `client` (the person seen) then `second`; presence `expected` / `present` / `absent`; confirmed at | one row per client and appointment |

**Personal appointments** are their professional's only: the staff neither read nor move, cancel or mark them.

**RLS:** staff (`appointments.view`) read the clinic's rows but personal appointments; a professional (`appointments.self`) reads her own, personal ones included, and her own availability; participants follow their appointment. Another professional's busy time comes with the agenda's RPC (R2), never her clients.

## RPCs (R1)

All definer, permission first, French `P0001` with a HINT naming the field.

| RPC | Permission | What |
|---|---|---|
| `set_appointment_settings(days[], start, end, reminder_days, reminder_hour)` | `appointments.settings` | the business hours |
| `set_availability_rule(id, professional, weekday, start, end, service_ids[], visible, overflow, valid_from, valid_until)` → id | `appointments.manage`, or `.self` for her own | creates or updates a window (five-minute marks, active services, no overlap); `delete_availability_rule(id)` |
| `add_availability_exception(professional, kind, starts_at, ends_at, label)` → id, `remove_availability_exception(id)` | same | |
| `book_appointment(professional, service, starts_at, client_ids[], mode = 'video', internal_note, client_message, balance_override_reason)` → id | same | the checks below; links each client to the professional (`clients_link_professional`, reason `appointment`) |
| `move_appointment(id, starts_at, professional = null)` | same (both professionals) | the same checks but the balance; clears the client's confirmation |
| `set_appointment_presence(appointment, client, presence)` | same | not on a cancelled appointment |
| `cancel_appointment(id, reason_key, details, kept_on_schedule = false)` | same | `cancel_late` from Services' `billing_policy_on(the session's date)` (`late_notice_hours`); the fee is Facturation's (R-59) |
| `list_agenda(from, to, professional_ids)` (R2) | `appointments.view`, or `.self` for her own | the agenda, 45 days at most: each appointment with its state, flags (`outside_availability`, `balance_override`), video fields and clients (`{client_id, name, client_number, role, presence, confirmed_at}` through Clients' `clients_display_names`); another professional's personal appointment as busy time (no service, label or client) |
| `set_appointment_details(id, mode, internal_note, client_message)` (R2) | as a booking | the editor's « Notes » |
| `preview_series(professional, service, first_starts_at, interval_weeks, weekdays[], count, until)` → (occurrence, starts_at, ends_at, conflict) (R3) | as a booking | each date of the series at the first one's local time (9:00 stays 9:00 across a change), 52 at most, with its conflict: `overlap` or `outside_availability` |
| `create_series(…the rule, client_ids[], mode, internal_note, client_message, skip_conflicts = false, balance_override_reason, outside_availability_reason)` → series id (R3) | as a booking | books every date through `book_appointment` (every rule, the overrides for every date); dates in conflict refuse the series with their dates (« 2 dates de la série sont en conflit : 29 mars 2027, 12 avr. 2027. », HINT `series_conflicts`) unless `skip_conflicts`: they are then skipped and kept in `skipped_on`; any other refusal (the clients, the service) is the series' |
| `cancel_series_from(id, reason_key, details, kept_on_schedule)` → count (R3) | as a cancellation | this appointment and the series' later booked or confirmed ones, each through `cancel_appointment` (its own late flag) |
| `book_personal_appointment(starts_at, ends_at, label, is_work = false)` → id (R3) | `appointments.self`, her own agenda only | any time (no availability), never over another appointment; the staff see it as busy time; moved and cancelled with R1's RPCs |
| `get_open_slots(professional, service, from, to)` → (starts_at, ends_at) | `appointments.view`, or `.self` for her own | the free slots, 62 days at most (below) |
| `get_appointment_consents(appointment)` → (client_id, consent_key, frequency, state) | `appointments.view` (not a personal one), or her own | the consents Clients requires for each client (`private.required_consents_for` with the service code, the client's active payer for staff, the appointment as context): R2 shows « Consentement signé / manquant »; never blocks (R-47, AP-11) |

**What a booking checks (in the database):**

1. The professional is **active** and **offers the service**: one of her titles is among the service's, or the service is the clinic's (no titles). The service has a duration (fees are not booked) and is active (an appointment of a service retired since still moves).
2. The slot is **duration + « pause après »** (a 50 min session blocks 60, R-13), on a five-minute mark, at most two years ahead.
3. It lies **in one of her windows** for that service, in clinic local time and on the same local day (9:00 stays 9:00 across a daylight-saving change), and **no exception** overlaps the session; else « Ce créneau est en dehors des disponibilités du professionnel pour ce service. » (HINT `outside_availability`). **AP-12:** a holder of `appointments.manage` books or moves there anyway with `p_outside_availability_reason` (3–500 characters, kept with its author, redacted in the audit, shown on the appointment); never a professional on her own agenda; a move back inside clears it.
4. **No overlap** with her other active appointments, the pause included (HINT `overlap`).
5. **The clients:** one, or two (a couple service needs two; a second person otherwise); never the same twice; each the clinic's, not archived (« restaurez-le »), merged or anonymised. **Her limits** (Professionnels, P4-245) on the first client: « Femmes seulement » refuses a client known not to be a woman (unknown: allowed); a minimum age refuses a client known to be younger on the day.
6. **The balance rule (R-58):** a client for whom `private.client_has_balance` is true is refused (HINT `balance_due`); `balance_override_reason` (3–500 characters) books anyway for a holder of `appointments.balance_override`, and the reason and its author are kept. **`private.client_has_balance` is a stub returning false until Facturation (F3) replaces it**; the notice to the conseillère and the professional comes with it.

**Completion (R3, AP-18):** the SQL job `appointments.mark_completed` (hourly, at :20) marks completed every booked or confirmed appointment that has ended, personal ones included, **except a no-show** (every client absent): that one keeps its state for Facturation's decision (R-59). Noting every client absent on a completed appointment takes it back to booked (or confirmed), and the next pass leaves it.

**Open slots:** for each date, each window allowing the service is cut in slots of the slot length from the window's start (9:00, 10:00, 11:00 for a 50 + 10 min service), whose session ends in the window (or starts in it, with overflow); the past, the exceptions and her active appointments (pause included) are taken out.

## Screens (R2)

- **« Agenda »** (`/agenda`, `appointments.view`, nav order 12). The view, the date, the professional, the service and the mode are URL parameters (`vue`, `date`, `professionnel`, `service`, `mode`).
  - **Views:** Jour (a column per professional shown), Semaine (default), Prochains jours (14 days as a list), Mois (six weeks). They are real Radix tabs (decision #35); « Aujourd'hui », « ‹ › ».
  - **Who:** all professionals, a service's (those offering it) or one.
  - **Rendez-vous mode:** the grid runs 7:00–21:00. Items are placed by clinic date and clock time (`lib/time`), so 9:00 stays on the 9:00 line across a daylight-saving change. The professional's windows are shaded and exceptions hatched. A click on a free quarter hour opens « Nouveau rendez-vous » there. An appointment is a button: it opens the editor; dragging it (Pointer Events, 15-minute snapping) moves it, and the database decides. A move outside the availability is refused there; the editor offers the override.
  - **Disponibilités mode** (one professional; AP-27, `AvailabilityGrid`): direct manipulation. A drag on an empty part of a day draws a window (15-minute snapping; a click: one hour), saved at once with the defaults (weekly from the week shown, every service, visible, no overflow): « Disponible le mardi 9 h – 12 h, chaque semaine », with « Seulement cette semaine » and « Annuler ». A window drags to move (to another day too) and by its top or bottom edge to resize, saved on the drop with « Annuler »; a click opens « Supprimer », « Chaque semaine / Seulement cette semaine » and « Plus d'options… » (« Modifier la plage », every setting). The preview turns red over a window with other settings or an exception (the database refuses); windows of the same settings merge. A change that leaves coming appointments outside says so (« 2 rendez-vous seront hors disponibilités ») with « Annuler ». « Glisser pour : Ajouter des disponibilités / Bloquer »: with « Bloquer », a drag takes the time off (an exception « Autre ») and a click on a blocked time offers « Retirer le blocage ». Keyboard: « Ajouter une plage » (the full editor) and the windows are buttons. Phones: a long press, then drag (the page scrolls otherwise). The exceptions panel has « En vacances toute la semaine » (« Je suis en vacances toute la semaine » in « Mon agenda »), with « Annuler », and « Ajouter une exception ».
- **The editor** (a sheet):
  - **« Nouveau rendez-vous »:** professional, service (the ones she offers), date, time, mode, the client then a second person (Clients' `ClientPicker`), internal note, message to the client.
  - **An appointment:** in-sheet tabs, out of the tab order. « Rendez-vous » holds the presence of each client and « Déplacer ». « Notes » holds the mode, the note and the message. « Annulation » holds the reason, the details and « garder à l'horaire ».
  - **Refusals:** a refusal is shown in the sheet. HINT `outside_availability` shows « Hors disponibilités » with a reason to the staff; `balance_due` shows the exception with a reason to who may override.
  - **Lane C (RZ):** a professional's Zoom state warning and the picker dot come with lane C's `useProfessionalVideoStatus()` (R5).

## Messages to clients (R4)

Decisions R-38, R-39, R-52 … R-55, AP-19 … AP-22. Migration `…_appointments_messages`; functions `appointments-messages` (job) and `appointments-confirm` (public token).

- **Who and how (R-54, AP-19):** the recipients of an appointment are Clients' contacts with the right `appointments` (`private.client_contacts_for`: each client, and each relation who manages her appointments), each by her own channels (`reminders_by_email`, `reminders_by_sms`) and language (French or English templates and texts): a teen gets the text, her parent the email. Texts go through Communications' `private.send_sms` (consent checked, held until the business hours); no consent in force → the text is `skipped` (`no_consent`); Communications off → `sms_off`.
- **When (AP-19):** a booking or an accepted proposal → `confirmation`; a move (time or professional) → `changed` (pending older emails set aside); a cancellation → `cancelled` (pending emails set aside); for a series, one confirmation and one cancellation (its first date). Never for a personal, held or past appointment, nor for an import's insert (`external_ref`: no confirmation; a move, cancellation or restore made here afterwards is told, I-15). A deferred constraint trigger (`appointments_messages`) queues them at commit, once the participants exist. **Reminders** (R-38, R-52): on a business day, from the reminder hour (`appointment_settings`, 8 h) until the end of the business hours, the booked or confirmed appointments up to the next business day (Friday: Saturday's, Sunday's and Monday's) get a `reminder`, once (`appointment_messages` is unique per appointment, recipient, channel, kind and start), and not right after a confirmation or a change of that start (18 hours).
- **`appointment_messages`** (operational, not audited, like `email_log`: ids and statuses, no text): appointment, client, recipient, channel `email` / `sms`, kind, start announced, language, status `pending` / `sent` / `failed` / `skipped` (+ reason), tries, the text's id in Communications, the link. Staff (`appointments.view`) read it.
- **The job `appointments.messages`** (function `appointments-messages`, every 10 minutes; off until the clinic turns it on in « Tâches planifiées »): `appointment_messages_for_service` (the reminders due, stale emails set aside, the pending emails), then per email `prepare_appointment_message_for_service(org, id, token_hash)` (the recipient, the values, a fresh `appointment_confirm` link valid until the start, 30 days at most; none for a cancellation) and `finish_appointment_message_for_service(org, id, sent)` (three tries, then `failed`). Templates `appointments.confirmation`, `.reminder`, `.changed`, `.cancelled` (+ `_en`), editable in « Modèles de courriels »; the variable `appointment.access` says how to join (the video link through lane C's `appointment_video_link`: the link, « le lien vous sera envoyé » while Zoom prepares it, or « Par vidéo. »; « Par téléphone : votre professionnel vous appellera. »).
- **Confirmation (R-39, AP-20):** the email's button opens `/rendez-vous/confirmer#t=…` (the token leaves the address bar first): `resolve-link` shows the clinic, the moment in words, the professional and the mode; « Confirmer ma présence » calls `appointments-confirm` (per-IP limit `appointments.confirm_ip` first; `confirm_appointment_by_link_for_service`, one use) → the appointment `confirmed` and the client's participant row. No cancellation link (R-39): the page says to call the clinic. **« OUI »** by text: `private.sms_confirmation_hook` (Communications' stub, replaced here) confirms the next booked appointment a text of which went to that number in the last 14 days. An unconfirmed appointment triggers nothing (R-53).
- **Reserved for testers (P3-40, AP-26):** while Rendez-vous is « Réservé aux testeurs », a booking, a move or a cancellation queues nothing, the job's pass sets every pending message aside (`skipped`, `reserved`) and sends nothing (no reminder either), and an email prepared in between is set aside: nothing waits to go out at the launch. While Communications is reserved, `send_sms` queues no automatic text and refuses a typed one: the text is `skipped` (`sms_off`). The template's test send (« M'envoyer un test ») still goes. An imported appointment (`external_ref`, the cutover) never sends a confirmation. Core's CC-14 holds them too: Rendez-vous' texts name their module to `send_sms`, and an email `sendTemplatedEmail` answers `module_reserved` is set aside (`reserved`), never retried.
- **« Clients sans rappel » (AP-21):** the agenda's button opens the next 7 days' appointments no recipient of which can be reached (no email, no text with a consent in force), for the counselors to phone: `list_appointments_without_reminder(from, to)` (`appointments.view`, 14 days at most).

## « Mon agenda » (R5, AP-23)

`/mon-agenda` (`appointments.self`, an account linked to a professional file): the agenda's views on the professional alone (Jour, Semaine, Prochains jours, Mois; « Disponibilités » for her own windows and exceptions). She opens, moves and cancels her appointments and notes presence; a click on a free quarter hour adds a **personal appointment** (« Rendez-vous personnel »: a label only she sees, the start and the end, « Rendez-vous de travail »; the staff see « Occupé »), which she takes off with « Retirer ce rendez-vous personnel ». Below the agenda, the panels of the slot `agenda.mine` (Facturation F3: her cancellation fees to decide, « Appliquer les frais » / « Ne pas facturer »). Booking clients stays the clinic's (dispatch). Its reference comes from `get_my_agenda_reference()` (her file and the services she offers: she cannot read the staff's views). « Vidéoconférence » (lane C, RZ) stays at `/mon-agenda/videoconference`. The editor (staff and « Mon agenda ») shows a video appointment's « Vidéo »: « Démarrer » (its Zoom meeting or the professional's fixed link, lane C's `get_appointment_video`), « le lien Zoom se prépare », « Réessayer » after a failure, or that the professional has no video link.

## What the module publishes

- **`get_open_slots(professional, service, from, to)`**: Demandes (D3) and the public booking page (later) read free slots through it.
- **For Clients:** `private.appointments_reassign_client(old, new)` in `client_merge_handlers` (the merged file's places move; an appointment holding both keeps the kept file once, as the person seen if either was) and `private.appointments_anonymize_client(id)` in `client_anonymize_handlers` (the free texts of her appointments are blanked; her future appointments stop: cancelled when she is alone in one, else she leaves it and the other is the person seen; past dates, services and presence stay).
- **For Facturation (R5, AP-25):** `private.appointments_for_billing(org, from, to)` → (appointment_id, starts_at, ends_at, state, professional_id, service_id, mode, client_id, role, presence, cancel_late, cancelled_at, series_id): the completed appointments of the period and the late cancellations (the fee is the professional's decision, R-59), one row per client, ordered by start. Granted to no role; signature stable.
- **For Facturation (F3, R-59):** `private.appointments_fee_candidates(org, from, to)` (migration `20261013140554_appointments_fee_facts`) → (appointment_id, starts_at, local_date, professional_id, service_id, client_ids[], kind `late_cancellation` / `no_show`): the late cancellations and the absences (ended, still booked or confirmed, every client absent, AP-18) the professional decides a fee for. And the balance rule: Facturation F3 replaces `private.client_has_balance` (an invoice of the dossier still unpaid on the blocking day; off without « Relances à partir du »). Granted to no role.
- **For Rapports (Demandes D6, D-44):** `private.appointments_cancelled_between(org, from, to)` → (appointment_id, client_id, professional_id, starts_at, cancelled_at, reason_name): the appointments cancelled in the window, never personal, one row per client; and `private.appointments_first_after(org, client_ids[], professional_ids[], after[])` (migration `20261013233844_appointments_first_after`) → (ord, appointment_id, starts_at, state, cancelled_at, cancel_late, reason_name): for each position, the client's first appointment with that professional starting at or after the instant (booked, confirmed, completed or cancelled; never personal, never only held). Granted to no role.
- **For Clients' links (Demandes D-51):** `private.appointments_professional_has_client(org, client, pro)` (migration `20261014042310_demandes_security_fixes`): whether she has an appointment with the client (held, booked, confirmed, completed, or cancelled late; never personal). Granted to no role.
- **For Clients' list (A-2, CL-31):** `private.appointments_last_visits(org)` (migration `20261014021937_appointments_last_visits`) → (client_id, last_at): per client, the start of her latest appointment that has begun (booked, confirmed or completed; never personal; a no-show counts, a cancellation never; imported history counts). Computed when read. Granted to no role.
- **For Demandes (R5, AP-25):** `private.first_appointments(org, client_ids[])` → (client_id, appointment_id, starts_at, professional_id, state, confirmed): each client's first active appointment (booked, confirmed or completed); none for a client without one. Granted to no role; signature stable.
- **For Clients' record (R5, AP-24):** the panel `appointments.visits` in the slot `client.visits` (« Visites et paiements »), over `list_client_visits(client, before, limit)` (`appointments.view`; or `appointments.self` for her own appointments with a client she is linked to): the appointments newest first (held ones never), each with the professional, the service, the state, the client's presence, the cancellation's reason and late flag.

- **For Rapports (RP1):** `private.appointment_absence_facts(org, from, to)` → one row per client of the appointments starting in [from, to) cancelled (reason, late, kept on the schedule) or where the client was absent, with `later_starts_at` (her next booked, confirmed or completed appointment); never a personal or held one, never the cancellation's details; `private.cancellation_reason_names(org)`. Granted to no role; signatures stable.

### For other modules: held appointments (R1b, AP-15)

Demandes (D3b) proposes slots to a client; each proposed slot is an appointment in the state **`held`** until the client accepts it, the proposal is withdrawn or it expires. A held appointment takes its slot exactly like a booked one (the same exclusion constraint): nobody books over it, `get_open_slots` skips it, another hold over it is refused. It is **not** an appointment yet: no reminder (R4) and no invoice (Facturation) ever reads a `held` row (they read `booked`, `confirmed`, `completed`), no Zoom meeting is made for it (lane C's queue starts at `booked`), and its clients are linked to the professional (« Mes clients ») only once it is accepted. The agenda shows it hatched with « En attente d'acceptation »; the staff cannot move or cancel it or note a presence (HINT `held`: « il se gère depuis la demande »); its mode and notes may change.

Service-side helpers, `security definer`, **granted to no role**: call them from Demandes' own definer RPCs (after their permission check) or its job. `p_actor` is the staff member acting (an active member of the clinic, named in the audit), or null for the client's own answer through a secure link.

| Helper | Does |
|---|---|
| `private.appointments_hold(org, professional, service, starts_at, client_ids[], expires_at, actor, reference default null, mode default 'video')` → uuid | Every rule of `book_appointment` (active professional, offered and bookable service, a 5-minute start in the future, the clients' files and the professional's limits, the slot free with « pause après »), **in the availability only** (no « Hors disponibilités ») and the **balance rule with no exception** (HINT `balance_due`). `expires_at` after now and no later than the start (HINT `expires_at`). `reference` is the proposal's id (`hold_reference`, kept once booked; several slots of one proposal may share it). First clears the professional's expired holds, so a stale one never blocks. Refusals are the booking's (P0001, French, HINT the field; `overlap` for a taken slot). |
| `private.appointments_confirm_hold(org, id, actor)` | held → `booked`, every rule checked again at that moment: still held (HINT `hold_gone`) and not expired (HINT `hold_expired`), not past, the professional active, the service still offered, the slot still in her availability (an exception added since refuses it), the clients' files, the balance rule; today's duration and « pause après » (the service may have changed: `ends_at` and `blocks_until` are recomputed, an overlap then refuses). Links the clients to the professional. Consents never block (R-47): `get_appointment_consents` reads them for a held appointment and for the booked one alike. |
| `private.appointments_release_hold(org, id, reason)` → boolean | Deletes the held appointment and its participants (a proposal never accepted is not an appointment: it never shows in a client's visits nor counts as a cancellation). `reason` ∈ `declined`, `withdrawn`, `other_accepted`, `expired`, `demande_closed`, `client_anonymized` (else 22023), recorded as the audit's source `rpc:appointments_release_hold:<reason>`. False when it is no longer held (already accepted or released): safe to call twice. |

- **Expiry:** the SQL job `appointments.holds_release` (every 5 minutes, maintenance) deletes the holds past `held_until` (source `job:appointments.holds_release:expired`). Until it runs, an expired hold still takes its slot but cannot be accepted. Demandes keeps its own proposal history; never put a foreign key on `appointments.id` (a released hold is deleted).
- **Anonymisation:** `appointments_anonymize_client` first releases every hold of the client (reason `client_anonymized`); a later confirm answers `hold_gone`.
- **Reading a hold's state:** the agenda (`list_agenda`, `state = 'held'`); Demandes learns the outcome from its own calls (confirm or release) and `hold_gone` / `hold_expired`.

### What this module reads from the others (published only)

- **Professionnels:** `private.professional_booking_facts(org, professional)` → status, title ids, women only, minimum client age (migration `…_professionals_booking_facts`).
- **Clients:** `private.clients_booking_facts(org, client_ids[])` → per id: found, sex, birthday, archived, closed (merged or anonymised); `private.clients_link_professional`.
- **Services et tarifs:** `private.service_booking_facts(org, service)` → active, code, duration, « pause après », `for_two`, title ids (a retired service too), `billing_policy_on(date)` (late notice).
- **Clients (consents):** `private.required_consents_for`, the view `client_payers_active`.

## Video links (batch RZ)

Migrations `20261013085921_professionals_appointments_facts` (Professionnels' published names and accounts) and `20261013085924_appointments_video`; pgTAP `123_appointments_video`; functions `zoom-connect`, `zoom-callback`, `zoom-deauthorize`, `appointments-video-sync`; decisions R-55, RZ-1 … RZ-8.

- **Tables:**
  - `professional_video_links`: a professional's fixed link, https only, ≤ 500 characters, the link redacted in the journal.
  - `video_connections`: her Zoom account (one per professional and clinic; one professional per Zoom account). It holds the state `connected` / `needs_reconnect` / `disconnected` and, for a reconnection, a reason (`invalid_grant`, `unauthorized`, `deauthorized`). The address is redacted.
  - `video_connection_tokens`: the tokens, encrypted. No privilege for any role; listed in `pii_encrypted_values()` and the rotation runbook.
  - `appointment_video_meetings`: which account holds an appointment's meeting, its link, and the link last emailed.
  - `video_tasks`: one reconcile task per appointment.
  - Staff (`appointments.view`) read every professional's setup, and a professional (`.self`) hers. Meetings and tasks follow their appointment's policy.
- **The trigger:** `appointments_video_status` (BEFORE) and `appointments_video_queue` (AFTER) fire on inserts and on changes of `mode`, `state`, `starts_at`, `ends_at`, `professional_id`:
  - a future, active, video, non-personal appointment of a professional whose Zoom is connected is `video_status = 'pending'` and queued;
  - an appointment that loses its meeting (cancelled, phone, another professional) has its link cleared and is queued for the deletion;
  - completed appointments are left alone.
  - **The booking RPCs never call this batch**; they never write the three `video_*` columns.
- **Client RPCs:**
  - `set_professional_video_link(professional, url)`: `.manage`, or `.self` for her own; blank removes it; a refused address is a P0001 with HINT `url`.
  - `list_professional_video_status()`: staff see every professional with a connection or a link, a professional her own row. It returns the Zoom state, address, connection date, reason and fixed link, never a token.
  - `get_my_video_setup()`: the professional's own setup.
  - `get_appointment_video(appointment)` → (url, source, status): the appointment's own visibility rule.
  - `retry_appointment_video(appointment)`: « Réessayer » on a `failed` one.
- **Published:** `private.appointment_video_link(org, appointment)` → (url, source `zoom` / `fixed` / null, status `ready` / `pending` / `failed` / `none`), for R4's confirmations and reminders and R5's « Démarrer ». Say « le lien vous sera envoyé » while `pending`: the job emails it.
- **Service RPCs** (the functions; actor model for the person's own connection):
  - the connection: `store_zoom_connection`, `get_my_zoom_credentials_for_service`, `disconnect_my_zoom_connection`, `zoom_deauthorized_for_service`;
  - the tokens: `get_zoom_credentials_for_service`, `set_zoom_tokens_for_service`, `mark_zoom_needs_reconnect_for_service`, `list_zoom_connections_to_refresh_for_service`;
  - the tasks: `claim_video_tasks_for_service`, `complete_video_task_for_service`;
  - the link email: `video_link_email_for_service`, `mark_video_link_emailed_for_service`.
- **Functions:**
  - `zoom-connect` (user, `appointments.self`): `start` → Zoom's consent URL with a signed state; `disconnect` revokes the grant, then ends the connection.
  - `zoom-callback` (user, `appointments.self`): the code exchanged, `users/me`, the connection stored; her future video appointments are queued.
  - `zoom-deauthorize` (webhook, `?org=`): `x-zm-signature` (HMAC of `v0:<timestamp>:<body>` with the app's Secret Token, 5 minutes), `endpoint.url_validation` answered, `app_deauthorized` ends the connection. No module gate, on purpose: it only deletes tokens.
  - `appointments-video-sync` (job `appointments.video_sync`, every 5 minutes, off by default).
  - Rate limits: `zoom.connect_user`, `zoom.callback_user`, `webhooks.zoom_ip`.
  - Local fake: `npm run fake:zoom` (port 55394).
- **Email:** `appointments.video_link` / `_en` « Votre lien de rencontre » (button: the meeting link).
- **Notice:** `appointments.zoom_reconnect` (important, to the professional) and its staff twin (`appointments.manage`), expired at the reconnection.
- **Screens:**
  - « Vidéoconférence » (`/mon-agenda/videoconference`, nav entry for an account with a professional file): the « Zoom » card (« Connecter mon Zoom », « Compte …, connecté le … », « Reconnecter mon Zoom », « Déconnecter » confirmed) and the « Lien fixe » form. The page is Zoom's return path.
  - Paramètres → Vidéoconférence (`video` / `videoconference`):
    - the active professionals with « Zoom connecté » / « Zoom à reconnecter » / « Lien fixe » / « Aucun lien vidéo », a summary and a filter, and « Ajouter / Modifier le lien fixe » (`appointments.manage`);
    - the Zoom app: client id, secret and Secret Token (write-only), the return and webhook addresses to copy;
    - the job's state.
- **For R2 / R5 (lane A):** import `useProfessionalVideoStatus` (`hooks/use-video.ts`, keys under `['appointments', 'video']`) inside the module to warn « pas de Zoom ni de lien fixe » when booking a video appointment, and for the picker's dot. Use `useAppointmentVideo` / `useRetryAppointmentVideo` for « Démarrer » and « Réessayer ». Mount `components/video/{ZoomConnectionCard,FixedLinkForm}` in « Mon agenda » (R5) and drop the nav entry.

## The parity audit's gaps, part 1 (AP-28 … AP-32)

Migrations `20261013215759_clients_consent_names` (Clients publishes `private.clients_consent_names(org)`) and `20261013215801_appointments_parity`; pgTAP `171_appointments_parity`, `172_clients_consent_names`. Items P1–P3 and P5 of the [parity audit](../plans/2026-10-13-parity-audit.md), and the consent prompt.

- **« Changer le service »** (AP-28): `change_appointment_service(id, service, outside reason)` keeps the date, the time and the professional; the new service's duration and « pause après » give the end. Every booking rule again (the professional offers it, a couple service needs two clients, the availability or the staff's reason, the overlap). The state is kept and the client gets one `changed` message (never cancel + confirm). No price is stored on an appointment: Facturation prices the service when it invoices the completed session. Sheet: « Rendez-vous » tab, section « Service ».
- **« Rétablir »** (AP-29): `restore_appointment(id)` makes a cancelled appointment still to come « Réservé » again if its slot is free (the exclusion constraint) and its files are active. Its cancellation fields are cleared and the participants confirm again. A past one is refused: a fee is only ever collected for a past appointment, so a restored one never has a fee decision or draft. The client gets `changed`, and the video triggers queue the meeting again. Sheet: « Annulation » tab.
- **« Marquer confirmé »** (AP-30): `confirm_appointment(id)` (`appointments.manage`) moves booked to confirmed, every participant included, audited under `rpc:confirm_appointment`. It sends no message. It is offered in the sheet and in « Clients sans rappel » (`list_appointments_without_reminder` now returns the state, so a row says « Confirmé »).
- **Late notice in business hours** (AP-31): `appointment_settings.late_notice_business_hours` is on by default. With it, Services' `late_notice_hours` counts the hours of business days only (whole days, the clinic's zone): with 24 h of notice, a Monday 10:00 appointment must be cancelled by Friday 10:00. Off, calendar hours count. The rule is in `private.appointments_cancel_late`, which `cancel_appointment` uses, through `private.appointments_business_minutes`. **Paramètres → Agenda** (`/parametres/agenda`, seen with `appointments.view`, changed with `appointments.settings`) is the first screen for the business days and hours, the reminders' day and hour, and this switch. `set_appointment_settings` takes it as an optional 6th argument.
- **Consents** (AP-32): `get_booking_consents(service, clients)` (at booking) and `get_appointment_consents(id)` (now with `consent_name`) return the required consents with their state. The sheet shows those not signed by name (« manquant », « envoyé, pas encore signé », « à signer de nouveau »), per client when there are two. It never blocks (R-47). A professional reads only her own clients'.
- **Messages:**
  - The trigger now also says `changed` for a restore and for a change of service (`service_id`, `ends_at`).
  - `changed` reads « modifié » in the texts and in the default templates no clinic has changed.
  - `appointment_messages.event_at` (the transaction's time, for `changed` and `cancelled`) joins the key `appointment_messages_unique_key` (`nulls not distinct`). So each new change or cancellation is a new message (a restored appointment cancelled again is told again), while reminders and confirmations keep one per start.
- **Tests:** pgTAP 171 and 172; Vitest (`AgendaPage.test.tsx`: the service, its overlap refusal, « Marquer confirmé », « Rétablir » and its refusal, a past one, the consents at booking and on the appointment, « Clients sans rappel »; `AgendaSettingsPage.test.tsx`); Playwright (`appointments.spec.ts`: book, change the service, confirm, cancel, restore; Paramètres → Agenda).

## The parity audit's gaps, part 2 (AP-33)

Migration `20261013223925_appointments_history`; pgTAP `173_appointments_history`. Item P4 of the [parity audit](../plans/2026-10-13-parity-audit.md) and the extras.

- **Grid hours:**
  - The grid now runs 6:00 to 22:00, like the legacy agenda (`lib/time.ts`: `GRID_START`, `GRID_END`, `DEFAULT_GRID`).
  - The appointments' grid widens by whole hours to any appointment outside that range, so no appointment is ever drawn without height or hidden (`gridRangeFor`, `TimeGrid`).
  - `verticalBox` takes the grid's range.
  - Drags stay within the range shown.
  - « Disponibilités » keeps 6:00 to 22:00.
- **Service colour:** when a service has a colour (Services et tarifs), it marks the left edge of its blocks. The state keeps the block's own tone.
- **Deep link:**
  - `rendez-vous=<id>`, together with the appointment's `date`, opens its sheet (`APPOINTMENT_LINK_PARAM`, `appointmentLink`).
  - Closing the sheet drops the parameter.
  - In « Visites et paiements » (Clients), each date links there: to « Agenda » for the staff, to « Mon agenda » for a professional.
- **« Historique »**, a fourth tab of the sheet:
  - `list_appointment_history(id, before, limit)` returns the audit rows of the appointment, its participants and its video meeting, newest first, 50 a page.
  - Redacted values (notes, message, label, link) stay « (masqué) ».
  - Staff read clinic appointments (`appointments.view`); a professional reads her own, personal ones included.
  - The display copies Clients' history: by clinic day, in the Journal d'audit's words, with the professional, service, client and reason by name.
- **Not built** (Drop pending Jonathan's OK, coordinator): resizing an appointment by dragging, and dragging services from a side bar.

## Google busy times (batch R6, AP-40 … AP-45)

Migration `20261014000122_appointments_google_busy`; pgTAP `177_appointments_google_busy`; functions `google-calendar-connect`, `google-calendar-callback`, `google-calendar-sync` (`_shared/google-calendar/`); decisions AP-40 … AP-46.

- **Tables:**
  - `calendar_connections`: a professional's Google account (one per professional and clinic; one professional per Google account while connected). State `connected` / `needs_reconnect` / `disconnected`, a reconnect reason (`invalid_grant`, `unauthorized`, `scope_missing`), the account's `sub` and address (redacted in the journal). Staff (`appointments.view`) read every row, a professional (`.self`) hers.
  - `calendar_connection_tokens`: the tokens, encrypted. No privilege for any role; listed in `pii_encrypted_values()`.
  - `calendar_sync_status`: when each connection was last read and the last failure's code. Operational (not audited, in `000_invariants`), no privilege: `get_my_calendar_setup` reads it.
  - `external_busy_blocks`: the busy times, **times only** (`professional_id`, `starts_at`, `ends_at`). Operational (not audited). Staff read all, a professional hers.
- **Client RPCs:**
  - `get_my_calendar_setup()`: her state, address, connection date, reason, last read, last failure's code and the busy times still ahead.
  - `list_external_busy(from, to, professional_ids)`: 62 days at most; staff for any professional, a professional for herself.
- **Service RPCs** (the functions; actor model for her own connection): `store_calendar_connection`, `get_my_calendar_credentials_for_service`, `disconnect_my_calendar_connection`, `get_calendar_credentials_for_service`, `set_calendar_token_for_service`, `mark_calendar_needs_reconnect_for_service`, `list_calendar_connections_to_sync_for_service`, `replace_calendar_busy_for_service` (-1 when the connection changed since it was read), `record_calendar_sync_error_for_service`.
- **Open slots:** `get_open_slots` skips a busy time (`create or replace`, same signature), so the booking forms, the proposals and the waiting list's offers never offer one. The booking RPCs do not refuse one (AP-43).
- **Functions:**
  - `google-calendar-connect` (user, `appointments.self`): `start` → Google's consent URL (scopes `openid email calendar.freebusy`, offline, consent, signed state); `disconnect` revokes the grant, then deletes.
  - `google-calendar-callback` (user, `appointments.self`): the state and its nonce, the code exchanged with the clinic's Google application (`calendarOAuthApp`), the free/busy scope required (else a French refusal and the grant revoked), a refresh token required, `userinfo`, the connection stored, a first sync.
  - `google-calendar-sync`: the job `appointments.google_busy_sync` (every 15 minutes, off by default) and « Synchroniser » (`{ action: 'sync' }`).
  - Rate limits: `google_calendar.connect_user`, `google_calendar.callback_user` (20 an hour), `google_calendar.sync_user` (30 an hour); the nonce on `oauth.state_nonce`.
  - The Google application (AP-46, `_shared/google-calendar/credentials.ts`): the org secrets `google_calendar_client_id` / `_secret` when both are set, else Gmail's `google_oauth_client_*`. After a change of application, Google's `unauthorized_client` on a refresh marks the connection « à reconnecter ».
  - Local fake: `npm run fake:gmail` (port 55392) answers `/oauth2/v3/userinfo` and `/calendar/v3/freeBusy` too (`GOOGLE_CALENDAR_BASE_URL`, honoured only while `APP_URL` is local); `POST /__fake/busy` sets the busy times.
- **Notice:** `appointments.google_calendar_reconnect` (important, to the professional), expired at the reconnection.
- **Screens:**
  - « Agenda Google » (`/mon-agenda/agenda-google`, nav entry for an account with a professional file): « Mes moments occupés » with « Connecter mon agenda Google », « Compte …, connecté le … », « Lu le … : N moments occupés dans les 62 prochains jours », « Synchroniser », « Reconnecter mon agenda Google », « Déconnecter » confirmed. The page is Google's return path.
  - Paramètres → Agenda, « Agendas Google des professionnels » (`GoogleCalendarAppCard`): the application's client id and secret (write-only, `settings.integrations_manage`), the return address to give Google, the job's state.
  - The agenda (`TimeGrid`, `busy` prop; `useExternalBusy`, keys under `['appointments', 'calendar']`): « Occupé » under the appointments where a column has one professional (day view, a week of one professional, « Mon agenda »). Not drawn in a week of every professional, the month or « Prochains jours ».

## The GOrendezvous import (I2, I-15)

`import_appointment(row, dry_run)` (`appointments.manage`, `clients.manage`, `clients.merge`; migration `*_appointments_import.sql`, pgTAP `178_appointments_import`): one appointment by `external_ref` « gorendezvous:… » (a re-run `skipped`), its professional, service code and one or two clients (by reference or name, Clients' `clients_import_match`: `unmatched`), each linked « import » to the professional.

- **History** (already started): `completed` (each client `present`, or `absent` per client) or `cancelled` (reason by key or name, else « Non spécifiée », noted `reason_unknown`); its slot without the « pause après ».
- **Coming:** `booked` or `confirmed`, with its pause; a GOrendezvous video link is kept (`video_status` `ready`) and no Zoom task replaces it (`appointments_video_queue` skips an imported appointment with its own link and no meeting of ours); without a link, the usual meeting.
- **Never billed twice:** `appointments_for_billing`, `client_billable_appointments` and `appointments_fee_candidates` leave out an appointment imported after it started (`external_ref` and `starts_at < created_at`); one imported before it happens is ordinary.
- **Overlaps:** `conflict` (never an error), for the tool's report. Notes are never imported (D8).
- **Reminders at the cutover (I-19):** an imported coming appointment gets its reminder, never a confirmation. `private.appointments_reminder_window(org, at)` gives the dates reminded at an instant (the rule of `appointments_queue_reminders`, unchanged): never today's (no catch-up), Friday covers Saturday to Monday. pgTAP `182_appointments_reminder_window` checks it at the cutover's dates (Monday November 30, 2026).

## Rules for the other lanes

- Never book by inserting: `book_appointment` holds every rule; the import (I1) will get its own service-role entry that keeps `external_ref`.
- Times are stored in UTC; windows are local times in `organizations.timezone`. Show times with `@/shared/lib/timezone`.
- A cancelled appointment kept on the schedule (`kept_on_schedule`) still takes its slot.
- Presence is per participant; « Client absent » is a presence, not a cancellation reason.

## Keep / Change / Drop

From the plan's summary (§7) and the legacy inventory (§E). Drops have Jonathan's OK (plan §7).

| Item | Mark | Where |
|---|---|---|
| Views Jour, Semaine, Prochains jours, Mois; all pros, a service's pros, one pro; deep link | Keep | R2 |
| Availability mode with a recurring default week, exceptions (Jour férié, Vacances, Autre), visible to clients, overflow, services per window | Keep | R1 (data, RPCs), R2 (screen) |
| Blocks and the editor (Participants / Facturation / Notes / Actions / Historique), drag at 15 min, click to create at the service's duration | Keep | R2 |
| « Deuxième personne », presence per participant (Sera présent / Présent / Absent) | Keep | R1 |
| States: pending acceptance, reminder sent, confirmed by the client, present / absent, cancelled, kept on schedule, deleted | Keep + Change | R1: `booked`, `confirmed`, `completed`, `cancelled` + `kept_on_schedule` + presence; « rappel envoyé » with R4; deletion is a cancellation |
| Cancellation with a reason (GOrendezvous's, minus COVID-19), « garder à l'horaire » | Keep | R1 |
| « Raison / Notes » visible to the client | Change | `internal_note` + `client_message` (R-11) |
| Booking rules in the client (legacy app) | Change | in the database (R1) |
| Recurrence weekly or every 2–12 weeks with a conflict check | Keep | R3 |
| Personal and work appointments | Keep | R1 (columns), R3 (RPCs) |
| `completed` by hand | Change | a job (R3) |
| Zoom per professional, « Démarrer »; a fixed personal link | Keep | RZ (both; « Démarrer » in R5 reads `get_appointment_video`) |
| Reminders two days before | Change | one business day before, never on a weekend (R-38, R-52) |
| Client links confirm / modify / cancel | Change | confirmation only in v1 (R-39) |
| One account per counselor | Change | core's accounts |
| Clinic time everywhere | Change | `organizations.timezone`, local windows (R1) |
| Google Calendar busy / free | Keep (later) | R6 |
| Rooms, equipment, group classes, physical locations, health forms, « Lumino Santé » print, inventory | Drop (Jonathan's OK) | — |
