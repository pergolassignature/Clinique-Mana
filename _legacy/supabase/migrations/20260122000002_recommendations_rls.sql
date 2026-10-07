-- Migration: recommendations_rls
-- Module: recommendations
-- Gate: 2 - Row Level Security
-- Created: 2026-01-22

-- =============================================================================
-- ENABLE RLS
-- Default deny: no access unless explicitly granted via policies
-- =============================================================================

alter table public.recommendation_configs enable row level security;
alter table public.demande_recommendations enable row level security;
alter table public.recommendation_professional_details enable row level security;
alter table public.recommendation_audit_log enable row level security;

-- =============================================================================
-- RECOMMENDATION_CONFIGS POLICIES
-- Admin: full access (select, insert, update, delete)
-- Staff: read-only (select only)
-- Provider: no access
-- =============================================================================

-- Admin can read all configs
create policy "recommendation_configs_select_admin"
  on public.recommendation_configs for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all configs (for reference when viewing recommendations)
create policy "recommendation_configs_select_staff"
  on public.recommendation_configs for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can create new configs
create policy "recommendation_configs_insert_admin"
  on public.recommendation_configs for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Admin can update configs
create policy "recommendation_configs_update_admin"
  on public.recommendation_configs for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Admin can delete configs
create policy "recommendation_configs_delete_admin"
  on public.recommendation_configs for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- DEMANDE_RECOMMENDATIONS POLICIES
-- Admin/Staff: full access (select, insert, update, delete)
-- Provider: no access (to prevent bias in client assignment)
-- =============================================================================

-- Admin can read all recommendations
create policy "demande_recommendations_select_admin"
  on public.demande_recommendations for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all recommendations
create policy "demande_recommendations_select_staff"
  on public.demande_recommendations for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can create recommendations
create policy "demande_recommendations_insert_admin"
  on public.demande_recommendations for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can create recommendations
create policy "demande_recommendations_insert_staff"
  on public.demande_recommendations for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can update recommendations (e.g., mark as superseded)
create policy "demande_recommendations_update_admin"
  on public.demande_recommendations for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can update recommendations (e.g., mark as superseded)
create policy "demande_recommendations_update_staff"
  on public.demande_recommendations for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can delete recommendations
create policy "demande_recommendations_delete_admin"
  on public.demande_recommendations for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can delete recommendations
create policy "demande_recommendations_delete_staff"
  on public.demande_recommendations for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- RECOMMENDATION_PROFESSIONAL_DETAILS POLICIES
-- Admin/Staff: full access (select, insert, update, delete)
-- Provider: no access (contains sensitive scoring data)
-- =============================================================================

-- Admin can read all professional details
create policy "recommendation_professional_details_select_admin"
  on public.recommendation_professional_details for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all professional details
create policy "recommendation_professional_details_select_staff"
  on public.recommendation_professional_details for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can create professional details
create policy "recommendation_professional_details_insert_admin"
  on public.recommendation_professional_details for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can create professional details
create policy "recommendation_professional_details_insert_staff"
  on public.recommendation_professional_details for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can update professional details
create policy "recommendation_professional_details_update_admin"
  on public.recommendation_professional_details for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can update professional details
create policy "recommendation_professional_details_update_staff"
  on public.recommendation_professional_details for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can delete professional details
create policy "recommendation_professional_details_delete_admin"
  on public.recommendation_professional_details for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can delete professional details
create policy "recommendation_professional_details_delete_staff"
  on public.recommendation_professional_details for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- RECOMMENDATION_AUDIT_LOG POLICIES
-- Admin/Staff: read-only + insert for audit logging
-- Provider: no access
-- No updates or deletes allowed (append-only audit log)
-- =============================================================================

-- Admin can read audit logs
create policy "recommendation_audit_log_select_admin"
  on public.recommendation_audit_log for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read audit logs
create policy "recommendation_audit_log_select_staff"
  on public.recommendation_audit_log for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can create audit log entries
create policy "recommendation_audit_log_insert_admin"
  on public.recommendation_audit_log for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can create audit log entries
create policy "recommendation_audit_log_insert_staff"
  on public.recommendation_audit_log for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- No UPDATE/DELETE policies for audit log (append-only)

-- =============================================================================
-- REVOKE ANON ACCESS
-- Recommendations contain sensitive matching data - no anonymous access
-- =============================================================================

revoke all on public.recommendation_configs from anon;
revoke all on public.demande_recommendations from anon;
revoke all on public.recommendation_professional_details from anon;
revoke all on public.recommendation_audit_log from anon;
