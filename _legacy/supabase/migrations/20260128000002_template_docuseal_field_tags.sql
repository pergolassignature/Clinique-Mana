-- Fix template signature section: replace placeholder divs with DocuSeal field tags
-- DocuSeal's /submissions/html endpoint uses custom HTML elements for form fields
-- instead of coordinate-based field positioning on a PDF

-- Replace city field placeholder
UPDATE document_templates
SET content = REPLACE(
  content,
  '<span class="field-placeholder" style="width: 150px; height: 24px; display: inline-block; border-bottom: 1px solid #000;"></span>',
  '<text-field name="city" role="Second Party" required="true" title="Ville" style="width: 150px; height: 24px; display: inline-block;"></text-field>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Replace professional signature placeholder (yellow background)
UPDATE document_templates
SET content = REPLACE(
  content,
  '<div class="signature-placeholder" style="width: 200px; height: 60px; border: 1px dashed #999; background-color: #fffde7;"></div>',
  '<signature-field name="professional_signature" role="Second Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Replace clinic signature placeholder (green background)
UPDATE document_templates
SET content = REPLACE(
  content,
  '<div class="signature-placeholder" style="width: 200px; height: 60px; border: 1px dashed #999; background-color: #e8f5e9;"></div>',
  '<signature-field name="clinic_signature" role="First Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Replace professional date field (with context to distinguish from clinic date)
UPDATE document_templates
SET content = REPLACE(
  content,
  E'<div class="signature-label">{{professional.full_name}}</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <span class="field-placeholder" style="width: 100px; height: 20px; display: inline-block; border-bottom: 1px solid #000;"></span>',
  E'<div class="signature-label">{{professional.full_name}}</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <date-field name="date_professionnel" role="Second Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;

-- Replace clinic date field (with context to distinguish from professional date)
UPDATE document_templates
SET content = REPLACE(
  content,
  E'<div class="signature-label">Christine Sirois, Clinique MANA inc.</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <span class="field-placeholder" style="width: 100px; height: 20px; display: inline-block; border-bottom: 1px solid #000;"></span>',
  E'<div class="signature-label">Christine Sirois, Clinique MANA inc.</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <date-field name="date_clinique" role="First Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>'
),
updated_at = now()
WHERE key = 'contrat_service' AND version = 1;
