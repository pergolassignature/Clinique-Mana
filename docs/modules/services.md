# Module `services` (« Services et tarifs »)

The clinic's catalogue of services, coded like GOrendezvous (families 10xxx–80xxx, the code is the QuickBooks item), with each service's duration, the « pause après » it books, its taxes and the **source** of its price: the retention grid of the professional's title (`grid`; the price is never copied here), a fixed amount, free, or an amount typed on the invoice (`entered`). Student and reduced rates are dated variants; the cancellation policy is a dated row. Rendez-vous and Facturation read prices through this module's published functions, never its tables. Plan: [coding plan §5](../plans/2026-10-11-modules-coding-plan.md#5-services-et-tarifs-services--full-task-detail); roadmap §2.1; data: [GOrendezvous tour §3 and §18](../research/2026-10-11-gorendezvous-tour.md); decisions R-3 … R-6, R-13, R-37, R-41, R-45, R-59, R-64 and S-1 … S-8 in the [decisions log](../plans/2026-10-07-decisions-log.md).

- **Registry:** `modules.key = 'services'` (migration `20261012184103_services_module`), depends on `professionals` (titles, retention grids). It **starts disabled** in every clinic; the local seed enables it. Disabling it removes the settings section and empties every read (each policy has a `has_permission('services.view')` term).
- **Migrations:** `20261012184101_professionals_grid_client_price` (Professionnels' helper), `20261012184103_services_module` (registry, tables, seed, price functions, RPCs; S1), `20261012191301_professionals_titles_catalog` (Professionnels' published titles view), `20261012191303_services_price_list` (`list_service_prices`; S2), `20261012195739_services_rate_variant_after_end` (a new rate after an ended one; S2 review).
- **Tests:** pgTAP `097_professionals_grid_client_price`, `098_services_module`, `099_professionals_titles_catalog`, `100_services_price_list`, `101_services_rate_variant_after_end`; Vitest next to each file of `src/modules/services/` (fixtures in `test/fixtures.ts`); Playwright `e2e/services.spec.ts`.

## Tables

All per clinic (`org_id`), RLS on (`services.view`), `select` only for clients (no column grant: every write is an RPC), audited with `private.audit_trigger()` (nothing redacted), audit source of the seed `seed:services_catalogue` (« Catalogue initial »).

| Table | What | Rules |
|---|---|---|
| `service_families` | `code` (10, 20 … 80), `name`, `sort_order` | unique (`org_id`, `code`); seeded: Individuel, Couple et famille, IVAC, PAE externe, Administratif, Ateliers, Annulation tardive et absence, Frais de déplacement |
| `services` | `family_id`, `code` (five digits inside the family's range, set once), `key` (English, set once), `name`, `description`, `kind` (`session` / `call` / `fee` / `workshop` / `admin`), `duration_minutes` (0 without a slot), `buffer_after_minutes`, `for_two`, `price_source` (`grid` / `fixed` / `free` / `entered`), `fixed_price_cents`, `grid_duration` (60 couple / 50 / 30), `tax_rule` (`exempt` / `taxable`), `colour`, `is_active`, `sort_order` | `fixed` ⇒ a price; `grid` ⇒ a column; codes and keys unique per clinic; soft delete only (`is_active`) |
| `service_titles` | (`service_id`, `profession_title_id`) | which profession titles offer a service; none = a clinic service (waitlist, discovery call) |
| `service_rate_variants` | `variant` (`student` / `reduced`), `profession_title_id` (null: every title), `discount_kind` (`price` / `amount` / `percent`), `amount_cents` or `percent`, `effective_from`, `effective_to` (exclusive) | no overlap per (service, variant, title or general) (`btree_gist`); a title's row wins over the general one |
| `billing_policies` | `late_notice_hours` (24), `first_fee_percent` (50), `next_fee_percent` (100), `file_opening_service_id`, `fee_mode` (`confirm` / `automatic`), dated | periods never overlap; the clinic's first policy is never deleted |

## RPCs, views and helpers

**Writes** (definer, `services.manage` first through `private.assert_services_manage()`, French `P0001` with a HINT naming the field):

- `save_service(p_id, p_family_id, p_code, p_key, p_name, p_description, p_kind, p_duration_minutes, p_buffer_after_minutes, p_for_two, p_price_source, p_fixed_price_cents, p_grid_duration, p_tax_rule, p_colour, p_sort_order) → uuid`: `p_id` null creates; the key, the code and the family are refused if changed later.
- `set_service_active(p_id, p_active)`: archive / restore.
- `set_service_titles(p_id, p_title_ids uuid[])`: replaces the titles; unchanged rows are not rewritten.
- `add_service_rate_variant(p_service_id, p_variant, p_title_id, p_discount_kind, p_amount_cents, p_percent, p_effective_from) → uuid`: closes the open row of its series on the new start, which must come after it; with no open row, the start must be on or after the series' last end (a rate ended on a coming date).
- `end_service_rate_variant(p_id, p_effective_to)`: ends an open variant; `p_effective_to` null deletes the series' last row while it is not in force yet or within 24 h of its creation (the previous one opens again).
- `add_billing_policy(p_effective_from, p_late_notice_hours, p_first_fee_percent, p_next_fee_percent, p_file_opening_service_id, p_fee_mode) → uuid` and `delete_billing_policy(p_id)` (same rules as the variants; the first policy stays).

**Reads for the settings section:** the five tables (RLS) and Professionnels' `profession_titles_catalog`; `list_service_prices(p_on)` (definer, `services.view` first, the caller's clinic): one row per active grid service and offering title, one title-less row for every other active service, with the student and reduced prices in force (`null` when none applies).

## What the module publishes

Other modules read these, never the raw tables (CLAUDE.md §5):

- **`services_catalog`** (security invoker, `services.view`): the **active** services with `family_id, family_code, family_name, family_sort_order`, `title_ids uuid[]`, `title_keys text[]` and every column of `services` but `is_active`. Pickers (Rendez-vous' booking form, Facturation's manual line, Demandes' fee lines) list from it; a service offered by no title is a clinic service, offered to every client.
- **`get_service_price(p_service_id, p_title_id, p_variant, p_on, p_tax_exempt = false) → (price_cents, tax_rule, source, variant_applied)`** (definer, `services.view` first, the caller's clinic): for clients.
- **`private.service_price(p_org, p_service_id, p_title_id, p_variant, p_on, p_tax_exempt)`**: the same, for definer callers in Rendez-vous and Facturation, after their own permission check, with the org they verified. Granted to no role. **The one place a price is computed.**
- **`billing_policy_on(p_on)`**: the cancellation policy in force on a date (no row when none).
- **`private.service_payout_facts(p_org, p_ids)`** (FPay, migration `20261013120848`): code, key, name, kind, duration, grid duration, active or not, family, for Facturation's payroll (its rules by service; a retired service too); `p_ids` null for every service. Granted to no role.
- **Journal d'audit:** the manifest's `audit` loader (`lib/audit-labels.ts`): the five tables, their fields and values in French.

### What Rendez-vous, Facturation and Demandes must do

1. **Price = `service_price(…)` on the date of the session**, with the professional's **primary title** (`professionals_directory.primary_title_id`) and the client's variant (`student` / `reduced`, set on the client by Clients) and tax exemption (« Statut Indien », Clients). Never recompute a grid price, never read `retention_grid_prices` or `service_rate_variants`.
2. **Snapshot what you charge** (Facturation): the invoice line stores `price_cents`, `tax_rule`, `source` and the code / name of the service at the time; a later price change never alters an issued invoice.
3. **`price_cents` null** means one of two things, told apart by `source`: `entered` (the amount is typed on the invoice line, required there) or `grid` without a grid in force for that title on that date (« À confirmer »: Facturation refuses the line with a clear message; Rendez-vous books it and shows « Prix à confirmer »).
4. **Taxes:** `tax_rule` says whether the line is taxable; the rates are core's (« Fiscalité », `tax_rate_on`). A tax-exempt client turns every line `exempt`.
5. **Slot length** = `duration_minutes + buffer_after_minutes` (a 50 min session books 60, R-13). `duration_minutes = 0`: not bookable on the agenda (fees, admin).
6. **`for_two`:** a couple service; Facturation invoices the couple (one payer chosen per invoice, no split: Christine's answers).
7. **Who offers it:** a professional may be booked for a service only if one of her titles is in `title_ids` (or the list is empty: a clinic service).
8. **Cancellation:** `billing_policy_on(date of the session)`: late under `late_notice_hours`; the fee line is `first_fee_percent` the first time and `next_fee_percent` after, on the session's price; with `fee_mode = 'confirm'` the line is **proposed** and the professional (or the adjointe on her behalf) decides (R-59). `file_opening_service_id`: the service Facturation adds to a client's first appointment.
9. **Codes are stable** (QuickBooks items, the GOrendezvous import's key): the import maps GOrendezvous codes through `services_catalog.code`; student / reduced codes (10131, 10151, 10152) map to the base service plus a variant, PRÉSENTIEL codes (10154, 10155, 20151, 20161) to their online twin.

## Permissions and what each role sees

| Permission | Default roles | Gives |
|---|---|---|
| `services.view` | admin, conseillère, adjointe, professionnel | the published reads (catalogue, prices, policy): her own agenda and receipts for a professional |
| `services.manage` | admin, adjointe | every write; the settings section editable |

**Settings section (S-8):** Paramètres → « Services et tarifs » (`id: 'services'`, path `services-et-tarifs`) opens with `services.manage` **or** `settings.view`, and is editable with `services.manage`. So the admin and the adjointe see and edit it; a conseillère or a professional never sees the clinic's price settings. A custom role with `settings.view` but without `services.manage` reads it (« Lecture seule »); it should also hold `services.view`, or the cards stay empty.

## Screens

Paramètres → **Services et tarifs** (UI-4: the section title is the H1), four `SettingsCard`s:

- **Catalogue:** services grouped by family (`10 · Individuel`), code, name (« Pour deux personnes »), duration and pause (« 50 min + 10 »), price and taxes (« Grille, 50 min » / « 37,83 $ » / « Gratuit » / « Montant saisi à la facture », then « Taxable » / « Non taxable »), professions (names up to two, else « 9 professions »); « Actifs · Archivés · Tous », a search on name, code and key; « Ajouter un service » and a « … » menu per row (Modifier, Archiver / Restaurer). The sheet groups Identité, Durée, Prix et taxes, Professions qui l'offrent; it asks before closing with changes; refusals land under their field.
- **Tarifs étudiant et réduit:** the dated variants per service (Variante, Profession or « Toutes les professions », Rabais, Du, Au or « Sans fin », Statut), « Nouveau tarif », « Terminer », « Supprimer » where the database allows it.
- **Politique d'annulation:** the policy in force (and a coming one) as a `DescriptionList`, the history, « Nouvelle politique ».
- **Prix:** read-only, the grid price today of every active grid service for each profession offering it, with « Étudiant … » / « Réduit … » under it, « Non offert », « À confirmer »; then « Écarts avec GOrendezvous » (`lib/price-gaps.ts`: GOrendezvous's 2026 prices per profession for 10130 / 10150 / 20160 against the grids; « Aucun écart » with the seeded grids). A link to Paramètres → Rémunération for whoever holds `professionals.compensation`.

## Known follow-ups

- `import_service_catalogue` (S-4) and the consent a service requires (S-3) come with I1 and C5a.
- Fails closed in core's role guard (CM-1): a non-admin holding `users.manage` cannot assign « Conseillère » or « Adjointe » while `services` is disabled, since their defaults carry `services.view`. Only admins hold `users.manage` by default: no impact today.
- « Ajouter un service » calls `save_service` then `set_service_titles`: if the second call fails, the service exists without its titles (the sheet shows the error; editing it again sets them). One RPC for both if it ever matters.
- At 375 px the catalogue and the price table scroll inside their own region (the professions column is hidden below `md`).
