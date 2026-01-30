-- Migration: fix_template_signature_fields
-- Description: Replace the signature section in the service contract template
--              with proper DocuSeal field tags for HTML-based submission.
--
-- Root cause: The original migration 20260128000001 was modified locally AFTER
--             being pushed to staging. The database has the old version without
--             DocuSeal field tags. This migration forcefully updates the signature
--             section to include the correct field tags.

-- Update the signature section to use DocuSeal HTML field tags
-- We use a multi-step approach to handle different possible states of the template

-- Step 1: First, let's replace the entire signature section
-- This handles the case where the template has placeholder divs (old version)
UPDATE document_templates
SET content = REGEXP_REPLACE(
  content,
  '<!-- Signature Section -->.*?<!-- Annexe A -->',
  E'<!-- Signature Section -->\n  <div class="signature-section">\n    <div class="signature-header">EN FOI DE QUOI, LES PARTIES ONT SIGNÉ :</div>\n\n    <div class="date-city-line">\n      <div class="city-field">\n        <span>À </span>\n        <text-field name="city" role="First Party" required="true" title="Ville" style="width: 150px; height: 24px; display: inline-block; border-bottom: 1px solid #000;"></text-field>\n      </div>\n    </div>\n\n    <div class="signature-grid">\n      <div class="signature-block">\n        <signature-field name="professional_signature" role="First Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>\n        <div class="signature-label">{{professional.full_name}}</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <date-field name="date_professionnel" role="First Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>\n        </div>\n      </div>\n      <div class="signature-block">\n        <div style="font-family: ''Brush Script MT'', ''Segoe Script'', cursive; font-size: 20pt; color: #1a237e; padding: 10px 0;">Christine Sirois</div>\n        <div class="signature-label">Christine Sirois, Clinique MANA inc.</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: {{today}}</span>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- Annexe A -->',
  's'  -- 's' flag makes . match newlines
),
updated_at = now()
WHERE key = 'contrat_service' AND status = 'published';

-- Step 2: Alternative approach - if the above didn't work, try a different pattern
-- This handles templates that use a different structure
UPDATE document_templates
SET content = REGEXP_REPLACE(
  content,
  '<div class="signature-section">.*?</div>\s*<!-- Annexe A -->',
  E'<div class="signature-section">\n    <div class="signature-header">EN FOI DE QUOI, LES PARTIES ONT SIGNÉ :</div>\n\n    <div class="date-city-line">\n      <div class="city-field">\n        <span>À </span>\n        <text-field name="city" role="First Party" required="true" title="Ville" style="width: 150px; height: 24px; display: inline-block; border-bottom: 1px solid #000;"></text-field>\n      </div>\n    </div>\n\n    <div class="signature-grid">\n      <div class="signature-block">\n        <signature-field name="professional_signature" role="First Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>\n        <div class="signature-label">{{professional.full_name}}</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: </span>\n          <date-field name="date_professionnel" role="First Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>\n        </div>\n      </div>\n      <div class="signature-block">\n        <div style="font-family: ''Brush Script MT'', ''Segoe Script'', cursive; font-size: 20pt; color: #1a237e; padding: 10px 0;">Christine Sirois</div>\n        <div class="signature-label">Christine Sirois, Clinique MANA inc.</div>\n        <div style="margin-top: 5px;">\n          <span style="font-size: 9pt;">Date: {{today}}</span>\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- Annexe A -->',
  's'
),
updated_at = now()
WHERE key = 'contrat_service'
  AND status = 'published'
  AND content NOT LIKE '%<signature-field name="professional_signature"%';

-- Step 3: Log result for debugging
DO $$
DECLARE
  v_has_field_tags boolean;
  v_content_preview text;
BEGIN
  SELECT
    content LIKE '%<signature-field%' AND content LIKE '%<text-field%' AND content LIKE '%<date-field%',
    substring(content from position('signature-section' in content) for 500)
  INTO v_has_field_tags, v_content_preview
  FROM document_templates
  WHERE key = 'contrat_service' AND status = 'published';

  IF v_has_field_tags THEN
    RAISE NOTICE 'SUCCESS: Template now has DocuSeal field tags';
    RAISE NOTICE 'Signature section preview: %', v_content_preview;
  ELSE
    RAISE NOTICE 'WARNING: Field tags may not have been added. Manual verification needed.';
    RAISE NOTICE 'Content preview: %', v_content_preview;
  END IF;
END $$;
