# Module `appointments` (« Rendez-vous »)

The clinic's agenda: each professional's availability (weekly windows in clinic time, exceptions), the appointments with their clients and presence, cancellations with a reason, the business hours. Plan: [coding plan §7](../plans/2026-10-11-modules-coding-plan.md#7-rendez-vous-appointments--batches); data: [GOrendezvous tour §1 and §18](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); legacy inventory [§E](../plans/2026-10-06-legacy-feature-inventory.md#e-rendez-vous--disponibilités); decisions R-11 … R-16, R-52, R-53, R-55, R-58, R-59, **AP-1 … AP-15** and **RZ-1 … RZ-8** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| R1 | Schema, booking RPCs, business hours, open slots, the Clients merge and anonymisation handlers | built |
| R1b | Held appointments: the slots a Demandes proposal keeps for a client until accepted, withdrawn or expired (AP-15) | built |
| R2 | Agenda UI (Jour, Semaine, Prochains jours, Mois; all pros, a service's, one), availability mode, the staff's « Hors disponibilités » (AP-12) | built |
| R3 | Recurrence, the remaining states, personal appointments, the `mark_completed` job | planned |
| R4 | Reminders (one business day before, never on a weekend) by email and SMS, confirmation link, fixed video link | planned |
| R5 | « Mon agenda », the client's « Visites et paiements », publications for Demandes and Facturation | planned |
| RZ | Video links: Zoom per professional, or a fixed personal link (lane C) | built |

- **Registry:** `modules.key = 'appointments'`, depends on `clients`, `services`, `professionals`. It **starts disabled** in every clinic.
- **Migrations:** `20261013055753_appointments_module` (registry, tables, RLS, audit, seeds), `20261013055754_professionals_booking_facts`, `20261013055755_clients_booking_facts` and `20261013055756_services_booking_facts` (the owning modules' published facts), `20261013055757_appointments_booking` (RPCs, handlers); R2: `20261013064650_clients_display_names` (Clients' published names), `20261013064653_appointments_agenda` (AP-12, `set_appointment_details`, `list_agenda`); R1b: `20261013075644_appointments_holds` (the `held` state, the hold helpers, the job `appointments.holds_release`).
- **Tests:** pgTAP `118_appointments`, `122_appointments_agenda` (R2: the override, the details, the agenda read), `130_appointments_holds` (R1b: a hold takes its slot, the staff's RPCs refuse it, confirm checks again with the balance rule, release, expiry and the job, anonymisation) (97 tests: privileges, RLS per role, seeds, availability, a 50 min session blocking 60, overlap and « pause après », outside availability, the two 2027 daylight-saving Sundays, services and titles, couples, the professional's limits, archived files, the balance rule (HINT `balance_due`) and its override, a retired service, personal appointments, move, presence, cancellation and its late flag, open slots (also under a Montréal session), the consents read, the handlers); Vitest `src/modules/appointments/**/*.test.ts(x)` (manifest; `lib/agenda.test.ts`: calendar days and placement at both 2027 change Sundays, 15-minute snapping, lanes; `AgendaPage.test.tsx`: the views, click to book, AP-12, drag to move, availability mode, a held slot); Playwright `e2e/appointments.spec.ts` (book, drag, cancel; « Hors disponibilités »); the audit labels checked by `src/app/audit-labels.test.ts`. Local seed: Félix available Monday–Friday 9:00–17:00, three appointments next week.

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
| `get_open_slots(professional, service, from, to)` → (starts_at, ends_at) | `appointments.view`, or `.self` for her own | the free slots, 62 days at most (below) |
| `get_appointment_consents(appointment)` → (client_id, consent_key, frequency, state) | `appointments.view` (not a personal one), or her own | the consents Clients requires for each client (`private.required_consents_for` with the service code, the client's active payer for staff, the appointment as context): R2 shows « Consentement signé / manquant »; never blocks (R-47, AP-11) |

**What a booking checks (in the database):**

1. The professional is **active** and **offers the service**: one of her titles is among the service's, or the service is the clinic's (no titles). The service has a duration (fees are not booked) and is active (an appointment of a service retired since still moves).
2. The slot is **duration + « pause après »** (a 50 min session blocks 60, R-13), on a five-minute mark, at most two years ahead.
3. It lies **in one of her windows** for that service, in clinic local time and on the same local day (9:00 stays 9:00 across a daylight-saving change), and **no exception** overlaps the session; else « Ce créneau est en dehors des disponibilités du professionnel pour ce service. » (HINT `outside_availability`). **AP-12:** a holder of `appointments.manage` books or moves there anyway with `p_outside_availability_reason` (3–500 characters, kept with its author, redacted in the audit, shown on the appointment); never a professional on her own agenda; a move back inside clears it.
4. **No overlap** with her other active appointments, the pause included (HINT `overlap`).
5. **The clients:** one, or two (a couple service needs two; a second person otherwise); never the same twice; each the clinic's, not archived (« restaurez-le »), merged or anonymised. **Her limits** (Professionnels, P4-245) on the first client: « Femmes seulement » refuses a client known not to be a woman (unknown: allowed); a minimum age refuses a client known to be younger on the day.
6. **The balance rule (R-58):** a client for whom `private.client_has_balance` is true is refused (HINT `balance_due`); `balance_override_reason` (3–500 characters) books anyway for a holder of `appointments.balance_override`, and the reason and its author are kept. **`private.client_has_balance` is a stub returning false until Facturation (F3) replaces it**; the notice to the conseillère and the professional comes with it.

**Open slots:** for each date, each window allowing the service is cut in slots of the slot length from the window's start (9:00, 10:00, 11:00 for a 50 + 10 min service), whose session ends in the window (or starts in it, with overflow); the past, the exceptions and her active appointments (pause included) are taken out.

## Screens (R2)

- **« Agenda »** (`/agenda`, `appointments.view`, nav order 12). The view, the date, the professional, the service and the mode are URL parameters (`vue`, `date`, `professionnel`, `service`, `mode`).
  - **Views:** Jour (a column per professional shown), Semaine (default), Prochains jours (14 days as a list), Mois (six weeks). They are real Radix tabs (decision #35); « Aujourd'hui », « ‹ › ».
  - **Who:** all professionals, a service's (those offering it) or one.
  - **Rendez-vous mode:** the grid runs 7:00–21:00. Items are placed by clinic date and clock time (`lib/time`), so 9:00 stays on the 9:00 line across a daylight-saving change. The professional's windows are shaded and exceptions hatched. A click on a free quarter hour opens « Nouveau rendez-vous » there. An appointment is a button: it opens the editor; dragging it (Pointer Events, 15-minute snapping) moves it, and the database decides. A move outside the availability is refused there; the editor offers the override.
  - **Disponibilités mode** (one professional): the week's windows are buttons that open « Modifier la plage », and a click elsewhere adds one. The exceptions panel has « Vacances cette semaine » and « Ajouter une exception ».
- **The editor** (a sheet):
  - **« Nouveau rendez-vous »:** professional, service (the ones she offers), date, time, mode, the client then a second person (Clients' `ClientPicker`), internal note, message to the client.
  - **An appointment:** in-sheet tabs, out of the tab order. « Rendez-vous » holds the presence of each client and « Déplacer ». « Notes » holds the mode, the note and the message. « Annulation » holds the reason, the details and « garder à l'horaire ».
  - **Refusals:** a refusal is shown in the sheet. HINT `outside_availability` shows « Hors disponibilités » with a reason to the staff; `balance_due` shows the exception with a reason to who may override.
  - **Lane C (RZ):** a professional's Zoom state warning and the picker dot come with lane C's `useProfessionalVideoStatus()` (R5).

## What the module publishes

- **`get_open_slots(professional, service, from, to)`**: Demandes (D3) and the public booking page (later) read free slots through it.
- **For Clients:** `private.appointments_reassign_client(old, new)` in `client_merge_handlers` (the merged file's places move; an appointment holding both keeps the kept file once, as the person seen if either was) and `private.appointments_anonymize_client(id)` in `client_anonymize_handlers` (the free texts of her appointments are blanked; her future appointments stop: cancelled when she is alone in one, else she leaves it and the other is the person seen; past dates, services and presence stay).
- **Coming:** `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)` (R5).

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

Migrations `20261013083104_professionals_appointments_facts` (Professionnels' published names and accounts) and `20261013083107_appointments_video`; pgTAP `123_appointments_video`; functions `zoom-connect`, `zoom-callback`, `zoom-deauthorize`, `appointments-video-sync`; decisions R-55, RZ-1 … RZ-8.

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
