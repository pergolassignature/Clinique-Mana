import { useMemo, useRef, useState, type RefObject } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, X } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { DURATIONS, type GridInput, type GridRow } from '../../api/compensation'
import { useSetRetentionGrid } from '../../hooks/use-compensation'
import { durationLabel, earliestStart } from '../../lib/compensation'
import { gridSchema, type GridFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const G = 'modules.professionals.settings.compensation.grids'
const W = 'modules.professionals.compensation'

/** French decimals for a prefilled field: `27.5` → « 27,5 », cents → « 175,00 ». */
const decimal = (value: number) => String(value).replace('.', ',')
const dollars = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/** The open version's values, or one tier at 0 and no price for a title's first grid. */
function defaultsFrom(open: GridRow | undefined): GridFormValues {
  const price = (duration: number) => {
    const found = open?.prices.find((p) => p.duration === duration)
    return found ? dollars(found.clientPriceCents) : ''
  }
  return {
    effectiveFrom: '',
    tiers: open ? open.tiers.map((tier) => ({ threshold: String(tier.threshold), pct: decimal(tier.pct) })) : [{ threshold: '0', pct: '' }],
    prices: { 60: price(60), 50: price(50), 30: price(30) },
    note: '',
  }
}

interface GridDialogProps {
  titleId: string
  titleName: string
  /** The title's versions, newest first. */
  series: readonly GridRow[]
}

/**
 * « Nouvelle version » of a title's grid (or « Créer la grille » for a title without one): the
 * tiers (threshold → retention), the client prices per duration (blank: not offered), the start
 * date and a note. Prefilled from the open version: a change usually touches one value.
 */
export function GridDialog({ titleId, titleName, series }: GridDialogProps) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetRetentionGrid(feedback)
  const firstField = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      clear()
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={t(series.length > 0 ? `${G}.newVersionLabel` : `${G}.createLabel`, { title: titleName })}>
          {t(series.length > 0 ? `${G}.newVersion` : `${G}.create`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${G}.dialog.title`, { title: titleName })}</DialogTitle>
          <DialogDescription>{t(`${G}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <GridForm
          titleId={titleId}
          series={series}
          firstFieldRef={firstField}
          pending={save.isPending}
          refusal={refusal}
          dateError={dateError}
          onSubmit={(input) => {
            clear()
            save.mutate(input, { onSuccess: () => setOpen(false) })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

interface GridFormProps {
  titleId: string
  series: readonly GridRow[]
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: GridInput) => void
}

function GridForm({ titleId, series, firstFieldRef, pending, refusal, dateError, onSubmit }: GridFormProps) {
  const minDate = earliestStart(series)
  const resolver = useMemo(() => zodResolver(gridSchema(titleId, minDate)), [titleId, minDate])
  const form = useForm<GridFormValues, unknown, GridInput>({ resolver, defaultValues: defaultsFrom(series.find((grid) => grid.effectiveTo === null)) })
  const tiers = useFieldArray({ control: form.control, name: 'tiers' })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const effectiveFrom = useWatch({ control: form.control, name: 'effectiveFrom' })
  const { ref: fromRef, ...fromField } = form.register('effectiveFrom')
  const tiersError = errors.tiers?.root?.message ?? errors.tiers?.message

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <EffectiveFromField
        registration={{
          ...fromField,
          ref: (element: HTMLInputElement | null) => {
            fromRef(element)
            firstFieldRef.current = element
          },
        }}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={minDate}
        help={t(`${G}.dialog.fromHelp`)}
      />
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t(`${G}.dialog.tiers`)}</legend>
        <p className="text-xs text-muted-foreground">{t(`${G}.dialog.tiersHelp`)}</p>
        <ol className="space-y-2">
          {tiers.fields.map((tier, index) => (
            <li key={tier.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
              <FormField label={t(`${G}.dialog.threshold`, { index: String(index + 1) })} error={errors.tiers?.[index]?.threshold?.message}>
                {(field) => <Input {...field} {...form.register(`tiers.${index}.threshold`)} inputMode="numeric" autoComplete="off" />}
              </FormField>
              <FormField label={t(`${G}.dialog.retention`, { index: String(index + 1) })} error={errors.tiers?.[index]?.pct?.message}>
                {(field) => <Input {...field} {...form.register(`tiers.${index}.pct`)} inputMode="decimal" autoComplete="off" />}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={t(`${G}.dialog.removeTier`, { index: String(index + 1) })}
                disabled={tiers.fields.length === 1}
                onClick={() => tiers.remove(index)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        {tiersError && (
          <p role="alert" className="text-xs text-destructive">
            {tiersError}
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => tiers.append({ threshold: '', pct: '' })}>
          <Plus aria-hidden />
          {t(`${G}.dialog.addTier`)}
        </Button>
      </fieldset>
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t(`${G}.dialog.prices`)}</legend>
        <p className="text-xs text-muted-foreground">{t(`${G}.dialog.pricesHelp`)}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {DURATIONS.map((duration) => (
            <FormField key={duration} label={durationLabel(duration)} error={errors.prices?.[duration]?.message}>
              {(field) => <Input {...field} {...form.register(`prices.${duration}`)} inputMode="decimal" autoComplete="off" />}
            </FormField>
          ))}
        </div>
      </fieldset>
      <FormField label={t(`${W}.note`)} help={t(`${W}.noteHelp`)} error={errors.note?.message}>
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
    </DialogForm>
  )
}
