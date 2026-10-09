-- Professionnels: drops public.sign_my_consent, which nothing calls any more.
--
-- The questionnaire's typed-name consent (*_professionals_onboarding.sql, its return type changed
-- by *_professionals_questionnaire_consent_answer.sql) was replaced by the image consent signed
-- through Documenso (*_professionals_image_consent.sql: prepare_my_image_consent,
-- get_my_image_consent). No client, edge function, view, policy, trigger or other function calls
-- it (checked over src, supabase/functions, e2e, the migrations and pgTAP), so dropping it changes
-- no behaviour. Until then any provider with an open draft could still call it: a write path into
-- the draft that no screen offers, reason enough to remove it rather than keep it deprecated.
--
-- The drafts' `consent` answers it wrote stay where they are, and get_my_submission still reads
-- them (`signed_consent_version`).

drop function public.sign_my_consent(uuid, text);
