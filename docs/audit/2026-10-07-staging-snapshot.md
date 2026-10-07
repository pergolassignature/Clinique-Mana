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

---

## Reset to the foundation baseline — 2026-10-07 (Task 1.21)

Done with Jonathan's explicit go-ahead.

| Step | Result |
|---|---|
| Cron | `check-insurance-expiry-daily` unscheduled; the reset then removed the `pg_cron` extension (re-added by migration when Phase 4 needs it) |
| Database | `supabase db reset --linked --no-seed`; migrations `20261007140517`, `…140623`, `…140741`, `…140859` applied (local = remote) |
| Auth users | Legacy test users removed by the reset (`auth` tables truncated) |
| Edge functions | All 13 legacy functions deleted (none remain) |
| Vault | Empty (no legacy secret) |
| Function secrets removed | `DOCUSEAL_API_KEY`, `ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY` |
| Function secrets kept | `GOOGLE_PLACES_API_KEY`, `GOOGLE_OAUTH_*` (to be reused by later modules), built-in `SUPABASE_*` |
| Storage | Bucket `professional-documents` (39 legacy test files) **kept**, not covered by the backup; it has no storage policy left, so clients cannot read it. Delete it when no longer wanted. |
| Advisors (security) | No error. 1 INFO (`org_secrets` has RLS and no policy — intended) and 7 WARN (the intended public RPCs callable by signed-in users; each checks its permission first) |

**Auth settings (dashboard):** Site URL `https://clinique-mana.vercel.app`; redirect URLs `https://clinique-mana.vercel.app/**` and `https://clinique-mana-*-pergolas-signature.vercel.app/**`; sign-ups off; email provider on; email confirmation on; secure email change on; secure password change on; leaked-password protection on; minimum password length 10; refresh-token reuse detection on, interval 10 s.

**SMTP:** Resend account « cliniquemana », domain `gestion.cliniquemana.com` verified (DNS on Cloudflare), sender `no-reply@gestion.cliniquemana.com` « Clinique MANA », `smtp.resend.com:465`, user `resend`, password = a sending-only API key restricted to that domain (entered by Jonathan).

**Admin:** Jonathan's account created in the dashboard, then `scripts/bootstrap-admin.sql` → organization « Clinique MANA », role `admin`, module `professionals` enabled (4 audit rows tagged `bootstrap`). First sign-in on the Vercel preview succeeded.

**Vercel:** Node 22.x; preview of PR #1 built and serves deep links (`vercel.json`).

**Smoke test on the preview (staging data):** Jonathan's admin sign-in ✅ · menu Accueil / Professionnels / Paramètres ✅ · module Professionnels off → disappears from the menu, back on ✅ · explicit sign-out ✅ · « Mot de passe oublié » → Resend shows « Reset Your Password » **Delivered** to Jonathan's address ✅.

**Still to verify:** Secure email change needs both addresses (plan Task 1.21 Step 10). The auth emails still use Supabase's default English templates (French templates: Phase 3, or earlier in the dashboard).

**Custom domain (2026-10-07, with Jonathan's go-ahead):** Cloudflare CNAME `app.cliniquemana.com` → `cname.vercel-dns.com` (DNS only) created by Jonathan; Vercel serves the app there with a valid certificate. `_dmarc.cliniquemana.com` fixed by Jonathan. Supabase Site URL changed to `https://app.cliniquemana.com`, and `https://app.cliniquemana.com/**` added to the redirect URLs (the two Vercel patterns are kept for previews). Verified after a reload of the dashboard.
