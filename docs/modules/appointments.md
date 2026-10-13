# Module `appointments` (« Rendez-vous »)

The clinic's agenda: each professional's availability (weekly windows in clinic time, exceptions), the appointments with their clients and presence, cancellations with a reason, the business hours. Plan: [coding plan §7](../plans/2026-10-11-modules-coding-plan.md#7-rendez-vous-appointments--batches); data: [GOrendezvous tour §1 and §18](../research/2026-10-11-gorendezvous-tour.md); [Christine's answers](../research/2026-10-12-christine-answers.md); legacy inventory [§E](../plans/2026-10-06-legacy-feature-inventory.md#e-rendez-vous--disponibilités); decisions R-11 … R-16, R-52, R-53, R-55, R-58, R-59 and **AP-1 … AP-10** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| R1 | Schema, booking RPCs, business hours, open slots, the Clients merge and anonymisation handlers | built |
| R2 | Agenda UI (Jour, Semaine, Prochains jours, Mois; all pros, a service's, one) and availability mode | planned |
| R3 | Recurrence, the remaining states, personal appointments, the `mark_completed` job | planned |
| R4 | Reminders (one business day before, never on a weekend) by email and SMS, confirmation link, fixed video link | planned |
| R5 | « Mon agenda », the client's « Visites et paiements », publications for Demandes and Facturation | planned |
| RZ | Zoom per professional (lane C) | planned |

- **Registry:** `modules.key = 'appointments'`, depends on `clients`, `services`, `professionals`. It **starts disabled** in every clinic.
- **Migrations:** `20261013055753_appointments_module` (registry, tables, RLS, audit, seeds), `20261013055754_professionals_booking_facts` and `20261013055755_clients_booking_facts` (the owning modules' published facts), `20261013055757_appointments_booking` (RPCs, handlers).
- **Tests:** pgTAP `118_appointments` (83 tests: privileges, RLS per role, seeds, availability, a 50 min session blocking 60, overlap and « pause après », outside availability, the two 2027 daylight-saving Sundays, services and titles, couples, the professional's limits, archived files, the balance rule and its override, move, presence, cancellation and its late flag, open slots, the handlers); Vitest `src/modules/appointments/manifest.test.ts`; the audit labels checked by `src/app/audit-labels.test.ts`. No screen in R1.

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
| `get_open_slots(professional, service, from, to)` → (starts_at, ends_at) | `appointments.view`, or `.self` for her own | the free slots, 62 days at most (below) |

**What a booking checks (in the database):**

1. The professional is **active** and **offers the service**: one of her titles is among the service's, or the service is the clinic's (no titles). The service has a duration (fees are not booked).
2. The slot is **duration + « pause après »** (a 50 min session blocks 60, R-13), on a five-minute mark, at most two years ahead.
3. It lies **in one of her windows** for that service, in clinic local time and on the same local day (9:00 stays 9:00 across a daylight-saving change), and **no exception** overlaps the session; else « Ce créneau est en dehors des disponibilités du professionnel pour ce service. »
4. **No overlap** with her other active appointments, the pause included (HINT `overlap`).
5. **The clients:** one, or two (a couple service needs two; a second person otherwise); never the same twice; each the clinic's, not archived (« restaurez-le »), merged or anonymised. **Her limits** (Professionnels, P4-245) on the first client: « Femmes seulement » refuses a client known not to be a woman (unknown: allowed); a minimum age refuses a client known to be younger on the day.
6. **The balance rule (R-58):** a client for whom `private.client_has_balance` is true is refused (HINT `balance_due`); `balance_override_reason` (3–500 characters) books anyway for a holder of `appointments.balance_override`, and the reason and its author are kept. **`private.client_has_balance` is a stub returning false until Facturation (F3) replaces it**; the notice to the conseillère and the professional comes with it.

**Open slots:** for each date, each window allowing the service is cut in slots of the slot length from the window's start (9:00, 10:00, 11:00 for a 50 + 10 min service), whose session ends in the window (or starts in it, with overflow); the past, the exceptions and her active appointments (pause included) are taken out.

## What the module publishes

- **`get_open_slots(professional, service, from, to)`**: Demandes (D3) and the public booking page (later) read free slots through it.
- **For Clients:** `private.appointments_reassign_client(old, new)` in `client_merge_handlers` (the merged file's places move; an appointment holding both keeps the kept file once) and `private.appointments_anonymize_client(id)` in `client_anonymize_handlers` (the free texts of her appointments are blanked; dates, services and presence stay).
- **Coming:** the agenda's read RPC with busy blocks (R2), `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)` (R5).

### What this module reads from the others (published only)

- **Professionnels:** `private.professional_booking_facts(org, professional)` → status, title ids, women only, minimum client age (migration `…_professionals_booking_facts`).
- **Clients:** `private.clients_booking_facts(org, client_ids[])` → per id: found, sex, birthday, archived, closed (merged or anonymised); `private.clients_link_professional`.
- **Services et tarifs:** `services_catalog` (active services: duration, « pause après », `for_two`, title ids), `billing_policy_on(date)` (late notice).

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
| Zoom per professional, « Démarrer »; a fixed personal link | Keep | R4 (fixed link), RZ (Zoom) |
| Reminders two days before | Change | one business day before, never on a weekend (R-38, R-52) |
| Client links confirm / modify / cancel | Change | confirmation only in v1 (R-39) |
| One account per counselor | Change | core's accounts |
| Clinic time everywhere | Change | `organizations.timezone`, local windows (R1) |
| Google Calendar busy / free | Keep (later) | R6 |
| Rooms, equipment, group classes, physical locations, health forms, « Lumino Santé » print, inventory | Drop (Jonathan's OK) | — |
