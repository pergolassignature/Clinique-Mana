import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SaveButton } from '@/shared/components/SaveButton'
import { SectionHeading } from '@/shared/components/SectionHeading'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionTitle, Service, ServiceFamily } from '../../api/parse'
import { useSaveService } from '../../hooks/use-services'
import { GRID_DURATIONS, PRICE_SOURCES, SERVICE_KINDS, TAX_RULES } from '../../lib/constants'
import { gridDurationLabel, kindLabel, priceSourceLabel, taxRuleLabel } from '../../lib/display'
import { emptyServiceForm, serviceFormValues, serviceSchema, type ServiceFormOutput, type ServiceFormValues } from '../../schemas/service'
import { useDialogRefusal, useRefusalOnField } from '../../hooks/use-dialog-refusal'
import { RefusalAlert } from './DatedParts'

const S = 'modules.services.settings.sheet'

/** The RPC's HINTs → the form's fields. */
const HINT_FIELDS = {
  family_id: 'familyId',
  code: 'code',
  key: 'key',
  name: 'name',
  description: 'description',
  kind: 'kind',
  duration_minutes: 'durationMinutes',
  buffer_after_minutes: 'bufferAfterMinutes',
  price_source: 'priceSource',
  fixed_price_cents: 'fixedPrice',
  grid_duration: 'gridDuration',
  tax_rule: 'taxRule',
  colour: 'colour',
  sort_order: 'sortOrder',
  title_ids: 'titleIds',
} as const

export interface ServiceSheetProps {
  open: boolean
  /** The service edited, or null to add one. Kept while the sheet closes, so its content does not change. */
  service: Service | null
  /** The titles offering the edited service (ids). */
  titleIds: readonly string[]
  families: readonly ServiceFamily[]
  /** Every service, archived ones included: a code or a key already taken is refused before saving. */
  services: readonly Service[]
  titles: readonly ProfessionTitle[]
  onClose: () => void
  /** Where focus goes once closed (the row's « Modifier », or « Ajouter un service »). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Ajouter un service » / « Modifier le service » (plan S3.2): a sheet over the catalogue with
 * every field of `save_service` and the professions offering the service. The key, the code
 * and the family are typed once (read-only on an existing service). Closing with changes (Échap,
 * X, outside) asks first; while it saves the sheet cannot be closed, so its outcome is always
 * seen: success closes it (toast), a refusal stays in it, under its field when the database names
 * one. The panel mounts on each opening, so it always starts from the saved service.
 */
export function ServiceSheet({ open, onClose, ...panel }: ServiceSheetProps) {
  return (
    // Closing goes through the panel (it may ask first): Radix never closes it here.
    <Sheet open={open} onOpenChange={() => undefined}>
      {open && <ServicePanel {...panel} onClose={onClose} />}
    </Sheet>
  )
}

type PanelProps = Omit<ServiceSheetProps, 'open'>

function ServicePanel({ service, titleIds, families, services, titles, onClose, onCloseAutoFocus }: PanelProps) {
  const [confirming, setConfirming] = useState(false)
  const { refusal, fieldRefusal, feedback, clear } = useDialogRefusal(HINT_FIELDS)
  const save = useSaveService(feedback)
  const firstField = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const editing = service !== null

  const others = useMemo(() => services.filter((s) => s.id !== service?.id), [services, service])
  const resolver = useMemo(() => zodResolver(serviceSchema({ families, others })), [families, others])
  const form = useForm<ServiceFormValues, unknown, ServiceFormOutput>({
    resolver,
    defaultValues: service ? serviceFormValues(service, titleIds) : emptyServiceForm(families[0]?.id ?? ''),
  })
  const { errors, isDirty } = form.formState
  const { ref: nameRef, ...nameField } = form.register('name')
  useRefusalOnField(form.setError, fieldRefusal)
  useUnsavedChanges(isDirty)
  const [priceSource, familyId] = useWatch({ control: form.control, name: ['priceSource', 'familyId'] })
  const family = families.find((f) => f.id === familyId)

  const requestClose = () => {
    if (save.isPending) return
    if (isDirty) setConfirming(true)
    else onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.stopPropagation()
    void form.handleSubmit((output) => {
      clear()
      const { titleIds: nextTitles, ...fields } = output
      const sameTitles = editing && [...titleIds].sort().join() === [...nextTitles].sort().join()
      save.mutate({ input: { id: service?.id ?? null, ...fields }, titleIds: sameTitles ? null : nextTitles }, { onSuccess: onClose })
    })(event)
  }

  return (
    <SheetContent
      ref={contentRef}
      hideClose
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        firstField.current?.focus()
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onInteractOutside={(event) => {
        event.preventDefault()
        requestClose()
      }}
      className="max-w-[560px]"
    >
      <SheetHeader>
        <SheetTitle>{t(editing ? `${S}.editTitle` : `${S}.createTitle`)}</SheetTitle>
        <SheetDescription>{t(editing ? `${S}.editDescription` : `${S}.createDescription`)}</SheetDescription>
      </SheetHeader>
      {/* Custom X: it closes through the guard. Out of the tab order (CLAUDE.md §10). */}
      <button type="button" tabIndex={-1} onClick={requestClose} className={closeButtonClasses}>
        <X aria-hidden className="h-4 w-4" />
        <span className="sr-only">{t('common.close')}</span>
      </button>
      <form noValidate onSubmit={submit} aria-busy={save.isPending || undefined} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${S}.sections.identity`)}</SectionHeading>
            <FormRow>
              <FormField label={t(`${S}.fields.family`)} width="md" required readOnly={editing} error={errors.familyId?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="familyId"
                    render={({ field: f }) => (
                      <Select
                        {...field}
                        value={f.value}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        ref={(element) => {
                          f.ref(element)
                          if (!editing) firstField.current = element
                        }}
                        placeholder={t(`${S}.familyPlaceholder`)}
                      >
                        {families.map((fam) => (
                          <option key={fam.id} value={fam.id}>
                            {fam.code} · {fam.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField
                label={t(`${S}.fields.code`)}
                width="sm"
                required
                readOnly={editing}
                help={editing ? undefined : family ? t(`${S}.help.codeRange`, { from: `${family.code} 000`, to: `${family.code} 999` }) : t(`${S}.help.code`)}
                error={errors.code?.message}
              >
                {(field) => <Input {...field} {...form.register('code')} inputMode="numeric" autoComplete="off" />}
              </FormField>
            </FormRow>
            <FormField label={t(`${S}.fields.key`)} width="md" required readOnly={editing} help={editing ? undefined : t(`${S}.help.key`)} error={errors.key?.message}>
              {(field) => <Input {...field} {...form.register('key')} autoComplete="off" spellCheck={false} />}
            </FormField>
            <FormField label={t(`${S}.fields.name`)} width="full" required error={errors.name?.message}>
              {(field) => (
                <Input
                  {...field}
                  {...nameField}
                  ref={(element) => {
                    nameRef(element)
                    // The first field an existing service lets you change.
                    if (editing) firstField.current = element
                  }}
                  autoComplete="off"
                />
              )}
            </FormField>
            <FormField label={t(`${S}.fields.description`)} width="full" error={errors.description?.message}>
              {(field) => <Textarea {...field} {...form.register('description')} rows={2} className="min-h-16" />}
            </FormField>
            <FormRow>
              <FormField label={t(`${S}.fields.kind`)} width="md" required error={errors.kind?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="kind"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                        {SERVICE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kindLabel(kind)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField label={t(`${S}.fields.sortOrder`)} width="xs" error={errors.sortOrder?.message}>
                {(field) => <Input {...field} {...form.register('sortOrder')} inputMode="numeric" autoComplete="off" />}
              </FormField>
            </FormRow>
          </section>

          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${S}.sections.slot`)}</SectionHeading>
            <FormRow>
              <FormField label={t(`${S}.fields.duration`)} width="xs" required error={errors.durationMinutes?.message}>
                {(field) => <Input {...field} {...form.register('durationMinutes')} inputMode="numeric" autoComplete="off" />}
              </FormField>
              <FormField label={t(`${S}.fields.buffer`)} width="xs" required help={t(`${S}.help.buffer`)} error={errors.bufferAfterMinutes?.message}>
                {(field) => <Input {...field} {...form.register('bufferAfterMinutes')} inputMode="numeric" autoComplete="off" />}
              </FormField>
            </FormRow>
            <Controller
              control={form.control}
              name="forTwo"
              render={({ field: f }) => (
                <CheckboxField ref={f.ref} label={t(`${S}.fields.forTwo`)} help={t(`${S}.help.forTwo`)} checked={f.value} onCheckedChange={f.onChange} onBlur={f.onBlur} />
              )}
            />
          </section>

          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${S}.sections.price`)}</SectionHeading>
            <FormRow>
              <FormField label={t(`${S}.fields.priceSource`)} width="md" required error={errors.priceSource?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="priceSource"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                        {PRICE_SOURCES.map((source) => (
                          <option key={source} value={source}>
                            {priceSourceLabel(source)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              {priceSource === 'fixed' && (
                <FormField label={t(`${S}.fields.fixedPrice`)} width="sm" required help={t(`${S}.help.fixedPrice`)} error={errors.fixedPrice?.message}>
                  {(field) => <Input {...field} {...form.register('fixedPrice')} inputMode="decimal" autoComplete="off" />}
                </FormField>
              )}
              {priceSource === 'grid' && (
                <FormField label={t(`${S}.fields.gridDuration`)} width="md" required help={t(`${S}.help.gridDuration`)} error={errors.gridDuration?.message}>
                  {(field) => (
                    <Controller
                      control={form.control}
                      name="gridDuration"
                      render={({ field: f }) => (
                        <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t(`${S}.familyPlaceholder`)}>
                          {GRID_DURATIONS.map((duration) => (
                            <option key={duration} value={String(duration)}>
                              {gridDurationLabel(duration)}
                            </option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </FormField>
              )}
            </FormRow>
            <FormRow>
              <FormField label={t(`${S}.fields.taxRule`)} width="md" required error={errors.taxRule?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="taxRule"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                        {TAX_RULES.map((rule) => (
                          <option key={rule} value={rule}>
                            {taxRuleLabel(rule)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField label={t(`${S}.fields.colour`)} width="sm" error={errors.colour?.message}>
                {(field) => <Input {...field} {...form.register('colour')} placeholder="#1a2b3c" autoComplete="off" spellCheck={false} />}
              </FormField>
            </FormRow>
          </section>

          <section className="space-y-3">
            <SectionHeading as="h3" description={t(`${S}.help.titles`)}>
              {t(`${S}.sections.titles`)}
            </SectionHeading>
            {titles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${S}.noTitles`)}</p>
            ) : (
              <Controller
                control={form.control}
                name="titleIds"
                render={({ field: f }) => (
                  <ul className="grid gap-2 sm:grid-cols-2" aria-label={t(`${S}.fields.titles`)}>
                    {titles.map((title) => {
                      const id = `title-${title.id}`
                      const checked = f.value.includes(title.id)
                      return (
                        <li key={title.id} className="flex items-start gap-2.5">
                          <Checkbox
                            id={id}
                            checked={checked}
                            onCheckedChange={(value) => f.onChange(value === true ? [...f.value, title.id].sort() : f.value.filter((x) => x !== title.id))}
                            onBlur={f.onBlur}
                            className="mt-0.5"
                          />
                          <Label htmlFor={id}>{title.name}</Label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              />
            )}
          </section>
          {refusal && <RefusalAlert message={refusal} />}
        </SheetBody>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={save.isPending || undefined}
            onClick={ignoreWhenInactive(save.isPending, requestClose)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
          <SaveButton
            pending={save.isPending}
            disabled={!isDirty}
            variant={isDirty || save.isPending ? 'default' : 'outline'}
            label={editing ? t('common.save') : t(`${S}.create`)}
            pendingLabel={editing ? t('common.saving') : t(`${S}.creating`)}
          />
        </SheetFooter>
      </form>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${S}.confirmClose.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${S}.confirmClose.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${S}.confirmClose.stay`)}</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>{t(`${S}.confirmClose.leave`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  )
}
