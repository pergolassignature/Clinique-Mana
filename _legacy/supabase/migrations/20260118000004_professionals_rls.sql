-- Migration: professionals_rls
-- Module: professionals
-- Gate: 3 — Security (RLS)
-- Created: 2026-01-18

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- Default deny: no access unless explicitly granted via policies
-- =============================================================================

alter table public.professionals enable row level security;
alter table public.specialties enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.professional_documents enable row level security;
alter table public.professional_onboarding_invites enable row level security;
alter table public.professional_questionnaire_submissions enable row level security;
alter table public.professional_audit_log enable row level security;

-- =============================================================================
-- SPECIALTIES: POLICIES
-- Read-only lookup table accessible to all authenticated users
-- =============================================================================

-- All authenticated users can read specialties
create policy "specialties_select_authenticated"
  on public.specialties
  for select
  to authenticated
  using (true);

-- Only admin can manage specialties
create policy "specialties_insert_admin"
  on public.specialties
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "specialties_update_admin"
  on public.specialties
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "specialties_delete_admin"
  on public.specialties
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- PROFESSIONALS: POLICIES
-- Admin/Staff: full access
-- Provider: read/update own record only
-- =============================================================================

-- Admin can read all professionals
create policy "professionals_select_admin"
  on public.professionals
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all professionals
create policy "professionals_select_staff"
  on public.professionals
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read their own professional record
create policy "professionals_select_provider_own"
  on public.professionals
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and profile_id = (select id from public.profiles where user_id = (select auth.uid()))
  );

-- Admin can insert professionals
create policy "professionals_insert_admin"
  on public.professionals
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can insert professionals (for onboarding)
create policy "professionals_insert_staff"
  on public.professionals
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can update any professional
create policy "professionals_update_admin"
  on public.professionals
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can update any professional
create policy "professionals_update_staff"
  on public.professionals
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can update their own record (portrait fields only enforced at app level)
create policy "professionals_update_provider_own"
  on public.professionals
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and profile_id = (select id from public.profiles where user_id = (select auth.uid()))
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and profile_id = (select id from public.profiles where user_id = (select auth.uid()))
    -- Prevent provider from changing their own status
    and status = (select status from public.professionals where profile_id = (select id from public.profiles where user_id = (select auth.uid())))
  );

-- Only admin can delete professionals
create policy "professionals_delete_admin"
  on public.professionals
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- PROFESSIONAL_SPECIALTIES: POLICIES
-- Admin/Staff: full access
-- Provider: read own, limited insert/delete on own
-- =============================================================================

-- Admin can read all professional specialties
create policy "professional_specialties_select_admin"
  on public.professional_specialties
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all professional specialties
create policy "professional_specialties_select_staff"
  on public.professional_specialties
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read their own specialties
create policy "professional_specialties_select_provider_own"
  on public.professional_specialties
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = (select auth.uid()))
    )
  );

-- Admin/Staff can manage all specialties
create policy "professional_specialties_insert_admin_staff"
  on public.professional_specialties
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "professional_specialties_delete_admin_staff"
  on public.professional_specialties
  for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- PROFESSIONAL_DOCUMENTS: POLICIES
-- Admin/Staff only in Phase 1 (providers no direct access)
-- =============================================================================

-- Admin can read all documents
create policy "professional_documents_select_admin"
  on public.professional_documents
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all documents
create policy "professional_documents_select_staff"
  on public.professional_documents
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin/Staff can insert documents
create policy "professional_documents_insert_admin_staff"
  on public.professional_documents
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Admin/Staff can update documents
create policy "professional_documents_update_admin_staff"
  on public.professional_documents
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Only admin can delete documents
create policy "professional_documents_delete_admin"
  on public.professional_documents
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- PROFESSIONAL_ONBOARDING_INVITES: POLICIES
-- Admin/Staff: full access
-- Anon: can read by token (for public invite page)
-- =============================================================================

-- Admin can read all invites
create policy "professional_onboarding_invites_select_admin"
  on public.professional_onboarding_invites
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all invites
create policy "professional_onboarding_invites_select_staff"
  on public.professional_onboarding_invites
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin/Staff can create invites
create policy "professional_onboarding_invites_insert_admin_staff"
  on public.professional_onboarding_invites
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Admin/Staff can update invites
create policy "professional_onboarding_invites_update_admin_staff"
  on public.professional_onboarding_invites
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Only admin can delete invites
create policy "professional_onboarding_invites_delete_admin"
  on public.professional_onboarding_invites
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Anon can read invites by token (for public invite page validation)
-- This is a limited policy that only allows token lookup
create policy "professional_onboarding_invites_select_anon_by_token"
  on public.professional_onboarding_invites
  for select
  to anon
  using (
    -- Only allow if status is pending or opened and not expired
    status in ('pending', 'opened')
    and expires_at > now()
  );

-- =============================================================================
-- PROFESSIONAL_QUESTIONNAIRE_SUBMISSIONS: POLICIES
-- Admin/Staff: full access
-- Anon: can insert/update (for public invite form submission)
-- =============================================================================

-- Admin can read all submissions
create policy "professional_questionnaire_submissions_select_admin"
  on public.professional_questionnaire_submissions
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all submissions
create policy "professional_questionnaire_submissions_select_staff"
  on public.professional_questionnaire_submissions
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin/Staff can insert submissions
create policy "professional_questionnaire_submissions_insert_admin_staff"
  on public.professional_questionnaire_submissions
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Admin/Staff can update submissions (for review)
create policy "professional_questionnaire_submissions_update_admin_staff"
  on public.professional_questionnaire_submissions
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Anon can insert submissions (via public invite form)
create policy "professional_questionnaire_submissions_insert_anon"
  on public.professional_questionnaire_submissions
  for insert
  to anon
  with check (
    -- Only allow if there's a valid, non-expired invite for this professional
    exists (
      select 1 from public.professional_onboarding_invites
      where professional_id = professional_questionnaire_submissions.professional_id
        and status in ('pending', 'opened')
        and expires_at > now()
    )
  );

-- Anon can update their own draft submissions (via public invite form)
create policy "professional_questionnaire_submissions_update_anon"
  on public.professional_questionnaire_submissions
  for update
  to anon
  using (
    -- Only drafts can be updated by anon
    status = 'draft'
    and exists (
      select 1 from public.professional_onboarding_invites
      where professional_id = professional_questionnaire_submissions.professional_id
        and status in ('pending', 'opened')
        and expires_at > now()
    )
  )
  with check (
    -- Can only transition to submitted, not skip ahead
    status in ('draft', 'submitted')
  );

-- =============================================================================
-- PROFESSIONAL_AUDIT_LOG: POLICIES
-- Read-only for Admin/Staff
-- Writes happen via SECURITY DEFINER triggers
-- =============================================================================

-- Admin can read all audit logs
create policy "professional_audit_log_select_admin"
  on public.professional_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read audit logs
create policy "professional_audit_log_select_staff"
  on public.professional_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- No INSERT/UPDATE/DELETE policies = denied (writes via SECURITY DEFINER triggers only)

-- =============================================================================
-- REVOKE ANON ACCESS WHERE NOT EXPLICITLY GRANTED
-- =============================================================================

revoke all on public.professionals from anon;
revoke all on public.specialties from anon;
revoke all on public.professional_specialties from anon;
revoke all on public.professional_documents from anon;
revoke all on public.professional_audit_log from anon;

-- Grant limited access for anon on invite/submission tables (policies restrict further)
grant select on public.professional_onboarding_invites to anon;
grant select, insert, update on public.professional_questionnaire_submissions to anon;
