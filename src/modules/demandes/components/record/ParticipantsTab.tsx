import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { demandesError } from '../../lib/errors'
import { FormActions } from '@/shared/components/FormActions'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { RELATIONSHIPS, type DemandeParticipant, type ParticipantInput } from '../../api/demandes'
import { useSaveParticipants } from '../../hooks/use-demandes'
import { fileLabel, optionLabel } from '../../lib/display'
import { useServerDraft } from '../../lib/use-server-draft'
import { useDemandeRecord } from './record-context'
import { StaleNotice } from './StaleNotice'

const P = 'modules.demandes.participants'
/** `set_demande_participants` takes at most 10. */
const MAX_PARTICIPANTS = 10

interface Row {
  key: string
  id?: string
  client_id: string | null
  file: string | null
  display_name: string
  relationship: string
  birthday: string
  is_primary: boolean
}

let counter = 0
const newKey = () => `new-${++counter}`

function rowsOf(participants: DemandeParticipant[]): Row[] {
  return participants.map((p) => ({
    key: p.id,
    id: p.id,
    client_id: p.client_id,
    file: p.client ? fileLabel(p.client.client_number, p.client.display_name) : null,
    display_name: p.display_name ?? '',
    relationship: p.relationship,
    birthday: p.birthday ?? '',
    is_primary: p.is_primary,
  }))
}

/**
 * « Participants »: who the request is for (a couple, a family, a child and a parent), one main
 * person; each is a file of the clinic or a name. Saved as a set (`set_demande_participants`).
 */
export function ParticipantsTab() {
  return (
    <SectionSurface>
      <ParticipantsForm />
    </SectionSurface>
  )
}

function ParticipantsForm() {
  const { id, bundle, canEdit } = useDemandeRecord()
  const draft = useServerDraft(useMemo(() => rowsOf(bundle.participants), [bundle.participants]))
  const { values: rows, setValues: setRows, dirty } = draft
  const [error, setError] = useState<string | null>(null)
  const save = useSaveParticipants(id)
  useUnsavedChanges(dirty)
  const client = bundle.client
  const clientListed = client !== null && rows.some((r) => r.client_id === client.id)

  const change = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setPrimary = (key: string) => setRows((prev) => prev.map((r) => ({ ...r, is_primary: r.key === key })))
  const add = (row: Partial<Row>) =>
    setRows((prev) => [
      ...prev,
      { key: newKey(), client_id: null, file: null, display_name: '', relationship: 'self', birthday: '', is_primary: prev.length === 0, ...row },
    ])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending || !dirty) return
    setError(null)
    if (rows.some((r) => !r.client_id && !r.display_name.trim())) {
      setError(t(`${P}.nameNeeded`))
      return
    }
    if (rows.length > MAX_PARTICIPANTS) {
      setError(t(`${P}.tooMany`, { max: String(MAX_PARTICIPANTS) }))
      return
    }
    if (rows.length > 0 && rows.filter((r) => r.is_primary).length !== 1) {
      setError(t(`${P}.onePrimary`))
      return
    }
    const payload: ParticipantInput[] = rows.map((r) => ({
      ...(r.id && { id: r.id }),
      client_id: r.client_id,
      display_name: r.client_id ? null : r.display_name.trim(),
      relationship: r.relationship,
      birthday: r.birthday || null,
      is_primary: r.is_primary,
    }))
    save.mutate(payload, {
      onSuccess: () => toast.success(t(`${P}.saved`)),
      onError: (failure) => setError(demandesError(failure)),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="contents">
      <SettingsCard as="section" layout="section" title={t(`${P}.title`)} description={t(`${P}.description`)}>
        {draft.stale && <StaleNotice onReload={draft.reload} />}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{t(`${P}.empty`)}</p>}
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.key} className="space-y-2 rounded-md border border-border-light p-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {row.file ?? (row.display_name.trim() || t(`${P}.person`, { n: String(index + 1) }))}
                  {row.is_primary && <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`${P}.primary`)}</span>}
                </legend>
                <FormRow>
                  {!row.client_id && (
                    <FormField label={t(`${P}.name`)}>
                      {(field) => <Input {...field} value={row.display_name} onChange={(e) => change(row.key, { display_name: e.target.value })} readOnly={!canEdit} autoComplete="off" />}
                    </FormField>
                  )}
                  <FormField label={t(`${P}.relationship`)}>
                    {(field) => (
                      <Select {...field} value={row.relationship} onChange={(e) => change(row.key, { relationship: e.target.value })} readOnly={!canEdit}>
                        {RELATIONSHIPS.map((r) => (
                          <option key={r} value={r}>
                            {optionLabel('relationship', r)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  {!row.client_id && (
                    <FormField label={t(`${P}.birthday`)}>
                      {(field) =>
                        canEdit ? (
                          <Input {...field} type="date" value={row.birthday} onChange={(e) => change(row.key, { birthday: e.target.value })} />
                        ) : (
                          <Input {...field} value={row.birthday ? formatDateOnlyShort(row.birthday) : ''} readOnly />
                        )
                      }
                    </FormField>
                  )}
                </FormRow>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {!row.is_primary && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setPrimary(row.key)} className="max-sm:h-11">
                        {t(`${P}.makePrimary`)}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(`${P}.removeLabel`, { who: row.file ?? (row.display_name.trim() || String(index + 1)) })}
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      className="max-sm:h-11"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                      {t(`${P}.remove`)}
                    </Button>
                  </div>
                )}
              </fieldset>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_PARTICIPANTS} onClick={() => add({})} className="max-sm:h-11">
              <Plus aria-hidden className="size-3.5" />
              {t(`${P}.add`)}
            </Button>
            {client && !clientListed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => add({ client_id: client.id, file: fileLabel(client.client_number, client.display_name) })}
                className="max-sm:h-11"
              >
                <Plus aria-hidden className="size-3.5" />
                {t(`${P}.addFile`, { file: fileLabel(client.client_number, client.display_name) })}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="flex justify-end gap-2 empty:hidden">
            <FormActions onCancel={draft.reset} dirty={dirty} pending={save.isPending} />
          </div>
        )}
      </SettingsCard>
    </form>
  )
}
