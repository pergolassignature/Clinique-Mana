import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, Plus, TriangleAlert, X } from 'lucide-react'
import { t } from '@/i18n'
import { addressAutofill } from '@/core/address/autofill'
import { AddressAutocomplete } from '@/core/address/components/AddressAutocomplete'
import { rpcErrorHint } from '@/core/modules/errors'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SaveButton } from '@/shared/components/SaveButton'
import { SectionHeading } from '@/shared/components/SectionHeading'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatPostalCode, parsePhone, regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
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
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { Textarea } from '@/shared/ui/textarea'
import { DateField } from '@/shared/ui/date-field'
import type { ClientDuplicate } from '../../api/parse'
import { useClientDuplicates, useClientsReference, useCreateClient } from '../../hooks/use-clients'
import { LANGUAGES, SEXES, clientPath } from '../../lib/constants'
import { choices, clientNumberLabel, duplicateReasonLabel as reasonLabel, languageLabel, phoneLabel, sexLabel } from '../../lib/display'
import { ReferrerField } from '../picker/ReferrerField'
import { ALL_CLIENT_FIELDS, clientCardSchema, emptyClientForm, fieldOfHint, toClientFields, type ClientFieldOutput, type ClientFormValues } from '../../schemas/client'

const C = 'modules.clients.create'

const ADDRESS_FIELDS = { line1: 'addressLine1', line2: 'addressLine2', city: 'city', province: 'province', postalCode: 'postalCode' } as const

/**
 * « Nouveau client » (plan C3.3): a sheet in sections (Identité, Coordonnées, Adresse, Dossier,
 * Notes administratives). While the name is typed, the « Dossiers semblables » panel lists the
 * clinic's possible duplicates (the rules of the import, I-5), 400 ms after the last keystroke,
 * each with « Ouvrir le dossier existant ». A HIGH duplicate refuses the creation; a MEDIUM one
 * needs « C'est une autre personne » ticked. Closing with changes asks first; the record opens
 * once created, unless the caller takes the new file's id (`onCreated`, the client picker of other
 * modules), which may also take an existing file from the panel (`onPickExisting`).
 */
export interface CreateClientDialogProps {
  /** The new file's id; without it the record opens. */
  onCreated?: (clientId: string) => void
  /** Offers « Choisir ce dossier » on each similar file: its id instead of a new file. */
  onPickExisting?: (clientId: string) => void
  /** Similar files that cannot be chosen (the picker's `excludeIds`). */
  excludeIds?: readonly string[]
  /** The form's first values (a name typed in the picker's search…). */
  initialValues?: Partial<Pick<ClientFormValues, 'firstName' | 'lastName' | 'email' | 'mobile'>>
  /** The trigger's look: the page's primary button, or an outline one inside a form. */
  variant?: 'default' | 'outline'
}

export function CreateClientDialog({ onCreated, onPickExisting, excludeIds, initialValues, variant = 'default' }: CreateClientDialogProps = {}) {
  const [open, setOpen] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  return (
    <Sheet open={open} onOpenChange={() => undefined}>
      <SheetTrigger asChild>
        <Button ref={addRef} type="button" variant={variant} onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          {t(`${C}.add`)}
        </Button>
      </SheetTrigger>
      {open && <CreatePanel onClose={() => setOpen(false)} onCreated={onCreated} onPickExisting={onPickExisting} excludeIds={excludeIds} initialValues={initialValues} />}
    </Sheet>
  )
}

function CreatePanel({ onClose, onCreated, onPickExisting, excludeIds = [], initialValues }: { onClose: () => void } & Omit<CreateClientDialogProps, 'variant'>) {
  const navigate = useNavigate()
  const reference = useClientsReference()
  const [confirming, setConfirming] = useState(false)
  // « C'est une autre personne » answers for the similar files shown when it was ticked: another
  // set (an edited email…) needs a new tick. `server` when the database found one the panel did not.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const [serverMediumFor, setServerMediumFor] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The staff notes have their own table: kept beside the form, sent with the creation.
  const [adminNotes, setAdminNotes] = useState('')
  const firstName = useRef<HTMLInputElement | null>(null)
  const schema = useMemo(() => clientCardSchema(ALL_CLIENT_FIELDS), [])
  const form = useForm<ClientFormValues, unknown, ClientFieldOutput>({ resolver: zodResolver(schema), defaultValues: { ...emptyClientForm(), ...initialValues } })
  const { errors } = form.formState
  const isDirty = form.formState.isDirty || adminNotes.trim() !== ''
  // A caller's values (the picker) are enough to create: the person may not have typed anything.
  const ready = isDirty || Object.values(initialValues ?? {}).some((value) => Boolean(value?.trim()))
  useUnsavedChanges(isDirty)
  const create = useCreateClient({
    onErrorMessage: (message, error) => {
      const hint = rpcErrorHint(error)
      const field = fieldOfHint(hint)
      if (hint === 'duplicate_medium') setServerMediumFor(probeKeyRef.current)
      if (field) form.setError(field, { message }, { shouldFocus: true })
      else setRefusal(message)
    },
  })

  // The duplicate panel follows the identity and the contacts, once a first and a last name are typed.
  const [first, last, email, mobile, home, birthday] = useWatch({ control: form.control, name: ['firstName', 'lastName', 'email', 'mobile', 'home', 'birthday'] })
  const [referredBy, referredByClientId] = useWatch({ control: form.control, name: ['referredBy', 'referredByClientId'] })
  const probe = useDebouncedValue(
    useMemo(
      () =>
        first.trim() && last.trim()
          ? {
              firstName: first.trim(),
              lastName: last.trim(),
              email: email.trim().toLowerCase() || null,
              phones: [mobile, home].map((v) => parsePhone(v)).filter((v): v is string => v !== null),
              birthday: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthday) ? birthday : null,
            }
          : null,
      [first, last, email, mobile, home, birthday],
    ),
    400,
  )
  const duplicates = useClientDuplicates(probe)
  const found = probe ? (duplicates.data ?? []) : []
  const high = found.some((d) => d.level === 'high')
  const probeKey = JSON.stringify(probe)
  const probeKeyRef = useRef(probeKey)
  probeKeyRef.current = probeKey
  const mediumIds = found
    .filter((d) => d.level === 'medium')
    .map((d) => d.clientId)
    .sort()
    .join(',')
  const mediumKey = high ? null : mediumIds !== '' ? mediumIds : serverMediumFor === probeKey ? 'server' : null
  const medium = mediumKey !== null
  const confirmMedium = medium && confirmedFor === mediumKey

  const requestClose = () => {
    if (create.isPending) return
    if (isDirty) setConfirming(true)
    else onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    // The sheet is a portal: its submit must not reach a form the picker sits in (React bubbles through portals).
    event.stopPropagation()
    void form.handleSubmit((output) => {
      setRefusal(null)
      const fields = toClientFields(output)
      fields.admin_notes = adminNotes.trim() || null
      create.mutate(
        { fields, confirmMedium },
        {
          onSuccess: (id) => {
            onClose()
            if (onCreated) onCreated(id)
            else navigate(clientPath(id))
          },
        },
      )
    })(event)
  }

  return (
    <SheetContent
      hideClose
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        firstName.current?.focus()
      }}
      onEscapeKeyDown={(event) => {
        // Already handled: Échap closed an open list (« Adresse », « Référé par »), not the sheet.
        if (event.defaultPrevented) return
        event.preventDefault()
        requestClose()
      }}
      onInteractOutside={(event) => {
        event.preventDefault()
        requestClose()
      }}
      className="max-w-[620px]"
    >
      <SheetHeader>
        <SheetTitle>{t(`${C}.title`)}</SheetTitle>
        <SheetDescription>{t(`${C}.description`)}</SheetDescription>
      </SheetHeader>
      {/* Custom X: it closes through the guard. Out of the tab order (CLAUDE.md §10). */}
      <button type="button" tabIndex={-1} onClick={requestClose} className={closeButtonClasses}>
        <X aria-hidden className="h-4 w-4" />
        <span className="sr-only">{t('common.close')}</span>
      </button>
      <form noValidate onSubmit={submit} aria-busy={create.isPending || undefined} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${C}.sections.identity`)}</SectionHeading>
            <FormRow columns={2}>
              <FormField label={t('modules.clients.fields.firstName')} required error={errors.firstName?.message}>
                {(field) => {
                  const { ref, ...rest } = form.register('firstName')
                  return (
                    <Input
                      {...field}
                      {...rest}
                      ref={(element) => {
                        ref(element)
                        firstName.current = element
                      }}
                      autoComplete="off"
                    />
                  )
                }}
              </FormField>
              <FormField label={t('modules.clients.fields.lastName')} required error={errors.lastName?.message}>
                {(field) => <Input {...field} {...form.register('lastName')} autoComplete="off" />}
              </FormField>
            </FormRow>
            <FormRow columns={3}>
              <FormField label={t('modules.clients.fields.birthday')} error={errors.birthday?.message}>
                {(field) => <Controller control={form.control} name="birthday" render={({ field: control }) => <DateField {...field} {...control} min="1900-01-01" />} />}
              </FormField>
              <FormField label={t('modules.clients.fields.sex')} error={errors.sex?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="sex"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t('modules.clients.fields.notSaid')} clearable>
                        {SEXES.map((sex) => (
                          <option key={sex} value={sex}>
                            {sexLabel(sex)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField label={t('modules.clients.fields.language')} required error={errors.language?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="language"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref}>
                        {LANGUAGES.map((language) => (
                          <option key={language} value={language}>
                            {languageLabel(language)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label={t('modules.clients.fields.pronouns')} help={t('modules.clients.fields.pronounsHelp')} error={errors.pronouns?.message}>
                {(field) => <Input {...field} {...form.register('pronouns')} autoComplete="off" />}
              </FormField>
            </FormRow>
          </section>

          <DuplicatePanel
            duplicates={found}
            loading={probe !== null && duplicates.isFetching}
            onPick={
              onPickExisting &&
              ((id) => {
                onClose()
                onPickExisting(id)
              })
            }
            canPick={(id) => !excludeIds.includes(id)}
          />

          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${C}.sections.contact`)}</SectionHeading>
            <FormField label={t('modules.clients.fields.email')} width="full" error={errors.email?.message}>
              {(field) => <Input {...field} {...form.register('email')} type="email" autoComplete="off" spellCheck={false} />}
            </FormField>
            <FormRow columns={2}>
              <FormField label={t('modules.clients.fields.mobile')} error={errors.mobile?.message}>
                {(field) => <Input {...field} {...form.register('mobile', regroupOnBlur(form, 'mobile', regroupPhone))} type="tel" autoComplete="off" />}
              </FormField>
              <FormField label={t('modules.clients.fields.home')} error={errors.home?.message}>
                {(field) => <Input {...field} {...form.register('home', regroupOnBlur(form, 'home', regroupPhone))} type="tel" autoComplete="off" />}
              </FormField>
            </FormRow>
            <Controller
              control={form.control}
              name="remindersBySms"
              render={({ field: f }) => (
                <CheckboxField ref={f.ref} label={t('modules.clients.fields.remindersBySms')} checked={f.value as boolean} onCheckedChange={f.onChange} onBlur={f.onBlur} />
              )}
            />
            <Controller
              control={form.control}
              name="remindersByEmail"
              render={({ field: f }) => (
                <CheckboxField ref={f.ref} label={t('modules.clients.fields.remindersByEmail')} checked={f.value as boolean} onCheckedChange={f.onChange} onBlur={f.onBlur} />
              )}
            />
          </section>

          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${C}.sections.address`)}</SectionHeading>
            <FormField label={t('modules.clients.fields.addressLine1')} error={errors.addressLine1?.message}>
              {(field) => (
                <AddressAutocomplete {...field} {...form.register('addressLine1')} autofill={addressAutofill(form, ADDRESS_FIELDS)} placeholder={t('address.line1Placeholder')} />
              )}
            </FormField>
            {/* Alone in the first column, as Professionnels' address forms (P4-220). */}
            <FormRow columns={2}>
              <FormField label={t('modules.clients.fields.addressLine2')} error={errors.addressLine2?.message}>
                {(field) => <Input {...field} {...form.register('addressLine2')} placeholder={t('address.line2Placeholder')} autoComplete="off" />}
              </FormField>
            </FormRow>
            <FormRow columns="address">
              <FormField label={t('modules.clients.fields.city')} error={errors.city?.message}>
                {(field) => <Input {...field} {...form.register('city')} autoComplete="off" />}
              </FormField>
              <FormField label={t('modules.clients.fields.province')} error={errors.province?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="province"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} autoComplete="off" clearable placeholder={t('modules.clients.fields.notSaid')}>
                        {PROVINCE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField label={t('modules.clients.fields.postalCode')} error={errors.postalCode?.message}>
                {(field) => (
                  <Input
                    {...field}
                    {...form.register('postalCode', regroupOnBlur(form, 'postalCode', (v) => formatPostalCode(v.trim())))}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                )}
              </FormField>
            </FormRow>
          </section>

          <section className="space-y-3">
            <SectionHeading as="h3">{t(`${C}.sections.file`)}</SectionHeading>
            <FormRow columns={2}>
              {/* A one-line label, so both selects stay on one line; the question is the help. */}
              <FormField
                label={t('modules.clients.fields.referralSourceShort')}
                help={t('modules.clients.fields.referralSource')}
                error={errors.referralSourceId?.message}
              >
                {(field) => (
                  <Controller
                    control={form.control}
                    name="referralSourceId"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t('modules.clients.fields.notSaid')} clearable>
                        {choices(reference.data?.referralSources).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
              <FormField label={t('modules.clients.fields.primaryProfessional')} error={errors.primaryProfessionalId?.message}>
                {(field) => (
                  <Controller
                    control={form.control}
                    name="primaryProfessionalId"
                    render={({ field: f }) => (
                      <Select {...field} value={f.value as string} onChange={f.onChange} onBlur={f.onBlur} ref={f.ref} placeholder={t('modules.clients.fields.none')} clearable>
                        {choices(reference.data?.professionals).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </FormField>
            </FormRow>
            <ReferrerField
              label={t('modules.clients.fields.referredBy')}
              value={{ clientId: referredByClientId, text: referredBy }}
              onChange={(next) => {
                form.setValue('referredByClientId', next.clientId, { shouldDirty: true })
                form.setValue('referredBy', next.text, { shouldDirty: true, shouldValidate: errors.referredBy !== undefined })
              }}
              error={errors.referredBy?.message ?? errors.referredByClientId?.message}
            />
            <FormField label={t('modules.clients.fields.adminNotes')} width="full" help={t('modules.clients.fields.adminNotesHelp')}>
              {(field) => <Textarea {...field} value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} rows={3} maxLength={5000} />}
            </FormField>
          </section>

          {medium && (
            <CheckboxField label={t(`${C}.confirmMedium`)} help={t(`${C}.confirmMediumHelp`)} checked={confirmMedium} onCheckedChange={(value) => setConfirmedFor(value === true ? mediumKey : null)} />
          )}
          {refusal && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription className="text-foreground">{refusal}</AlertDescription>
            </Alert>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={create.isPending || undefined}
            onClick={ignoreWhenInactive(create.isPending, requestClose)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
          <SaveButton pending={create.isPending} disabled={!ready || high} variant={ready && !high ? 'default' : 'outline'} label={t(`${C}.submit`)} pendingLabel={t(`${C}.submitting`)} />
        </SheetFooter>
      </form>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${C}.confirmClose.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${C}.confirmClose.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${C}.confirmClose.stay`)}</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>{t(`${C}.confirmClose.leave`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  )
}


/**
 * « Dossiers semblables »: the possible duplicates while the person is typed, HIGH first (« Ce
 * client a déjà un dossier »), each with its number, birthday and contact and « Ouvrir le dossier
 * existant ». Only a short line is a live region (how many were found), so a screen reader is not
 * read the whole list at each keystroke.
 */
function DuplicatePanel({
  duplicates,
  loading,
  onPick,
  canPick = () => true,
}: {
  duplicates: readonly ClientDuplicate[]
  loading: boolean
  onPick?: (clientId: string) => void
  canPick?: (clientId: string) => boolean
}) {
  const high = duplicates.some((d) => d.level === 'high')
  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {duplicates.length > 0
          ? t(`${C}.duplicates.announce`, { count: String(duplicates.length) })
          : loading
            ? t(`${C}.duplicates.checking`)
            : ''}
      </p>
      {duplicates.length > 0 && (
        <Alert variant={high ? 'destructive' : 'warning'}>
          {high ? <CircleAlert aria-hidden /> : <TriangleAlert aria-hidden />}
          <AlertDescription className="space-y-2 text-foreground">
            <p className="font-medium">{t(high ? `${C}.duplicates.high` : `${C}.duplicates.medium`)}</p>
            <ul className="space-y-1.5">
              {duplicates.map((d) => (
                <li key={d.clientId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span>
                    <span className="font-medium">{d.displayName}</span> · <span className="tabular">{clientNumberLabel(d.clientNumber)}</span>
                    {d.birthday && <> · {formatDateOnlyShort(d.birthday)}</>}
                    {(d.email || d.mobile) && <span className="block text-xs text-muted-foreground">{[d.email, phoneLabel(d.mobile)].filter(Boolean).join(' · ')}</span>}
                    <span className="block text-xs text-muted-foreground">{d.reasons.map(reasonLabel).filter(Boolean).join(', ')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {onPick && canPick(d.clientId) && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onPick(d.clientId)}>
                        {t(`${C}.duplicates.pick`)}
                      </Button>
                    )}
                    <Link to={clientPath(d.clientId)} target="_blank" rel="noreferrer" className="text-link text-sm underline-offset-2 hover:underline">
                      {t(`${C}.duplicates.open`)}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
