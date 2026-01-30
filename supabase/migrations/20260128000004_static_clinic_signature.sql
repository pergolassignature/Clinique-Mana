-- Remove clinic DocuSeal fields and render Christine's signature as static HTML
-- DocuSeal HTML API assigns all fields to a single role, so only professional fields
-- should be DocuSeal fields. Christine's signature is static (always the same).

-- Step 1: Replace clinic signature field with static cursive text
UPDATE document_templates
SET content = REPLACE(
  content,
  '<signature-field name="clinic_signature" role="First Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>',
  '<div style="font-family: ''Brush Script MT'', ''Segoe Script'', cursive; font-size: 20pt; color: #1a237e; padding: 10px 0;">Christine Sirois</div>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Step 2: Replace clinic date field with static rendered date
UPDATE document_templates
SET content = REPLACE(
  content,
  E'<span style="font-size: 9pt;">Date: </span>\n          <date-field name="date_clinique" role="First Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>',
  '<span style="font-size: 9pt;">Date: {{today}}</span>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Step 3: Remove role attributes from professional fields (single role = no role needed)
UPDATE document_templates
SET content = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        content,
        'role="Second Party" required="true" title="Ville"',
        'required="true" title="Ville"'
      ),
      'name="professional_signature" role="Second Party"',
      'name="professional_signature"'
    ),
    'name="date_professionnel" role="Second Party"',
    'name="date_professionnel"'
  ),
  'name="city" role="Second Party"',
  'name="city"'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;
