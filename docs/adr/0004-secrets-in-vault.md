# 0004 — Secrets in Vault, sensitive data in encrypted private tables

**Status:** Accepted (secrets built; encrypted private tables built (`organization_bank_details`, Phase 2); key versions, canary and deploy health check built (Phase 4, Task 4a.16); professionals' `*_private` tables come with their module) · **Date:** 2026-10-06 · **Design:** [§3 Storage of settings](../plans/2026-10-06-foundation-rebuild-design.md#storage-of-settings) · **Conventions:** [§8](../standards/database-conventions.md#8-secrets-and-sensitive-data)

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
- **`service_role` is inside the PII key's trust boundary.** Supabase grants it `select` on `vault.decrypted_secrets` and `vault.secrets`, `delete` on `vault.secrets`, and `execute` on `vault.create_secret` and `vault.update_secret` (checked locally, Vault 0.3.1; also on the internal `vault._crypto_aead_det_decrypt`). The `vault` schema is not exposed by the Data API, so the service-role key alone cannot reach them over REST, but any SQL that runs as `service_role` (a direct connection that sets the role, a function it can call) can read, replace or delete the key. Our own grants keep the PII helpers, `pii_canary` and `pii_health_check` away from it; Vault's defaults do not, so the service-role key and the database password are guarded like the key itself.
- RPC arguments carry secret values (`set_org_secret`) and personal data (`set_bank_details`): hosted logging of RPC parameters is unverified (review, « Not verified »). Settings to verify on staging, and keep off or short: `log_min_duration_statement`, `log_parameter_max_length`, `log_parameter_max_length_on_error`, `auto_explain.log_min_duration`, `auto_explain.log_parameter_max_length`, `pgaudit.log`, `pgaudit.log_parameter`. The check (SQL and expected values) is a Phase 4 « Mise en service » item in [the status](../plans/2026-10-07-status.md), to do before any real SIN or bank number.

## Encrypted private tables
Built in Phase 2 for `organization_bank_details` (conventions §8, « Encrypted columns »). One data key, the Vault secret `pii_encryption_key`, created by the migration if absent. pgcrypto (`pgp_sym_encrypt`, AES-256, S2K SHA-256) through `private.encrypt_pii` / `decrypt_pii`, SECURITY INVOKER and granted to no role. Vault encrypts the key with a root key kept outside the database: a dump alone reveals nothing, but **losing the key loses the data**.

### Before Phase 4 (SIN)
Built in Phase 4, Task 4a.16 (migration `…_core_pii_key_versions.sql`, pgTAP `047`). The escrow itself, on each environment, is the owner's: Phase 4 « Mise en service » in [the status](../plans/2026-10-07-status.md).
- [x] **Key escrow runbook:** the owner exports `pii_encryption_key` into the clinic's password manager; restoring it (same name) comes before loading any data into a new or restored project. → [`pii-key-escrow.md`](../runbooks/pii-key-escrow.md)
- [x] **Health check after each deploy, and daily:** decrypt a known ciphertext (a fixed test value encrypted with the key) and raise an alarm if it does not round-trip. → `private.pii_canary` + `public.pii_health_check()` (granted to no role; `postgres`, its owner, runs it), which also returns false when a key version that holds data has no key or no canary (`private.pii_key_versions_in_use()`), or when any stored value does not decrypt with its row's version (a full scan of `private.pii_encrypted_values()`: a canary only proves its own key, so data copied or restored from another project is caught too; staging shows red while it holds production copies, on purpose). It does **not** fail or stop the deploy: it turns the « Apply Supabase migrations » job red (step « PII key health check », after the push and the drift check, read-only) and runs again every day (`.github/workflows/pii-health.yml`). It is an alarm, not a gate: migrations are already applied when it runs, and Vercel deploys the app regardless. The red job, its step summary and GitHub's failure e-mail send the owner to the escrow runbook before any SIN or bank number is entered.
- [x] **Key versions:** a `key_version` column (or versioned secret names such as `pii_encryption_key_v2`) and a written re-encryption procedure, so the key can be rotated. → both: `pii_encryption_key_v<n>` and a `key_version` per row; [`pii-key-rotation.md`](../runbooks/pii-key-rotation.md)
- [x] **Prod → staging copies are undecryptable on purpose:** staging has its own key; copied encrypted columns stay unreadable there. Document it so nobody « fixes » it by copying the production key. → escrow runbook, « Staging et production »
- [x] **Dashboard warning:** never delete or edit the `pii_encryption_key` secret in the Supabase dashboard (Vault). Its description says so; the runbook must too. → escrow runbook, « Ne jamais supprimer ni modifier ce secret »

## Alternatives
- **Environment variables per function:** not per org, and changing one needs a deploy.
- **Plain columns protected by RLS:** values readable by anyone with the permission and copied into the audit log.
