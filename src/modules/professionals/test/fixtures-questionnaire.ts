import { parseRpc } from '../api/parse'
import { mySubmissionPayload, type MySubmission } from '../api/self'
import { IDS } from './fixtures'

/**
 * The questionnaire's payloads as the database returns them (snake_case JSON). Test-only: no
 * production file imports this one.
 */

/** `get_my_submission` as the migrations build it (20261008191219, 20261008224223). */
export const MY_SUBMISSION_JSON = {
  id: '00000000-0000-4000-8000-00000000e001',
  kind: 'onboarding',
  status: 'draft',
  requested_sections: ['personal', 'professional', 'portrait', 'languages', 'clienteles', 'motifs', 'availability', 'photo', 'insurance', 'tax_bank', 'consent'],
  prefill: { personal: { personal_phone: null, address_line1: null, province: 'QC' }, languages: { language_ids: [IDS.fr] } },
  values: { portrait: { bio: 'Bonjour' } },
  decision_note: null,
  submitted_at: null,
  updated_at: '2026-10-08T14:32:00.123456+00:00',
  private_saved_at: null,
  started_by_me: false,
  private: null,
  on_file: null,
  consent: { id: '00000000-0000-4000-8000-00000000c001', version: 1, title: 'Consentement au droit à l’image', body: 'Texte' },
  signed_consent_version: null,
  collect_sin: false,
  professional: { first_name: 'Félix', last_name: 'Gauthier', email: 'provider@mana.test', gender: null },
}


/** The submission as the page reads it, from the JSON above with `over` merged in. */
export function mySubmission(over: Partial<Record<keyof typeof MY_SUBMISSION_JSON, unknown>> = {}): MySubmission {
  return parseRpc(mySubmissionPayload, { ...MY_SUBMISSION_JSON, ...over })
}
