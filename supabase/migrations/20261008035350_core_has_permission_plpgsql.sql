-- =============================================================================
-- has_permission as plpgsql (Task 3.1 review follow-up)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.1 (P3-21)
-- Rules:   docs/standards/database-conventions.md §5
--
-- Key choices
-- * A SECURITY DEFINER `language sql` function is never inlined, so every call paid the
--   SQL-function executor (about 8× slower per call than before Task 3.1). plpgsql caches
--   its plan. Semantics, signature, grants, `stable`, `security definer` and
--   `search_path = ''` are unchanged (create or replace keeps the grants).
-- * Corrects the 3.1 header comment: in a policy, the one-per-statement form is
--     `col = any ((select private.current_permission_keys())::text[])`
--   The cast is required: without it `= any ((select …))` parses as `= any (subquery)`,
--   which compares the column with each row (a text[]): « operator does not exist:
--   text = text[] ». With the cast it is an array, evaluated once as an InitPlan.
-- =============================================================================

create or replace function private.has_permission(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(p_key = any (private.current_permission_keys()), false);
end;
$$;
