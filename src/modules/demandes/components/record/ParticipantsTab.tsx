import { Suspense, useId, useMemo, useState, type FormEvent } from 'react'
import { CircleCheck, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { ClientPicker } from '@/modules/clients'
import { demandesError } from '../../lib/errors'
import { FormActions } from '@/shared/components/FormActions'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { DateField } from '@/shared/ui/date-field'
import { RELATIONSHIPS, type DemandeFileConsents, type DemandeParticipant, type ParticipantInput } from '../../api/demandes'
import { useDemandeConsents, useSaveParticipants } from '../../hooks/use-demandes'
import { allConsentsValid, fileConsentStatus } from '../../lib/consents'
import { fileLabel, optionLabel } from '../../lib/display'
import { countWarning } from '../../lib/participants'
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
 * person; each is a file of the clinic (« Ajouter un dossier de la clinique »: Clients' picker,
 * search or create) or a name. Saved as a set (`set_demande_participants`). A couple or a family
 * with the wrong count is said, never blocked (D-37). Each file shows its consents, read live from
 * Clients (D-39), with one line for the whole request: all valid, or what to settle.
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
  const [picking, setPicking] = useState(false)
  const consents = useDemandeConsents(id)
  const consentOf = (clientId: string | null) => (clientId ? consents.data?.find((f) => f.client_id === clientId) : undefined)
  const warning = countWarning(bundle.demande.beneficiary, rows.length)

  const change = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setPrimary = (key: string) => setRows((prev) => prev.map((r) => ({ ...r, is_primary: r.key === key })))
  const add = (row: Partial<Row>) =>
    setRows((prev) => [
      ...prev,
      { key: newKey(), client_id: null, file: null, display_name: '', relationship: 'self', birthday: '', is_primary: prev.length === 0, ...row },
    ])

  // A file of the clinic: the relationship guessed from the request's kind (the person first).
  const addFile = (clientId: string, file: string) => {
    setPicking(false)
    if (rows.some((r) => r.client_id === clientId)) return
    const relationship = rows.length === 0 ? 'self' : bundle.demande.beneficiary === 'couple' ? 'partner' : 'other'
    add({ client_id: clientId, file, relationship })
  }

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
      onSuccess: () => {
        draft.commit()
        toast.success(t(`${P}.saved`))
      },
      onError: (failure) => setError(demandesError(failure)),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="contents">
      <SettingsCard as="section" layout="section" title={t(`${P}.title`)} description={t(`${P}.description`)}>
        {draft.stale && <StaleNotice onReload={draft.reload} />}
        <ConsentsSummary
          files={consents.data ?? null}
          failed={consents.isError && !consents.data}
          labelOf={(clientId) =>
            clientId === client?.id
              ? fileLabel(client.client_number, client.display_name)
              : (rows.find((r) => r.client_id === clientId)?.file ?? bundle.participants.find((p) => p.client_id === clientId)?.client?.display_name ?? '')
          }
        />
        {warning && (
          <p role="status" className="text-sm text-foreground">
            {warning}
          </p>
        )}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{t(`${P}.empty`)}</p>}
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.key} className="space-y-2 rounded-md border border-border-light p-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {row.file ?? (row.display_name.trim() || t(`${P}.person`, { n: String(index + 1) }))}
                  {row.is_primary && <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`${P}.primary`)}</span>}
                </legend>
                {row.client_id && <ConsentBadge file={consentOf(row.client_id)} saved={Boolean(row.id)} loading={!consents.data && !consents.isError} />}
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
                          <DateField {...field} value={row.birthday} min="1900-01-01" clearable onChange={(birthday) => change(row.key, { birthday })} />
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
            {!picking && (
              <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_PARTICIPANTS} onClick={() => setPicking(true)} className="max-sm:h-11">
                <Plus aria-hidden className="size-3.5" />
                {t(`${P}.addClient`)}
              </Button>
            )}
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
        {canEdit && picking && (
          <FilePicker
            excludeIds={rows.flatMap((r) => (r.client_id ? [r.client_id] : []))}
            onPick={(clientId, file) => addFile(clientId, file)}
            onCancel={() => setPicking(false)}
          />
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

/** « Ajouter un dossier de la clinique »: Clients' picker (search, or « Nouveau client »). */
function FilePicker({ excludeIds, onPick, onCancel }: { excludeIds: string[]; onPick: (clientId: string, file: string) => void; onCancel: () => void }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="space-y-2 rounded-md border border-border p-3">
      <h3 id={titleId} className="text-sm font-medium">
        {t(`${P}.picker.title`)}
      </h3>
      <p className="text-sm text-muted-foreground">{t(`${P}.picker.description`)}</p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
        <ClientPicker
          excludeIds={excludeIds}
          onSelect={(clientId, picked) => onPick(clientId, picked ? fileLabel(picked.clientNumber, picked.name) : t(`${P}.picker.newFile`))}
          onCreated={(clientId) => onPick(clientId, t(`${P}.picker.newFile`))}
        />
      </Suspense>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="max-sm:h-11">
        {t('common.cancel')}
      </Button>
    </section>
  )
}

/** One file's consents (D-39), as a badge; a file added but not saved yet is read once saved. */
function ConsentBadge({ file, saved, loading }: { file: DemandeFileConsents | undefined; saved: boolean; loading: boolean }) {
  if (loading) return null
  if (!file) return saved ? null : <p className="text-xs text-muted-foreground">{t(`${P}.consents.afterSave`)}</p>
  const status = fileConsentStatus(file)
  return (
    <p className="text-xs">
      <span className="sr-only">{t(`${P}.consents.label`)} </span>
      <Badge variant={status.tone}>{status.label}</Badge>
    </p>
  )
}

/** The request's files (its own and the participants'): all consents valid, or what to settle. */
function ConsentsSummary({ files, failed, labelOf }: { files: DemandeFileConsents[] | null; failed: boolean; labelOf: (clientId: string) => string }) {
  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`${P}.consents.loadError`)}
      </p>
    )
  }
  if (!files || files.length === 0) return null
  if (allConsentsValid(files)) {
    return (
      <Alert variant="success">
        <CircleCheck aria-hidden />
        <AlertTitle>{t(`${P}.consents.allValid`)}</AlertTitle>
      </Alert>
    )
  }
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t(`${P}.consents.toSettle`)}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-0.5">
          {files
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => !fileConsentStatus(file).valid)
            .map(({ file, index }) => (
              <li key={file.client_id}>
                {t(`${P}.consents.fileLine`, {
                  file: labelOf(file.client_id) || t(`${P}.person`, { n: String(index + 1) }),
                  status: fileConsentStatus(file).label,
                })}
              </li>
            ))}
        </ul>
        <p className="mt-1">{t(`${P}.consents.noBlock`)}</p>
      </AlertDescription>
    </Alert>
  )
}
