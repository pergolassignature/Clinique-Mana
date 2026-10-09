import type { FormEvent } from 'react'
import { CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { fullName } from '../../lib/display'
import { ConsentSigning } from '../self/ConsentSigning'
import { StepActions, StepForm } from './StepParts'
import type { StepContext } from './use-step-form'

const C = 'modules.professionals.questionnaire.consent'

/**
 * « Consentement » (P4-487, decided with Jonathan 2026-10-09): the image consent is filled in and
 * signed through Documenso inside this step (`ConsentSigning`: « Signer le consentement », the
 * embedded signing page, its fallback), then reads « Signé le … · valide jusqu'au … ». The form not
 * published yet: the clinic sends it later, and « Envoyer mon profil » is not blocked. A draft
 * signed with the former in-app e-consent (typed name, before the switch) keeps that signature.
 * « Continuer » goes on, signed or not: « Révision » lists what is left.
 */
export function ConsentStep({ ctx }: { ctx: StepContext }) {
  const { submission, autosave } = ctx
  const consent = submission.consent
  const signed = autosave.answered.consent
  const legacySigned = consent !== null && signed?.consent_version_id === consent.id

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    ctx.next()
  }

  return (
    <StepForm onSubmit={onSubmit} busy={false} className="space-y-5">
      {legacySigned && signed ? (
        <p role="status" className="flex items-start gap-2 text-sm text-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            {t(`${C}.signed`, {
              date: typeof signed.signed_at === 'string' ? formatClinicDateTime(signed.signed_at) : '',
              name: typeof signed.signer_name === 'string' ? signed.signer_name : fullName(submission.professional),
            })}
          </span>
        </p>
      ) : (
        <ConsentSigning back={{ returnTo: 'questionnaire', returnStep: 'consentement' }} variant="step" />
      )}
      <StepActions back={ctx.back} pending={false} />
    </StepForm>
  )
}
