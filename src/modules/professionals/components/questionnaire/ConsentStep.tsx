import { useId, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { professionalKeys } from '../../hooks/keys'
import { isRefusal, useSignMyConsent } from '../../hooks/use-my-submission'
import { fullName } from '../../lib/display'
import { nameMatches } from '../../lib/questionnaire'
import { StepActions, StepAlert, StepForm } from './StepParts'
import { refusalTarget, type StepContext } from './use-step-form'

const C = 'modules.professionals.questionnaire.consent'

/**
 * « Consentement »: the latest published text (P4-273), « J'ai lu et j'accepte » and the full name
 * typed as the file has it (accents, case and spaces aside, checked here and by the database).
 * Signed on « Continuer » (the signature is the provider's act, with the server's time); a
 * signature of an older version must be given again.
 */
export function ConsentStep({ ctx }: { ctx: StepContext }) {
  const { submission, autosave } = ctx
  const consent = submission.consent
  const queryClient = useQueryClient()
  const sign = useSignMyConsent()
  const ids = useId()
  const signed = autosave.answered.consent
  const signedCurrent = consent !== null && signed?.consent_version_id === consent.id
  const [agreed, setAgreed] = useState(false)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<{ agree?: string; name?: string }>({})
  const [alert, setAlert] = useState<string | null>(null)
  const agreeRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const expected = fullName(submission.professional)
  const dirty = agreed || name.trim() !== ''
  useUnsavedChanges(dirty && !signedCurrent)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (sign.isPending) return
    if (!consent || (signedCurrent && !dirty)) return ctx.next()
    const next: typeof errors = {}
    if (!agreed) next.agree = t(`${C}.agreeRequired`)
    if (!nameMatches(name, submission.professional.firstName, submission.professional.lastName)) {
      next.name = name.trim() === '' ? t(`${C}.nameRequired`) : t(`${C}.nameMismatch`)
    }
    setErrors(next)
    setAlert(null)
    if (next.agree || next.name) {
      ;(next.agree ? agreeRef.current : nameRef.current)?.focus()
      return
    }
    const signerName = name.trim().replace(/\s+/g, ' ')
    try {
      await sign.mutateAsync({ versionId: consent.id, signerName })
      autosave.recordAnswer('consent', { consent_version_id: consent.id, signer_name: signerName, signed_at: new Date().toISOString() })
      setAgreed(false)
      setName('')
      ctx.next()
    } catch (error) {
      const hint = isRefusal(error) ? rpcErrorHint(error) : undefined
      const { message } = refusalTarget(error, [])
      if (hint === 'signer_name') setErrors({ name: message })
      else setAlert(message)
      // The text changed meanwhile: show the new one.
      if (hint === 'consent_version') void queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() })
    }
  }

  return (
    <StepForm onSubmit={(event) => void onSubmit(event)} busy={sign.isPending} className="space-y-5">
      {consent ? (
        <article aria-labelledby={`${ids}-title`} className="rounded-lg border border-border p-4">
          <h3 id={`${ids}-title`} className="text-sm font-semibold text-foreground">
            {consent.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`${C}.version`, { version: String(consent.version) })}</p>
          <div className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{consent.body}</div>
        </article>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${C}.none`)}</p>
      )}
      {consent && signedCurrent && signed && (
        <p role="status" className="flex items-start gap-2 text-sm text-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            {t(`${C}.signed`, {
              date: typeof signed.signed_at === 'string' ? formatClinicDateTime(signed.signed_at) : '',
              name: typeof signed.signer_name === 'string' ? signed.signer_name : expected,
            })}
          </span>
        </p>
      )}
      {consent && !signedCurrent && (
        <div className="space-y-4">
          {signed && <p className="text-sm text-muted-foreground">{t(`${C}.newVersion`)}</p>}
          <CheckboxField
              ref={agreeRef}
              label={t(`${C}.agree`)}
              error={errors.agree}
              checked={agreed}
              onCheckedChange={(value) => {
                setAgreed(value)
                setErrors((e) => ({ ...e, agree: undefined }))
              }}
            />
          <FormField label={t(`${C}.name`)} required help={t(`${C}.nameHelp`, { name: expected })} error={errors.name}>
            {(field) => (
              <Input
                {...field}
                ref={nameRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setErrors((e) => ({ ...e, name: undefined }))
                }}
                autoComplete="name"
                maxLength={161}
              />
            )}
          </FormField>
        </div>
      )}
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={sign.isPending} label={consent && !signedCurrent ? t(`${C}.signAndContinue`) : undefined} />
    </StepForm>
  )
}
