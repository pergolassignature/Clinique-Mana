import { useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import { Switch } from '@/shared/ui/switch'
import type { WaitlistSettings } from '../../api/waitlist'
import { useSaveWaitlistSettings, useWaitlistSettings } from '../../hooks/use-waitlist'
import { demandesError } from '../../lib/errors'

const S = 'modules.demandes.waitlist.settings'

/**
 * Paramètres → Liste d'attente (Demandes D3, D-17; seen with `demandes.view`, changed with
 * `demandes.waitlist`): when an entry without news becomes « À rappeler », and the optional email
 * « Souhaitez-vous rester sur la liste d'attente ? » with the days the person has to answer. The
 * daily job itself is switched on in « Tâches planifiées ».
 */
export function WaitlistSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useWaitlistSettings()
  let content
  if (settings.isError && !settings.data) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else if (!settings.data) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <FollowUpCard key={JSON.stringify(settings.data)} settings={settings.data} readOnly={readOnly} />
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

interface Draft {
  followupWeeks: string
  followupEmail: boolean
  answerDays: string
}

const toDraft = (s: WaitlistSettings): Draft => ({ followupWeeks: String(s.followupWeeks), followupEmail: s.followupEmail, answerDays: String(s.answerDays) })
const inRange = (value: string, min: number, max: number) => /^[0-9]{1,2}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max

function FollowUpCard({ settings, readOnly }: { settings: WaitlistSettings; readOnly: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [errors, setErrors] = useState<Partial<Record<'followupWeeks' | 'answerDays' | 'server', string>>>({})
  const save = useSaveWaitlistSettings()
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings))
  useUnsavedChanges(dirty && !readOnly)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!inRange(draft.followupWeeks, 1, 26)) next.followupWeeks = t(`${S}.weeksInvalid`)
    if (!inRange(draft.answerDays, 3, 30)) next.answerDays = t(`${S}.daysInvalid`)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    save.mutate(
      { followupWeeks: Number(draft.followupWeeks), followupEmail: draft.followupEmail, answerDays: Number(draft.answerDays) },
      {
        onSuccess: () => toast.success(t(`${S}.saved`)),
        onError: (error) => setErrors({ server: demandesError(error) }),
      },
    )
  }

  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.followUp.title`)}
      description={t(`${S}.followUp.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={submit}
      footer={<FormActions onCancel={() => setDraft(toDraft(settings))} dirty={dirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.followUp.weeks`)} help={t(`${S}.followUp.weeksHelp`)} error={errors.followupWeeks}>
        {(field) => (
          <Input {...field} value={draft.followupWeeks} onChange={(e) => set({ followupWeeks: e.target.value })} inputMode="numeric" maxLength={2} className="tabular w-20" />
        )}
      </FormField>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t(`${S}.followUp.email`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${S}.followUp.emailHelp`)}</p>
        </div>
        <Switch checked={draft.followupEmail} readOnly={readOnly} onCheckedChange={(followupEmail) => set({ followupEmail })} aria-label={t(`${S}.followUp.email`)} />
      </div>
      <FormField label={t(`${S}.followUp.days`)} help={t(`${S}.followUp.daysHelp`)} error={errors.answerDays}>
        {(field) => (
          <Input {...field} value={draft.answerDays} onChange={(e) => set({ answerDays: e.target.value })} inputMode="numeric" maxLength={2} className="tabular w-20" />
        )}
      </FormField>
      {errors.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.server}
        </p>
      )}
    </SettingsCard>
  )
}
