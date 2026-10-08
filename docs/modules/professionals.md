# Module `professionals`

The module « Professionnels » is registered as an empty placeholder: migration `20261007140859_professionals_module.sql` adds its registry row (`modules.key = 'professionals'`, no dependency besides core) and its only permission, `professionals.view` (by default: Administrateur, Conseillère and Adjointe administrative; migration `20261007192359_core_roles_split.sql` gives it to the two roles that replaced `staff`), and `src/modules/professionals/manifest.ts` declares the nav item and the `/professionnels` route, both gated on `professionals.view`, with no settings section yet. It owns no table yet: its tables, RPCs and screens arrive in Phase 4, which starts by marking every item of the [legacy inventory §A](../plans/2026-10-06-legacy-feature-inventory.md#a-professionnels-incl-onboarding-documents-contrats-spécialités-motifs) Keep / Change / Drop against the [design §5](../plans/2026-10-06-foundation-rebuild-design.md#5-module-1--professionnels).

## Deactivation and the provider's account (P4-11)

Migration `20261008100634_professionals_lifecycle.sql` (Task 4a.4) links a professional's status to their login account.

- **Disabling.** `deactivate_professional` with a reason marked `disables_account` (« Fin de collaboration ») disables the provider's profile the way `set_user_status` does: status `disabled`, then their `auth.sessions` are deleted. It acts only on an active profile holding the role `provider`. When it did, the professional keeps `deactivation_disabled_account = true`: the module owns that disable.
- **Re-enabling.** `activate_professional` re-enables the account only when `deactivation_disabled_account` is true. An account disabled before the deactivation, by someone else, stays disabled.
- **A change made elsewhere ends the module's claim.** Any other change of the profile's status (`set_user_status` in « Utilisateurs », or by hand) clears `deactivation_disabled_account`, through the trigger `profiles_release_professional_account`. Example: the adjointe deactivates with « Fin de collaboration », an admin re-enables the account, then disables it again. Reactivating the professional now leaves the account disabled, and `account_change` is null. The module's own changes run with the transaction-local setting `app.professionals_account_status = 'on'`, which the trigger skips; `private.set_provider_account_status` puts the previous value back on every path, errors included.
- **Écart from « Utilisateurs ».** `set_user_status` lets only an admin re-enable an account. Here, an adjointe (`professionals.manage`) who reactivates a professional re-enables the account the module itself disabled with that professional. It is the same decision undone, not a new access: an account an admin disabled separately is never re-enabled this way.

## Readiness and archived reference rows

« Profil de jumelage complet » (`professionals_readiness`, `get_professional_readiness`) counts only active reference rows: titles, motifs, clientèles and languages. Matching ignores archived rows, so a professional whose only clientèle was archived is incomplete again (`missing` holds `clientele`). An archived title is neither a profession nor a missing licence, and an archived restricted motif requires no regulated title.

## Programme de reconnaissance (rétention)

The clinic's program (P4-180–P4-194, the plan's « The retention program »), in migration `20261008170703_professionals_compensation_private.sql`:

- **Grids.** One grid per profession title and period (`retention_grids`, with `retention_grid_tiers` and `retention_grid_prices`), seeded from 2026-07-01 with the clinic's eight grids. The retention starts at 28 % (Psychologie, Psychothérapie) or 30 % and drops by 0.5 point per 50 cumulative sessions, down to 25 %. A change is a new dated version (Paramètres → Rémunération). The professional's **primary** title picks the grid; without one, the professional reads « Profession à confirmer ».
- **Sessions.** `professional_session_counts`: one row per professional and month; a 50/60-minute session counts 1, a 30-minute one 0.5, and an adjustment carries an opening balance or a correction. The cumulative count is their sum, computed on read.
- **Applied rate.** `professional_retention`: dated decisions (« Taux de départ », « Appliquer la suggestion », « Maintenir », « Taux particulier »). The grid only suggests; staff decide. Status: « Écart à valider », « Conforme », « Palier maximum atteint », « Maintenu », « Taux particulier », « Profession à confirmer » (`private.retention_overview`).
- **Pay.** Client price × (1 − retention), to the cent, in the database (`private.retention_pay_cents`). « Ententes particulières » (`professional_client_agreements`) are fixed amounts for one client and duration; the retention does not apply to them. `client_id` waits for the Clients module (FK and backfill then).
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
- **Playwright (4a.0).** We follow PS Hub's `playwright.config.ts` and `e2e/fixtures/auth.ts` structure: the `e2e/` folder, Chromium only, a trace on first retry and a screenshot on failure, at the same version (1.58.1). We differ in four ways:
  - There is no remote Supabase URL fallback: the config refuses a `VITE_SUPABASE_URL` that is not local.
  - Tests sign in through the real login page instead of injecting a session.
  - The fixture refuses any origin but the e2e server's.
  - The e2e server runs on its own port (5190, `--strictPort`), because the shared 5173 server may be serving another worktree's code.
