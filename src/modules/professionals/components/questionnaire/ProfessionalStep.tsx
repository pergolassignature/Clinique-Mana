import { useId, useMemo, useRef } from 'react'
import { Controller, useFieldArray, useWatch, type Path, type UseFormReturn } from 'react-hook-form'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { titleOrder, type CatalogView } from '../../lib/catalog-view'
import { professionalSchema, submittedProfessions, toProfessionalValues, type ProfessionalValues } from '../../schemas/questionnaire'
import { FIELD_GRID, FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { useStepForm, type StepContext } from './use-step-form'

const P = 'modules.professionals.questionnaire.professional'
const E = 'modules.professionals.record.identity.professions'
const MAX_TITLES = 2

/**
 * « Profil professionnel »: one or two titles, each with its licence when the title belongs to an
 * order (in the order's format), one of them primary, and the years of experience (0–60, P4-33).
 * Titles are saved as one list (`professions`); a refusal of the staff paths (archived title,
 * licence) lands on the row its DETAIL names (P4-174).
 */
export function ProfessionalStep({ ctx }: { ctx: StepContext }) {
  const { catalog, autosave, submission } = ctx
  const schema = useMemo(() => {
    const prefill = submission.prefill.professional ?? {}
    return professionalSchema(catalog, {
      // Titles held when the questionnaire opened may stay archived; new ones may not.
      heldTitleIds: submittedProfessions(prefill).map((p) => p.title_id),
      heldMotifIds: submission.requestedSections.includes('motifs') ? motifIds(autosave.current('motifs')) : [],
    })
    // The schema is built once per step visit: a refusal from the database covers later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])
  const { form, onSubmit, pending, alert } = useStepForm<ProfessionalValues>(ctx, {
    section: 'professional',
    schema,
    initial: toProfessionalValues,
    hintField: (hint, detail, values) => {
      const field = hint === 'title' ? 'titleId' : hint === 'licence' ? 'licenceNumber' : null
      const index = field && detail ? values.professions.findIndex((row) => row.titleId === detail) : -1
      return index >= 0 ? (`professions.${index}.${field}` as Path<ProfessionalValues>) : null
    },
  })
  const listError = form.formState.errors.professions?.message ?? form.formState.errors.professions?.root?.message

  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-6">
      <FieldGroup title={t(`${P}.titles`)} description={t(`${P}.titlesHelp`)}>
        <Professions form={form} catalog={catalog} />
        {listError && <p className="text-xs text-destructive">{listError}</p>}
      </FieldGroup>
      <div className={FIELD_GRID}>
        <FormField label={t(`${P}.years`)} help={t(`${P}.yearsHelp`)} error={form.formState.errors.years_experience?.message}>
          {(field) => <Input {...field} {...form.register('years_experience')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular max-w-[6rem]" />}
        </FormField>
      </div>
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}

const motifIds = (values: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(values.motif_ids) ? values.motif_ids.filter((id): id is string => typeof id === 'string') : []

/** The title rows, « Ajouter un titre » (two at most) and « Retirer ». */
function Professions({ form, catalog }: { form: UseFormReturn<ProfessionalValues>; catalog: CatalogView }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'professions' })
  const addButton = useRef<HTMLButtonElement | null>(null)
  const ids = useId()
  const full = fields.length >= MAX_TITLES

  const removeRow = (index: number) => {
    const wasPrimary = form.getValues(`professions.${index}.isPrimary`)
    remove(index)
    if (wasPrimary && form.getValues('professions').length > 0) form.setValue('professions.0.isPrimary', true, { shouldDirty: true })
    addButton.current?.focus()
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && <p className="text-sm text-muted-foreground">{t(`${P}.noTitle`)}</p>}
      {fields.map((field, index) => (
        <ProfessionRow key={field.id} form={form} catalog={catalog} index={index} rows={fields.length} radioName={`${ids}-primary`} onRemove={() => removeRow(index)} />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={full || undefined}
          aria-describedby={full ? `${ids}-max` : undefined}
          onClick={ignoreWhenInactive(full, () =>
            append({ titleId: '', licenceNumber: '', isPrimary: fields.length === 0 }, { focusName: `professions.${fields.length}.titleId` }),
          )}
          className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        >
          <Plus aria-hidden />
          {t(`${E}.add`)}
        </Button>
        {full && (
          <span id={`${ids}-max`} className="text-xs text-muted-foreground">
            {t(`${E}.max`)}
          </span>
        )}
      </div>
    </div>
  )
}

interface ProfessionRowProps {
  form: UseFormReturn<ProfessionalValues>
  catalog: CatalogView
  index: number
  rows: number
  radioName: string
  onRemove: () => void
}

/** One title: « Titre », its licence when the title has an order, « Titre principal » and « Retirer ». */
function ProfessionRow({ form, catalog, index, rows, radioName, onRemove }: ProfessionRowProps) {
  const items = useWatch({ control: form.control, name: 'professions' })
  const item = items[index] ?? { titleId: '', licenceNumber: '', isPrimary: false }
  const order = titleOrder(catalog, item.titleId || null)
  const errors = form.formState.errors.professions?.[index]
  const titleName = catalog.byId.titles.get(item.titleId)?.name
  const otherTitle = items.find((_, i) => i !== index)?.titleId
  // Active titles not chosen on the other row, plus this row's own title when archived (it may stay).
  const options = catalog.titles.filter((title) => (title.isActive && title.id !== otherTitle) || title.id === item.titleId)
  const n = String(index + 1)
  const rowLabel = titleName ? t(`${E}.row`, { n, name: titleName }) : t(`${E}.rowEmpty`, { n })

  return (
    <div role="group" aria-label={rowLabel} className={cn('space-y-3', index > 0 && 'border-t border-border-light pt-3')}>
      <div className={FIELD_GRID}>
        <FormField label={t(`${E}.titleField`)} required error={errors?.titleId?.message}>
          {(field) => (
            <Controller
              control={form.control}
              name={`professions.${index}.titleId`}
              render={({ field: title }) => (
                <Select
                  {...field}
                  {...title}
                  placeholder={t(`${E}.titlePlaceholder`)}
                  onChange={(event) => {
                    title.onChange(event)
                    // The licence goes with a title that needs none: nothing hidden is sent.
                    if (!titleOrder(catalog, event.target.value || null)) form.setValue(`professions.${index}.licenceNumber`, '')
                    form.clearErrors(`professions.${index}.licenceNumber`)
                  }}
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.isActive ? option.name : t(`${E}.archived`, { name: option.name })}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        {order && (
          <FormField label={order.licenceLabel} required help={t(`${E}.licenceHelp`, { order: order.acronym })} error={errors?.licenceNumber?.message}>
            {(field) => <Input {...field} {...form.register(`professions.${index}.licenceNumber`)} autoComplete="off" className="tabular" />}
          </FormField>
        )}
      </div>
      <div className="flex min-h-8 items-center justify-between gap-3">
        {rows > 1 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={radioName}
              checked={item.isPrimary}
              onChange={() => items.forEach((_, i) => form.setValue(`professions.${i}.isPrimary`, i === index, { shouldDirty: true }))}
              aria-label={t(`${E}.primaryLabel`, { name: titleName ?? t(`${E}.rowEmpty`, { n }) })}
              className={cn('h-4 w-4 rounded-full accent-primary', focusRing)}
            />
            <span aria-hidden>{t(`${E}.primary`)}</span>
          </label>
        ) : (
          <span />
        )}
        <Button type="button" variant="ghost" size="sm" aria-label={titleName ? t(`${E}.removeLabel`, { name: titleName }) : t(`${E}.removeEmpty`)} onClick={onRemove}>
          {t(`${E}.remove`)}
        </Button>
      </div>
    </div>
  )
}
