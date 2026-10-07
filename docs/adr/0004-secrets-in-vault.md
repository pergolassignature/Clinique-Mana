# 0004 — Secrets in Vault, sensitive data in encrypted private tables

**Status:** Accepted (secrets built; `*_private` tables come with their modules) · **Date:** 2026-10-06 · **Design:** [§3 Storage of settings](../plans/2026-10-06-foundation-rebuild-design.md#storage-of-settings) · **Conventions:** [§8](../standards/database-conventions.md#8-secrets-and-sensitive-data)

## Context
Integrations (Documenso, Resend, Google) need per-clinic API keys, and legacy kept some in code and docs. Professionals are contractors: the app will hold SIN/BN and bank details (Loi 25).

## Decision
- **Secrets** live in Supabase Vault, referenced by `org_secrets(org_id, key, vault_secret_id, version)`. Clients have no privilege on the table: they write with `set_org_secret`, delete with `delete_org_secret` and list key names with `list_org_secret_keys`. Only the service role reads values (`get_org_secret`), from edge functions. The UI is write-only (« Configurée ✓ / Remplacer »).
- Rotation bumps `version` and writes an explicit audit row; values and Vault ids never reach `audit_log`.
- **Sensitive non-secret data** goes in `*_private` tables with pgcrypto-encrypted columns (key from Vault), read only through audited RPCs, and redacted by `audit_trigger(...)` arguments.

## Consequences
- A leaked client session can overwrite a secret (with `settings.manage`) but never read one.
- Edge functions must resolve the org server-side before reading a secret.
- RPC arguments carry secret values: hosted logging of RPC parameters is unverified (review, « Not verified »).

## Alternatives
- **Environment variables per function:** not per org, and changing one needs a deploy.
- **Plain columns protected by RLS:** values readable by anyone with the permission and copied into the audit log.
