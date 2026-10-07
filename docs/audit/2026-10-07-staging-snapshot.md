# Staging snapshot before the foundation reset

**Project:** `vnmbjbdsjxmpijyjmmkh` (clinique-mana-staging) · **Taken:** 2026-10-07 · **Legacy code:** tag `legacy-v1`

## Backups (outside the repo)

`/Users/jonathanharvey/Documents/Claude Projects/clinique-mana-backups/`

| File | Content |
|---|---|
| `2026-10-07-staging-schema.sql` | Full schema (320 KB) |
| `2026-10-07-staging-data.sql` | Data only (886 KB) |
| `2026-10-07-staging-roles.sql` | Custom roles |

## Live state not visible in migrations

**Auth users:** 10.

**Storage:** bucket `professional-documents` (private, 10 MB, pdf/jpeg/png/webp/doc/docx) with 39 objects.

**Cron jobs (created by hand, not in any migration):**

| Job | Schedule | Command |
|---|---|---|
| `check-insurance-expiry-daily` | `0 6 * * *` | `select public.deactivate_professionals_with_expired_insurance();` |

**Edge functions deployed (13), all `verify_jwt = false`:** google-places-autocomplete, google-places-details, create-professional, google-calendar-auth-url, google-calendar-callback, google-calendar-sync, google-calendar-disconnect, **sign-contract**, **get-contract**, docuseal-create-submission, docuseal-get-submission, docuseal-webhook, docuseal-create-template.
`sign-contract` and `get-contract` are deployed but not in the repo; `send-contract-email` is in the repo but not deployed.

**Table grants to `anon` (security finding):** the anonymous role holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on 22 public tables / views:
client_relations, client_relations_expanded (view), demande_audit_log, demande_motifs, demande_participants, demandes, document_instances, document_templates, motif_categories, motifs, profession_categories, profession_category_rates, profession_titles, professional_motifs, professional_onboarding_invites, professional_professions, professional_questionnaire_submissions, professional_services, service_contracts, service_prices, services, tax_rates — plus `INSERT` on professional_documents.
RLS limits most of these, but `client_relations` had an "any authenticated, all operations" policy and the view `client_relations_expanded` does not enforce RLS by default. `TRUNCATE` bypasses RLS entirely. This confirms the inventory's security findings.

**Lessons applied in the rebuild:** every table revokes `anon` explicitly; cron schedules live in migrations; every edge function is in the repo and deployed by CI only.
