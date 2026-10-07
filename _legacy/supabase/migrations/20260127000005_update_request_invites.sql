-- Migration: Add support for update request invites
-- Allows admins to request specific section updates from professionals
-- with pre-populated data from their current profile

-- Add invite_type column to distinguish initial onboarding from update requests
ALTER TABLE public.professional_onboarding_invites
ADD COLUMN invite_type text NOT NULL DEFAULT 'onboarding'
CHECK (invite_type IN ('onboarding', 'update_request'));

-- Add requested_sections to store which sections need updating
-- JSONB array of section keys: ['personal', 'professional', 'portrait', 'specialties', 'motifs', 'photo', 'insurance', 'consent']
ALTER TABLE public.professional_onboarding_invites
ADD COLUMN requested_sections jsonb;

-- Add parent_invite_id to reference the original completed invite (for audit trail)
ALTER TABLE public.professional_onboarding_invites
ADD COLUMN parent_invite_id uuid REFERENCES public.professional_onboarding_invites(id);

-- Add pre_populated_data to store snapshot of current professional data at invite creation
-- This ensures the form shows the exact data from when the request was made
ALTER TABLE public.professional_onboarding_invites
ADD COLUMN pre_populated_data jsonb;

-- Index for filtering by invite_type
CREATE INDEX professional_onboarding_invites_type_idx
ON public.professional_onboarding_invites(invite_type);

-- Comments for documentation
COMMENT ON COLUMN public.professional_onboarding_invites.invite_type IS 'Type: onboarding (initial), update_request (section update)';
COMMENT ON COLUMN public.professional_onboarding_invites.requested_sections IS 'JSONB array of section keys that need updating (update_request only)';
COMMENT ON COLUMN public.professional_onboarding_invites.parent_invite_id IS 'Reference to original completed invite (for audit trail)';
COMMENT ON COLUMN public.professional_onboarding_invites.pre_populated_data IS 'Snapshot of professional data at time of invite creation for pre-population';
