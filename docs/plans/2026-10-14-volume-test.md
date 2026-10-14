# Volume test before the cutover (2026-10-14)

The hot screens were timed against production-scale synthetic data on the local stack. One slow query was found and fixed. Every other screen stays under 100 ms at this volume, including the messages, request events and notices added in pass 2.

## The data

`scripts/volume-test/generate.sql`, fictional and local only, adds to the seed's clinic:

| What | Count |
|---|---:|
| Professionals (psychologists, Monday to Friday, 9:00–17:00) | 70 (60 + the seed's) |
| Clients, 50 per professional | 3 009 |
| Appointments: two years back (85 % completed, 12 % cancelled, 3 % absent) and the next four weeks | 42 428 |
| Issued invoices, one session line each | 15 180 |
| Payments (90 % of the invoices) | 13 645 |
| Requests (Demandes) over two years, most matched or closed | 4 000 |

**How it was measured:**

- Each RPC was called as the seed's admin, as the app calls it, and the best of the runs (2 or 3, `\timing`) was kept.
- The inner statements over 50 ms were logged with their plans (`EXPLAIN ANALYZE` through `auto_explain`, nested statements).
- The machine was a MacBook running the local Docker stack.

**To run it again** (it resets the local stack before and after; never remote):

```
bash scripts/with-db-lock.sh bash scripts/volume-test/run.sh <tag>
```

## Timings

| Screen / RPC | Before (ms) | After (ms) |
|---|---:|---:|
| Agenda, a week, every professional (`list_agenda`) | 34 | 4 |
| Agenda, a week, one professional | 1 | 1 |
| **Agenda, the month view (42 days), every professional** | **719** | **24** |
| Open slots, 4 weeks, one professional (`get_open_slots`) | 2 | 2 |
| Clients, first page by name (`list_clients`) | 24 | 22 |
| Clients, search | 23 | 22 |
| Clients, one professional | 1 | 1 |
| Clients, by last visit | 24 | 22 |
| Clients, « no visit for 6 months » | 13 | 12 |
| A client's record (`get_client_summary`) | 2 | 2 |
| A client's « Visites et paiements » (`get_client_billing`) | 5 | 5 |
| Demandes inbox, open requests (`list_demandes`) | 3 | 3 |
| Demandes inbox, every request, with a search | 97 | 93 |
| Waiting list (`list_waitlist`) | 5 | 5 |
| Facturation, morning queue (`list_morning_queue`) | 4 | 3 |
| Facturation, invoices, first page (`list_invoices`) | 5 | 5 |
| Facturation, « Impayés » (`list_overdue_invoices`) | 28 | 28 |
| « Revenus » over a year, by invoice | 88 | 84 |
| « Revenus » over a year, by service | 99 | 95 |
| « Revenus » over a year, by payment | 93 | 88 |
| « Annulations et absences » over a year | 69 | 64 |
| « Clients à relancer » over a year | 45 | 46 |
| « Indicateurs des demandes » over a year | 21 | 19 |
| ⌘K, clients (`search_clients`) | 10–14 | 10–14 |
| ⌘K, professionals (`search_professionals`) | 2 | 2 |

## What was fixed

**The agenda.** `list_agenda` built each appointment's participants with a correlated subquery that scanned the whole names CTE, which has no index. The cost grew with the square of the period's appointments: about 5 900 for the month view of every professional, 700 ms. Migration `*_appointments_agenda_volume.sql` reads the participants once, joins their names once, aggregates them per appointment and hash-joins the result to the appointments. The function keeps the same signature and the same answer, including the held-slot rule (AP-15).

## Looked at, left as is

- **Reports over a year (65–95 ms):** the time goes into building the JSON for at most 5 000 rows, not into reading. Plans use the existing `(org_id, …)` indexes, and no sequential scan is costly.
- **The Demandes inbox over every request, with a search (93 ms):** `demandes_inbox_rows` computes the business-hours delay of all 4 000 requests before the search filters them. The default view (open requests) takes 3 ms. Filtering on the search words before computing the delays would bring it under 20 ms. This is lane B's module, and it is noted for them. **Fixed** (`*_demandes_inbox_page_first`, see the end of this file).
- **No missing index was found.** None of the logged plans (statements over 50 ms) scans `appointments`, `invoices`, `invoice_lines`, `payments` or `appointment_participants` sequentially. The only sequential scans are small tables (`organizations`, `profiles`) and the inbox's full read of `demandes` when every request is asked.
- **Messages and request events** were not in the first run. Pass 2 below adds them.

## Pass 2: messages, request events and notices

`scripts/volume-test/generate-messages.sql` runs in the same session after `generate.sql`. It adds, fictional and local only:

- about 18 000 request events (created, contacts, state changes);
- 2 shared mailboxes with 10 000 threads and 30 000 emails over two years, 7 threads in 10 linked to a client;
- about 10 000 texts with about 1 900 numbers, in and out, each number linked to a client;
- 2 000 notices for the admin, half of them read.

`timing-messages.sql` times their screens, and `run.sh` runs both passes.

| Screen / RPC | Time (ms) |
|---|---:|
| Courriels, inbox, first page (`list_mail_threads`) | 1 |
| Courriels, every thread, with a search | 52–55 |
| Courriels, « À rattacher » | 1 |
| Courriels, one thread (`get_mail_thread`) | 1–2 |
| Courriels, mailboxes (`list_mail_connections`) | 3 |
| A client's « Courriels » tab (`list_client_mail_threads`) | 1 |
| Textos, conversations (`list_sms_conversations`) | 11 |
| Textos, « À rattacher » | 9 |
| Textos, search | 13 |
| Textos, one conversation (`list_sms_thread`) | 0.3 |
| A client's « Textos » tab (`list_client_sms`) | 1 |
| The bell's unread count (`count_my_unread_notifications`) | 0.4 |
| The bell's list (`list_my_notifications`) | 0.4 |
| Demandes inbox, open requests, with events | 3 |
| Demandes inbox, every request, with a search, with events | 74 |
| Demandes inbox, every request, with events | 74 |
| « Indicateurs des demandes » over a year, with events | 39 |

Nothing exceeds 150 ms, so pass 2 changes no query. The slowest is still the Demandes inbox over every request (74 ms, with or without a search), for the reason given above: the delays of every request are computed before the search and the page limit apply. The note for lane B stands (fixed below).

## The inbox, page first (lane B, 2026-10-14)

`list_demandes` now chooses its page on the request's own columns (the view, the counselor, urgent,
« Sans réponse », « À rappeler maintenant », the search), then computes the business-hours delays
for those rows only, in one read (`demandes_inbox_rows` takes the page's ids). It does this when
neither the filters nor the order need the delay. « En retard », « Attente la plus longue » and the
open view's priority order keep the full read; the open view is a few hundred requests. pgTAP 198
compares both bodies on a volume-shaped set (1 140 cases, two pages each): same rows, order and
values. Same volume data, as the seed's admin:

| Screen | Before (ms) | After (ms) |
|---|---|---|
| Demandes inbox, every request | 74 | 3 |
| Demandes inbox, every request, with a search | 74–93 | 11 |
| Demandes inbox, every request, a phone's digits | not measured | 15 |
| Demandes inbox, closed, third page | not measured | 3 |
| Demandes inbox, open requests (full read kept) | 3 | 3 |
