-- Fix DocuSeal field tag role names
-- DocuSeal /submissions/html uses "First Party" / "Second Party" as default role names
-- Custom role names (Clinique, Professionnel) are not supported

UPDATE document_templates
SET content = REPLACE(
  REPLACE(
    content,
    'role="Professionnel"',
    'role="Second Party"'
  ),
  'role="Clinique"',
  'role="First Party"'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;
