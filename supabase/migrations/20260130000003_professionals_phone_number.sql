-- Migration: Add phone_number field to professionals
-- This is the professional's personal/internal phone number (distinct from public_phone)

ALTER TABLE professionals
ADD COLUMN phone_number text;

-- Add comment for clarity
COMMENT ON COLUMN professionals.phone_number IS 'Personal/internal phone number for clinic use (distinct from public_phone which is displayed publicly)';
