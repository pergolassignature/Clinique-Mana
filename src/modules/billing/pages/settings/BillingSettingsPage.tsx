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

const S = 'modules.billing.settings'

/**
 * Paramètres → Facturation (`billing.view` to read, `billing.settings` to change; F1): where the
 * year's numbering continues (`AAAA-N`): at the cutover, GOrendezvous's last number, so the next
 * invoice follows it. It never goes below a number this app already gave. QuickBooks (FQ) adds its
 * own sections.
 */
export function BillingSettingsPage() {
  const { readOnly } = useSettingsSection()
  const year = Number(getClinicDateString(new Date()).slice(0, 4))
  const sequence = useSequence(year)
  let content
  if (sequence.isError && sequence.data === undefined) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={sequence.isFetching} onRetry={() => void sequence.refetch()} />
  } else if (sequence.data === undefined) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <NumberingCard key={sequence.data} year={year} last={sequence.data} readOnly={readOnly} />
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
