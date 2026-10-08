import { useMemo, type ReactNode } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useScheduledJobs, useSetScheduledJobEnabled } from '@/core/jobs/hooks'
import { rpcErrorHint } from '@/core/modules/errors'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { SwitchField } from '@/shared/components/SwitchField'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalsSettings } from '../../api/parse'
import { useProfessionalsSettings, useSaveProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { INVITATION_REMINDER_MAX, invitationsSchema, toInvitationsFormValues } from '../../schemas/invitations'

const S = 'modules.professionals.settings.invitations'

/** The reminders' scheduled job (4b.2): off by default, like every business job. */
export const INVITATION_REMINDERS_JOB = 'professionals.invitation_reminders'

/**
 * Paramètres → Invitations (Task 4b.3; seen with `professionals.invite` or `.settings`, changed with
 * `.settings`): how long an invitation link works (1–30 days) and the automatic reminder (after
 * 1–29 days, before the link expires, P4-308), in one form. A reminder leaves only when the
 * scheduled job « Rappels d'invitation » is on too: the second card says whether it is, and lets
 * whoever may switch jobs (`settings.manage`) turn it on (P4-311).
 */
export function InvitationsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useProfessionalsSettings()

  let content
  if (settings.data) {
    content = (
      <>
        <InvitationsCard settings={settings.data} readOnly={readOnly} />
        <ReminderJobCard reminderOn={settings.data.invitationReminderAfterDays !== null} />
      </>
    )
  } else if (settings.isError) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else {
    content = <Loading />
  }

  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

function InvitationsCard({ settings, readOnly }: { settings: ProfessionalsSettings; readOnly: boolean }) {
  const values = useMemo(() => toInvitationsFormValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: invitationsSchema, values })
  const save = useSaveProfessionalsSettings({
    onErrorMessage: (message, error) => {
      // P4-308 checked again by the database (another tab saved a shorter lifetime meanwhile).
      const field = rpcErrorHint(error) === 'invitation_reminder_after_days' ? 'reminderDays' : 'root.server'
      form.setError(field, { message }, { shouldFocus: field !== 'root.server' })
    },
  })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const reminderOn = useWatch({ control: form.control, name: 'reminderEnabled' })
  const expiry = Number(useWatch({ control: form.control, name: 'expiryDays' }))
  const reminderMax = Number.isInteger(expiry) && expiry > 1 ? Math.min(expiry - 1, INVITATION_REMINDER_MAX) : INVITATION_REMINDER_MAX

  const onSubmit = handleSave((patch, onSaved) =>
    save.mutate(patch, { onSuccess: (saved) => onSaved(toInvitationsFormValues(saved)) }),
  )

  return (
    <SettingsCard
      title={t(`${S}.link.title`)}
      description={t(`${S}.link.description`)}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('expiryDays')} dirty={isDirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.link.expiryDays`)} required help={t(`${S}.link.expiryHelp`)} error={errors.expiryDays?.message}>
        {(field) => (
          <DaysInput unit={t(`${S}.link.days`)}>
            <Input {...field} {...form.register('expiryDays')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-16" />
          </DaysInput>
        )}
      </FormField>
      <div className="space-y-3 border-t border-border-light pt-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t(`${S}.reminder.title`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${S}.reminder.description`)}</p>
        </div>
        <Controller
          control={form.control}
          name="reminderEnabled"
          render={({ field }) => (
            <SwitchField
              ref={field.ref}
              label={t(`${S}.reminder.enabled`)}
              help={t(`${S}.reminder.enabledHelp`)}
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        {reminderOn && (
          <FormField
            label={t(`${S}.reminder.afterDays`)}
            required
            help={t(`${S}.reminder.afterHelp`, { max: String(reminderMax) })}
            error={errors.reminderDays?.message}
          >
            {(field) => (
              <DaysInput unit={t(`${S}.reminder.days`)}>
                <Input {...field} {...form.register('reminderDays')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-16" />
              </DaysInput>
            )}
          </FormField>
        )}
      </div>
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}

/** « 7 jours »: the number and its unit on one line. */
function DaysInput({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <span aria-hidden className="text-sm text-muted-foreground">
        {unit}
      </span>
    </div>
  )
}

/**
 * « Envoi des rappels »: whether reminders actually leave. They need the setting (saved) and the
 * scheduled job switched on: the job's state is read with `settings.view`, switched with
 * `settings.manage` (« Activer la tâche planifiée », a business job, P4-311); without those, the
 * card says where it is done.
 */
function ReminderJobCard({ reminderOn }: { reminderOn: boolean }) {
  const { can } = useAccess()
  const canRead = can('settings.view')
  return (
    <SettingsCard as="section" title={t(`${S}.job.title`)} description={t(`${S}.job.description`)}>
      {!reminderOn ? (
        <p className="text-sm text-muted-foreground">{t(`${S}.job.disabledReminder`)}</p>
      ) : canRead ? (
        <JobState />
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${S}.job.unknown`)}</p>
      )}
    </SettingsCard>
  )
}

function JobState() {
  const { can } = useAccess()
  const jobs = useScheduledJobs()
  const setEnabled = useSetScheduledJobEnabled()
  if (jobs.isError && !jobs.data) return <LoadError message={t(`${S}.job.loadError`)} retrying={jobs.isFetching} onRetry={() => void jobs.refetch()} />
  if (!jobs.data) return <Loading />
  const job = jobs.data.find((j) => j.key === INVITATION_REMINDERS_JOB)
  if (!job) return <p className="text-sm text-muted-foreground">{t(`${S}.job.unknown`)}</p>
  if (job.enabled) {
    return (
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        {job.local_hour === null ? t(`${S}.job.onNoHour`) : t(`${S}.job.on`, { hour: String(job.local_hour) })}
      </p>
    )
  }
  const pending = setEnabled.isPending
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
        {t(`${S}.job.off`)}
      </p>
      {can('settings.manage') ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending || undefined}
          onClick={ignoreWhenInactive(pending, () => setEnabled.mutate({ key: INVITATION_REMINDERS_JOB, enabled: true }))}
          className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        >
          {pending ? t(`${S}.job.enabling`) : t(`${S}.job.enable`)}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(`${S}.job.askAdmin`)}{' '}
          <GuardedNavLink to={`${SETTINGS_BASE_PATH}/taches-planifiees`} className="text-link underline-offset-[3px] hover:underline">
            {t(`${S}.job.openJobs`)}
          </GuardedNavLink>
        </p>
      )}
    </div>
  )
}
