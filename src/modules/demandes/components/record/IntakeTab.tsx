import { useMemo, useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { demandesError } from '../../lib/errors'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FormActions } from '@/shared/components/FormActions'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatPhone, parsePhone } from '@/shared/lib/format'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import { BENEFICIARIES, GENDERS, MODALITIES, PAYER_KINDS, PERIODS, type DemandeBundle } from '../../api/demandes'
import { useUpdateDemande } from '../../hooks/use-demandes'
import { fileLabel, optionLabel } from '../../lib/display'
import { ClientLinkDialog } from './ClientLinkDialog'
import { useServerDraft } from '../../lib/use-server-draft'
import { useDemandeRecord } from './record-context'
import { StaleNotice } from './StaleNotice'

const A = 'modules.demandes.intake'
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

interface Values {
  contact_name: string
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
}

function valuesOf(bundle: DemandeBundle): Values {
  const d = bundle.demande
  return {
    contact_name: d.contact_name ?? '',
    contact_email: d.contact_email ?? '',
    contact_phone: d.contact_phone_e164 ? formatPhone(d.contact_phone_e164) : '',
    beneficiary: d.beneficiary ?? '',
    previous_therapy: d.previous_therapy === null ? '' : d.previous_therapy ? 'yes' : 'no',
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
        patch.previous_therapy = values.previous_therapy === '' ? null : values.previous_therapy === 'yes'
        break
      case 'motif_ids':
        patch.motif_ids = [...values.motif_ids].sort()
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
 * « Accueil »: the file the request belongs to (TEMPORAIRE picker, D-9), the contact, and the
 * intake (GOrendezvous's « Requêtes de service » fields, roadmap §2.3), saved together: only the
 * changed keys reach `update_demande`. Read-only once closed or without demandes.manage.
 */
export function IntakeTab() {
  return (
    <SectionSurface>
      <FileCard />
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
      {canEdit && <ClientLinkDialog label={client ? t(`${A}.file.change`) : t(`${A}.file.link`)} />}
    </SettingsCard>
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
  const toggle = <K extends 'availability_periods' | 'availability_days' | 'motif_ids'>(key: K, item: Values[K][number]) =>
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
    const patch = patchOf(initial, values)
    if ('error' in patch && typeof patch.error === 'string') {
      setError(patch.error)
      return
    }
    update.mutate(patch, {
      onSuccess: () => toast.success(t(`${A}.saved`)),
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

  return (
    <form onSubmit={submit} noValidate className="contents">
      {draft.stale && <StaleNotice onReload={draft.reload} />}
      <SettingsCard as="section" layout="section" title={t(`${A}.contact.title`)} description={t(`${A}.contact.description`)}>
        <FormField label={t(`${A}.contact.name`)}>
          {(field) => <Input {...field} value={values.contact_name} onChange={(e) => set('contact_name', e.target.value)} readOnly={!canEdit} autoComplete="off" />}
        </FormField>
        <FormRow>
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
      </SettingsCard>

      <SettingsCard as="section" layout="section" title={t(`${A}.need.title`)} description={t(`${A}.need.description`)}>
        <FormRow>
          {choice('beneficiary', BENEFICIARIES, 'beneficiary', t(`${A}.need.beneficiary`), true)}
          {choice('yesNo', ['yes', 'no'], 'previous_therapy', t(`${A}.need.previousTherapy`), true)}
        </FormRow>
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
          <FormField label={t(`${A}.need.clientele`)}>
            {(field) => (
              <Select {...field} value={values.clientele_id} onChange={(e) => set('clientele_id', e.target.value)} readOnly={!canEdit}>
                <option value="">{t(`${A}.unknown`)}</option>
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
          <div className="grid max-h-80 gap-3 overflow-y-auto rounded-md border border-border-light p-3 sm:grid-cols-2">
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
