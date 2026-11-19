-- =============================================================================
-- Communications: « Réécrire une sélection » is its own kind in the AI usage log (CM-29)
-- =============================================================================
-- The composer's selection bubble (PS Hub's, `@pergolas-signature/email-ui`) rewrites only the
-- selected passage: `communications-draft` gains a `rewrite` mode, and each call is recorded in
-- `ai_requests` without its text, like the others (CM-20). The kind check took write, reply and
-- refine only; a rewrite logged as one of them would misstate the usage log.
-- Needs:   *_communications_ai_draft.sql (the table, `record_ai_request_for_service`).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Key choices
-- * **One more value in the check, nothing else.** No column, no function change: the record
--   function already takes the kind as text, and the month's spending already sums every kind.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:communications_ai_rewrite', true);

alter table public.ai_requests
  drop constraint ai_requests_kind_check;
alter table public.ai_requests
  add constraint ai_requests_kind_check check (kind in ('write', 'reply', 'refine', 'rewrite'));

select pg_catalog.set_config('app.audit_source', '', true);
