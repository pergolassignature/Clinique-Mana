import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { Controller, useController, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { DescriptionList } from '@/shared/components/DescriptionList'
import { SectionHeading } from '@/shared/components/SectionHeading'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { PolicyInput, ServicesSettings } from '../../api/catalogue'
import type { BillingPolicy, Service } from '../../api/parse'
import { useAddBillingPolicy, useDeleteBillingPolicy } from '../../hooks/use-services'
import { FEE_MODES } from '../../lib/constants'
import { canDeleteDated, datedStatus, earliestStart, periodLabel, rowsOf, shownRow } from '../../lib/dated'
import { feeModeLabel } from '../../lib/display'
import { formatPercent, percentInput } from '../../lib/format'
import { policySchema, type PolicyFormValues } from '../../schemas/dated'
import { useDialogRefusal, useRefusalOnField } from '../../hooks/use-dialog-refusal'
import { ConfirmDeleteDialog, DatedStatusBadge, DialogForm, EffectiveFromField } from './DatedParts'

const P = 'modules.services.settings.policy'

const HINT_FIELDS = {
  effective_from: 'effectiveFrom',
  late_notice_hours: 'lateNoticeHours',
  first_fee_percent: 'firstFeePercent',
  next_fee_percent: 'nextFeePercent',
  file_opening_service_id: 'fileOpeningServiceId',
  fee_mode: 'feeMode',
} as const

interface BillingPolicyCardProps {
  data: ServicesSettings
  canEdit: boolean
}

/**
 * « Politique d'annulation » (R-6, R-37, R-59): the policy in force as a `DescriptionList`, the
 * coming one when there is one, the history, « Nouvelle politique » and « Supprimer » on the
 * coming policy (the first one of the clinic stays).
 */
export function BillingPolicyCard({ data, canEdit }: BillingPolicyCardProps) {
  const { policies, services } = data
  const today = useClinicDate()
  const now = Date.now()
  const series = rowsOf(policies, () => true)
  const current = shownRow(series, today)
  const upcoming = series.find((row) => row.effectiveTo === null && datedStatus(row, today) === 'upcoming' && row !== current) ?? null
  const [toDelete, setToDelete] = useState<BillingPolicy | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteBillingPolicy({ onErrorMessage: (message) => setRefusal(message) })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)

  const items = (policy: BillingPolicy) => [
    { label: t(`${P}.fields.lateNotice`), value: t(`${P}.hours`, { hours: String(policy.lateNoticeHours) }) },
    { label: t(`${P}.fields.firstFee`), value: formatPercent(policy.firstFeePercent) },
    { label: t(`${P}.fields.nextFee`), value: formatPercent(policy.nextFeePercent) },
    {
      label: t(`${P}.fields.fileOpening`),
      value: policy.fileOpeningServiceId === null ? null : (services.find((s) => s.id === policy.fileOpeningServiceId)?.name ?? t(`${P}.unknownService`)),
      empty: t(`${P}.noFileOpening`),
    },
    { label: t(`${P}.fields.feeMode`), value: feeModeLabel(policy.feeMode) },
  ]

  return (
    <SettingsCard
      as="section"
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      footer={canEdit ? <PolicyDialog ref={addRef} policies={series} services={services.filter((s) => s.isActive)} /> : undefined}
    >
      {current === null ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.none`)}</p>
      ) : (
        <div className="space-y-4">
          <section>
            <SectionHeading as="h3" description={periodLabel(current)}>
              {t(`${P}.current`)}
            </SectionHeading>
            <DescriptionList items={items(current)} className="mt-2" />
          </section>
          {upcoming && (
            <section>
              <SectionHeading as="h3" description={periodLabel(upcoming)}>
                {t(`${P}.upcoming`)}
              </SectionHeading>
              <DescriptionList items={items(upcoming)} className="mt-2" />
            </section>
          )}
          {series.length > 1 && (
            <section>
              <SectionHeading as="h3">{t(`${P}.history`)}</SectionHeading>
              <Table aria-label={t(`${P}.historyLabel`)} className="mt-2 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
                <TableHeader>
                  <TableRow className="[&>th]:whitespace-nowrap">
                    <TableHead>{t(`${P}.columns.period`)}</TableHead>
                    <TableHead align="right">{t(`${P}.columns.notice`)}</TableHead>
                    <TableHead>{t(`${P}.columns.fees`)}</TableHead>
                    <TableHead className="max-sm:hidden">{t(`${P}.columns.mode`)}</TableHead>
                    {canEdit && (
                      <TableHead>
                        <span className="sr-only">{t(`${P}.columns.actions`)}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {series.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell className="whitespace-nowrap">
                        {periodLabel(policy)}
                        <span className="ml-2">
                          <DatedStatusBadge status={datedStatus(policy, today)} />
                        </span>
                      </TableCell>
                      <TableCell align="right" className="whitespace-nowrap tabular">
                        {t(`${P}.hours`, { hours: String(policy.lateNoticeHours) })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular">{t(`${P}.fees`, { first: formatPercent(policy.firstFeePercent), next: formatPercent(policy.nextFeePercent) })}</TableCell>
                      <TableCell className="max-sm:hidden">{feeModeLabel(policy.feeMode)}</TableCell>
                      {canEdit && (
                        <TableCell className="py-1 text-right">
                          {canDeleteDated(policy, series, today, now, { keepFirst: true }) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={t(`${P}.deleteLabel`, { date: formatDateOnlyShort(policy.effectiveFrom) })}
                              onClick={(event) => {
                                trigger.current = event.currentTarget
                                setRefusal(null)
                                setToDelete(policy)
                              }}
                            >
                              <Trash2 aria-hidden className="sm:hidden" />
                              <span className="max-sm:sr-only">{t(`${P}.delete`)}</span>
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>
      )}
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${P}.deleteTitle`)}
        body={toDelete ? t(`${P}.deleteBody`, { date: formatDateOnlyShort(toDelete.effectiveFrom) }) : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={trigger}
        fallbackRef={addRef}
      />
    </SettingsCard>
  )
}

interface PolicyDialogProps {
  /** Newest first. */
  policies: readonly BillingPolicy[]
  /** The active services, for « Ouverture de dossier ». */
  services: readonly Service[]
}

/** « Nouvelle politique »: prefilled from the open one; the start date closes it the day before. */
const PolicyDialog = forwardRef<HTMLButtonElement, PolicyDialogProps>(function PolicyDialog({ policies, services }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, fieldRefusal, feedback, clear } = useDialogRefusal(HINT_FIELDS)
  const save = useAddBillingPolicy(feedback)
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
        <Button ref={ref} type="button" variant="outline">
          <Plus aria-hidden />
          {t(`${P}.add`)}
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
          <DialogTitle>{t(`${P}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${P}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        {open && (
          <PolicyForm
            policies={policies}
            services={services}
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

interface PolicyFormProps extends PolicyDialogProps {
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  fieldRefusal: { field: string; message: string } | null
  onSubmit: (input: PolicyInput) => void
}

function PolicyForm({ policies, services, firstFieldRef, pending, refusal, fieldRefusal, onSubmit }: PolicyFormProps) {
  const minDate = earliestStart(policies)
  const resolver = useMemo(() => zodResolver(policySchema(minDate)), [minDate])
  const openPolicy = policies.find((row) => row.effectiveTo === null)
  const form = useForm<PolicyFormValues, unknown, PolicyInput>({
    resolver,
    defaultValues: {
      effectiveFrom: '',
      lateNoticeHours: String(openPolicy?.lateNoticeHours ?? 24),
      firstFeePercent: percentInput(openPolicy?.firstFeePercent ?? 50),
      nextFeePercent: percentInput(openPolicy?.nextFeePercent ?? 100),
      fileOpeningServiceId: openPolicy?.fileOpeningServiceId ?? '',
      feeMode: openPolicy?.feeMode ?? 'confirm',
    },
  })
  const { errors, isDirty } = form.formState
  useRefusalOnField(form.setError, fieldRefusal)
  const { field: from } = useController({ control: form.control, name: 'effectiveFrom' })
  const { ref: noticeRef, ...noticeField } = form.register('lateNoticeHours')

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <FormRow>
        <FormField label={t(`${P}.dialog.lateNotice`)} width="xs" required error={errors.lateNoticeHours?.message}>
          {(field) => (
            <Input
              {...field}
              {...noticeField}
              ref={(element) => {
                noticeRef(element)
                firstFieldRef.current = element
              }}
              inputMode="numeric"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField label={t(`${P}.dialog.firstFee`)} width="xs" required error={errors.firstFeePercent?.message}>
          {(field) => <Input {...field} {...form.register('firstFeePercent')} inputMode="decimal" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${P}.dialog.nextFee`)} width="xs" required error={errors.nextFeePercent?.message}>
          {(field) => <Input {...field} {...form.register('nextFeePercent')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </FormRow>
      <FormField label={t(`${P}.dialog.fileOpening`)} width="full" error={errors.fileOpeningServiceId?.message}>
        {(field) => (
          <Controller
            control={form.control}
            name="fileOpeningServiceId"
            render={({ field: f }) => (
              <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t(`${P}.dialog.fileOpeningNone`)} clearable>
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
      <FormField label={t(`${P}.dialog.feeMode`)} width="md" required help={t(`${P}.dialog.feeModeHelp`)} error={errors.feeMode?.message}>
        {(field) => (
          <Controller
            control={form.control}
            name="feeMode"
            render={({ field: f }) => (
              <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                {FEE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {feeModeLabel(mode)}
                  </option>
                ))}
              </Select>
            )}
          />
        )}
      </FormField>
      <EffectiveFromField input={from} error={errors.effectiveFrom?.message} min={minDate} help={t(`${P}.dialog.fromHelp`)} />
    </DialogForm>
  )
}
