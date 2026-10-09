import { useWatch } from 'react-hook-form'
import { t } from '@/i18n'
import { regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { portraitSchema, toPortraitValues, type PortraitValues } from '../../schemas/questionnaire'
import { FIELD_GRID, FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { useStepForm, type StepContext } from './use-step-form'

const P = 'modules.professionals.questionnaire.portrait'
const MAX = 4000

/**
 * « Portrait »: the texts of the public fiche (the presentation is required, P4-173; the approach is
 * the professional's own words, not a list, P4-240) and the optional public contact.
 */
export function PortraitStep({ ctx }: { ctx: StepContext }) {
  const { form, onSubmit, pending, alert } = useStepForm<PortraitValues>(ctx, {
    section: 'portrait',
    schema: portraitSchema,
    initial: toPortraitValues,
  })
  const { register, formState: { errors } } = form
  const [bio, approach] = useWatch({ control: form.control, name: ['bio', 'approach'] })
  const counter = (value: string) => t(`${P}.counter`, { count: String([...(value ?? '')].length), max: String(MAX) })

  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-6">
      <div className="space-y-3">
        <FormField label={t(`${P}.bio`)} required help={<>{t(`${P}.bioHelp`)} {counter(bio)}</>} error={errors.bio?.message}>
          {(field) => <Textarea {...field} {...register('bio')} rows={8} maxLength={MAX} className="min-h-40" />}
        </FormField>
        <FormField label={t(`${P}.approach`)} help={<>{t(`${P}.approachHelp`)} {counter(approach)}</>} error={errors.approach?.message}>
          {(field) => <Textarea {...field} {...register('approach')} rows={5} maxLength={MAX} />}
        </FormField>
      </div>
      <FieldGroup title={t(`${P}.publicTitle`)} description={t(`${P}.publicHelp`)}>
        <div className={FIELD_GRID}>
          <FormField label={t(`${P}.publicEmail`)} error={errors.public_email?.message}>
            {(field) => <Input {...field} {...register('public_email')} type="email" inputMode="email" autoComplete="off" />}
          </FormField>
          <FormField label={t(`${P}.publicPhone`)} error={errors.public_phone?.message}>
            {(field) => <Input {...field} {...register('public_phone', regroupOnBlur(form, 'public_phone', regroupPhone))} type="tel" inputMode="tel" autoComplete="off" />}
          </FormField>
        </div>
      </FieldGroup>
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}
