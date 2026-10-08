# Module `professionals` (« Professionnels »)

The bank of the clinic's ~50 independent professionals as clean, curated data that matching relies on (motifs, clientèles and their limits, langues, disponibilités générales, readiness; no approaches, P4-240), the record staff read and edit, and its lifecycle. **Batch 4a is built** (this document); 4b (invitation, questionnaire, review), 4c (documents, insurance, fiche PDF) and 4d (service contract) follow the [plan](../plans/2026-10-08-professionals-module-plan.md).

- **Design:** [Professionnels design](../plans/2026-10-08-professionals-module-design.md) · **Plan and decisions:** [plan](../plans/2026-10-08-professionals-module-plan.md) (each task's « As built » is the reference where the sketch differs), P4-1 … P4-169 in the [decisions log](../plans/2026-10-07-decisions-log.md), later ones (P4-220 …, the website catalogue P4-240 – P4-249) in the plan · **Rules:** [database conventions](../standards/database-conventions.md), [CLAUDE.md](../../CLAUDE.md) · **Parity:** [inventory §A](../plans/2026-10-06-legacy-feature-inventory.md#a-professionnels-incl-onboarding-documents-contrats-spécialités-motifs) (ticked by Task 4a.20).
- **Registry:** `modules.key = 'professionals'` (migration `20261007140859_professionals_module`), no dependency besides core. It **starts disabled** in every clinic; an admin enables it in Paramètres → Modules. Disabling it removes the menu, the routes and the settings sections, and empties every module read in the database (each policy has a `has_permission` term, decision #5).
- **Migrations (4a):** `20261008082847_professionals_reference_data`, `…084945_professionals_reference_settings`, `…092451_professionals_core`, `…100634_professionals_lifecycle`, `…163932_professionals_import`, `…170703_professionals_compensation_private`. Core migrations made on this branch for the module: `…113715_core_user_preferences` (remembered filters), `…154413_core_pii_key_versions` (ADR 0004 « Before Phase 4 »), and the signing capture `…151625` / `…151626` (P4-53 … P4-66, see « Signing »).
- **Tests:** pgTAP `040`–`043`, `044_core_user_preferences`, `047_core_pii_key_versions`, `048_professionals_import`, `049_professionals_compensation_private` (Phase 4 numbers 040–069, P4-41); Vitest next to each file of `src/modules/professionals/`; Playwright `e2e/professionals.spec.ts` (local); the probe `supabase/scripts/perf-professionals.sql`.

## Tables

All per clinic (`org_id`), RLS on, `select` only for clients (column `update` grants where said), audited with `private.audit_trigger`, unless noted.

### Reference lists (4a.1–4a.2)

Nine lists, one shape: `id, org_id, key (immutable ASCII snake_case, never shown), name (French, editable), is_system, sort_order, is_active, created_at, updated_at`, `unique (org_id, key)`, `unique (org_id, id)` (target of composite FKs, P4-40), a unique `(org_id, lower(normalize(name, NFKC)))`, an `(org_id, sort_order)` index. Soft delete only (`is_active`). `private.freeze_reference_identity()` refuses a change of `key` / `code` / `org_id`. At most 500 rows per list, archived included. Seeded per clinic by `private.seed_professionals_reference(org)` (trigger on `organizations`, and once for existing clinics), audit source `seed:professionals_reference`; seeded rows keep their legacy keys (P4-31) and the plain labels of P4-51.

| Table | Extra columns | Seed |
|---|---|---|
| `professional_orders` | `acronym` (`^[A-Z]{2,10}$`, unique per clinic ignoring case), `licence_label` (default « N° de permis »), `licence_pattern` (PostgreSQL regex, validated on save) | OPQ, OTSTCFQ, OPPQ (`licence_pattern` `^[0-9]{5}-[0-9]{2}$`, P4-248), OPSQ, OCCOQ, ODNQ |
| `profession_categories` | — (Services et tarifs prices by category) | 9 |
| `profession_titles` | `category_id` (required), `order_id` (null = not regulated, no licence) | 9 (P4-6) |
| `clienteles` | `min_age`, `max_age` (null max = « et plus »; both null = not an age group) | 8 from the website (P4-244): Enfants `children` 0–12, Adolescents `adolescents` 13–17, Jeunes adultes `young_adults` 18–25, Adultes `adults` 18+, Couples `couples`, Familles `families`, Parents `parents`, Athlètes `athletes`; the five legacy keys `is_system` (P4-42) |
| `motif_categories` | `description`, `icon` (one of 20 Lucide names) | 13, the website's headings in its order (P4-241) |
| `motifs` | `category_id` (null or archived category → « Sans catégorie », P4-246), `is_restricted` (P4-16) | 124, the website's labels in its order and wording (P4-241 – P4-243); none restricted |
| `languages` | `code` (ISO 639-1) **instead of** `key` | fr (`is_system`), en, es, ca |
| `deactivation_reasons` | `requires_note`, `disables_account` | Congé, Fin de collaboration (disables the account), Assurance expirée, Autre (`is_system`, note required) |

`is_system` rows cannot be archived (French is added to every new record; the five legacy clientèles are what matching filters on; « Autre » is the catch-all reason). The seed is only a start: staff add, edit, archive and reorder categories, motifs and clientèles in Paramètres. There are no approaches (P4-240): no `specialties` list, junction or RPC. Module settings live in core `org_module_settings` (module `professionals`): today one key, `collect_sin` (boolean, default false, P4-7).

### The record (4a.3)

| Table | Key | What |
|---|---|---|
| `professionals` | `id`, `unique (org_id, id)` | identity (`first_name`, `last_name`, `email` lower-cased, unique per clinic), contact (`personal_phone` E.164, address lines, city, `province` default QC, `postal_code` `A1A 1A1`, `country` CA), `years_experience` 0–60 (P4-33), `gender` (`female` / `male` / `unspecified`, staff only, P4-5), `status` (`draft` « À inviter », `invited`, `in_review`, `active`, `inactive`), `status_changed_at/by`, `deactivation_reason_id` + `deactivation_note` (required exactly when inactive), `deactivation_disabled_account` (P4-11), `activation_override_reason`, `profile_id` (the provider's account, unique), `created_by`. Column `update` grant on the plain fields only (names, phone, address, years, gender) under `professionals.manage`; email, status and the account go through RPCs. Audit redacts phone, address lines, city, postal code and gender (Loi 25). |
| `professional_public_profiles` | `professional_id` | `bio`, `approach` (≤ 4000), `public_email`, `public_phone`; update grant, `professionals.manage`. |
| `professional_matching_profiles` | `professional_id` | `accepting_new_clients` (default true), `availability_periods` ⊆ `am, pm, end_of_day, evening, weekend` (interim until Rendez-vous, P4-4; `end_of_day` « Fin de journée », P4-250), `availability_note` (≤ 500), `min_client_age` (0–120, null = none) and `women_only` (default false): the client limits (P4-245); update grant, `professionals.matching`. |
| `professional_professions` | `(professional_id, id)` + `unique (id)` (P4-36) | `profession_title_id`, `licence_number`, `is_primary`. At most two titles, exactly one primary (deferred constraint trigger), a licence for every regulated title, in the order's format (`professional_professions_guard`). |
| `professional_clienteles` | `(professional_id, clientele_id)` | `is_specialized` (★). |
| `professional_motifs`, `professional_languages` | `(professional_id, <x>_id)` | — |
| `professional_payer_numbers` | `(professional_id, payer_type)` | `payer_type` `ivac`; `number` upper-cased, unique per clinic (P4-14). |

Junction indexes are `(org_id, <x>_id) include (professional_id)`: they serve the composite FKs, « who holds X » and the usage counts. Every child row's primary key starts with `professional_id`, so its audit `record_id` does too (P4-36).

### Private data and compensation (4a.17)

| Table | What |
|---|---|
| `professional_private` | 1:1. `sin` and `bank_account` are **pgcrypto ciphertexts** (`bytea`) with `sin_last3` / `bank_account_last4` for display; `business_number`, `gst_number`, `qst_number`, `bank_institution`, `bank_transit` plain; `key_version`; `updated_at`, `updated_by`. **No privilege for `anon`, `authenticated` or `service_role`, RLS on with no policy**: only the definer RPCs below read or write it. Every value column is redacted in the audit. |
| `compensation_kinds` | Global catalogue (no `org_id`, changed by migration, not audited): consultation, atelier, annulation tardive, autres frais. |
| `compensation_defaults` | Dated default margin ranges per kind (`margin_min_pct`, `margin_max_pct`, `effective_from`, `effective_to`), exclusion on overlapping periods. Seeded from 2017-01-01: 25–30 %, 25 %, 30 %, 15 %. |
| `professional_compensation` | A professional's dated margin per kind (P4-9). PK `(professional_id, id)`. |
| `recognition_rules` | Dated programme rules: step 50 sessions, 0,50 $ / 50 min, 0,25 $ / 30 min, cap 25 %, `cap_basis = 'unconfirmed'` (P4-8: **no amount is computed anywhere** until the accountant confirms). |
| `professional_recognition` | A professional's dated level and sessions counted, entered by hand. PK `(professional_id, id)`. |

Compensation tables are read with `professionals.compensation` (org-scoped RLS), written only through RPCs, and audited **with their values** (P4-149: `audit.view` is admin-only by default).

### Core table used by the module

`user_preferences` (core, migration `…_core_user_preferences`): one row per user and key, read by the user's own select, written through `set_user_preference` / `delete_user_preference` only for the session's own user. The list stores its remembered filters under `professionals.list_filters` (P4-60 – P4-62). Not audited (UI state).

## RPCs, views and helpers

Every module RPC checks its permission first (`42501`), scopes to `private.current_user_org_id()`, locks what it changes, and raises French `P0001` refusals that carry a **HINT naming the field** when a form routes them (P4-65, P4-91, P4-115). Every `public` function is in `003`'s `functions_are` list (P4-47).

**Settings lists (4a.2)** — `professionals.settings` to write:
- `save_professional_order`, `save_profession_category`, `save_profession_title`, `save_clientele`, `save_motif_category`, `save_motif`, `save_language`, `save_deactivation_reason` (`returns uuid`; keys from `private.reference_key` + `private.unique_reference_key`; names through `private.reference_text`);
- `set_professionals_reference_active(kind, id, active)` (archive rules: a parent with active titles, `is_system` rows; restore rules: a title's category and order first), `reorder_professionals_reference(kind, ids)` (the **full** list, archived rows included; writes only rows whose order changes);
- `get_professionals_catalog()` (definer, one round trip, the eight lists for the caller's clinic, empty lists without a professionals permission; cached 5 min by the client), `list_professionals_reference_usage()` (`kind` = table name; counts professionals per row, active titles per category and order, active motifs per category; `.settings` or `.manage`);
- `get_professionals_settings()` (any professionals key), `set_professionals_settings(patch)` (`.settings`; `collect_sin` also needs `.private`; each key validated by `private.validate_professionals_setting`, defaults in `private.professionals_settings_defaults()`: 4b and 4c add their keys there).

**Record (4a.3–4a.4)**:
- `create_professional(first, last, email, title?, licence?)` (`.manage`; email unique among the clinic's professionals **and** profiles, P4-34; adds both 1:1 rows and French), `set_professional_email` (only while no account), `set_professional_professions` (`.manage`), `set_professional_clienteles` / `_motifs` / `_languages` (`.matching`), `set_professional_payer_number` (`.manage`). Set RPCs replace the set in three statements, refuse a `null` set (`[]` clears), accept ≤ 500 ids, keep an archived item already held but never add one, enforce restricted motifs both ways (P4-16, P4-55), write only what changes, and bump `professionals.updated_at` when anything changed.
- `activate_professional(id, override_reason?)` and `deactivate_professional(id, reason_id, note?)` (`.manage`; return `(status, account_change, profile_id)`): activation from any non-active status once `ready`, otherwise only with `.activate_override` and a reason of 5–500 characters (stored, shown in Aperçu). A reason with `disables_account` disables the provider's account (P4-11, below).
- `get_professional_record(id)` (one JSON: `professional`, `public_profile`, `matching_profile`, `professions`, `clienteles`, `motif_ids`, `language_ids`, `payer_numbers`, `readiness`; null when unreadable), `get_professional_readiness(id)` (`{complete, done, total, items: [{key: 'matching_profile', done, missing}], warnings}`), `get_professional_public_profile(id)` (published: names grouped by category for a fiche).
- `list_professional_history(id, before_id?, limit?)` (`.view`; keyset by audit id, ≤ 200 per page; `professional_private` rows without values, reads keep only `{"fields": ["sin" | "bank_account"]}`; compensation rows only with `.compensation`, P4-144).
- `list_professionals(…)` (server pages with filters, sorts `name` / `recent`, keyset cursor; built at the coordinator's request: the list page reads `professionals_list` whole today, ≤ 500 rows).
- `import_professional(row, dry_run default true)` (4a.19, « Import », below).

**Private data and compensation (4a.17)**: `get_professional_private(id)` (one row, masks only, `updated_at` as a string), `reveal_professional_private(id, 'sin' | 'bank_account')` (audited `read`), `set_professional_tax_numbers`, `set_professional_bank`, `set_professional_sin` (each with `p_expected_updated_at`, P4-148), `clear_professional_private_field` — all `.private`. `set_compensation_default` / `delete_compensation_default`, `set_recognition_rule` / `delete_recognition_rule`, `set_professional_margin` (returns `{id, warning}` against the default range) / `delete_professional_margin`, `set_professional_recognition` / `delete_professional_recognition`, `get_professional_compensation(id, on?)` (the read model for 4d and Facturation, P4-146) — all `.compensation`. A new dated row closes the open one; deleting is allowed only for the open row while it is not in force or within 24 h of its creation (P4-145); dates within 2000–2100 (P4-150).

**Views (security invoker, `select` to `authenticated`)**: `professionals_readiness` (per professional: `has_profession`, `licences_ok`, `restricted_motifs_ok`, `has_language`, `has_clientele`, `has_motif`, `matching_complete`, `email_matches_login`, `ready`; active reference rows only), `professionals_list` (the list page: ids, not labels), `professionals_directory` and the catalogue views (published, below). `professionals_list` and `professionals_directory` filter on `professionals.view`, so a provider's self policies never put their row there.

**Private helpers** (granted to no client role unless said): `private.current_professional_id()` (**published**, granted to `authenticated`: the caller's own professional, null unless their profile is active), `private.can_read_professionals_reference()`, `private.lock_professional(id)` / `private.lock_professional_with_account(id)` (account first, then the professional, as the email sync trigger; `40001` « Le dossier vient de changer. » if the link moved), `private.set_provider_account_status`, `private.professional_login_email_mismatches()`, `private.professional_history_tables()`, `private.professional_email`, `private.assert_professional_email_free`, `private.parse_specialized_items`, `private.is_valid_sin`, `private.unreadable_private_field`, the seeds.

**Triggers worth knowing**: `profiles_sync_professional_email` (a login address change reaches `professionals.email`; a conflict with an unlinked professional's address is skipped, decision #38, and readiness shows the warning `login_email_mismatch`); `profiles_release_professional_account` (P4-11, below).

**Indexes for every path** (efficiency checklist): `org_id` leading on every table; `professionals (org_id, last_name, first_name)`, `(org_id, status)`, `(org_id, status_changed_at desc, id desc)`; junctions `(org_id, <x>_id)`; `audit_log_org_record_prefix_idx (org_id, left(record_id, 36), id desc)` for the history; `(org_id, sort_order)` on the lists.

## Permissions and what each role sees

| Key | Meaning | Default roles |
|---|---|---|
| `professionals.view` | See the list and the records (Phase 1) | admin, admin_assistant, counselor |
| `professionals.manage` | Create, edit identity, professions, public profile, IVAC; activate a complete file; deactivate | admin, admin_assistant |
| `professionals.matching` | Edit the matching profile (P4-10) | admin, admin_assistant, counselor |
| `professionals.activate_override` | Activate an incomplete file with a reason | admin |
| `professionals.settings` | Edit the module's lists and settings | admin |
| `professionals.compensation` | Margins and recognition (record tab, « Rémunération » settings) | admin |
| `professionals.private` | Tax numbers, SIN, bank details | admin |
| `professionals.self` | Read one's own record (provider) | admin, provider |

Role defaults are a template (decision #40): an admin can change them per clinic, and overrides apply per person.

- **Administrateur:** everything. List with « Ajouter »; every record tab including « Rémunération et fiscalité »; « Activer » even when incomplete (override reason); all six settings sections, editable, including « Rémunération » and its « Recueillir le NAS » switch.
- **Adjointe administrative:** list with « Ajouter »; Aperçu, Jumelage, Profil public, Identité et permis, Historique, all editable; « Activer » for a complete file, « Désactiver »; Historique shows that private data changed, never a value, and no margin rows; the five list sections **read-only** (one « Lecture seule » notice); no « Rémunération » tab or section.
- **Conseillère:** list and records without « Ajouter » or header actions; **Jumelage editable**, every other tab read-only (one notice per tab); no « Paramètres » (decision #19).
- **Professionnel (provider):** no « Professionnels » menu, the routes answer « Accès refusé ». The database already lets them read their own record (`professionals.self`, `current_professional_id()`, Loi 25 right of access, including their own deactivation note); « Mon profil » arrives in 4b.

## Screens (routes and sections)

- `/professionnels` (`professionals.view`): the list. Filters in the URL (`q`, `statut`, `profession` (primary title), `langue`, `clientele`, `motif`, `nouveaux`, `surveiller`, `page`), remembered per user server-side, never in `localStorage` (P4-60 – P4-62); columns follow the card's width (P4-63); a row is one link that prefetches the record on hover or focus (P4-64).
- `/professionnels/:id/:onglet` (`professionals.view`): the record. Tabs `apercu`, `jumelage`, `profil-public`, `identite`, `historique`, `remuneration` (with `.compensation` or `.private`); « Documents » comes with 4c. Real Radix tabs, the URL names the tab, a switch replaces the history entry (P4-70). Every tab but Aperçu is a `lazyPage` preloaded with its data on hover or focus (P4-72, P4-106, P4-166).
- **Settings** (group « Modules »): `professions` « Professions et ordres », `clienteles` « Clientèles » (« Spécialités » until P4-240), `motifs` (with the categories sheet), `langues`, `raisons-desactivation` — seen with `.manage` or `.settings`, edited with `.settings` — and `remuneration` « Rémunération » (`.compensation`, P4-160).

**Readiness by batch.** 4a: « Profil de jumelage complet » (profession, licence per regulated title, a regulated title when a restricted motif is held, language, clientèle, motif; active rows only). 4b adds « Compte créé » and « Questionnaire approuvé »; 4c photo, insurance and consent; 4d the signed contract. Each batch replaces `professionals_readiness` (same columns first, new ones appended, `ready` redefined).

## Motif density (Jonathan's rules)

Some professionals hold nearly all 124 motifs. Every place that shows a professional's motifs (Aperçu, Jumelage, the history's details, the fiche, Demandes' suggestions) **writes every held motif out, by name** (P4-249, superseding P4-73's summaries). `lib/motif-summary.ts` (`summarizeMotifs`) and `components/record/MotifsSummary.tsx` (`MotifsSummary`, `CategoryNames`) implement it:

- **Each category's title on its own line:** icon, name, and a muted « 9 / 16 » beside it (active motifs held / active motifs of the category), **in addition to** the names, never in their place.
- **Then every held motif by name**, small (13 px), one per line in compact columns that follow the list's own width (auto-fill grid, columns ≥ 11rem, at most 3), hairlines between categories. Archived motifs stay in their category, marked « (archivé) »; counts use active motifs only.
- **Never « Tous », « Tous sauf … » or « N sur M » in place of names**, and nothing folds. Aperçu stacks its motif row so the list takes the card's width.
- The Jumelage picker stays searchable, grouped and folded, with « Tout sélectionner » per category and « Sélection : N sur M ». The history counts a long save in its sentence (« a ajouté 65 motifs ») and lists every name, by category, in the entry's details.

## What the module publishes

Other modules read these, never the raw tables (CLAUDE.md §5):

- **`professionals_directory`** (security invoker, `professionals.view`): `id, org_id, status, accepting_new_clients, availability_periods, display_name, primary_title_id, primary_title_key, primary_title_name, category_key, order_acronym, licence_number, professions jsonb [{id, title_id, title_key, title_name, category_key, order_acronym, licence_number, is_primary}], language_codes text[], clienteles jsonb [{id, key, specialized, min_age, max_age}], min_client_age (smallint, null = none), women_only (boolean), motif_ids uuid[], motif_keys text[], years_experience, gender, insurance_status ('unknown' until 4c), ready, updated_at` (greatest of the record's and its matching profile's; every set RPC bumps the record's, so a stored recommendation can say « profil modifié depuis »). Later batches only append columns.
- **Catalogue views** (active rows only): `motifs_catalog` (`id, org_id, key, name, is_restricted, sort_order, category_id, category_key, category_name, category_sort_order, category_icon`; category columns null when the category is archived), `clienteles_catalog` (`id, org_id, key, name, min_age, max_age, sort_order`), `languages_catalog` (`id, org_id, code, name, sort_order`).
- **`get_professional_public_profile(id)`**: the fiche's content with names (motif groups in category order, « Sans catégorie » last with a null `category_key`; clientèles with their ages; `min_client_age`, `women_only`).
- **`private.current_professional_id()`**: for Clients, Demandes and Rendez-vous policies that let a provider see their own rows.
- **Later:** `get_professional_compensation(id, on)` for 4d's Annexe A and Facturation (snapshot what you use, P4-151).

### Ce que Demandes doit faire

1. **Read through its own `api/` layer** the directory and the catalogue views; never `professionals` or a junction.
2. **Eligible for a new client:** `status = 'active'`, `ready`, `accepting_new_clients`. An inactive or not-ready professional is never suggested; one not accepting new clients may still be shown for an existing client.
3. **Clientèle is a hard filter:** the principal person's age within `min_age … max_age` (a null `max_age` means « et plus »), or, for formats, the clientèle's `key` (`couples`, `families`, and the clinic's own such as `parents`; keys never change, P4-31). A ★ (`specialized`) scores higher, it never excludes.
3b. **The professional's client limits are hard filters too (P4-245):** with `min_client_age` set, a client younger than it is **never** suggested, whatever clientèle matches (an « Enfants (8 ans et +) » professional holds Enfants 0–12 but takes no 7-year-old); with `women_only`, only a client who is a woman is suggested (a client of unknown gender: ask, never assume). Show them with the clientèles: « Enfants (8 ans et +) », « Femmes seulement ».
4. **Overlapping age clientèles:** a clinic may edit the bounds so that two age clientèles overlap (« 12 à 17 » and « 13 à 17 »). A professional holding **any** clientèle that contains the age is eligible. **The matcher must not use `sort_order` as a hidden tie-breaker** (nor to pick « the » clientèle of an age): it is a display order anyone with `professionals.settings` can change in Paramètres. Ties are broken by documented scoring criteria (motif hits, ★), then by a stable, visible order (`display_name`, then `id`).
5. **Language** is a hard filter on `language_codes` (ISO codes; French is on every record unless removed).
6. **Motifs score** (`motif_ids` / `motif_keys`); they never exclude on their own. There are no approaches (P4-240). Show a professional's motifs with the motif density rules above.
7. **Archived reference rows:** the directory lists what a professional holds, archived languages, clientèles and motifs included (with their ids and keys). Matching ignores archived rows, as readiness does: intersect with the catalogue views, which hold active rows only.
8. **Insurance (from 4c, P4-1):** `insurance_status = 'expired'` shows « Assurance expirée » in the suggestions and asks for confirmation before assigning a **new** client; it never hides the professional and never changes their status. Until 4c the column is `'unknown'`: ignore it.
9. **Availability** is the interim `availability_periods` (`am`, `pm`, `end_of_day` « Fin de journée », `evening`, `weekend`, in that order, P4-250) until Rendez-vous provides slots (P4-4). **Gender** serves only a client's stated preference.
10. **Store what was recommended** with the directory's `updated_at`, to say « profil modifié depuis » later.

## Deactivation and the provider's account (P4-11)

Migration `20261008100634_professionals_lifecycle.sql` (Task 4a.4) links a professional's status to their login account.

- **Disabling.** `deactivate_professional` with a reason marked `disables_account` (« Fin de collaboration ») disables the provider's profile the way `set_user_status` does: status `disabled`, then their `auth.sessions` are deleted. It acts only on an active profile holding the role `provider`. When it did, the professional keeps `deactivation_disabled_account = true`: the module owns that disable.
- **Re-enabling.** `activate_professional` re-enables the account only when `deactivation_disabled_account` is true. An account disabled before the deactivation, by someone else, stays disabled.
- **A change made elsewhere ends the module's claim.** Any other change of the profile's status (`set_user_status` in « Utilisateurs », or by hand) clears `deactivation_disabled_account`, through the trigger `profiles_release_professional_account`. Example: the adjointe deactivates with « Fin de collaboration », an admin re-enables the account, then disables it again. Reactivating the professional now leaves the account disabled, and `account_change` is null. The module's own changes run with the transaction-local setting `app.professionals_account_status = 'on'`, which the trigger skips; `private.set_provider_account_status` puts the previous value back on every path, errors included.
- **Écart from « Utilisateurs ».** `set_user_status` lets only an admin re-enable an account. Here, an adjointe (`professionals.manage`) who reactivates a professional re-enables the account the module itself disabled with that professional. It is the same decision undone, not a new access: an account an admin disabled separately is never re-enabled this way.
- **4b:** deactivating an `invited` professional must also revoke their invitation links; 4b.6 adds the Auth ban (new sign-ins), as `users-set-status` does.

## Readiness and archived reference rows

« Profil de jumelage complet » (`professionals_readiness`, `get_professional_readiness`) counts only active reference rows: titles, motifs, clientèles and languages. Matching ignores archived rows, so a professional whose only clientèle was archived is incomplete again (`missing` holds `clientele`). An archived title is neither a profession nor a missing licence, and an archived restricted motif requires no regulated title. Aperçu shows the gaps whenever the file is incomplete, active or not (P4-76).

## Private data and key versions

The rules of [ADR 0004](../adr/0004-secrets-in-vault.md) and [conventions §8](../standards/database-conventions.md#8-secrets-and-sensitive-data), as this module applies them:

- **Encrypted at rest:** the SIN and the bank account number are encrypted with pgcrypto under a Vault key (`private.encrypt_pii(value, version)`); the other tax and bank numbers are plain but sit in the same table behind `professionals.private`.
- **Key versions:** each row stores `key_version`. Writes use `private.pii_current_key_version()` (the highest version with a canary). **One version per row:** every write leaves the whole row on the current version in one statement (a kept ciphertext is re-encrypted from the row's version, or left byte for byte when the row is already current, so no spurious audit change). `private.pii_encrypted_values()` lists both columns (row key `professional_id`), so `pii_health_check()`, the canary seeding and the [rotation runbook](../runbooks/pii-key-rotation.md) cover them (pgTAP 047's completeness guard fails otherwise). 4b's `professional_submission_private` must be added the same way (P4-38).
- **Unreadable value:** a kept value that does not decrypt (wrong or missing key) raises a clean `P0001` naming the field, with a HINT saying how to fix it (P4-142); never pgcrypto's error.
- **SIN:** collection is off by default (`collect_sin`, P4-7): no screen asks for it and `set_professional_sin` refuses one until an admin turns « Recueillir le NAS » on (confirmation; after the accountant says it is needed). A stored SIN can still be revealed and removed while collection is off. 9 digits and the Luhn check; no message repeats a value.
- **Concurrency:** one RPC per card with the `updated_at` the card read (`stale` HINT on a change since, P4-148, P4-163).
- **Reveal:** `reveal_professional_private` writes an audit `read` row (« a affiché le NAS / le numéro de compte » in Historique). The client never caches a revealed value: component state only (`useRevealedPrivateValue` over `useRevealedValue`), masked after 60 s, when the tab is hidden, on unmount and when the row changes; mutations that carry a value use `gcTime: 0` (CLAUDE.md §8).
- **History and audit:** every value column is redacted in `audit_log`; the history shows « a modifié les coordonnées fiscales ou bancaires » without values.
- **Escrow first:** no real SIN or bank number on staging before the key is escrowed and the logging settings are checked (status doc, « Mise en service »).

## Signing (core capture, used by 4d)

The module sends no document yet. 4d's service contract uses core signing (Documenso, ADR 0005). Because the Documenso VM is not backed up, this branch also carries the **signing capture**, core migrations `20261008151625_core_signing_capture` and `…151626_core_signing_blind_alert`, rebuilt on main's envelope API (P4-53, P4-56, P4-57, P4-59, P4-66): every sent or viewed request is read hourly with a fair rotation, the signed PDF is copied into our storage as soon as it exists, and integration managers get an important notice when a completion cannot be seen (reconcile outage, requests no read reaches, module disabled). The signed PDF, with Documenso's certificate and audit-log pages, is then the only copy that counts: Documenso's document preferences must include both (« Mise en service »). Details: [core module doc, « Signing »](core.md#signing-design-6-adr-0005-adr-0008).

## Import of the existing professionals (4a.19)

- **RPC** `import_professional(p_row jsonb, p_dry_run boolean default true)`, security **invoker** (P4-121): it calls the module's own RPCs and the « Coordonnées » column update, so grants, RLS, guards, readiness and audit (source `import`, the person running it as actor) are the app's. A dry run writes everything and rolls it back (deferred checks included). Results `ok` / `skipped` (an email the clinic's professionals already use: re-runs are idempotent, P4-123) / `error` with every data error of the row under the client schemas' field names (P4-122). Permissions: `.manage`, `.matching`, `.view`, and `.activate_override` when the row asks to activate (« Dossier complété hors application », P4-124).
- **Script** `node scripts/import-professionals.mjs --file <csv> [--commit] [--url <api>]`: CSV in UTF-8 (comma or semicolon), keys rather than names; dry run by default; `--commit` dry-runs the whole file first and stops on any error; signs in **as the operator** (prompted on the terminal, never from files or the environment); a remote URL must be confirmed by typing its project reference; secret keys refused; a report (mode 600, one line per row, no personal data beyond the line number and email); interruptible between rows (P4-126 – P4-129).
- **Runbook:** [`docs/runbooks/import-professionals.md`](../runbooks/import-professionals.md) (CSV format, keys, legacy mapping trap `license` = image-rights consent, local trial, then the staging run, **Jonathan's go-ahead only**). Not imported in 4a: gender, address lines, public profile, availability, documents, compensation.

## Programme de reconnaissance (rétention)

The clinic's program (P4-180–P4-194, the plan's « The retention program »), in migration `20261008170703_professionals_compensation_private.sql`:

- **Grids.** One grid per profession title and period (`retention_grids`, with `retention_grid_tiers` and `retention_grid_prices`), seeded from 2026-07-01 with the clinic's eight grids. The retention starts at 28 % (Psychologie, Psychothérapie) or 30 % and drops by 0.5 point per 50 cumulative sessions, down to 25 %. A change is a new dated version (Paramètres → Rémunération). The professional's **primary** title picks the grid; without one, the professional reads « Profession à confirmer ».
- **Sessions.** `professional_session_counts`: one row per professional and month; a 50/60-minute session counts 1, a 30-minute one 0.5, and an adjustment carries an opening balance or a correction. The cumulative count is their sum, computed on read.
- **Applied rate.** `professional_retention`: dated decisions (« Taux de départ », « Appliquer la suggestion », « Maintenir », « Taux particulier »). The grid only suggests; staff decide. Status: « Écart à valider », « Conforme », « Palier maximum atteint », « Maintenu », « Taux particulier », « Profession à confirmer » (`private.retention_overview`). A « Taux particulier » or « Maintenu » is flagged again when the count reaches a new tier, except at the floor (Jonathan, P4-195). A decision counts through the month it was taken for (the reviewed month, or the record's current month), so what is applied is what was shown.
- **Pay.** Client price × (1 − retention), to the cent, in the database (`private.retention_pay_cents`), at the rate in force on the date read (what Facturation pays); a decision starting later shows as upcoming. « Ententes particulières » (`professional_client_agreements`) are fixed amounts for one client and duration; the retention does not apply to them. `client_id` waits for the Clients module (FK and backfill then); the client reference (file number or initials, never a full name) is redacted from the audit log (Loi 25).
- **Other kinds.** `compensation_rates`: « Ateliers et conférences » 25 %, « Annulation tardive » 30 %, « Autres frais » 15 %, per clinic, dated.
- **Pages.** The record's « Rémunération et fiscalité » → « Rétention »; « Révision mensuelle » (`/professionnels/revision-mensuelle`); Paramètres → Rémunération. Everything needs `professionals.compensation` (admin by default) and is internal: never shown to the professional (`professionals.self`). The notice email to the professional arrives with 4b (P4-191).

## Écarts par rapport à PS Hub

PS Hub (`NEW PS Hub`, read-only) settles uncertain choices (P4-39). Where this module differs, the reason is below.

- **List filters (4a.5, `lib/filters.ts`).**
  - `useProfessionalsFilters` follows `useCrmUrlState`: the URL is the source of truth, unknown values fall back to the defaults, and typing replaces the history entry.
  - Parameters are French (`statut`, `langue`, `surveiller`…), like the routes.
  - Each setter starts from the current URL, not the last render. PS Hub's setters copy the `searchParams` of their render, so two changes in one event lose the first one.
- **Remembered search and filters (4a.10, `lib/remembered-filters.ts`, `src/core/preferences/`).**
  - PS Hub's `useCrmUrlState` restores each user's last search and assignee filter through `usePersistedSearch`. It stores them per user in `user_search_preferences (user_id, page_key, search_state)`, and that table has RLS on the user's own rows.
  - We follow the same model: the core `user_preferences` table (migration `…_core_user_preferences.sql`), key `professionals.list_filters`, read and written only for the signed-in user. The filters come back when the same person signs in on any computer.
  - As in PS Hub: the URL wins over the saved filters, writes wait for a 1.5 s pause, a pending write goes out when the person leaves the list (and, here, when the page is hidden or unloaded), and only the filters a person chooses are saved (a link, Back or a page change is not).
  - Écart: PS Hub also keeps a copy in `localStorage`, tagged with the user id. We keep none (decision #10: reception computers are shared), so the server row is the only copy.
  - Écart: PS Hub upserts the table directly. Clients here only read it and write through `set_user_preference` / `delete_user_preference` (conventions §3). Clearing every filter deletes the row instead of saving an empty value.
  - Écart: each write names the user who made the change (`p_user_id`), and the database refuses it for any other session (HINT `user_mismatch`); the writer also drops what waits on a sign-out or a change of user. PS Hub takes the user from the session when the request goes out, so a debounced write can follow a sign-out onto the next person.
- **Record tabs (4a.11, P4-70):** as PS Hub's `useOpportunityUrlState`, a tab switch replaces the history entry, so Back leaves the record for the list.
- **Notification bell (Phase 3, P3-24):** PS Hub listens to Realtime on `notifications`; ours polls the count every 60 s while the tab is visible, and on a return to the tab once the count is older than 15 s (4a.20 walkthrough fix).
- **Fiche PDF (4c, P4-58):** follows PS Hub's `@react-pdf/renderer` base in the browser; contracts keep the server pdfmake renderer (ADR 0008).
- **Playwright (4a.0).** We follow PS Hub's `playwright.config.ts` and `e2e/fixtures/auth.ts` structure: the `e2e/` folder, Chromium only, a trace on first retry and a screenshot on failure, at the same version (1.58.1). We differ in four ways:
  - There is no remote Supabase URL fallback: the config refuses a `VITE_SUPABASE_URL` that is not local.
  - Tests sign in through the real login page instead of injecting a session.
  - The fixture refuses any origin but the e2e server's.
  - The e2e server runs on its own port (5190, `--strictPort`), because the shared 5173 server may be serving another worktree's code.

## Known follow-ups

- **Motif list (settled by P4-241).** The seeded catalogue is the clinic's website (13 categories, 124 motifs), neither legacy-v1 nor the untracked v2. Once 4a is on staging, a later change to the seeded list follows the **swap strategy**: upsert by key, archive what leaves (`is_active = false`), never delete; held motifs that become archived stay on records and drop out of matching and readiness until replaced.
- **Google Places** for addresses comes with Clients and is reused here then (P4-12).
- **Feminine title forms** for the fiche (P4-5), decided with 4c.5.
- **Recognition cap (P4-8):** `cap_basis` stays `unconfirmed` and nothing is computed until the accountant confirms the reading of « jusqu'à concurrence de 25 % ».
- **4b:** invitation links revoked on deactivation, the Auth ban on disable (4b.6), `professional_submission_private` in `pii_encrypted_values()`.
- **List cost at scale:** `professionals_list` aggregates the junctions over the whole clinic (5–7 ms for 200 professionals). Fine at ≤ 500 per clinic; with many more, move the aggregates into `lateral` subqueries bounded by the page and switch the page to `list_professionals` (`useProfessionalsPages` already wraps it, unused by any page today).
