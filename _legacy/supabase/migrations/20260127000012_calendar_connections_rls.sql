-- =============================================================================
-- EXTERNAL CALENDAR CONNECTIONS RLS POLICIES
-- Module: calendar-integration
-- Description: Row-level security for calendar connections and busy blocks
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

ALTER TABLE public.professional_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_busy_blocks ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- PROFESSIONAL_CALENDAR_CONNECTIONS: POLICIES
-- Read: Admin/Staff can read all, Provider can read own
-- Write: Service role only (via Edge Functions)
-- =============================================================================

-- Admin can read all connections
CREATE POLICY "calendar_connections_select_admin"
  ON public.professional_calendar_connections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'admin'
  );

-- Staff can read all connections
CREATE POLICY "calendar_connections_select_staff"
  ON public.professional_calendar_connections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'staff'
  );

-- Provider can read their own connection
CREATE POLICY "calendar_connections_select_provider_own"
  ON public.professional_calendar_connections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'provider'
    AND professional_id = (
      SELECT p.id
      FROM public.professionals p
      JOIN public.profiles pr ON p.profile_id = pr.id
      WHERE pr.user_id = (SELECT auth.uid())
    )
  );

-- No direct INSERT/UPDATE/DELETE policies for authenticated users
-- All write operations go through Edge Functions with service role key
-- This protects OAuth tokens from client-side manipulation

COMMENT ON TABLE public.professional_calendar_connections IS
  'OAuth connections are read-only from client. Write operations use service role via Edge Functions.';


-- =============================================================================
-- CALENDAR_BUSY_BLOCKS: POLICIES
-- Read: Admin/Staff can read all, Provider can read own
-- Write: Service role only (via Edge Functions during sync)
-- =============================================================================

-- Admin can read all busy blocks
CREATE POLICY "calendar_busy_blocks_select_admin"
  ON public.calendar_busy_blocks
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'admin'
  );

-- Staff can read all busy blocks
CREATE POLICY "calendar_busy_blocks_select_staff"
  ON public.calendar_busy_blocks
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'staff'
  );

-- Provider can read their own busy blocks
CREATE POLICY "calendar_busy_blocks_select_provider_own"
  ON public.calendar_busy_blocks
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'provider'
    AND professional_id = (
      SELECT p.id
      FROM public.professionals p
      JOIN public.profiles pr ON p.profile_id = pr.id
      WHERE pr.user_id = (SELECT auth.uid())
    )
  );

-- No direct INSERT/UPDATE/DELETE policies for authenticated users
-- All write operations go through Edge Functions with service role key

COMMENT ON TABLE public.calendar_busy_blocks IS
  'Busy blocks are read-only from client. Sync operations use service role via Edge Functions.';


-- =============================================================================
-- REVOKE DIRECT WRITE ACCESS
-- Explicit revocation to ensure only service role can write
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.professional_calendar_connections FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.calendar_busy_blocks FROM authenticated;

REVOKE ALL ON public.professional_calendar_connections FROM anon;
REVOKE ALL ON public.calendar_busy_blocks FROM anon;
