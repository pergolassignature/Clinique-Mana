import { Controller, useWatch } from 'react-hook-form'
import { t } from '@/i18n'
import { regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { Checkbox } from '@/shared/ui/checkbox'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { portraitSchema, toPortraitValues, type PortraitValues } from '../../schemas/questionnaire'
import { FIELD_GRID, FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { useStepForm, type StepContext } from './use-step-form'

const P = 'modules.professionals.questionnaire.portrait'
const MAX = 4000

/**
 * « Portrait »: the texts of the public fiche (the presentation is required, P4-173; the free-text
 * approach is the professional's own words, P4-276), the approaches she works with (P4-561:
 * checkboxes, counted by the clinic, never shown on her fiche) and the optional public contact.
 */
export function PortraitStep({ ctx }: { ctx: StepContext }) {
  const { form, onSubmit, pending, alert } = useStepForm<PortraitValues>(ctx, {
    section: 'portrait',
    schema: portraitSchema,
    initial: toPortraitValues,
  })
  const { register, formState: { errors } } = form
  const [bio, approach, approachIds] = useWatch({ control: form.control, name: ['bio', 'approach', 'approach_ids'] })
  // P4-561: the clinic's list, archived rows left out unless she already holds one.
  const held = new Set(approachIds ?? [])
  const approaches = ctx.catalog.approaches.filter((a) => a.isActive || held.has(a.id))
  const otherChecked = approaches.some((a) => a.requiresText && held.has(a.id))
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
      {approaches.length > 0 && (
        <FieldGroup title={t(`${P}.approachesTitle`)} description={t(`${P}.approachesHelp`)}>
          <Controller
            control={form.control}
            name="approach_ids"
            render={({ field }) => (
              <ul className="space-y-2">
                {approaches.map((approachRow) => {
                  const checked = (field.value ?? []).includes(approachRow.id)
                  return (
                    <li key={approachRow.id} className="flex items-start gap-2">
                      <Checkbox
                        id={`approach-${approachRow.id}`}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const ids = new Set(field.value ?? [])
                          if (next === true) ids.add(approachRow.id)
                          else ids.delete(approachRow.id)
                          field.onChange([...ids].sort())
                          // « Autre » unchecked: its text goes with it.
                          if (approachRow.requiresText && next !== true) form.setValue('approach_other', '', { shouldDirty: true })
                        }}
                      />
                      <label htmlFor={`approach-${approachRow.id}`} className="text-sm leading-5">
                        {approachRow.name}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          />
          {otherChecked && (
            <FormField label={t(`${P}.approachOther`)} error={errors.approach_other?.message}>
              {(field) => <Input {...field} {...register('approach_other')} maxLength={200} autoComplete="off" />}
            </FormField>
          )}
        </FieldGroup>
      )}
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
