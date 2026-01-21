-- Fix invite status for professionals who have submitted questionnaires
-- This migration marks invites as 'completed' when there's a submitted questionnaire

UPDATE professional_onboarding_invites i
SET
  status = 'completed',
  completed_at = s.submitted_at
FROM professional_questionnaire_submissions s
WHERE s.invite_id = i.id
  AND s.status = 'submitted'
  AND s.submitted_at IS NOT NULL
  AND i.status IN ('pending', 'opened');
