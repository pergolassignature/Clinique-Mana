import { useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { getClinicDateString } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useSequence, useSetSequence } from '../../hooks/use-invoices'
import type { BillingSettings } from '../../api/queue'
import { useSetDunning } from '../../hooks/use-follow-up'
import { useBillingSettings, useSetQueueFrom } from '../../hooks/use-queue'

const S = 'modules.billing.settings'

/**
 * Paramètres → Facturation (`billing.view` to read, `billing.settings` to change): where the
 * year's numbering continues (`AAAA-N`; at the cutover, GOrendezvous's last number, never below a
 * number this app already gave), and from which day the morning queue prepares the drafts (F2;
 * empty: off, so GOrendezvous's history never enters it). QuickBooks (FQ) adds its own sections.
 */
export function BillingSettingsPage() {
  const { readOnly } = useSettingsSection()
  const year = Number(getClinicDateString(new Date()).slice(0, 4))
  const sequence = useSequence(year)
  const settings = useBillingSettings()
  let content
  if ((sequence.isError && sequence.data === undefined) || (settings.isError && settings.data === undefined)) {
    content = (
      <LoadError
        message={t(`${S}.loadError`)}
        retrying={sequence.isFetching || settings.isFetching}
        onRetry={() => {
          void sequence.refetch()
          void settings.refetch()
        }}
      />
    )
  } else if (sequence.data === undefined || settings.data === undefined) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <NumberingCard key={sequence.data} year={year} last={sequence.data} readOnly={readOnly} />
        <QueueCard key={settings.data.queueFrom ?? ''} queueFrom={settings.data.queueFrom} readOnly={readOnly} />
        <DunningCard
          key={`${settings.data.dunningFrom ?? ''}|${settings.data.dunningDays.join(',')}|${settings.data.blockAfterDays}`}
          settings={settings.data}
          readOnly={readOnly}
        />
      </SectionSurface>
    )
  }
  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

function NumberingCard({ year, last, readOnly }: { year: number; last: number; readOnly: boolean }) {
  const [value, setValue] = useState(String(last))
  const [error, setError] = useState<string | null>(null)
  const save = useSetSequence({ onErrorMessage: setError })
  const dirty = value.trim() !== String(last)
  useUnsavedChanges(dirty && !readOnly)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!/^[0-9]{1,7}$/.test(value.trim())) return setError(t(`${S}.numberInvalid`))
    setError(null)
    save.mutate({ year, lastNumber: Number(value.trim()) })
  }
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.numbering.title`)}
      description={t(`${S}.numbering.description`, { next: `${year}-${(Number(value) || last) + 1}` })}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={submit}
      footer={<FormActions onCancel={() => setValue(String(last))} dirty={dirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.numbering.last`, { year: String(year) })} help={t(`${S}.numbering.lastHelp`)} error={error ?? undefined}>
        {(field) => <Input {...field} value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" maxLength={7} className="tabular w-28" />}
      </FormField>
    </SettingsCard>
  )
}

const Q = 'modules.billing.settings.queue'

/** « File du matin »: from which day the night prepares the drafts (empty: off). */
function QueueCard({ queueFrom, readOnly }: { queueFrom: string | null; readOnly: boolean }) {
  const [value, setValue] = useState(queueFrom ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useSetQueueFrom({ onErrorMessage: setError })
  const dirty = value !== (queueFrom ?? '')
  useUnsavedChanges(dirty && !readOnly)
  return (
    <SettingsCard
      layout="section"
      title={t(`${Q}.title`)}
      description={t(`${Q}.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError(null)
        save.mutate(value || null)
      }}
      footer={<FormActions onCancel={() => setValue(queueFrom ?? '')} dirty={dirty} pending={save.isPending} />}
    >
      <FormField label={t(`${Q}.from`)} help={t(`${Q}.fromHelp`)} error={error ?? undefined}>
        {(field) => <Input {...field} type="date" value={value} onChange={(e) => setValue(e.target.value)} readOnly={readOnly} className="w-44" />}
      </FormField>
    </SettingsCard>
  )
}

const D = 'modules.billing.settings.dunning'

/** « Relances » (F3, R-58): from which issue date, at which days after the due date, and the day a balance blocks a booking. */
function DunningCard({ settings, readOnly }: { settings: BillingSettings; readOnly: boolean }) {
  const initial = { from: settings.dunningFrom ?? '', days: settings.dunningDays.join(', '), block: String(settings.blockAfterDays) }
  const [from, setFrom] = useState(initial.from)
  const [days, setDays] = useState(initial.days)
  const [block, setBlock] = useState(initial.block)
  const [errors, setErrors] = useState<{ days?: string; block?: string; form?: string }>({})
  const save = useSetDunning({ onErrorMessage: (message) => setErrors({ form: message }) })
  const dirty = from !== initial.from || days !== initial.days || block !== initial.block
  useUnsavedChanges(dirty && !readOnly)
  const reset = () => {
    setFrom(initial.from)
    setDays(initial.days)
    setBlock(initial.block)
    setErrors({})
  }
  return (
    <SettingsCard
      layout="section"
      title={t(`${D}.title`)}
      description={t(`${D}.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const parsed = days.split(/[,;\s]+/).filter(Boolean).map(Number)
        const next: typeof errors = {}
        if (parsed.length < 1 || parsed.length > 6 || parsed.some((d) => !Number.isInteger(d) || d < 1 || d > 60)) next.days = t(`${D}.daysInvalid`)
        const blockDays = Number(block)
        if (!Number.isInteger(blockDays) || blockDays < 1 || blockDays > 90) next.block = t(`${D}.blockInvalid`)
        setErrors(next)
        if (next.days || next.block) return
        save.mutate({ dunningFrom: from || null, days: parsed, blockAfterDays: blockDays })
      }}
      footer={<FormActions onCancel={reset} dirty={dirty} pending={save.isPending} />}
    >
      <FormField label={t(`${D}.from`)} help={t(`${D}.fromHelp`)} error={errors.form}>
        {(field) => <Input {...field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} readOnly={readOnly} className="w-44" />}
      </FormField>
      <FormField label={t(`${D}.days`)} help={t(`${D}.daysHelp`)} error={errors.days}>
        {(field) => <Input {...field} value={days} onChange={(e) => setDays(e.target.value)} readOnly={readOnly} className="tabular w-44" />}
      </FormField>
      <FormField label={t(`${D}.block`)} help={t(`${D}.blockHelp`)} error={errors.block}>
        {(field) => <Input {...field} value={block} onChange={(e) => setBlock(e.target.value)} readOnly={readOnly} inputMode="numeric" className="tabular w-28" />}
      </FormField>
    </SettingsCard>
  )
}
