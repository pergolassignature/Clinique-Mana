# 0004 — Secrets in Vault, sensitive data in encrypted private tables

**Status:** Accepted (secrets built; encrypted private tables built (`organization_bank_details`, Phase 2); professionals' `*_private` tables come with their module) · **Date:** 2026-10-06 · **Design:** [§3 Storage of settings](../plans/2026-10-06-foundation-rebuild-design.md#storage-of-settings) · **Conventions:** [§8](../standards/database-conventions.md#8-secrets-and-sensitive-data)

## Context
Integrations (Documenso, Resend, Google) need per-clinic API keys, and legacy kept some in code and docs. Professionals are contractors: the app will hold SIN/BN and bank details (Loi 25).

## Decision
- **Secrets** live in Supabase Vault, referenced by `org_secrets(org_id, key, vault_secret_id, version)`. Clients have no privilege on the table: they write with `set_org_secret`, delete with `delete_org_secret` and list key names with `list_org_secret_keys`. Only the service role reads values (`get_org_secret`), from edge functions. The UI is write-only (« Configurée ✓ / Remplacer »).
- Rotation bumps `version` and writes an explicit audit row; values and Vault ids never reach `audit_log`.
- **Sensitive non-secret data** goes in `*_private` tables with pgcrypto-encrypted columns (key from Vault), read only through audited RPCs, and redacted by `audit_trigger(...)` arguments.

## Consequences
- A leaked client session can overwrite a secret (with `settings.manage`) but never read one.
- Edge functions must resolve the org server-side before reading a secret.
- `get_org_secret` and the `org_secrets` Vault-delete trigger only touch the secret named `org:<org_id>:<key>`, so a forged `org_secrets` row cannot read or delete another secret (such as `pii_encryption_key`).
- RPC arguments carry secret values (`set_org_secret`) and personal data (`set_bank_details`): hosted logging of RPC parameters is unverified (review, « Not verified »). Settings to verify on staging, and keep off or short: `log_min_duration_statement`, `log_parameter_max_length`, `log_parameter_max_length_on_error`, `auto_explain.log_min_duration`, `auto_explain.log_parameter_max_length`, `pgaudit.log`, `pgaudit.log_parameter`.

## Encrypted private tables
Built in Phase 2 for `organization_bank_details` (conventions §8, « Encrypted columns »). One data key, the Vault secret `pii_encryption_key`, created by the migration if absent. pgcrypto (`pgp_sym_encrypt`, AES-256, S2K SHA-256) through `private.encrypt_pii` / `decrypt_pii`, SECURITY INVOKER and granted to no role. Vault encrypts the key with a root key kept outside the database: a dump alone reveals nothing, but **losing the key loses the data**.

### Before Phase 4 (SIN)
- [ ] **Key escrow runbook:** the owner exports `pii_encryption_key` into the clinic's password manager; restoring it (same name) comes before loading any data into a new or restored project.
- [ ] **Health check at deploy:** decrypt a known ciphertext (a fixed test value encrypted with the key) and fail the deploy if it does not round-trip.
- [ ] **Key versions:** a `key_version` column (or versioned secret names such as `pii_encryption_key_v2`) and a written re-encryption procedure, so the key can be rotated.
- [ ] **Prod → staging copies are undecryptable on purpose:** staging has its own key; copied encrypted columns stay unreadable there. Document it so nobody « fixes » it by copying the production key.
- [ ] **Dashboard warning:** never delete or edit the `pii_encryption_key` secret in the Supabase dashboard (Vault). Its description says so; the runbook must too.

## Alternatives
- **Environment variables per function:** not per org, and changing one needs a deploy.
- **Plain columns protected by RLS:** values readable by anyone with the permission and copied into the audit log.
