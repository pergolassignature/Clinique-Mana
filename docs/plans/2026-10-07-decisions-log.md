# Decisions made during autonomous execution (2026-10-07)

Jonathan asked for the work to continue without questions until a local version is ready to test. These are the choices made along the way. Each one can be reversed; ask if one doesn't fit.

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Local Supabase ports | Clinique MANA runs on **553xx** (API 55321, DB 55322, Studio 55323, Mailpit 55324) | PS Hub's local stack already uses 543xx; both can run side by side. |
| 2 | Code identifiers | English everywhere in code (`professionals`); French only for URLs and labels (`/professionnels`, « Professionnels ») | Removes the `professionnels`/`professionals` mix that would cause bugs (schema review I6). |
| 3 | Roles | Stored in a `roles` table (admin, staff, provider), not a Postgres enum | Adding « conseillère » / « adjointe administrative » later becomes a simple insert. |
| 4 | Role labels (placeholders) | « Administrateur », « Personnel administratif », « Professionnel » | The conseillère vs adjointe split is still open (business context §2). |
| 5 | Module enablement | A disabled module also blocks its permissions **in the database** (`has_permission`), not just in the menu | Defence in depth; every future module gets it automatically. |
| 6 | Email login config | `[auth.email] enable_signup = true` (enables the email provider); sign-ups stay closed via `[auth] enable_signup = false` | In the CLI, the `[auth.email]` flag turns off password login entirely. |
| 7 | Email change | `double_confirm_changes = true`; whether both addresses must confirm is to be verified on staging (Task 1.21) | Locally, autoconfirm let the new-address link alone complete the change. |
| 8 | Fast-refresh lint warnings | Accepted (provider files also export their context/hook, as in PS Hub) | Warnings only; splitting files adds indirection for no runtime benefit. |
| 9 | Magic link | Unknown emails get the same "link sent" message (422 "signups not allowed" treated as success) | Never reveal whether an account exists. |
