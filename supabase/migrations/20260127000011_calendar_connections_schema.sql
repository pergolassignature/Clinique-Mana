-- =============================================================================
-- EXTERNAL CALENDAR CONNECTIONS SCHEMA
-- Module: calendar-integration
-- Description: Stores OAuth connections and cached busy blocks from external calendars
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: professional_calendar_connections
-- Stores OAuth tokens and connection metadata for external calendars
-- One professional can have at most one calendar connection (unique constraint)
-- -----------------------------------------------------------------------------

CREATE TABLE public.professional_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID UNIQUE NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,

  -- Provider identification
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'calendly')),
  provider_email TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',

  -- OAuth tokens (encrypted with AES-256-GCM, stored as bytea)
  access_token_encrypted BYTEA NOT NULL,
  refresh_token_encrypted BYTEA NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/calendar.readonly'],

  -- Sync state
  sync_token TEXT,
  last_synced_at TIMESTAMPTZ,

  -- Connection status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  last_error TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX professional_calendar_connections_professional_idx
  ON public.professional_calendar_connections(professional_id);

CREATE INDEX professional_calendar_connections_status_idx
  ON public.professional_calendar_connections(status);

CREATE INDEX professional_calendar_connections_expires_idx
  ON public.professional_calendar_connections(token_expires_at)
  WHERE status = 'active';

-- Comments
COMMENT ON TABLE public.professional_calendar_connections IS
  'OAuth connections to external calendars (Google, Microsoft, Calendly) for professionals';

COMMENT ON COLUMN public.professional_calendar_connections.access_token_encrypted IS
  'AES-256-GCM encrypted OAuth access token';

COMMENT ON COLUMN public.professional_calendar_connections.refresh_token_encrypted IS
  'AES-256-GCM encrypted OAuth refresh token';

COMMENT ON COLUMN public.professional_calendar_connections.sync_token IS
  'Incremental sync token from provider (e.g., Google nextSyncToken)';

COMMENT ON COLUMN public.professional_calendar_connections.status IS
  'Connection status: active, expired (needs reconnect), revoked (user revoked access), error (API errors)';

-- Updated_at trigger
CREATE TRIGGER professional_calendar_connections_set_updated_at
  BEFORE UPDATE ON public.professional_calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- TABLE: calendar_busy_blocks
-- Cached busy time blocks from external calendars
-- Privacy-safe: stores only duration, no event details
-- -----------------------------------------------------------------------------

CREATE TABLE public.calendar_busy_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.professional_calendar_connections(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,

  -- Time boundaries (stored as UTC)
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'google_calendar',
  external_event_id TEXT,

  -- Sync metadata
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraint: end_time must be after start_time
  CONSTRAINT calendar_busy_blocks_time_check CHECK (end_time > start_time)
);

-- Indexes
CREATE INDEX calendar_busy_blocks_professional_idx
  ON public.calendar_busy_blocks(professional_id);

CREATE INDEX calendar_busy_blocks_connection_idx
  ON public.calendar_busy_blocks(connection_id);

CREATE INDEX calendar_busy_blocks_time_range_idx
  ON public.calendar_busy_blocks(professional_id, start_time, end_time);

CREATE INDEX calendar_busy_blocks_synced_idx
  ON public.calendar_busy_blocks(synced_at);

-- Unique constraint for deduplication during sync
CREATE UNIQUE INDEX calendar_busy_blocks_dedup_idx
  ON public.calendar_busy_blocks(connection_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- Comments
COMMENT ON TABLE public.calendar_busy_blocks IS
  'Cached busy blocks from external calendars. Privacy-preserving: stores duration only, no event details.';

COMMENT ON COLUMN public.calendar_busy_blocks.external_event_id IS
  'External event ID for deduplication during sync (e.g., Google Calendar event ID)';

COMMENT ON COLUMN public.calendar_busy_blocks.source IS
  'Source provider identifier: google_calendar, microsoft_calendar, calendly';


-- -----------------------------------------------------------------------------
-- AUDIT LOGGING for calendar connections
-- Uses existing professional_audit_log table
-- -----------------------------------------------------------------------------

-- Add audit action types via comment update
COMMENT ON TABLE public.professional_audit_log IS
  'Audit log for professional changes including: created, updated, status_changed, document_uploaded, specialty_added, specialty_removed, motif_added, motif_removed, calendar_connected, calendar_disconnected, calendar_sync_error';
