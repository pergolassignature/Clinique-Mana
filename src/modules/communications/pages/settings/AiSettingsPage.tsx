import { useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { SecretField } from '@/core/settings/components/SecretField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
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
import type { AiSettings } from '../../api/ai'
import { useAiSettings, useSaveAiSettings } from '../../hooks/use-ai'
import { aiSettingsSchema, centsToDollars, toAiValues } from '../../schemas/ai'

const S = 'modules.communications.ai.settings'
export const OPENAI_SECRET = 'openai_api_key'

/**
 * Paramètres → IA (CM4; seen and changed with `communications.ai_manage`): the clinic's OpenAI key
 * (write-only, SecretField, changed with `settings.integrations_manage`), « Rédiger avec l'IA »
 * switched on, the model, the monthly cap and the prices per million tokens it counts with, and the
 * month's use (calls and cost; never a text: none is kept).
 */
export function AiSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useAiSettings()
  let content
  if (settings.data) {
    content = (
      <SectionSurface>
        <KeyCard readOnly={readOnly} />
        <SettingsFormCard settings={settings.data} readOnly={readOnly} />
        <UsageCard settings={settings.data} />
      </SectionSurface>
    )
  } else if (settings.isError) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else {
    content = <Loading />
  }
  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

function KeyCard({ readOnly }: { readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  let field
  if (!can('settings.view')) field = <p className="text-xs text-muted-foreground">{t(`${S}.keyUnknown`)}</p>
  else if (secrets.isError && !secrets.data) field = <LoadError message={t(`${S}.keyLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  else if (!secrets.data) field = <Loading />
  else {
    field = (
      <SecretField
        secretKey={OPENAI_SECRET}
        label={t(`${S}.key`)}
        help={t(`${S}.keyHelp`)}
        configuredAt={secrets.data.find((s) => s.key === OPENAI_SECRET)?.updated_at ?? null}
        readOnly={readOnly || !can('settings.integrations_manage')}
      />
    )
  }
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.keyTitle`)} description={t(`${S}.keyDescription`)}>
      {field}
    </SettingsCard>
  )
}

function SettingsFormCard({ settings, readOnly }: { settings: AiSettings; readOnly: boolean }) {
  const values = useMemo(() => toAiValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: aiSettingsSchema, values })
  const save = useSaveAiSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((input, onSaved) =>
    save.mutate(input, {
      onSuccess: () =>
        onSaved({
          enabled: input.enabled,
          model: input.model,
          cap: centsToDollars(input.monthlyCapCents),
          inputPrice: centsToDollars(input.inputCentsPerMtok),
          outputPrice: centsToDollars(input.outputCentsPerMtok),
        }),
    }),
  )
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.formTitle`)}
      description={t(`${S}.formDescription`)}
      dirty={isDirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('model')} dirty={isDirty} pending={save.isPending} />}
    >
      <Controller
        control={form.control}
        name="enabled"
        render={({ field }) => (
          <CheckboxField
            label={t(`${S}.enabled`)}
            help={settings.key_configured ? t(`${S}.enabledHelp`) : t(`${S}.enabledNeedsKey`)}
            checked={field.value === true}
            onCheckedChange={(value) => {
              if (!readOnly) field.onChange(value === true)
            }}
            ref={field.ref}
          />
        )}
      />
      <FormField label={t(`${S}.model`)} required help={t(`${S}.modelHelp`)} error={errors.model?.message} width="md">
        {(field) => <Input {...field} {...form.register('model')} autoComplete="off" spellCheck={false} readOnly={readOnly} />}
      </FormField>
      <FormField label={t(`${S}.cap`)} required help={t(`${S}.capHelp`)} error={errors.cap?.message} width="md">
        {(field) => <Input {...field} {...form.register('cap')} inputMode="decimal" autoComplete="off" readOnly={readOnly} />}
      </FormField>
      <FormRow>
        <FormField label={t(`${S}.inputPrice`)} required error={errors.inputPrice?.message} width="sm">
          {(field) => <Input {...field} {...form.register('inputPrice')} inputMode="decimal" autoComplete="off" readOnly={readOnly} />}
        </FormField>
        <FormField label={t(`${S}.outputPrice`)} required error={errors.outputPrice?.message} width="sm">
          {(field) => <Input {...field} {...form.register('outputPrice')} inputMode="decimal" autoComplete="off" readOnly={readOnly} />}
        </FormField>
      </FormRow>
      <p className="text-xs text-muted-foreground">{t(`${S}.pricesHelp`)}</p>
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}

function UsageCard({ settings }: { settings: AiSettings }) {
  const spent = settings.month_spent_cents
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.usageTitle`)} description={t(`${S}.usageDescription`)}>
      <p className="text-sm text-foreground">
        {t(`${S}.usage`, {
          count: String(settings.month_requests),
          spent: `${centsToDollars(Math.round(spent))} $`,
          cap: `${centsToDollars(settings.monthly_cap_cents)} $`,
        })}
      </p>
      {spent >= settings.monthly_cap_cents && <p className="text-sm text-warning-strong">{t(`${S}.capReached`)}</p>}
    </SettingsCard>
  )
}
