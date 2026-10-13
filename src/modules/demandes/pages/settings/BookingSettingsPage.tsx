import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Switch } from '@/shared/ui/switch'
import { bookingPageUrl, type BookingSettings, type WeeklyRange } from '../../api/booking'
import { useBookingSettings, useSaveBookingSettings } from '../../hooks/use-booking'

const S = 'modules.demandes.booking.settings'
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const
const SLOT_MINUTES = [15, 20, 30, 45, 60] as const

/**
 * Paramètres → Appels découverte (Demandes D3c; seen with `demandes.view`, changed with
 * `demandes.manage`): the public booking page that replaces Calendly — open or closed, its address
 * for the website's button — and the weekly rule of the slots it offers (length, notice, horizon,
 * calls at once, the ranges of each day, in the clinic's time).
 */
export function BookingSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useBookingSettings()
  let content
  if (settings.isError && !settings.data) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else if (!settings.data) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <PageCard settings={settings.data} readOnly={readOnly} />
        <SlotsCard settings={settings.data} readOnly={readOnly} />
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

function PageCard({ settings, readOnly }: { settings: BookingSettings; readOnly: boolean }) {
  const access = useReadyAccess()
  const save = useSaveBookingSettings()
  const url = bookingPageUrl(window.location.origin, access.org_id)
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.page.title`)} description={t(`${S}.page.description`)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t(`${S}.page.enabled`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${S}.page.enabledHelp`)}</p>
        </div>
        <Switch
          checked={settings.enabled}
          readOnly={readOnly}
          disabled={save.isPending}
          onCheckedChange={(enabled) => save.mutate({ ...settings, enabled })}
          aria-label={t(`${S}.page.enabled`)}
        />
      </div>
      <FormField label={t(`${S}.page.link`)}>
        {(field) => (
          <div className="flex gap-2">
            <Input {...field} value={url} readOnly className="min-w-0 flex-1" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success(t(`${S}.page.copied`)))}
            >
              <Copy aria-hidden />
              {t(`${S}.page.copy`)}
            </Button>
          </div>
        )}
      </FormField>
    </SettingsCard>
  )
}

interface Draft {
  slotMinutes: number
  noticeHours: string
  horizonDays: string
  capacity: string
  weekly: WeeklyRange[]
}

const toDraft = (s: BookingSettings): Draft => ({
  slotMinutes: s.slotMinutes,
  noticeHours: String(s.noticeHours),
  horizonDays: String(s.horizonDays),
  capacity: String(s.capacity),
  weekly: s.weekly,
})

const inRange = (value: string, min: number, max: number) => /^[0-9]{1,2}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max

function SlotsCard({ settings, readOnly }: { settings: BookingSettings; readOnly: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [errors, setErrors] = useState<Partial<Record<'noticeHours' | 'horizonDays' | 'capacity' | 'weekly' | 'server', string>>>({})
  const save = useSaveBookingSettings({ onErrorMessage: (message) => setErrors({ server: message }) })
  useEffect(() => setDraft(toDraft(settings)), [settings])
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings))
  useUnsavedChanges(dirty && !readOnly)

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setRange = (index: number, patch: Partial<WeeklyRange>) => set({ weekly: draft.weekly.map((r, i) => (i === index ? { ...r, ...patch } : r)) })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!inRange(draft.noticeHours, 0, 72)) next.noticeHours = t(`${S}.slots.invalid`)
    if (!inRange(draft.horizonDays, 1, 30)) next.horizonDays = t(`${S}.slots.invalid`)
    if (!inRange(draft.capacity, 1, 5)) next.capacity = t(`${S}.slots.invalid`)
    if (draft.weekly.some((r) => r.end !== '24:00' && r.end <= r.start)) next.weekly = t(`${S}.slots.badRange`)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    save.mutate({
      ...settings,
      slotMinutes: draft.slotMinutes,
      noticeHours: Number(draft.noticeHours),
      horizonDays: Number(draft.horizonDays),
      capacity: Number(draft.capacity),
      weekly: [...draft.weekly].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)),
    })
  }

  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.slots.title`)}
      description={t(`${S}.slots.description`)}
      dirty={dirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={submit}
      footer={<FormActions onCancel={() => setDraft(toDraft(settings))} dirty={dirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.slots.slotMinutes`)}>
        {(field) => (
          <div className="w-40">
            <Select {...field} value={String(draft.slotMinutes)} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
              {SLOT_MINUTES.map((n) => (
                <option key={n} value={n}>
                  {t(`${S}.slots.minutes`, { n: String(n) })}
                </option>
              ))}
            </Select>
          </div>
        )}
      </FormField>
      <FormField label={t(`${S}.slots.noticeHours`)} help={t(`${S}.slots.noticeHelp`)} error={errors.noticeHours}>
        {(field) => <Input {...field} value={draft.noticeHours} onChange={(e) => set({ noticeHours: e.target.value })} inputMode="numeric" maxLength={2} className="tabular w-20" />}
      </FormField>
      <FormField label={t(`${S}.slots.horizonDays`)} help={t(`${S}.slots.horizonHelp`)} error={errors.horizonDays}>
        {(field) => <Input {...field} value={draft.horizonDays} onChange={(e) => set({ horizonDays: e.target.value })} inputMode="numeric" maxLength={2} className="tabular w-20" />}
      </FormField>
      <FormField label={t(`${S}.slots.capacity`)} help={t(`${S}.slots.capacityHelp`)} error={errors.capacity}>
        {(field) => <Input {...field} value={draft.capacity} onChange={(e) => set({ capacity: e.target.value })} inputMode="numeric" maxLength={1} className="tabular w-20" />}
      </FormField>
      <div className="space-y-3">
        {DAYS.map((day) => {
          const ranges = draft.weekly.map((r, index) => ({ r, index })).filter((x) => x.r.day === day)
          const dayName = t(`${S}.slots.days.${day}`)
          return (
            <fieldset key={day} className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">{dayName}</legend>
              {ranges.length === 0 && <p className="text-xs text-muted-foreground">{t(`${S}.slots.none`)}</p>}
              {ranges.map(({ r, index }) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${dayName} — ${t(`${S}.slots.start`)}`}
                    value={r.start}
                    onChange={(e) => setRange(index, { start: e.target.value })}
                    className="tabular w-32"
                    step={300}
                  />
                  <span aria-hidden className="text-muted-foreground">–</span>
                  <Input
                    type="time"
                    aria-label={`${dayName} — ${t(`${S}.slots.end`)}`}
                    value={r.end === '24:00' ? '23:59' : r.end}
                    onChange={(e) => setRange(index, { end: e.target.value })}
                    className="tabular w-32"
                    step={300}
                  />
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => set({ weekly: draft.weekly.filter((_, i) => i !== index) })}
                      aria-label={t(`${S}.slots.remove`, { day: dayName, start: r.start, end: r.end })}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  aria-label={t(`${S}.slots.addFor`, { day: dayName })}
                  onClick={() => set({ weekly: [...draft.weekly, { day, start: '09:00', end: '12:00' }] })}
                >
                  <Plus aria-hidden />
                  {t(`${S}.slots.add`)}
                </Button>
              )}
            </fieldset>
          )
        })}
        {errors.weekly && (
          <p role="alert" className="text-sm text-destructive">
            {errors.weekly}
          </p>
        )}
      </div>
      {errors.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.server}
        </p>
      )}
    </SettingsCard>
  )
}
