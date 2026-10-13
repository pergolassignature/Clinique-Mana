import { useMemo, useState } from 'react'
import { z } from 'zod'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SaveButton } from '@/shared/components/SaveButton'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import type { ConsentRule, ConsentSettings, ConsentTemplate, ConsentType, Population } from '../../api/consents'
import { ConsentTextEditor } from '../../components/consents/ConsentTextEditor'
import {
  useConsentRules,
  useConsentSettings,
  useConsentTemplates,
  useConsentTypes,
  usePublishConsentVersion,
  useSaveConsentRule,
  useSaveConsentSettings,
} from '../../hooks/use-consents'
import { ruleTriggerText } from '../../lib/consents'

const S = 'modules.clients.consents.settings'

/**
 * Paramètres → Consentements (Clients C5a; seen with `clients.view`, changed with `clients.manage`):
 * the 14 texts (7 consents × French and English) with « Publier » and who must sign again (R-49);
 * when each consent is asked (the rules, switched on once a text is published); the delays and
 * reminders. « Modifier le texte » opens a text in core's shared editor under the cards (CC-12);
 * opening another one or closing it asks first while a draft has unsaved changes.
 */
export function ConsentsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const types = useConsentTypes()
  const templates = useConsentTemplates()
  const rules = useConsentRules()
  const settings = useConsentSettings()
  const failed = [types, templates, rules, settings].filter((q) => q.isError && !q.data)
  const [editing, setEditing] = useState<{ templateId: string; name: string } | null>(null)
  const confirmLeave = useConfirmLeave()
  const openText = (next: { templateId: string; name: string } | null) => {
    if (next?.templateId === editing?.templateId) return
    confirmLeave(() => setEditing(next))
  }

  let content
  if (failed.length > 0) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={failed.some((q) => q.isFetching)} onRetry={() => failed.forEach((q) => void q.refetch())} />
  } else if (!types.data || !templates.data || !rules.data || !settings.data) {
    content = <Loading />
  } else {
    content = (
      <SectionSurface>
        <TextsCard types={types.data} templates={templates.data} readOnly={readOnly} onOpen={openText} />
        <RulesCard types={types.data} rules={rules.data} templates={templates.data} readOnly={readOnly} />
        <DelaysCard settings={settings.data} readOnly={readOnly} />
      </SectionSurface>
    )
  }
  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
      {editing && <ConsentTextEditor key={editing.templateId} templateId={editing.templateId} name={editing.name} readOnly={readOnly} onClose={() => openText(null)} />}
    </div>
  )
}

function TextsCard({
  types,
  templates,
  readOnly,
  onOpen,
}: {
  types: ConsentType[]
  templates: ConsentTemplate[]
  readOnly: boolean
  onOpen: (text: { templateId: string; name: string }) => void
}) {
  const [publishing, setPublishing] = useState<{ template: ConsentTemplate; name: string } | null>(null)
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.texts.title`)} description={t(`${S}.texts.description`)}>
      {templates.some((tpl) => tpl.draft?.placeholder) && <p className="text-xs text-muted-foreground">{t(`${S}.texts.editNote`)}</p>}
      <ul className="divide-y divide-border-light">
        {types.map((type) => (
          <li key={type.key} className="space-y-1 py-2.5">
            <p className="text-sm font-medium text-foreground">{type.name}</p>
            {(['fr', 'en'] as const).map((lang) => {
              const template = templates.find((tpl) => tpl.consentKey === type.key && tpl.language === lang)
              if (!template) return null
              const language = t(lang === 'en' ? `${S}.texts.english` : `${S}.texts.french`)
              const textName = `${type.name} (${language.toLocaleLowerCase('fr-CA')})`
              return (
                <div key={lang} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <span className="min-w-0 text-muted-foreground">{t(`${S}.texts.line`, { language, state: textState(template) })}</span>
                  <span className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t(readOnly ? `${S}.texts.viewLabel` : `${S}.texts.editLabel`, { name: textName })}
                      onClick={() => onOpen({ templateId: template.id, name: textName })}
                    >
                      {t(readOnly ? `${S}.texts.view` : `${S}.texts.edit`)}
                    </Button>
                    {!readOnly && template.draft && !template.draft.placeholder && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setPublishing({ template, name: lang === 'en' ? type.nameEn : type.name })}>
                        {t(`${S}.texts.publish`)}
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </li>
        ))}
      </ul>
      {publishing && <PublishDialog key={publishing.template.draft?.id} target={publishing} onClose={() => setPublishing(null)} />}
    </SettingsCard>
  )
}

/** A text's line: the version in force (or none), then its draft (the placeholder says so). */
function textState(template: ConsentTemplate): string {
  const parts = [
    template.published
      ? t(`${S}.texts.version`, { version: String(template.published.version), date: formatClinicDateShort(template.published.publishedAt) })
      : t(`${S}.texts.draftOnly`),
  ]
  if (template.draft?.placeholder) parts.push(t(`${S}.texts.placeholder`))
  else if (template.published && template.draft) parts.push(t(`${S}.texts.draftReady`, { version: String(template.draft.version) }))
  return parts.join(t('modules.clients.consents.separator'))
}

/** « Publier »: who must sign this version (R-49), « nouveaux clients seulement » by default. */
function PublishDialog({ target, onClose }: { target: { template: ConsentTemplate; name: string }; onClose: () => void }) {
  const [population, setPopulation] = useState<Population>('new_clients')
  const publish = usePublishConsentVersion()
  const first = !target.template.published
  return (
    <Dialog open onOpenChange={(open) => !open && !publish.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${S}.texts.publishTitle`, { name: target.name })}</DialogTitle>
          <DialogDescription>{t(`${S}.texts.publishHelp`)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!target.template.draft || target.template.draft.placeholder || publish.isPending) return
            publish.mutate({ versionId: target.template.draft.id, population: first ? 'new_clients' : population }, { onSuccess: onClose })
          }}
        >
          <fieldset className="space-y-2" disabled={first}>
            {(['new_clients', 'all_active'] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="population"
                  value={value}
                  checked={(first ? 'new_clients' : population) === value}
                  onChange={() => setPopulation(value)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium text-foreground">{t(value === 'new_clients' ? `${S}.texts.newClients` : `${S}.texts.allActive`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(value === 'new_clients' ? `${S}.texts.newClientsHelp` : `${S}.texts.allActiveHelp`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <SaveButton pending={publish.isPending} label={t(`${S}.texts.confirm`)} pendingLabel={t(`${S}.texts.publishing`)} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RulesCard({ types, rules, templates, readOnly }: { types: ConsentType[]; rules: ConsentRule[]; templates: ConsentTemplate[]; readOnly: boolean }) {
  const save = useSaveConsentRule()
  const nameOf = (key: string) => types.find((type) => type.key === key)?.name ?? key
  const published = (key: string) => templates.some((tpl) => tpl.consentKey === key && tpl.published)
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.rules.title`)} description={t(`${S}.rules.description`)}>
      <ul className="divide-y divide-border-light">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{nameOf(rule.consentKey)}</p>
              <p className="text-xs text-muted-foreground">
                {ruleTriggerText(rule)}
                {!published(rule.consentKey) && `${t('modules.clients.consents.separator')}${t('modules.clients.consents.notPublished')}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select
                aria-label={t(`${S}.rules.frequency`)}
                value={rule.frequency}
                readOnly={readOnly}
                disabled={save.isPending}
                onChange={(event) => save.mutate({ ...rule, frequency: event.target.value as ConsentRule['frequency'] })}
                className="w-48"
              >
                <option value="once">{t(`${S}.rules.once`)}</option>
                <option value="each_time">{t(`${S}.rules.eachTime`)}</option>
              </Select>
              <Switch
                checked={rule.isActive}
                readOnly={readOnly}
                disabled={save.isPending || (!rule.isActive && !published(rule.consentKey))}
                onCheckedChange={(isActive) => save.mutate({ ...rule, isActive })}
                aria-label={t(`${S}.rules.toggle`, { name: nameOf(rule.consentKey) })}
              />
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}

const intIn = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^[0-9]{1,3}$/, t(`${S}.delays.invalid`))
    .transform(Number)
    .pipe(z.number().int().min(min, t(`${S}.delays.invalid`)).max(max, t(`${S}.delays.invalid`)))

const delaysSchema = z.object({
  reminderDays: intIn(1, 30),
  dueDays: intIn(0, 30),
  preAppointmentHours: intIn(12, 168),
  retentionPolicy: z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(500, t(`${S}.delays.retentionTooLong`)))
    .transform((v) => (v === '' ? null : v)),
})

const toValues = (s: ConsentSettings) => ({
  reminderDays: String(s.reminderDays),
  dueDays: String(s.dueDays),
  preAppointmentHours: String(s.preAppointmentHours),
  retentionPolicy: s.retentionPolicy ?? '',
})

function DelaysCard({ settings, readOnly }: { settings: ConsentSettings; readOnly: boolean }) {
  const values = useMemo(() => toValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: delaysSchema, values })
  const save = useSaveConsentSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((patch, onSaved) => save.mutate(patch, { onSuccess: (saved) => onSaved(toValues(saved)) }))
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.delays.title`)}
      description={t(`${S}.delays.description`)}
      dirty={isDirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('reminderDays')} dirty={isDirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.delays.reminderDays`)} help={t(`${S}.delays.reminderHelp`)} error={errors.reminderDays?.message}>
        {(field) => <Input {...field} {...form.register('reminderDays')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-20" />}
      </FormField>
      <FormField label={t(`${S}.delays.dueDays`)} help={t(`${S}.delays.dueHelp`)} error={errors.dueDays?.message}>
        {(field) => <Input {...field} {...form.register('dueDays')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-20" />}
      </FormField>
      <FormField label={t(`${S}.delays.preHours`)} help={t(`${S}.delays.preHelp`)} error={errors.preAppointmentHours?.message}>
        {(field) => <Input {...field} {...form.register('preAppointmentHours')} inputMode="numeric" maxLength={3} autoComplete="off" className="tabular w-20" />}
      </FormField>
      <FormField label={t(`${S}.delays.retention`)} help={t(`${S}.delays.retentionHelp`)} error={errors.retentionPolicy?.message}>
        {(field) => <Input {...field} {...form.register('retentionPolicy')} maxLength={500} autoComplete="off" />}
      </FormField>
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}
