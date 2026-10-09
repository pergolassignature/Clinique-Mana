-- Core: drops functions that nothing calls any more (pre-launch cleanup).
--
-- * public.count_org_emails_today(uuid) (*_core_email.sql, service role only): it was to feed
--   the 80 % warning of the daily email quota. The quota is counted by the rate limit
--   `emails.org_day` instead (_shared/email/send.ts reports `email_daily_80_percent` on its hit),
--   so no function, job or client calls it.
-- * The one-argument PII helpers private.pii_key(), private.encrypt_pii(text) and
--   private.decrypt_pii(bytea) (*_core_bank_details.sql, version 1 since
--   *_core_pii_key_versions.sql): kept « for compatibility » with Phase 2 callers, which all pass
--   a key version now. Granted to no role; a caller would break once version 1 is retired.
--
-- Nothing reads them (functions, views, policies, triggers, scheduled_jobs, edge functions, the
-- app), so dropping them changes no behaviour.

drop function public.count_org_emails_today(uuid);

drop function private.pii_key();
drop function private.encrypt_pii(text);
drop function private.decrypt_pii(bytea);
