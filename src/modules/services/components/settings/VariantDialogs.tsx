import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { VariantInput } from '../../api/catalogue'
import type { ProfessionTitle, RateVariantRow, Service } from '../../api/parse'
import { useAddRateVariant, useEndRateVariant } from '../../hooks/use-services'
import { DISCOUNT_KINDS, RATE_VARIANTS, type DiscountKind } from '../../lib/constants'
import { earliestStart, rowsOf } from '../../lib/dated'
import { discountKindLabel, variantLabel } from '../../lib/display'
import { endVariantSchema, FIRST_DATE, LAST_DATE, variantSchema, type VariantFormValues } from '../../schemas/dated'
import { useDialogRefusal, useRefusalOnField } from '../../hooks/use-dialog-refusal'
import { DialogForm, EffectiveFromField } from './DatedParts'

const V = 'modules.services.settings.variants'

const HINT_FIELDS = { effective_from: 'effectiveFrom', variant: 'variant', title_id: 'titleId', discount_kind: 'discountKind', amount_cents: 'value', percent: 'value' } as const

interface VariantDialogProps {
  /** The services a rate can be put on: active, priced by the grid or fixed. */
  services: readonly Service[]
  titles: readonly ProfessionTitle[]
  variants: readonly RateVariantRow[]
}

/** « Nouveau tarif »: service, variant, profession (or every one), the discount and its value, « À partir du ». */
export const VariantDialog = forwardRef<HTMLButtonElement, VariantDialogProps>(function VariantDialog({ services, titles, variants }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, fieldRefusal, feedback, clear } = useDialogRefusal(HINT_FIELDS)
  const save = useAddRateVariant(feedback)
  const firstField = useRef<HTMLSelectElement | null>(null)

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
        <Button ref={ref} type="button" variant="outline">
          <Plus aria-hidden />
          {t(`${V}.add`)}
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
          <DialogTitle>{t(`${V}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${V}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        {open && (
          <VariantForm
            services={services}
            titles={titles}
            variants={variants}
            firstFieldRef={firstField}
            pending={save.isPending}
            refusal={refusal}
            fieldRefusal={fieldRefusal}
            onSubmit={(input) => {
              clear()
              save.mutate(input, { onSuccess: () => setOpen(false) })
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
})

interface VariantFormProps extends VariantDialogProps {
  firstFieldRef: RefObject<HTMLSelectElement | null>
  pending: boolean
  refusal: string | null
  fieldRefusal: { field: string; message: string } | null
  onSubmit: (input: VariantInput) => void
}

function VariantForm({ services, titles, variants, firstFieldRef, pending, refusal, fieldRefusal, onSubmit }: VariantFormProps) {
  const minDateFor = useMemo(
    () => (serviceId: string, variant: string, titleId: string | null) =>
      earliestStart(rowsOf(variants, (row) => row.serviceId === serviceId && row.variant === variant && row.titleId === titleId)),
    [variants],
  )
  const resolver = useMemo(() => zodResolver(variantSchema(minDateFor)), [minDateFor])
  const form = useForm<VariantFormValues, unknown, VariantInput>({
    resolver,
    defaultValues: { serviceId: services[0]?.id ?? '', variant: 'student', titleId: '', discountKind: 'price', value: '', effectiveFrom: '' },
  })
  const { errors, isDirty } = form.formState
  useRefusalOnField(form.setError, fieldRefusal)
  const [serviceId, variant, titleId, discountKind, effectiveFrom] = useWatch({ control: form.control, name: ['serviceId', 'variant', 'titleId', 'discountKind', 'effectiveFrom'] })

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <FormField label={t(`${V}.dialog.service`)} width="full" required error={errors.serviceId?.message}>
        {(field) => (
          <Controller
            control={form.control}
            name="serviceId"
            render={({ field: f }) => (
              <Select
                {...field}
                value={f.value}
                onChange={f.onChange}
                onBlur={f.onBlur}
                ref={(element) => {
                  f.ref(element)
                  firstFieldRef.current = element
                }}
                placeholder={t(`${V}.dialog.servicePlaceholder`)}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.code} · {service.name}
                  </option>
                ))}
              </Select>
            )}
          />
        )}
      </FormField>
      <FormRow>
        <FormField label={t(`${V}.dialog.variant`)} width="md" required error={errors.variant?.message}>
          {(field) => (
            <Controller
              control={form.control}
              name="variant"
              render={({ field: f }) => (
                <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                  {RATE_VARIANTS.map((v) => (
                    <option key={v} value={v}>
                      {variantLabel(v)}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField label={t(`${V}.dialog.titleField`)} width="md" error={errors.titleId?.message}>
          {(field) => (
            <Controller
              control={form.control}
              name="titleId"
              render={({ field: f }) => (
                <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t(`${V}.allTitles`)} clearable>
                  {titles.map((title) => (
                    <option key={title.id} value={title.id}>
                      {title.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t(`${V}.dialog.discountKind`)} width="md" required error={errors.discountKind?.message}>
          {(field) => (
            <Controller
              control={form.control}
              name="discountKind"
              render={({ field: f }) => (
                <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                  {DISCOUNT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {discountKindLabel(kind)}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField label={t(`${V}.dialog.value`)} width="sm" required help={t(`${V}.dialog.valueHelp.${discountKind as DiscountKind}`)} error={errors.value?.message}>
          {(field) => <Input {...field} {...form.register('value')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </FormRow>
      <EffectiveFromField
        registration={form.register('effectiveFrom')}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={minDateFor(serviceId, variant, titleId === '' ? null : titleId)}
        help={t(`${V}.dialog.fromHelp`)}
      />
    </DialogForm>
  )
}

interface EndVariantDialogProps {
  row: RateVariantRow | null
  serviceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes once closed. */
  triggerRef: RefObject<HTMLButtonElement | null>
  fallbackRef: RefObject<HTMLElement | null>
}

/** « Terminer le tarif »: the last day it applies (the RPC takes the day after as the exclusive end). */
export function EndVariantDialog({ row, serviceName, open, onOpenChange, triggerRef, fallbackRef }: EndVariantDialogProps) {
  const { refusal, fieldRefusal, feedback, clear } = useDialogRefusal({ effective_to: 'lastDay' })
  const end = useEndRateVariant(feedback)
  const handleOpenChange = (next: boolean) => {
    if (end.isPending) return
    if (!next) {
      end.reset()
      clear()
    }
    onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = triggerRef.current
          ;(trigger?.isConnected ? trigger : fallbackRef.current)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${V}.endDialog.title`)}</DialogTitle>
          <DialogDescription>{row ? t(`${V}.endDialog.description`, { variant: variantLabel(row.variant), service: serviceName }) : ''}</DialogDescription>
        </DialogHeader>
        {open && row && (
          <EndVariantForm
            row={row}
            pending={end.isPending}
            refusal={refusal}
            fieldRefusal={fieldRefusal}
            onSubmit={(effectiveTo) => {
              clear()
              end.mutate({ id: row.id, effectiveTo }, { onSuccess: () => onOpenChange(false) })
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EndVariantForm({
  row,
  pending,
  refusal,
  fieldRefusal,
  onSubmit,
}: {
  row: RateVariantRow
  pending: boolean
  refusal: string | null
  fieldRefusal: { field: string; message: string } | null
  onSubmit: (effectiveTo: string) => void
}) {
  const resolver = useMemo(() => zodResolver(endVariantSchema(row.effectiveFrom)), [row.effectiveFrom])
  const form = useForm<{ lastDay: string }, unknown, { effectiveTo: string }>({ resolver, defaultValues: { lastDay: '' } })
  const { errors, isDirty } = form.formState
  useRefusalOnField(form.setError, fieldRefusal)
  return (
    <DialogForm
      onSubmit={(event) => void form.handleSubmit((output) => onSubmit(output.effectiveTo))(event)}
      pending={pending}
      dirty={isDirty}
      refusal={refusal}
      submitLabel={t(`${V}.endDialog.confirm`)}
      pendingLabel={t(`${V}.endDialog.confirming`)}
    >
      <FormField label={t(`${V}.endDialog.lastDay`)} width="sm" required error={errors.lastDay?.message}>
        {(field) => <Input {...field} {...form.register('lastDay')} type="date" min={row.effectiveFrom > FIRST_DATE ? row.effectiveFrom : FIRST_DATE} max={LAST_DATE} autoFocus />}
      </FormField>
    </DialogForm>
  )
}
