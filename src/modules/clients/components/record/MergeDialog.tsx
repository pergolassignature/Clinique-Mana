import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Radio } from '@/shared/ui/radio'
import type { Client, ClientSummary } from '../../api/parse'
import { useClientRecord, useClientSearch, useClientsReference, useMergeClients } from '../../hooks/use-clients'
import { clientPath } from '../../lib/constants'
import { clientNumberLabel, fullName } from '../../lib/display'
import { chosenTakes, mergeMoves, mergeRows } from '../../lib/merge'

const M = 'modules.clients.merge'

/**
 * « Fusionner » (plan C4.1, clients.merge): this file and another one of the same person become
 * one. The person finds the other file (or comes from « Doublons possibles » with it chosen),
 * picks which file stays (the older one by default: its number is the one people quote), then,
 * side by side, which value to keep where the two differ; the kept file's empty fields are filled
 * from the other. Before « Fusionner les dossiers », what moves and that a merge is never undone.
 * The kept file opens afterwards.
 */
export function MergeDialog({ current, otherId: initialOtherId = null, onClose }: { current: ClientSummary; otherId?: string | null; onClose: () => void }) {
  const [otherId, setOtherId] = useState<string | null>(initialOtherId)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`${M}.title`)}</DialogTitle>
          <DialogDescription>{t(`${M}.description`, { client: fullName(current.client) })}</DialogDescription>
        </DialogHeader>
        {otherId === null ? <OtherPicker current={current.client} onPick={setOtherId} /> : <MergeForm current={current} otherId={otherId} onChange={() => setOtherId(null)} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function OtherPicker({ current, onPick }: { current: Client; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const search = useClientSearch(useDebouncedValue(query, 250))
  const results = (search.data ?? []).filter((row) => row.id !== current.id)
  return (
    <div className="space-y-2">
      <FormField label={t(`${M}.other`)} width="full" help={t(`${M}.otherHelp`)}>
        {(field) => <Input {...field} type="search" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />}
      </FormField>
      {query.trim().length >= 2 && (
        <ul aria-label={t(`${M}.results`)} className="max-h-60 space-y-1 overflow-y-auto">
          {search.isError ? (
            <li className="text-sm text-destructive">{t('modules.clients.picker.searchError')}</li>
          ) : results.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t(search.isFetching ? 'common.loading' : `${M}.noResult`)}</li>
          ) : (
            results.map((row) => (
              <li key={row.id}>
                <Button type="button" variant="ghost" className="h-auto w-full justify-start py-1.5 text-left" onClick={() => onPick(row.id)}>
                  <span>
                    <span className="font-medium">{row.name}</span> · <span className="tabular text-muted-foreground">{clientNumberLabel(row.clientNumber)}</span>
                    {row.email && <span className="block text-xs text-muted-foreground">{row.email}</span>}
                  </span>
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t('common.cancel')}
          </Button>
        </DialogClose>
        {/* The next step is in view, waiting for the other file. */}
        <Button type="button" disabled>
          {t(`${M}.submit`)}
        </Button>
      </DialogFooter>
    </div>
  )
}

function MergeForm({ current, otherId, onChange, onClose }: { current: ClientSummary; otherId: string; onChange: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const other = useClientRecord(otherId)
  const reference = useClientsReference()
  const [keepCurrent, setKeepCurrent] = useState<boolean | null>(null)
  const [takeMerged, setTakeMerged] = useState<ReadonlySet<string>>(new Set())
  const [refusal, setRefusal] = useState<string | null>(null)
  const merge = useMergeClients({ onErrorMessage: (message) => setRefusal(message) })
  const otherSummary = other.data

  const sides = useMemo(() => {
    if (!otherSummary) return null
    const keepThis = keepCurrent ?? current.client.clientNumber <= otherSummary.client.clientNumber
    return keepThis ? { keepThis, kept: current, merged: otherSummary } : { keepThis, kept: otherSummary, merged: current }
  }, [current, otherSummary, keepCurrent])
  const rows = useMemo(() => (sides ? mergeRows(sides.kept.client, sides.merged.client, reference.data) : []), [sides, reference.data])

  if (other.isError) return <LoadError message={t(`${M}.loadError`)} onRetry={() => void other.refetch()} retrying={other.isFetching} />
  if (otherSummary === null) return <p className="text-sm text-muted-foreground">{t(`${M}.notFound`)}</p>
  // The names (sources, professionals) are needed to compare and show the values.
  if (!sides || !otherSummary || !reference.data) return <Loading />
  const closed = otherSummary.client.mergedIntoId !== null || otherSummary.client.anonymizedAt !== null
  const choices = rows.filter((row) => row.choice)
  const filled = rows.filter((row) => !row.choice)
  const moves = mergeMoves(sides.merged)

  const submit = () => {
    setRefusal(null)
    const keptId = sides.kept.client.id
    // mutateAsync: the refetch that follows the merge may unmount this dialog (« Doublons
    // possibles » hides on a merged file) before a mutate() callback would run.
    merge.mutateAsync({ keepId: keptId, mergeId: sides.merged.client.id, take: chosenTakes(rows, takeMerged) }).then(
      () => {
        onClose()
        navigate(clientPath(keptId))
      },
      () => undefined, // shown in the dialog (onErrorMessage)
    )
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t(`${M}.keepLegend`)}</legend>
        {[current, otherSummary].map((summary) => {
          const isThis = summary === current
          return (
            <label key={summary.client.id} className="flex items-start gap-2 text-sm">
              <Radio
                name="merge-keep"
                checked={sides.keepThis === isThis}
                onChange={() => {
                  setKeepCurrent(isThis)
                  setTakeMerged(new Set())
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{fullName(summary.client)}</span> · <span className="tabular">{clientNumberLabel(summary.client.clientNumber)}</span>
                {isThis && <span className="text-muted-foreground"> {t(`${M}.thisFile`)}</span>}
              </span>
            </label>
          )
        })}
        <Button type="button" variant="ghost" size="sm" onClick={onChange}>
          {t(`${M}.changeOther`)}
        </Button>
      </fieldset>

      {closed && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{t(`${M}.closed`)}</AlertDescription>
        </Alert>
      )}

      {choices.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t(`${M}.valuesTitle`)}</h3>
          <p className="text-xs text-muted-foreground">{t(`${M}.valuesHelp`)}</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            <li aria-hidden className="hidden gap-3 p-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[10rem_1fr_1fr]">
              <span />
              <span>{t(`${M}.keptColumn`)}</span>
              <span>{t(`${M}.mergedColumn`)}</span>
            </li>
            {choices.map((row) => (
              <li
                key={row.key}
                role="radiogroup"
                aria-labelledby={`merge-label-${row.key}`}
                className="grid gap-1 p-2 sm:grid-cols-[10rem_1fr_1fr] sm:items-start sm:gap-3"
              >
                <span id={`merge-label-${row.key}`} className="text-sm text-muted-foreground">
                  {t(row.labelKey)}
                </span>
                {([false, true] as const).map((fromMerged) => (
                  <label key={String(fromMerged)} className="flex items-start gap-2 text-sm">
                    <Radio
                      name={`merge-${row.key}`}
                      checked={takeMerged.has(row.key) === fromMerged}
                      onChange={() => {
                        const next = new Set(takeMerged)
                        if (fromMerged) next.add(row.key)
                        else next.delete(row.key)
                        setTakeMerged(next)
                      }}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 break-words">{fromMerged ? row.merged : row.kept}</span>
                  </label>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {filled.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">{t(`${M}.filledTitle`)}</h3>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {filled.map((row) => (
              <li key={row.key}>
                {t(row.labelKey)} : {row.merged}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertDescription className="space-y-1 text-foreground">
          <p>
            {t(`${M}.summary`, {
              merged: `${fullName(sides.merged.client)} (${clientNumberLabel(sides.merged.client.clientNumber)})`,
              kept: `${fullName(sides.kept.client)} (${clientNumberLabel(sides.kept.client.clientNumber)})`,
            })}
          </p>
          {moves.length > 0 && <p>{t(`${M}.movesLead`, { items: moves.map((m) => t(m.key, { count: String(m.count) })).join(', ') })}</p>}
          <p className="font-medium">{t(`${M}.final`)}</p>
        </AlertDescription>
      </Alert>

      {refusal && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{refusal}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button
          type="button"
          variant="destructive"
          aria-disabled={merge.isPending || closed || undefined}
          onClick={ignoreWhenInactive(merge.isPending || closed, submit)}
          className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
        >
          {t(merge.isPending ? `${M}.submitting` : `${M}.submit`)}
        </Button>
      </DialogFooter>
    </div>
  )
}
