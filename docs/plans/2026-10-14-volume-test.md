# Volume test before the cutover (2026-10-14)

The hot screens were timed against production-scale synthetic data on the local stack. One slow query was found and fixed. Every other screen stays under 100 ms at this volume.

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
- **The Demandes inbox over every request, with a search (93 ms):** `demandes_inbox_rows` computes the business-hours delay of all 4 000 requests before the search filters them. The default view (open requests) takes 3 ms. Filtering on the search words before computing the delays would bring it under 20 ms. This is lane B's module, and it is noted for them.
- **No missing index was found.** None of the logged plans (statements over 50 ms) scans `appointments`, `invoices`, `invoice_lines`, `payments` or `appointment_participants` sequentially. The only sequential scans are small tables (`organizations`, `profiles`) and the inbox's full read of `demandes` when every request is asked.
- **Not measured here:** the synthetic data has no request events, mail or text messages, so the inbox's per-request lookups and the Communications screens ran against empty tables. A later run should add them.
