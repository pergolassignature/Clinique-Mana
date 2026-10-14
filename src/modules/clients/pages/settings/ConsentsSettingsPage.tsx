import { useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { z } from 'zod'
import { t } from '@/i18n'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import type { ConsentCampaign, ConsentRule, ConsentSettings, ConsentTemplate, ConsentType } from '../../api/consents'
import { ConsentEditorPage, TextChips } from '../../components/consents/ConsentEditorPage'
import {
  useCancelConsentCampaign,
  useConsentCampaigns,
  useConsentRules,
  useServiceNames,
  useConsentSettings,
  useConsentTemplates,
  useConsentTypes,
  useSaveConsentRule,
  useSaveConsentSettings,
  useStartConsentCampaign,
} from '../../hooks/use-consents'
import { consentPurpose, ruleTriggerText } from '../../lib/consents'

const S = 'modules.clients.consents.settings'

/**
 * Paramètres → Consentements (Clients C5a; seen with `clients.view`, changed with `clients.manage`).
 * CC-21: the consents first, one row each (its name, when it is asked, its French and English
 * states as chips, one « Modifier »), with one banner for the provisional texts still to replace;
 * « Modifier » opens the consent's page (`?texte=<consent>`, Back returns here): both languages
 * as tabs, each text in the shared editor (autosaved, pasted from Word, « Aperçu comme le client
 * le verra », « Comparer avec la version publiée », « Publier » and who must sign again, R-49).
 * Then « Nouvelles signatures » for the consents published (C5b.4, CC-20), when each consent is
 * asked (the rules, switched on once a text is published), the delays and reminders, and how long
 * the sealed PDFs of ended consents are kept (CC-18: none by default). Leaving a consent's page or
 * switching its language asks first while a form has unsaved changes.
 */
export function ConsentsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const types = useConsentTypes()
  const templates = useConsentTemplates()
  const rules = useConsentRules()
  const settings = useConsentSettings()
  const failed = [types, templates, rules, settings].filter((q) => q.isError && !q.data)
  const { params, update } = useUrlParams()
  const confirmLeave = useConfirmLeave()
  const editingKey = params.get('texte')
  const open = (key: string) => update({ texte: key }, { replace: false })
  const back = () => confirmLeave(() => update({ texte: null }, { replace: false }))

  if (failed.length > 0) {
    return (
      <div className="space-y-5">
        <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
        <LoadError message={t(`${S}.loadError`)} retrying={failed.some((q) => q.isFetching)} onRetry={() => failed.forEach((q) => void q.refetch())} />
      </div>
    )
  }
  if (!types.data || !templates.data || !rules.data || !settings.data) {
    return (
      <div className="space-y-5">
        <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
        <Loading />
      </div>
    )
  }
  const editing = editingKey ? types.data.find((type) => type.key === editingKey) : undefined
  if (editing) {
    return <ConsentEditorPage key={editing.key} consent={editing} templates={templates.data} rules={rules.data} readOnly={readOnly} onBack={back} />
  }
  const placeholders = types.data.filter((type) => templates.data.some((tpl) => tpl.consentKey === type.key && tpl.draft?.placeholder))
  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {editingKey && <Alert variant="warning"><AlertDescription className="text-foreground">{t(`${S}.overview.unknown`)}</AlertDescription></Alert>}
      {placeholders.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="space-y-1 text-foreground">
            <span className="block font-medium">{t(`${S}.overview.placeholderTitle`, { count: String(placeholders.length) })}</span>
            <span className="block">{t(`${S}.overview.placeholderBody`, { names: placeholders.map((type) => type.name).join(t(`${S}.overview.namesJoiner`)) })}</span>
          </AlertDescription>
        </Alert>
      )}
      <SectionSurface>
        <TextsCard types={types.data} templates={templates.data} rules={rules.data} readOnly={readOnly} onOpen={open} />
        <CampaignsCard types={types.data} templates={templates.data} readOnly={readOnly} />
        <RulesCard types={types.data} rules={rules.data} templates={templates.data} readOnly={readOnly} />
        <DelaysCard settings={settings.data} readOnly={readOnly} />
        <RetentionCard settings={settings.data} readOnly={readOnly} />
      </SectionSurface>
    </div>
  )
}

/** The consents, one row each: the name, when it is asked, the two languages' states, « Modifier ». */
function TextsCard({
  types,
  templates,
  rules,
  readOnly,
  onOpen,
}: {
  types: ConsentType[]
  templates: ConsentTemplate[]
  rules: ConsentRule[]
  readOnly: boolean
  onOpen: (key: string) => void
}) {
  const serviceNames = useServiceNames()
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.texts.title`)} description={t(`${S}.texts.description`)}>
      <ul className="divide-y divide-border-light">
        {types.map((type) => {
          const textOf = (lang: 'fr' | 'en') => templates.find((tpl) => tpl.consentKey === type.key && tpl.language === lang)
          return (
            <li key={type.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-foreground">{type.name}</p>
                <p className="text-xs text-muted-foreground">{consentPurpose(type.key, rules, serviceNames.data)}</p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 pt-0.5 text-xs">
                  {(['fr', 'en'] as const).map((lang) => (
                    <div key={lang} className="contents">
                      <dt className="text-muted-foreground">{t(lang === 'en' ? `${S}.texts.english` : `${S}.texts.french`)}</dt>
                      <dd className="min-w-0">
                        <TextChips template={textOf(lang)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
                aria-label={t(readOnly ? `${S}.texts.viewLabel` : `${S}.texts.editLabel`, { name: type.name })}
                onClick={() => onOpen(type.key)}
              >
                {t(readOnly ? `${S}.texts.view` : `${S}.texts.edit`)}
              </Button>
            </li>
          )
        })}
      </ul>
    </SettingsCard>
  )
}

function RulesCard({ types, rules, templates, readOnly }: { types: ConsentType[]; rules: ConsentRule[]; templates: ConsentTemplate[]; readOnly: boolean }) {
  const save = useSaveConsentRule()
  const serviceNames = useServiceNames()
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
                {ruleTriggerText(rule, serviceNames.data)}
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
})

const toValues = (s: ConsentSettings) => ({
  reminderDays: String(s.reminderDays),
  dueDays: String(s.dueDays),
  preAppointmentHours: String(s.preAppointmentHours),
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
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}

const retentionSchema = z.object({
  retentionPolicy: z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(500, t(`${S}.retention.policyTooLong`)))
    .transform((v) => (v === '' ? null : v)),
  retentionYears: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 50), t(`${S}.retention.yearsInvalid`))
    .transform((v) => (v === '' ? null : Number(v))),
})

const toRetentionValues = (s: ConsentSettings) => ({
  retentionPolicy: s.retentionPolicy ?? '',
  retentionYears: s.retentionYears === null ? '' : String(s.retentionYears),
})

/**
 * « Conservation des consentements signés » (CC-18): the policy's text and the duration, empty by
 * default (nothing is purged). A duration set or shortened is confirmed first: the sealed PDFs of
 * consents ended longer ago are purged at the next file cleanup, for good.
 */
function RetentionCard({ settings, readOnly }: { settings: ConsentSettings; readOnly: boolean }) {
  const values = useMemo(() => toRetentionValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: retentionSchema, values })
  const save = useSaveConsentSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const [confirming, setConfirming] = useState<{ run: () => void; years: number } | null>(null)
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((patch, onSaved) => {
    const run = () => save.mutate(patch, { onSuccess: (saved) => onSaved(toRetentionValues(saved)) })
    const years = patch.retentionYears
    if (years !== null && (settings.retentionYears === null || years < settings.retentionYears)) setConfirming({ run, years })
    else run()
  })
  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.retention.title`)}
      description={t(`${S}.retention.description`)}
      dirty={isDirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('retentionPolicy')} dirty={isDirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.retention.policy`)} help={t(`${S}.retention.policyHelp`)} error={errors.retentionPolicy?.message}>
        {(field) => <Input {...field} {...form.register('retentionPolicy')} maxLength={500} autoComplete="off" />}
      </FormField>
      <FormField label={t(`${S}.retention.years`)} help={t(`${S}.retention.yearsHelp`)} error={errors.retentionYears?.message}>
        {(field) => <Input {...field} {...form.register('retentionYears')} inputMode="numeric" maxLength={2} autoComplete="off" className="tabular w-20" />}
      </FormField>
      {settings.retentionYears === null && <p className="text-sm text-muted-foreground">{t(`${S}.retention.kept`)}</p>}
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(`${S}.retention.confirmTitle`)}</DialogTitle>
            <DialogDescription>{t(`${S}.retention.confirmBody`, { years: String(confirming?.years ?? '') })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                confirming?.run()
                setConfirming(null)
              }}
            >
              {t(`${S}.retention.confirm`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}

/**
 * « Nouvelles signatures » (C5b.4, CC-20): per consent with a text published, « Demander une nouvelle
 * signature à tous les clients actifs » (confirmed first), or its campaign in progress with
 * « Arrêter la campagne »; the last campaign's outcome otherwise. The sends are the job's, 100 a day.
 */
function CampaignsCard({ types, templates, readOnly }: { types: ConsentType[]; templates: ConsentTemplate[]; readOnly: boolean }) {
  const campaigns = useConsentCampaigns()
  const [starting, setStarting] = useState<ConsentType | null>(null)
  const stop = useCancelConsentCampaign()
  const latest = (key: string) => campaigns.data?.find((c) => c.consentKey === key) ?? null
  // Only a consent with a text in force can be signed again; the others say nothing here.
  const publishedTypes = types.filter((type) => type.isActive && templates.some((tpl) => tpl.consentKey === type.key && tpl.published))
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.campaigns.title`)} description={t(`${S}.campaigns.description`)}>
      {campaigns.isError && !campaigns.data ? (
        <LoadError message={t(`${S}.campaigns.loadError`)} retrying={campaigns.isFetching} onRetry={() => void campaigns.refetch()} />
      ) : !campaigns.data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-border-light">
          {publishedTypes.length === 0 && <li className="py-2.5 text-sm text-muted-foreground">{t(`${S}.campaigns.noneYet`)}</li>}
          {publishedTypes
            .map((type) => {
              const campaign = latest(type.key)
              return (
                <li key={type.key} className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium text-foreground">{type.name}</span>
                    <span className="block text-muted-foreground">{campaignLine(campaign)}</span>
                  </span>
                  {!readOnly && (
                    <span className="flex shrink-0 flex-wrap gap-2">
                      {campaign?.state === 'running' ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => !stop.isPending && stop.mutate(campaign.id)}>
                          {t(`${S}.campaigns.stop`)}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-auto min-h-7 whitespace-normal py-1 text-left"
                          aria-label={t(`${S}.campaigns.startLabel`, { name: type.name })}
                          onClick={() => setStarting(type)}
                        >
                          {t(`${S}.campaigns.start`)}
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
        </ul>
      )}
      {starting && <StartCampaignDialog type={starting} onClose={() => setStarting(null)} />}
    </SettingsCard>
  )
}

/** A consent's campaign in words: in progress with its counts, its end, or none. */
function campaignLine(campaign: ConsentCampaign | null): string {
  if (!campaign) return t(`${S}.campaigns.none`)
  const counts = { sent: String(campaign.sent), total: String(campaign.total), queued: String(campaign.queued), failed: String(campaign.failed) }
  if (campaign.state === 'running') return t(`${S}.campaigns.running`, counts)
  const date = formatClinicDateShort(campaign.finishedAt ?? campaign.createdAt)
  return campaign.state === 'done' ? t(`${S}.campaigns.done`, { ...counts, date }) : t(`${S}.campaigns.cancelled`, { ...counts, date })
}

/** Confirms a campaign: who is asked, 100 a day, the flag set now; a refusal shown where the person acted. */
function StartCampaignDialog({ type, onClose }: { type: ConsentType; onClose: () => void }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const start = useStartConsentCampaign({ onErrorMessage: setRefusal })
  return (
    <Dialog open onOpenChange={(open) => !open && !start.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${S}.campaigns.confirmTitle`, { name: type.name })}</DialogTitle>
          <DialogDescription>{t(`${S}.campaigns.confirmBody`)}</DialogDescription>
        </DialogHeader>
        {refusal && (
          <p role="alert" className="text-sm text-destructive">
            {refusal}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (start.isPending) return
              setRefusal(null)
              start.mutate(type.key, { onSuccess: onClose })
            }}
          >
            {t(start.isPending ? `${S}.campaigns.starting` : `${S}.campaigns.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
