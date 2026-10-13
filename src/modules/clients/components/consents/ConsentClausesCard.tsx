import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import type { VersionClause } from '../../api/consents'
import { useConsentClauses, useSaveConsentClauses } from '../../hooks/use-consents'

const C = 'modules.clients.consents.settings.clauses'
const MAX_CLAUSES = 20

/** A key for a new clause, unique in the list (`clause_1`, `clause_2`…); a reworded clause keeps its own. */
function newKey(clauses: VersionClause[]): string {
  const taken = new Set(clauses.map((c) => c.key))
  let n = clauses.length + 1
  while (taken.has(`clause_${n}`)) n++
  return `clause_${n}`
}

/**
 * « Clauses » (CC-13): the « Oui / Non » questions the client answers on our page before signing
 * (R-46), for one version of one consent text, in its language. A draft's are changed here (add,
 * reword, reorder, « Accord requis » or « Oui ou non », at most 20) and saved with « Enregistrer »; a
 * published version's are read only (« Nouvelle version » in the text's editor makes a draft).
 */
export function ConsentClausesCard({ versionId, readOnly }: { versionId: string; readOnly: boolean }) {
  const query = useConsentClauses(versionId)
  if (query.isPending) return <Loading />
  if (!query.data) {
    return <LoadError message={t(`${C}.loadError`)} retrying={query.isFetching} onRetry={() => void query.refetch()} />
  }
  return <ClausesForm key={`${versionId}:${JSON.stringify(query.data.clauses)}`} versionId={versionId} saved={query.data.clauses} editable={!readOnly && query.data.editable} />
}

function ClausesForm({ versionId, saved, editable }: { versionId: string; saved: VersionClause[]; editable: boolean }) {
  const [clauses, setClauses] = useState<VersionClause[]>(saved)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveConsentClauses({ onErrorMessage: (message) => setRefusal(message) })
  const dirty = editable && JSON.stringify(clauses) !== JSON.stringify(saved)
  useUnsavedChanges(dirty)

  const set = (index: number, patch: Partial<VersionClause>) => setClauses((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const move = (index: number, by: -1 | 1) =>
    setClauses((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item!)
      return next
    })
  const empty = clauses.some((c) => c.text.trim() === '')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || save.isPending) return
    if (empty) {
      setRefusal(t(`${C}.emptyText`))
      return
    }
    setRefusal(null)
    save.mutate({ versionId, clauses })
  }

  if (!editable) {
    return (
      <SettingsCard as="section" title={t(`${C}.title`)} description={t(`${C}.readOnlyDescription`)}>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${C}.none`)}</p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            {saved.map((clause) => (
              <li key={clause.key}>
                {clause.text} {clause.kind === 'agree' && <Badge variant="outline">{t(`${C}.kinds.agree`)}</Badge>}
              </li>
            ))}
          </ol>
        )}
      </SettingsCard>
    )
  }

  return (
    <SettingsCard
      title={t(`${C}.title`)}
      description={t(`${C}.description`)}
      dirty={dirty}
      pending={save.isPending}
      onSubmit={submit}
      footer={
        <FormActions
          dirty={dirty}
          pending={save.isPending}
          onCancel={() => {
            setClauses(saved)
            setRefusal(null)
          }}
        />
      }
    >
      {clauses.length === 0 && <p className="text-sm text-muted-foreground">{t(`${C}.none`)}</p>}
      <ol className="space-y-4">
        {clauses.map((clause, index) => (
          <li key={clause.key} className="space-y-2 rounded-md border border-border-light p-3">
            <FormField label={t(`${C}.text`, { n: String(index + 1) })}>
              {(field) => <Textarea {...field} value={clause.text} rows={2} maxLength={1000} onChange={(e) => set(index, { text: e.target.value })} />}
            </FormField>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="w-56">
                <FormField label={t(`${C}.kind`)}>
                  {(field) => (
                    <Select {...field} value={clause.kind} onChange={(e) => set(index, { kind: e.target.value as VersionClause['kind'] })}>
                      <option value="agree">{t(`${C}.kinds.agree`)}</option>
                      <option value="yes_no">{t(`${C}.kinds.yes_no`)}</option>
                    </Select>
                  )}
                </FormField>
              </div>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={index === 0} aria-label={t(`${C}.up`, { n: String(index + 1) })} onClick={() => move(index, -1)}>
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === clauses.length - 1}
                  aria-label={t(`${C}.down`, { n: String(index + 1) })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t(`${C}.remove`, { n: String(index + 1) })}
                  onClick={() => setClauses((list) => list.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={clauses.length >= MAX_CLAUSES}
          onClick={() => setClauses((list) => [...list, { key: newKey(list), kind: 'yes_no', text: '' }])}
        >
          <Plus aria-hidden className="size-3.5" />
          {t(`${C}.add`)}
        </Button>
        {clauses.length >= MAX_CLAUSES && <p className="text-xs text-muted-foreground">{t(`${C}.max`)}</p>}
      </div>
      {refusal && <RefusalAlert message={refusal} />}
    </SettingsCard>
  )
}
