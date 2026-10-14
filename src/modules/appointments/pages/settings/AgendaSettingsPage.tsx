import { useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { z } from 'zod'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { TimeField } from '@/shared/ui/time-field'
import type { AgendaSettings } from '../../api/changes'
import { useAgendaSettings, useSaveAgendaSettings } from '../../hooks/use-agenda'

const S = 'modules.appointments.settings'
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const

/**
 * Paramètres → Agenda (seen with `appointments.view`, changed with `appointments.settings`): the
 * clinic's business days and hours, the reminders' day and hour (R-52, R4), and whether the late
 * cancellation notice counts business hours (AP-31, on by default: GOrendezvous's « 24 h ouvrables »).
 */
export function AgendaSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useAgendaSettings()
  let content
  if (settings.isError && !settings.data) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else if (!settings.data) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <HoursCard settings={settings.data} readOnly={readOnly} />
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

const intIn = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]{1,2}$/, t(`${S}.invalid`))
    .transform(Number)
    .pipe(z.number().int().min(min, t(`${S}.invalid`)).max(max, t(`${S}.invalid`)))

const schema = z.object({
  d1: z.boolean(),
  d2: z.boolean(),
  d3: z.boolean(),
  d4: z.boolean(),
  d5: z.boolean(),
  d6: z.boolean(),
  d7: z.boolean(),
  businessStart: z.string().regex(/^\d{2}:\d{2}$/, t(`${S}.invalid`)),
  businessEnd: z.string().regex(/^\d{2}:\d{2}$/, t(`${S}.invalid`)),
  reminderBusinessDays: intIn(1, 5),
  reminderLocalHour: intIn(0, 23),
  lateNoticeBusinessHours: z.boolean(),
})

type Values = z.input<typeof schema>

const toValues = (s: AgendaSettings): Values => ({
  d1: s.businessDays.includes(1),
  d2: s.businessDays.includes(2),
  d3: s.businessDays.includes(3),
  d4: s.businessDays.includes(4),
  d5: s.businessDays.includes(5),
  d6: s.businessDays.includes(6),
  d7: s.businessDays.includes(7),
  businessStart: s.businessStart,
  businessEnd: s.businessEnd,
  reminderBusinessDays: String(s.reminderBusinessDays),
  reminderLocalHour: String(s.reminderLocalHour),
  lateNoticeBusinessHours: s.lateNoticeBusinessHours,
})

function HoursCard({ settings, readOnly }: { settings: AgendaSettings; readOnly: boolean }) {
  const values = useMemo(() => toValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema, values })
  const save = useSaveAgendaSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((data, onSaved) => {
    const businessDays = WEEKDAYS.filter((d) => data[`d${d}`]).map(Number)
    if (businessDays.length === 0) {
      form.setError('root.server', { message: t(`${S}.daysRequired`) })
      return
    }
    const next: AgendaSettings = {
      businessDays,
      businessStart: data.businessStart,
      businessEnd: data.businessEnd,
      reminderBusinessDays: data.reminderBusinessDays,
      reminderLocalHour: data.reminderLocalHour,
      lateNoticeBusinessHours: data.lateNoticeBusinessHours,
    }
    save.mutate(next, { onSuccess: () => onSaved(toValues(next)) })
  })
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.hoursTitle`)}
      description={t(`${S}.hoursDescription`)}
      dirty={isDirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('businessStart')} dirty={isDirty} pending={save.isPending} />}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t(`${S}.businessDays`)}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WEEKDAYS.map((d) => (
            <Controller
              key={d}
              control={form.control}
              name={`d${d}`}
              render={({ field }) => (
                <CheckboxField ref={field.ref} label={t(`${S}.weekdays.${d}`)} checked={field.value} onCheckedChange={(v) => !readOnly && field.onChange(v)} onBlur={field.onBlur} />
              )}
            />
          ))}
        </div>
      </fieldset>
      <FormRow>
        <FormField label={t(`${S}.businessStart`)} width="sm" error={errors.businessStart?.message}>
          {(field) => <Controller control={form.control} name="businessStart" render={({ field: control }) => <TimeField {...field} {...control} readOnly={readOnly} />} />}
        </FormField>
        <FormField label={t(`${S}.businessEnd`)} width="sm" error={errors.businessEnd?.message}>
          {(field) => <Controller control={form.control} name="businessEnd" render={({ field: control }) => <TimeField {...field} {...control} readOnly={readOnly} />} />}
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t(`${S}.reminderDays`)} help={t(`${S}.reminderDaysHelp`)} width="sm" error={errors.reminderBusinessDays?.message}>
          {(field) => <Input {...field} {...form.register('reminderBusinessDays')} inputMode="numeric" maxLength={1} autoComplete="off" className="tabular w-20" readOnly={readOnly} />}
        </FormField>
        <FormField label={t(`${S}.reminderHour`)} help={t(`${S}.reminderHourHelp`)} width="sm" error={errors.reminderLocalHour?.message}>
          {(field) => <Input {...field} {...form.register('reminderLocalHour')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-20" readOnly={readOnly} />}
        </FormField>
      </FormRow>
      <Controller
        control={form.control}
        name="lateNoticeBusinessHours"
        render={({ field }) => (
          <CheckboxField
            ref={field.ref}
            label={t(`${S}.lateNotice`)}
            help={t(`${S}.lateNoticeHelp`)}
            checked={field.value}
            onCheckedChange={(v) => !readOnly && field.onChange(v)}
            onBlur={field.onBlur}
          />
        )}
      />
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}
