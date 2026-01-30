-- Add role="First Party" to all DocuSeal field tags
-- DocuSeal requires role attribute on field tags to match submitter roles

UPDATE document_templates
SET content = REPLACE(
  REPLACE(
    REPLACE(
      content,
      'name="city" required',
      'name="city" role="First Party" required'
    ),
    'name="professional_signature" required',
    'name="professional_signature" role="First Party" required'
  ),
  'name="date_professionnel" required',
  'name="date_professionnel" role="First Party" required'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;
