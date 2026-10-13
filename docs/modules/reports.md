# Module `reports` (« Rapports »)

The clinic's reports, read-only: what GOrendezvous's « Revenus », « Annulations » and « Clients à relancer » give today (R-27), then the intake, payroll, IVAC and waitlist reports (RP2). The module has **no table**: it reads only what Facturation and Rendez-vous publish, through definer RPCs that check the permission first; the CSV is made in the browser from the answer (no file stored). Plan: [coding plan §12](../plans/2026-10-11-modules-coding-plan.md#12-rapports-reports--batches); data: [GOrendezvous tour](../research/2026-10-11-gorendezvous-tour.md) (Revenus by invoice, by service, by payment; cancellations by reason; clients to call back); decisions R-27 and **RP-1 … RP-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| RP1 | « Revenus » (by invoice, by service, by payment; filters; CSV), « Annulations et absences » (by reason), « Clients à relancer » | built |
| RP2 | Intake KPIs (D6), payouts, IVAC (FP), places, waitlist | planned (lane B, February) |

- **Registry:** `modules.key = 'reports'`, depends on `billing` and `appointments`; starts disabled in every clinic (Paramètres → Modules).
- **Migrations:** `20261013150015_billing_report_facts` (Facturation's published facts), `20261013150108_appointments_report_facts` (Rendez-vous'), `20261013150151_reports_module` (registry, permissions, the three RPCs).
- **Tests:** pgTAP `165_reports` (privileges, registry and roles, the three views and their filters, a credited invoice apart and a draft never, the period's rules, cancellations per reason with a couple's appointment once and never a personal one, the clinic's day bounds, the clients to call back, the permissions, the module off, another clinic); Vitest `src/shared/lib/csv.test.ts` (formula guard, quoting, numbers) and `src/modules/reports/**` (periods, labels, each report's CSV, the pages, the manifest); Playwright `e2e/reports.spec.ts`.

## Permissions (RP-1)

| Key | Who (defaults) | What |
|---|---|---|
| `reports.view` | admin | « Annulations et absences », « Clients à relancer » |
| `reports.finance` | admin, adjointe | « Revenus » |

## RPCs

All definer, permission first, French `P0001` with a HINT (`period`, `view`, `kind`). A period goes from a clinic date to another, **a year at most** (366 days, RP-5); at most **5 000 rows** come back (`truncated`), the totals always count everything.

| RPC | Permission | What |
|---|---|---|
| `report_revenue(view, from, to, professional, service, mode)` → jsonb | `reports.finance` | `invoice`: one row per invoice issued in the period and not credited (dossier, payer, professionals, totals, paid, balance); `service`: one row per line, and `by_service`; `payment`: one row per payment made in the period (whatever the invoice's date), and `by_mode`. `credited`: the invoices issued in the period then credited, counted apart (RP-2). `options`: the period's professionals and services, the clinic's modes. |
| `report_cancellations(from, to, professional, reason, kind)` → jsonb | `reports.view` | one row per client of the period's appointments cancelled (reason, late, kept on the schedule, the client's next appointment) or where the client was absent; `by_reason` and `totals` count appointments (a couple's once). Never a personal appointment nor a held one; never the cancellation's details (RP-3). |
| `report_clients_to_follow_up(from, to, professional)` → jsonb | `reports.view` | per client, the period's last cancellation or absence with nothing booked, confirmed or completed after it (whoever the professional), files neither archived nor closed; `events`: how many in the period (RP-4). |

## What this module reads (published only)

- **Facturation:** `private.billing_revenue_lines(org, from, to)`, `private.billing_revenue_payments(org, from, to)`, `private.billing_payment_mode_names(org)`.
- **Rendez-vous:** `private.appointment_absence_facts(org, from, to)` (instants: Rapports gives the clinic day's bounds), `private.cancellation_reason_names(org)`.
- **Clients:** `private.clients_display_names`, `private.clients_billing_facts` (archived, closed).
- **Professionnels:** `private.professional_display_names`. **Services et tarifs:** `private.service_payout_facts` (code, name).

## Screens

- **« Revenus »** (`/rapports/revenus`, menu Facturation, `reports.finance`): real tabs « Par facture », « Par service », « Par paiement » (`?vue=`); the period (« Du », « Au », « Ce mois-ci », « Mois dernier », « Cette année », « Année dernière »; this month by default), « Professionnel », « Service », « Mode de paiement » (by payment); the totals, the credited invoices said apart, the rows (each invoice links to its page), « Exporter (CSV) ». Every filter is in the address.
- **« Annulations et absences »** (`/rapports/annulations`, menu Suivi, `reports.view`): « Par raison » (the totals, per reason with the late ones, then each appointment with the client's next one or « Aucun rendez-vous après ») and « Clients à relancer » (`?onglet=relancer`: each client linked to the file, the last missed appointment, how many); filters: the period, the professional, the type and the reason; « Exporter (CSV) ».

## CSV (RP-6)

Made in the browser (`@/shared/lib/csv`): semicolons, a decimal comma, a BOM, CRLF (Excel fr-CA); a text cell starting with `= + - @`, a tab or a carriage return gets a leading `'` (formula injection); the amounts and numbers the app computes are written as they are. The file holds what the screen shows (the same filters, at most 5 000 rows). FPay's payroll export uses the same guard.

## Keep / Change / Drop

| Item | Decision |
|---|---|
| Legacy « Reports = link to IVAC report » (inventory, settings) | **Change:** the IVAC report comes with Payeurs externes (FP) and RP2 |
| GOrendezvous « Revenus » by invoice / by service-product / by payment; filters (period, professional, client, service, mode); Excel export | **Keep** (RP1); a client's own revenue is her « Visites et paiements »; CSV for Excel |
| GOrendezvous « Annulations » by reason, « Clients à relancer » (Impressions → Exporter) | **Keep** (RP1), with the absences |
| GOrendezvous dashboard (acquisition through GOrendezvous's own channels) | **Change:** the intake KPIs by source come from Demandes (D6, RP2) |
