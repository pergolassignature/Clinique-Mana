-- Migration: Add profession_category_key to appointments
-- Purpose: Track which profession category is used for each appointment
--          This enables deterministic price resolution when a professional
--          has multiple professions (e.g., psychologist AND social worker)

-- =============================================================================
-- 1. ADD COLUMN TO APPOINTMENTS TABLE
-- =============================================================================

ALTER TABLE public.appointments
ADD COLUMN profession_category_key text REFERENCES public.profession_categories(key) ON DELETE RESTRICT;

-- Add comment explaining the field
COMMENT ON COLUMN public.appointments.profession_category_key IS
  'The profession category used for this appointment. Determines service pricing. NULL for legacy appointments.';

-- =============================================================================
-- 2. CREATE INDEX FOR FASTER QUERIES
-- =============================================================================

CREATE INDEX idx_appointments_profession_category
ON public.appointments(profession_category_key)
WHERE profession_category_key IS NOT NULL;

-- =============================================================================
-- 3. BACKFILL EXISTING APPOINTMENTS (best effort)
-- =============================================================================
-- For existing appointments, set the profession_category_key based on the
-- professional's primary profession. This is a best-effort approach since
-- we don't know which profession was actually used for historical appointments.

UPDATE public.appointments apt
SET profession_category_key = (
  SELECT pt.profession_category_key
  FROM public.professional_professions pp
  JOIN public.profession_titles pt ON pt.key = pp.profession_title_key
  WHERE pp.professional_id = apt.professional_id
    AND pp.is_primary = true
  LIMIT 1
)
WHERE apt.profession_category_key IS NULL;

-- =============================================================================
-- 4. UPDATE RPC FUNCTION TO INCLUDE NEW COLUMN
-- =============================================================================
-- The create_invoice_with_line_item function needs to read the profession
-- category from the appointment to resolve prices correctly.

-- Note: The function already resolves prices based on profession_category_key
-- passed in parameters. The frontend will now pass this from the appointment.
