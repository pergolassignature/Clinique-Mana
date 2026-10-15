import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { demandesError } from '../../lib/errors'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FormActions } from '@/shared/components/FormActions'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatPhone, parsePhone } from '@/shared/lib/format'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import {
  BENEFICIARIES,
  GENDERS,
  ISSUES,
  LEGAL_CONTEXTS,
  MODALITIES,
  PAYER_KINDS,
  PERIODS,
  PREVIOUS_PROFESSIONALS,
  type DemandeBundle,
} from '../../api/demandes'
import { useSetDemandeSource, useUpdateDemande } from '../../hooks/use-demandes'
import { autoOptionLabel, clienteleConflict, participantsHint } from '../../lib/clientele'
import { clientNumber, demandePath, fileLabel, optionLabel } from '../../lib/display'
import { DemandeSourceCard } from '../DemandeSourceCard'
import { ClientLink } from './ClientLink'
import { useServerDraft } from '../../lib/use-server-draft'
import { useDemandeRecord } from './record-context'
import { StaleNotice } from './StaleNotice'

const A = 'modules.demandes.intake'
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

interface Values {
  contact_first_name: string
  contact_last_name: string
  contact_email: string
  contact_phone: string
  beneficiary: string
  previous_therapy: string
  language: string
  modality: string
  availability_periods: string[]
  availability_days: number[]
  preferred_pro_gender: string
  profession_title_id: string
  clientele_id: string
  motif_ids: string[]
  concerns: string
  payer_kind: string
  insurer: string
  is_urgent: boolean
  // D-40: the follow-up questions (« Non » clears what follows).
  has_issues: string
  issues: string[]
  issues_comment: string
  previous_professionals: string[]
  previous_comment: string
  has_legal_context: string
  legal_context: string[]
  legal_detail: string
  motif_other: string
  availability_other: string
}

/** The yes / no questions and what follows each (cleared on « Non » or no answer). */
const FOLLOW_UPS = {
  has_issues: ['issues', 'issues_comment'],
  previous_therapy: ['previous_professionals', 'previous_comment'],
  has_legal_context: ['legal_context', 'legal_detail'],
} as const satisfies Record<string, readonly (keyof Values)[]>
type YesNoKey = keyof typeof FOLLOW_UPS
type CodesKey = 'issues' | 'previous_professionals' | 'legal_context'

const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'yes' : 'no')

function valuesOf(bundle: DemandeBundle): Values {
  const d = bundle.demande
  return {
    contact_first_name: d.contact_first_name ?? '',
    contact_last_name: d.contact_last_name ?? '',
    contact_email: d.contact_email ?? '',
    contact_phone: d.contact_phone_e164 ? formatPhone(d.contact_phone_e164) : '',
    beneficiary: d.beneficiary ?? '',
    previous_therapy: yesNo(d.previous_therapy),
    language: d.language,
    modality: d.modality,
    availability_periods: [...d.availability_periods],
    availability_days: [...d.availability_days],
    preferred_pro_gender: d.preferred_pro_gender,
    profession_title_id: d.profession_title_id ?? '',
    clientele_id: d.clientele_id ?? '',
    motif_ids: [...bundle.motif_ids].sort(),
    concerns: d.concerns ?? '',
    payer_kind: d.payer_kind,
    insurer: d.insurer ?? '',
    is_urgent: d.is_urgent,
    has_issues: yesNo(d.has_issues),
    issues: [...d.issues].sort(),
    issues_comment: d.issues_comment ?? '',
    previous_professionals: [...d.previous_professionals].sort(),
    previous_comment: d.previous_comment ?? '',
    has_legal_context: yesNo(d.has_legal_context),
    legal_context: [...d.legal_context].sort(),
    legal_detail: d.legal_detail ?? '',
    motif_other: d.motif_other ?? '',
    availability_other: d.availability_other ?? '',
  }
}

/** The patch of what changed, in the RPC's keys (empty text → null). */
function patchOf(initial: Values, values: Values): Record<string, unknown> | { error: string } {
  const patch: Record<string, unknown> = {}
  const text = (v: string) => v.trim() || null
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  for (const key of Object.keys(values) as (keyof Values)[]) {
    if (same(initial[key], values[key])) continue
    switch (key) {
      case 'contact_phone': {
        const raw = values.contact_phone.trim()
        const e164 = raw ? parsePhone(raw) : null
        if (raw && !e164) return { error: t(`${A}.badPhone`) }
        patch.contact_phone_e164 = e164
        break
      }
      case 'contact_email':
        patch.contact_email = text(values.contact_email)?.toLowerCase() ?? null
        break
      case 'previous_therapy':
      case 'has_issues':
      case 'has_legal_context':
        patch[key] = values[key] === '' ? null : values[key] === 'yes'
        break
      case 'motif_ids':
      case 'issues':
      case 'previous_professionals':
      case 'legal_context':
        patch[key] = [...values[key]].sort()
        break
      case 'availability_periods':
      case 'availability_days':
      case 'is_urgent':
        patch[key] = values[key]
        break
      default:
        patch[key] = text(values[key] as string)
    }
  }
  return patch
}

/**
 * « Accueil »: the file the request belongs to (Clients' picker), where it came from, the contact, and the
 * intake (GOrendezvous's « Requêtes de service » fields, roadmap §2.3), saved together: only the
 * changed keys reach `update_demande`. Read-only once closed or without demandes.manage.
 */
export function IntakeTab() {
  return (
    <SectionSurface>
      <FileCard />
      <SourceSection />
      <IntakeForm />
    </SectionSurface>
  )
}

function FileCard() {
  const { bundle, canEdit } = useDemandeRecord()
  const client = bundle.client
  return (
    <SettingsCard as="section" layout="section" title={t(`${A}.file.title`)} description={t(`${A}.file.description`)}>
      {client ? (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{fileLabel(client.client_number, client.display_name)}</p>
          <p className="text-muted-foreground">
            {[client.email, client.mobile_e164 ? formatPhone(client.mobile_e164) : null, client.birthday ? formatDateOnlyShort(client.birthday) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${A}.file.none`)}</p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-start gap-2">
          <ClientLink label={client ? t(`${A}.file.change`) : t(`${A}.file.link`)} />
          {client && <RemoveFile />}
        </div>
      )}
    </SettingsCard>
  )
}

/**
 * « Retirer le dossier »: the request is no longer attached (D-57); its own contact, kept while the
 * file was attached, is shown and editable again. Refused in French when the request would have
 * nobody to call back.
 */
function RemoveFile() {
  const { id } = useDemandeRecord()
  const update = useUpdateDemande(id)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-sm:h-11"
        aria-disabled={update.isPending || undefined}
        onClick={() => {
          if (update.isPending) return
          setError(null)
          update.mutate({ client_id: null }, { onSuccess: () => toast.success(t(`${A}.file.removed`)), onError: (failure) => setError(demandesError(failure)) })
        }}
      >
        {t(`${A}.file.remove`)}
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Where the request came from (D3c's card, R-74): the channel, the declared source, the campaign.
 * « Modifier » corrects the first two (D-26: demandes.manage, a closed request too: it is a fact
 * about how the person came).
 */
function SourceSection() {
  const { id, bundle, reference } = useDemandeRecord()
  const d = bundle.demande
  const save = useSetDemandeSource(id)
  const heard = d.referral_source_id ? (reference.referral_sources.find((s) => s.id === d.referral_source_id)?.name ?? null) : null
  return (
    <div className="p-5">
      <DemandeSourceCard
        demande={d}
        referralSources={reference.referral_sources}
        referralSourceName={heard}
        onSave={
          bundle.can.manage
            ? async (values) => {
                try {
                  await save.mutateAsync(values)
                  toast.success(t('modules.demandes.sources.saved'))
                } catch (error) {
                  throw new Error(demandesError(error))
                }
              }
            : undefined
        }
      />
    </div>
  )
}

function IntakeForm() {
  const { id, bundle, reference, canEdit } = useDemandeRecord()
  // Another counselor's save (realtime) never wipes the edits under way: see useServerDraft.
  const draft = useServerDraft(useMemo(() => valuesOf(bundle), [bundle]))
  const { values, setValues, dirty } = draft
  const initial = draft.base
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateDemande(id)
  useUnsavedChanges(dirty)
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((prev) => ({ ...prev, [key]: value }))
  // « Non » (or no answer) clears what follows the question (legacy; the database does too).
  const answer = (key: YesNoKey, value: string) =>
    setValues((prev) => {
      const next: Values = { ...prev, [key]: value }
      if (value !== 'yes') for (const follow of FOLLOW_UPS[key]) (next as unknown as Record<string, unknown>)[follow] = Array.isArray(prev[follow]) ? [] : ''
      return next
    })
  const toggle = <K extends 'availability_periods' | 'availability_days' | 'motif_ids' | CodesKey>(key: K, item: Values[K][number]) =>
    setValues((prev) => {
      const list = prev[key] as (string | number)[]
      const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
      return { ...prev, [key]: key === 'availability_days' ? (next as number[]).sort() : next }
    })
  const motifsByCategory = useMemo(() => {
    const groups = new Map<string, { name: string; motifs: { id: string; name: string }[] }>()
    for (const m of reference.motifs) {
      const key = m.category_id ?? 'none'
      if (!groups.has(key)) groups.set(key, { name: m.category_name ?? t(`${A}.otherMotifs`), motifs: [] })
      groups.get(key)!.motifs.push({ id: m.id, name: m.name })
    }
    return [...groups.values()]
  }, [reference.motifs])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (update.isPending || !dirty) return
    setError(null)
    // Without a file, the person to call back has a first name (D-56); a request typed before,
    // with a phone only, may still save the rest of its intake.
    if (!bundle.client && !values.contact_first_name.trim() && (initial.contact_first_name.trim() || values.contact_last_name.trim())) {
      setError(t(`${A}.contact.firstNeeded`))
      return
    }
    const patch = patchOf(initial, values)
    if ('error' in patch && typeof patch.error === 'string') {
      setError(patch.error)
      return
    }
    update.mutate(patch, {
      onSuccess: () => {
        draft.commit()
        toast.success(t(`${A}.saved`))
      },
      onError: (failure) => setError(demandesError(failure)),
    })
  }

  const choice = (group: string, options: readonly string[], key: keyof Values, label: string, withEmpty = false) => (
    <FormField label={label}>
      {(field) => (
        <Select {...field} value={values[key] as string} onChange={(e) => set(key, e.target.value as never)} readOnly={!canEdit}>
          {withEmpty && <option value="">{t(`${A}.unknown`)}</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {optionLabel(group, o)}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  )

  const yesNoField = (key: YesNoKey, label: string, help?: string) => (
    <FormField label={label} help={help}>
      {(field) => (
        <Select {...field} value={values[key]} onChange={(e) => answer(key, e.target.value)} readOnly={!canEdit}>
          <option value="">{t(`${A}.unknown`)}</option>
          {['yes', 'no'].map((o) => (
            <option key={o} value={o}>
              {optionLabel('yesNo', o)}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  )
  const codes = (key: CodesKey, group: string, options: readonly string[], legend: string) => (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <CheckboxField key={o} label={optionLabel(group, o)} checked={values[key].includes(o)} onCheckedChange={() => canEdit && toggle(key, o)} />
        ))}
      </div>
    </fieldset>
  )
  const comment = (key: 'issues_comment' | 'previous_comment' | 'legal_detail', label: string) => (
    <FormField label={label}>
      {(field) => <Textarea {...field} value={values[key]} onChange={(e) => set(key, e.target.value)} readOnly={!canEdit} rows={2} maxLength={2000} />}
    </FormField>
  )

  return (
    <form onSubmit={submit} noValidate className="contents">
      {draft.stale && <StaleNotice onReload={draft.reload} />}
      <SettingsCard as="section" layout="section" title={t(`${A}.contact.title`)} description={bundle.client ? undefined : t(`${A}.contact.description`)}>
        {bundle.client ? (
          // D-57: with a file, its contact is the one to use; the request's own stays stored (it
          // comes back when the file is removed) but is not offered twice.
          <p className="text-sm">
            {t(`${A}.contact.fromFile`, { number: clientNumber(bundle.client.client_number) })}{' '}
            <Link to={`/clients/${bundle.client.id}`} className="text-link underline-offset-2 hover:underline">
              {t(`${A}.contact.openFile`)}
            </Link>
          </p>
        ) : (
          <ContactFields values={values} set={set} canEdit={canEdit} />
        )}
      </SettingsCard>

      <SettingsCard as="section" layout="section" title={t(`${A}.need.title`)} description={t(`${A}.need.description`)}>
        <FormRow>
          {choice('beneficiary', BENEFICIARIES, 'beneficiary', t(`${A}.need.beneficiary`), true)}
          {yesNoField('previous_therapy', t(`${A}.need.previousTherapy`))}
        </FormRow>
        <ParticipantsHint beneficiary={values.beneficiary} />
        {values.previous_therapy === 'yes' && (
          <div className="space-y-3 border-l-2 border-border-light pl-3">
            {codes('previous_professionals', 'previousProfessional', PREVIOUS_PROFESSIONALS, t(`${A}.need.previousProfessionals`))}
            {comment('previous_comment', t(`${A}.need.previousComment`))}
          </div>
        )}
        {/* Each question, then what follows it (the tab order keeps them together). */}
        <FormRow>{yesNoField('has_issues', t(`${A}.need.issues`), t(`${A}.need.issuesHelp`))}</FormRow>
        {values.has_issues === 'yes' && (
          <div className="space-y-3 border-l-2 border-border-light pl-3">
            {codes('issues', 'issue', ISSUES, t(`${A}.need.issuesWhich`))}
            {comment('issues_comment', t(`${A}.need.issuesComment`))}
          </div>
        )}
        <FormRow>{yesNoField('has_legal_context', t(`${A}.need.legal`), t(`${A}.need.legalHelp`))}</FormRow>
        {values.has_legal_context === 'yes' && (
          <div className="space-y-3 border-l-2 border-border-light pl-3">
            {codes('legal_context', 'legalContext', LEGAL_CONTEXTS, t(`${A}.need.legalWhich`))}
            {comment('legal_detail', t(`${A}.need.legalDetail`))}
          </div>
        )}
        <FormRow>
          <FormField label={t(`${A}.need.title_`)}>
            {(field) => (
              <Select {...field} value={values.profession_title_id} onChange={(e) => set('profession_title_id', e.target.value)} readOnly={!canEdit}>
                <option value="">{t(`${A}.any`)}</option>
                {reference.profession_titles.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t(`${A}.need.clientele`)} help={t(`${A}.need.clienteleHelp`)} error={clienteleConflict(values.clientele_id, bundle.match_basis) ?? undefined}>
            {(field) => (
              <Select {...field} value={values.clientele_id} onChange={(e) => set('clientele_id', e.target.value)} readOnly={!canEdit}>
                <option value="">{autoOptionLabel(bundle.match_basis)}</option>
                {reference.clienteles.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </FormRow>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t(`${A}.need.motifs`)}</legend>
          <p className="text-xs text-muted-foreground">{t(`${A}.need.motifsHelp`)}</p>
          {/* The whole list shows (an inner scroll box hid the last categories on a phone). */}
          <div className="grid gap-3 rounded-md border border-border-light p-3 sm:grid-cols-2">
            {motifsByCategory.map((group) => (
              <div key={group.name} className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">{group.name}</p>
                {group.motifs.map((m) => (
                  <CheckboxField key={m.id} label={m.name} checked={values.motif_ids.includes(m.id)} onCheckedChange={() => canEdit && toggle('motif_ids', m.id)} />
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <FormField label={t(`${A}.need.motifOther`)} help={t(`${A}.need.motifOtherHelp`)}>
          {(field) => <Input {...field} value={values.motif_other} onChange={(e) => set('motif_other', e.target.value)} readOnly={!canEdit} maxLength={200} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${A}.need.concerns`)} help={t(`${A}.need.concernsHelp`)}>
          {(field) => <Textarea {...field} value={values.concerns} onChange={(e) => set('concerns', e.target.value)} readOnly={!canEdit} rows={3} />}
        </FormField>
        <CheckboxField label={t(`${A}.need.urgent`)} checked={values.is_urgent} onCheckedChange={(v) => canEdit && set('is_urgent', v)} />
      </SettingsCard>

      <SettingsCard as="section" layout="section" title={t(`${A}.prefs.title`)} description={t(`${A}.prefs.description`)}>
        <FormRow>
          {choice('language', ['fr', 'en'], 'language', t(`${A}.prefs.language`))}
          {choice('modality', MODALITIES, 'modality', t(`${A}.prefs.modality`))}
          {choice('gender', GENDERS, 'preferred_pro_gender', t(`${A}.prefs.gender`))}
        </FormRow>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t(`${A}.prefs.periods`)}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {PERIODS.map((p) => (
              <CheckboxField key={p} label={optionLabel('period', p)} checked={values.availability_periods.includes(p)} onCheckedChange={() => canEdit && toggle('availability_periods', p)} />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t(`${A}.prefs.days`)}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {DAYS.map((day) => (
              <CheckboxField key={day} label={optionLabel('day', String(day))} checked={values.availability_days.includes(day)} onCheckedChange={() => canEdit && toggle('availability_days', day)} />
            ))}
          </div>
        </fieldset>
        <FormField label={t(`${A}.prefs.availabilityOther`)} help={t(`${A}.prefs.availabilityOtherHelp`)}>
          {(field) => (
            <Input {...field} value={values.availability_other} onChange={(e) => set('availability_other', e.target.value)} readOnly={!canEdit} maxLength={300} autoComplete="off" />
          )}
        </FormField>
        <FormRow>
          {choice('payer', PAYER_KINDS, 'payer_kind', t(`${A}.prefs.payer`))}
          <FormField label={t(`${A}.prefs.insurer`)}>
            {(field) => <Input {...field} value={values.insurer} onChange={(e) => set('insurer', e.target.value)} readOnly={!canEdit} autoComplete="off" />}
          </FormField>
        </FormRow>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="flex justify-end gap-2 empty:hidden">
            <FormActions onCancel={draft.reset} dirty={dirty} pending={update.isPending} />
          </div>
        )}
      </SettingsCard>
    </form>
  )
}

/** « Prénom » and « Nom » on one row (stacked on a phone), then the phone and the email. */
function ContactFields({
  values,
  set,
  canEdit,
}: {
  values: Pick<Values, 'contact_first_name' | 'contact_last_name' | 'contact_phone' | 'contact_email'>
  set: <K extends keyof Values>(key: K, value: Values[K]) => void
  canEdit: boolean
}) {
  return (
    <>
      <FormRow columns={2}>
        <FormField label={t(`${A}.contact.firstName`)}>
          {(field) => (
            <Input {...field} value={values.contact_first_name} onChange={(e) => set('contact_first_name', e.target.value)} readOnly={!canEdit} maxLength={100} autoComplete="off" />
          )}
        </FormField>
        <FormField label={t(`${A}.contact.lastName`)}>
          {(field) => (
            <Input {...field} value={values.contact_last_name} onChange={(e) => set('contact_last_name', e.target.value)} readOnly={!canEdit} maxLength={100} autoComplete="off" />
          )}
        </FormField>
      </FormRow>
      {/* Two equal columns: an e-mail address reads whole (it was cut beside the phone). */}
      <FormRow columns={2}>
        <FormField label={t(`${A}.contact.phone`)}>
          {(field) => (
            <Input {...field} type="tel" value={values.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} readOnly={!canEdit} autoComplete="off" />
          )}
        </FormField>
        <FormField label={t(`${A}.contact.email`)}>
          {(field) => (
            <Input {...field} type="email" value={values.contact_email} onChange={(e) => set('contact_email', e.target.value)} readOnly={!canEdit} autoComplete="off" />
          )}
        </FormField>
      </FormRow>
    </>
  )
}

/**
 * « Pour qui » says someone else and « Participants » does not say who yet (D-60): a plain notice
 * with the way there, never blocking. It reads the saved participants (the tab saves them).
 */
function ParticipantsHint({ beneficiary }: { beneficiary: string }) {
  const { id, bundle } = useDemandeRecord()
  const hint = participantsHint(beneficiary, bundle.participants, bundle.demande.client_id)
  if (!hint) return null
  return (
    <Alert variant="default">
      <Info aria-hidden />
      <AlertDescription className="text-foreground">
        {hint}{' '}
        <GuardedNavLink to={demandePath(id, 'participants')} className="text-link underline-offset-2 hover:underline">
          {t('modules.demandes.clientele.addPeopleLink')}
        </GuardedNavLink>
      </AlertDescription>
    </Alert>
  )
}
