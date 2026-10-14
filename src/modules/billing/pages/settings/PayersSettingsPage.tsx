import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { DescriptionList } from '@/shared/components/DescriptionList'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { SaveButton } from '@/shared/components/SaveButton'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnly, getClinicDateString } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { DateField } from '@/shared/ui/date-field'
import { CADENCES, LANGUAGES, type Cadence, type DocumentLanguage, type PayerOrganisation, type PayerSettings } from '../../api/payers'
import { usePayerOrganisations, usePayerSettings, useSavePayerOrganisation, useSetIvacRate } from '../../hooks/use-payers'
import { formatCents, parseDollars } from '../../lib/money'
import { cadenceLabel, organisationKindLabel } from '../../lib/payers'

const S = 'modules.billing.payers.settings'

/**
 * Paramètres → Payeurs tiers (FP): IVAC's rate per session from a day (`billing.settings`, FP-10)
 * and the payer organisations (`billing.manage`): the clinic's IVAC and the PAE providers, each
 * with its billing address, language, the clinic's provider number, when it is invoiced, its
 * delay to pay and whether it gets reminders (off by default, FP-6).
 */
export function PayersSettingsPage() {
  const { can } = useAccess()
  const manage = can('billing.manage')
  const settingsEdit = can('billing.settings')
  const settings = usePayerSettings()
  const organisations = usePayerOrganisations()
  let content
  if ((settings.isError && !settings.data) || (organisations.isError && !organisations.data)) {
    content = (
      <LoadError
        message={t(`${S}.loadError`)}
        retrying={settings.isFetching || organisations.isFetching}
        onRetry={() => {
          void settings.refetch()
          void organisations.refetch()
        }}
      />
    )
  } else if (!settings.data || !organisations.data) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <IvacRateCard key={settings.data.ivacRates.map((r) => `${r.effectiveFrom}:${r.sessionCents}`).join('|')} settings={settings.data} readOnly={!settingsEdit} />
        <OrganisationsCard organisations={organisations.data} manage={manage} />
      </SectionSurface>
    )
  }
  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {!manage && !settingsEdit && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

function IvacRateCard({ settings, readOnly }: { settings: PayerSettings; readOnly: boolean }) {
  const today = getClinicDateString(new Date())
  const [from, setFrom] = useState(today)
  const [amount, setAmount] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; form?: string }>({})
  const save = useSetIvacRate({ onErrorMessage: (message) => setErrors({ form: message }) })
  const dirty = amount.trim() !== ''
  useUnsavedChanges(dirty && !readOnly)
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.rate.title`)}
      description={t(`${S}.rate.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const cents = parseDollars(amount)
        if (cents === null || cents <= 0) return setErrors({ amount: t(`${S}.rate.amountInvalid`) })
        setErrors({})
        save.mutate({ effectiveFrom: from, sessionCents: cents })
      }}
      footer={
        <FormActions
          onCancel={() => {
            setAmount('')
            setFrom(today)
            setErrors({})
          }}
          dirty={dirty}
          pending={save.isPending}
        />
      }
    >
      <p className="text-sm font-medium">
        {settings.ivacRateCents !== null ? t(`${S}.rate.current`, { amount: formatCents(settings.ivacRateCents) }) : t(`${S}.rate.none`)}
      </p>
      {settings.ivacRates.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted-foreground" aria-label={t(`${S}.rate.history`)}>
          {settings.ivacRates.map((r) => (
            <li key={r.effectiveFrom} className="tabular">
              {t(`${S}.rate.from`, { date: formatDateOnly(r.effectiveFrom), amount: formatCents(r.sessionCents) })}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <FormRow>
          <FormField label={t(`${S}.rate.newFrom`)} help={t(`${S}.rate.newFromHelp`)} width="sm" error={errors.form}>
            {(field) => <DateField {...field} value={from} onChange={setFrom} className="w-44" />}
          </FormField>
          <FormField label={t(`${S}.rate.newAmount`)} width="sm" error={errors.amount}>
            {(field) => <Input {...field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" className="tabular w-32" />}
          </FormField>
        </FormRow>
      )}
    </SettingsCard>
  )
}

function OrganisationsCard({ organisations, manage }: { organisations: readonly PayerOrganisation[]; manage: boolean }) {
  const [editing, setEditing] = useState<PayerOrganisation | 'new' | null>(null)
  return (
    <SettingsCard
      as="section"
      layout="section"
      title={t(`${S}.organisations.title`)}
      description={t(`${S}.organisations.description`)}
      footer={
        manage ? (
          <Button type="button" variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t(`${S}.organisations.add`)}
          </Button>
        ) : undefined
      }
    >
      <ul className="space-y-3">
        {organisations.map((o) => (
          <li key={o.id} className="space-y-2 rounded-md border border-border p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {o.name}
              <span className="font-normal text-muted-foreground">· {organisationKindLabel(o.kind)}</span>
              {!o.isActive && <Badge variant="secondary">{t(`${S}.organisations.inactive`)}</Badge>}
              {!o.billingEmail && <Badge variant="warning">{t(`${S}.organisations.noEmail`)}</Badge>}
            </p>
            <DescriptionList
              items={[
                { label: t(`${S}.fields.billingEmail`), value: o.billingEmail },
                { label: t(`${S}.fields.contactName`), value: o.contactName },
                { label: t(`${S}.fields.language`), value: t(`${S}.languages.${o.language}`) },
                { label: t(`${S}.fields.providerNumber`), value: o.providerNumber },
                { label: t(`${S}.fields.cadence`), value: cadenceLabel(o.cadence) },
                { label: t(`${S}.fields.dueDays`), value: t(`${S}.organisations.days`, { count: String(o.dueDays) }) },
                { label: t(`${S}.fields.reminders`), value: t(o.remindersEnabled ? `${S}.organisations.remindersOn` : `${S}.organisations.remindersOff`) },
                { label: t(`${S}.fields.note`), value: o.note },
              ]}
            />
            {manage && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(o)} aria-label={t(`${S}.organisations.editLabel`, { name: o.name })}>
                {t(`${S}.organisations.edit`)}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editing !== null && <OrganisationDialog row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </SettingsCard>
  )
}

const textOrNull = (value: string) => value.trim() || null

function OrganisationDialog({ row, onClose }: { row: PayerOrganisation | null; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '')
  const [billingEmail, setBillingEmail] = useState(row?.billingEmail ?? '')
  const [contactName, setContactName] = useState(row?.contactName ?? '')
  const [language, setLanguage] = useState<DocumentLanguage>(row?.language ?? 'fr')
  const [providerNumber, setProviderNumber] = useState(row?.providerNumber ?? '')
  const [cadence, setCadence] = useState<Cadence>(row?.cadence ?? 'threshold')
  const [dueDays, setDueDays] = useState(String(row?.dueDays ?? 30))
  const [reminders, setReminders] = useState(row?.remindersEnabled ?? false)
  const [active, setActive] = useState(row?.isActive ?? true)
  const [note, setNote] = useState(row?.note ?? '')
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSavePayerOrganisation({ onErrorMessage: setRefusal })
  const ivac = row?.kind === 'ivac'
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? t(`${S}.dialog.editTitle`, { name: row.name }) : t(`${S}.dialog.addTitle`)}</DialogTitle>
          <DialogDescription>{t(ivac ? `${S}.dialog.ivacDescription` : `${S}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const days = Number(dueDays)
            if (!/^[0-9]{1,3}$/.test(dueDays.trim()) || days > 120) return setRefusal(t(`${S}.dialog.dueDaysInvalid`))
            setRefusal(null)
            save.mutate(
              {
                id: row?.id ?? null,
                name: name.trim(),
                billingEmail: textOrNull(billingEmail),
                contactName: textOrNull(contactName),
                language,
                providerNumber: textOrNull(providerNumber),
                cadence,
                dueDays: days,
                remindersEnabled: reminders,
                isActive: ivac ? true : active,
                note: textOrNull(note),
              },
              { onSuccess: onClose },
            )
          }}
        >
          <FormField label={t(`${S}.fields.name`)} width="full" required>
            {(field) => <Input {...field} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />}
          </FormField>
          <FormRow>
            <FormField label={t(`${S}.fields.billingEmail`)} help={t(`${S}.fields.billingEmailHelp`)} width="md">
              {(field) => <Input {...field} type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} maxLength={254} autoComplete="off" />}
            </FormField>
            <FormField label={t(`${S}.fields.contactName`)} width="md">
              {(field) => <Input {...field} value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} autoComplete="off" />}
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label={t(`${S}.fields.language`)} width="sm">
              {(field) => (
                <Select {...field} value={language} onChange={(e) => setLanguage(e.target.value as DocumentLanguage)}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t(`${S}.languages.${l}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t(`${S}.fields.providerNumber`)} help={t(`${S}.fields.providerNumberHelp`)} width="md">
              {(field) => <Input {...field} value={providerNumber} onChange={(e) => setProviderNumber(e.target.value)} maxLength={60} autoComplete="off" />}
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label={t(`${S}.fields.cadence`)} help={t(`${S}.cadenceHelp.${cadence}`)} width="md">
              {(field) => (
                <Select {...field} value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {cadenceLabel(c)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t(`${S}.fields.dueDays`)} width="xs">
              {(field) => <Input {...field} value={dueDays} onChange={(e) => setDueDays(e.target.value)} inputMode="numeric" maxLength={3} className="tabular" />}
            </FormField>
          </FormRow>
          <CheckboxField label={t(`${S}.fields.reminders`)} help={t(`${S}.fields.remindersHelp`)} checked={reminders} onCheckedChange={setReminders} />
          {!ivac && <CheckboxField label={t(`${S}.fields.active`)} help={t(`${S}.fields.activeHelp`)} checked={active} onCheckedChange={setActive} />}
          <FormField label={t(`${S}.fields.note`)} width="full">
            {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />}
          </FormField>
          {refusal && <RefusalAlert message={refusal} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={save.isPending} disabled={name.trim() === ''} label={t('common.save')} pendingLabel={t('common.saving')} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
