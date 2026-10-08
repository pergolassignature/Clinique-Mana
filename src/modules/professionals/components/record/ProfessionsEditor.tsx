import { useEffect, useId, useMemo, useRef } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleAlert, Plus } from 'lucide-react'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { ProfessionalRecord } from '../../api/parse'
import type { ProfessionInput } from '../../api/record'
import { professionalCatalogKeys, professionalKeys } from '../../hooks/keys'
import { useSetProfessions } from '../../hooks/use-professional-mutations'
import { titleOrder, type CatalogView } from '../../lib/catalog-view'
import { professionsErrorField, professionsSchema, toProfessionItems, type ProfessionItemValues } from '../../schemas/professions'
import { useRecordData } from './record-context'

const P = 'modules.professionals.record.identity.professions'
const MAX_TITLES = 2

interface Values {
  items: ProfessionItemValues[]
}
type Form = UseFormReturn<Values, unknown, { items: ProfessionInput[] }>

const toValues = (record: ProfessionalRecord): Values => ({ items: toProfessionItems(record.professions) })

/**
 * « Professions et permis » (A2.9): up to two titles, each with its licence when the title belongs
 * to an order (the order's own label), one of them primary. Every change edits a draft only (the
 * « Titre principal » radio included, decision #36); « Enregistrer » sends the whole list once
 * (`set_professional_professions`). Removing the primary promotes the other row. A refusal goes
 * under the row and field its HINT and DETAIL name, else above the buttons.
 */
export function ProfessionsEditor({ readOnly }: { readOnly: boolean }) {
  const { record, catalog } = useRecordData()
  const id = record.professional.id
  const queryClient = useQueryClient()
  const stored = useMemo(() => toValues(record), [record])
  const schema = useMemo(
    () =>
      z.object({
        items: professionsSchema(catalog, { heldTitleIds: record.professions.map((p) => p.titleId), heldMotifIds: record.motifIds }),
      }),
    [catalog, record.professions, record.motifIds],
  )
  const form: Form = useForm({ resolver: zodResolver(schema), defaultValues: stored })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
  const addButton = useRef<HTMLButtonElement | null>(null)
  const ids = useId()
  const { isDirty, errors } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  // Follows the record (a refetch, another card's save) while there is no draft.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(stored)
  }, [stored, form])

  const mutation = useSetProfessions({
    onErrorMessage: (message, error) => {
      const field = professionsErrorField(error, form.getValues('items'))
      const row = field ? Number(field.split('.')[1]) : -1
      if (field?.endsWith('licenceNumber') && !titleOrder(catalog, form.getValues(`items.${row}.titleId`))) {
        // The title gained an order since the catalogue was read: no licence field to show it under.
        form.setError('root.server', { message: t(`${P}.licenceNowRequired`) })
      } else if (field) {
        form.setError(field, { message }, { shouldFocus: true })
      } else {
        form.setError('root.server', { message })
      }
      // An archived title or a new licence rule: the refetched catalogue shows the current rules.
      if (field) void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.catalog() })
    },
  })
  const pending = mutation.isPending

  const submit = form.handleSubmit(({ items }) =>
    mutation.mutate(
      { id, items },
      {
        onSuccess: () => {
          const saved = queryClient.getQueryData<ProfessionalRecord | null>(professionalKeys.record(id)) ?? record
          form.reset(toValues(saved))
        },
      },
    ),
  )

  const removeRow = (index: number) => {
    const wasPrimary = form.getValues(`items.${index}.isPrimary`)
    remove(index)
    if (wasPrimary && form.getValues('items').length > 0) form.setValue('items.0.isPrimary', true, { shouldDirty: true })
    addButton.current?.focus()
  }
  const full = fields.length >= MAX_TITLES
  const listError = errors.items?.message ?? errors.items?.root?.message
  const alert = errors.root?.server?.message

  return (
    <SettingsCard
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      readOnly={readOnly}
      pending={pending}
      onSubmit={(event) => void submit(event)}
      footer={
        <FormActions
          onCancel={() => form.reset(stored)}
          onReset={() => (fields.length > 0 ? form.setFocus('items.0.titleId') : addButton.current?.focus())}
          dirty={isDirty}
          pending={pending}
        />
      }
    >
      {fields.length === 0 && <p className="text-sm text-muted-foreground">{t(`${P}.empty`)}</p>}
      {fields.map((field, index) => (
        <ProfessionRow
          key={field.id}
          form={form}
          catalog={catalog}
          index={index}
          rows={fields.length}
          radioName={`${ids}-primary`}
          readOnly={readOnly}
          onRemove={() => removeRow(index)}
        />
      ))}
      {listError && (
        <p role="alert" className="text-xs text-destructive">
          {listError}
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            ref={addButton}
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={full || undefined}
            aria-describedby={full ? `${ids}-max` : undefined}
            onClick={ignoreWhenInactive(full, () =>
              append({ titleId: '', licenceNumber: '', isPrimary: fields.length === 0 }, { focusName: `items.${fields.length}.titleId` }),
            )}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            <Plus aria-hidden />
            {t(`${P}.add`)}
          </Button>
          {full && (
            <span id={`${ids}-max`} className="text-xs text-muted-foreground">
              {t(`${P}.max`)}
            </span>
          )}
        </div>
      )}
      {alert && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{alert}</AlertDescription>
        </Alert>
      )}
    </SettingsCard>
  )
}

interface ProfessionRowProps {
  form: Form
  catalog: CatalogView
  index: number
  rows: number
  /** The rows' « Titre principal » radios form one group. */
  radioName: string
  readOnly: boolean
  onRemove: () => void
}

/** One title: « Titre », its licence when the title has an order, « Titre principal » and « Retirer ». */
function ProfessionRow({ form, catalog, index, rows, radioName, readOnly, onRemove }: ProfessionRowProps) {
  const items = useWatch({ control: form.control, name: 'items' })
  const item = items[index] ?? { titleId: '', licenceNumber: '', isPrimary: false }
  const order = titleOrder(catalog, item.titleId || null)
  const errors = form.formState.errors.items?.[index]
  const titleName = catalog.byId.titles.get(item.titleId)?.name
  // Active titles not chosen on the other row, plus this row's own title when archived (it may stay).
  const otherTitle = items.find((_, i) => i !== index)?.titleId
  const options = catalog.titles.filter((title) => (title.isActive && title.id !== otherTitle) || title.id === item.titleId)

  const choosePrimary = () =>
    items.forEach((_, i) => form.setValue(`items.${i}.isPrimary`, i === index, { shouldDirty: true }))

  return (
    <div className={cn('space-y-3', index > 0 && 'border-t border-border-light pt-3')}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={t(`${P}.titleField`)} required error={errors?.titleId?.message}>
          {(field) => (
            <Controller
              control={form.control}
              name={`items.${index}.titleId`}
              render={({ field: title }) => (
                <Select
                  {...field}
                  {...title}
                  placeholder={t(`${P}.titlePlaceholder`)}
                  onChange={(event) => {
                    title.onChange(event)
                    // The licence goes with a title that needs none: nothing hidden is sent.
                    if (!titleOrder(catalog, event.target.value || null)) form.setValue(`items.${index}.licenceNumber`, '')
                    form.clearErrors(`items.${index}.licenceNumber`)
                  }}
                >
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.isActive ? option.name : t(`${P}.archived`, { name: option.name })}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        {order && (
          <FormField
            label={order.licenceLabel}
            required
            help={readOnly ? undefined : t(`${P}.licenceHelp`, { order: order.acronym })}
            error={errors?.licenceNumber?.message}
          >
            {(field) => <Input {...field} {...form.register(`items.${index}.licenceNumber`)} autoComplete="off" className="tabular" />}
          </FormField>
        )}
      </div>
      {(rows > 1 || !readOnly) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {rows > 1 ? (
            readOnly ? (
              item.isPrimary && <span className="text-xs text-muted-foreground">{t(`${P}.primary`)}</span>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={radioName} checked={item.isPrimary} onChange={choosePrimary} className="h-4 w-4 accent-primary" />
                {t(`${P}.primary`)}
              </label>
            )
          ) : (
            <span />
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={titleName ? t(`${P}.removeLabel`, { name: titleName }) : t(`${P}.removeEmpty`)}
              onClick={onRemove}
            >
              {t(`${P}.remove`)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
