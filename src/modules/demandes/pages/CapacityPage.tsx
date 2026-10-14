import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { RequireAccess } from '@/core/access/guards'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { useUrlParams } from '@/shared/lib/use-url-params'
import type { CapacityRow } from '../api/capacity'
import { useCapacityBoard, useSetNewClientPlaces } from '../hooks/use-capacity'
import { CAPACITY_VIEWS, CAPACITY_VIEW_PARAM, inView, placesText, totalText, type CapacityView } from '../lib/capacity'
import { demandesError } from '../lib/errors'
import { periodsText } from '../lib/matching'

const C = 'modules.demandes.capacity'

/**
 * « Places des professionnels » (D5, D-31): the workbook's board — every active professional by
 * name, her places (left of declared, since when, how many taken), whether she accepts new
 * clients, her periods and languages, « À prioriser », « Bon à savoir », her matches of the last
 * 30 days; the total of places left. Views as real tabs (`?vue=`). « Modifier » sets her places
 * (Professionnels' `set_professional_new_client_places`, professionals.matching), with
 * « Recommencer le décompte aujourd'hui » (P4-553). The order is the name: the matching panel of a
 * request ranks (D4).
 */
export function CapacityPage() {
  return (
    <RequireAccess permission="professionals.view">
      <CapacityBoardPage />
    </RequireAccess>
  )
}

function CapacityBoardPage() {
  usePageTitle(t(`${C}.title`))
  const { can } = useAccess()
  const board = useCapacityBoard()
  const { params, update } = useUrlParams()
  const view = CAPACITY_VIEWS.find((v) => CAPACITY_VIEW_PARAM[v] === params.get('vue')) ?? 'all'
  const [editing, setEditing] = useState<CapacityRow | null>(null)
  const canEdit = can('professionals.matching')

  return (
    <>
      <PageHeader level={1} title={t(`${C}.title`)} description={t(`${C}.description`)} />
      {board.data && (
        <p className="mb-4 text-sm">
          <span className="font-medium">{totalText(board.data.total_left, board.data.tracked)}</span>
          {board.data.last_snapshot_on && (
            <span className="text-muted-foreground"> · {t(`${C}.snapshot`, { date: formatDateOnlyShort(board.data.last_snapshot_on) })}</span>
          )}
        </p>
      )}
      <Tabs value={view} onValueChange={(next) => update({ vue: next === 'all' ? null : CAPACITY_VIEW_PARAM[next as CapacityView] })}>
        <TabsList aria-label={t(`${C}.views`)}>
          {CAPACITY_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${C}.view.${v}`)}
              {board.data && <span className="tabular ml-1.5 text-muted-foreground">{board.data.professionals.filter((r) => inView(r, v)).length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view} className="mt-4">
          {board.isError && !board.data ? (
            <LoadError message={t(`${C}.loadError`)} onRetry={() => void board.refetch()} retrying={board.isFetching} />
          ) : !board.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : (
            <BoardTable rows={board.data.professionals.filter((r) => inView(r, view))} view={view} onEdit={canEdit ? setEditing : undefined} />
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        {editing && <PlacesForm row={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  )
}

function BoardTable({ rows, view, onEdit }: { rows: CapacityRow[]; view: CapacityView; onEdit?: (row: CapacityRow) => void }) {
  if (rows.length === 0) return <EmptyState title={t(`${C}.empty.${view}`)} body={t(`${C}.emptyBody`)} />
  return (
    // Beside the menu the content is narrow: the details go first (the note, the languages, the
    // periods, the matches), the professional, her places and « Modifier » always show.
    <Table aria-label={t(`${C}.title`)} scrollLabel={t(`${C}.title`)} scrollFocus="overflow">
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          <TableHead>{t(`${C}.columns.professional`)}</TableHead>
          <TableHead>{t(`${C}.columns.places`)}</TableHead>
          <TableHead className="max-sm:hidden">{t(`${C}.columns.accepting`)}</TableHead>
          <TableHead className="max-lg:hidden">{t(`${C}.columns.periods`)}</TableHead>
          <TableHead className="max-xl:hidden">{t(`${C}.columns.languages`)}</TableHead>
          <TableHead className="text-right max-md:hidden">{t(`${C}.columns.matched`)}</TableHead>
          <TableHead className="max-xl:hidden">{t(`${C}.columns.note`)}</TableHead>
          {onEdit && (
            <TableHead>
              <span className="sr-only">{t(`${C}.columns.actions`)}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const places = placesText(row)
          return (
            <TableRow key={row.professional_id}>
              <TableCell>
                <Link to={`/professionnels/${row.professional_id}/jumelage`} className="font-medium text-link underline-offset-2 hover:underline">
                  {row.display_name}
                </Link>
                {row.primary_title_label && <span className="block text-xs text-muted-foreground">{row.primary_title_label}</span>}
                {/* On a phone the « Nouveaux clients » column is folded here. */}
                <span className="block text-xs text-foreground sm:hidden">
                  {row.accepting_new_clients ? t(`${C}.accepting`) : t(`${C}.notAccepting`)}
                </span>
                {row.matching_priority_reason && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="info">{t('modules.demandes.matching.priority')}</Badge>
                    <span className="text-xs text-muted-foreground">{row.matching_priority_reason}</span>
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={places.tone === 'warning' ? 'warning' : 'secondary'}>{places.label}</Badge>
                {places.since && <span className="block text-xs text-muted-foreground">{places.since}</span>}
              </TableCell>
              <TableCell className="max-sm:hidden">{row.accepting_new_clients ? t(`${C}.accepting`) : t(`${C}.notAccepting`)}</TableCell>
              <TableCell className="max-lg:hidden">{row.availability_periods.length > 0 ? periodsText(row.availability_periods) : t(`${C}.noPeriods`)}</TableCell>
              <TableCell className="max-xl:hidden">{row.languages.join(', ')}</TableCell>
              <TableCell className="tabular text-right max-md:hidden">{row.matched_30_days}</TableCell>
              <TableCell className="max-w-72 whitespace-pre-line text-sm text-muted-foreground max-xl:hidden">{row.matching_note ?? ''}</TableCell>
              {onEdit && (
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(row)}
                    aria-label={t(`${C}.editFor`, { name: row.display_name })}
                    className="max-sm:h-11"
                  >
                    {t(`${C}.edit`)}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Her places offered: a number from 0 to 99, empty when not tracked; « Recommencer le décompte » with a number. */
function PlacesForm({ row, onDone }: { row: CapacityRow; onDone: () => void }) {
  const [value, setValue] = useState(row.places_declared === null ? '' : String(row.places_declared))
  const [restart, setRestart] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useSetNewClientPlaces()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending) return
    const trimmed = value.trim()
    if (trimmed !== '' && !/^\d{1,2}$/.test(trimmed)) {
      setError(t(`${C}.form.invalid`))
      return
    }
    const places = trimmed === '' ? null : Number(trimmed)
    if (places !== null && places > 99) {
      setError(t(`${C}.form.invalid`))
      return
    }
    if (restart && places === null) {
      setError(t(`${C}.form.restartNeedsNumber`))
      return
    }
    setError(null)
    save.mutate(
      { professionalId: row.professional_id, places, restart },
      {
        onSuccess: () => {
          toast.success(t(`${C}.form.saved`, { name: row.display_name }))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t(`${C}.form.title`, { name: row.display_name })}</DialogTitle>
        <DialogDescription>{t(`${C}.form.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormField label={t(`${C}.form.places`)} help={t(`${C}.form.placesHelp`)}>
          {(field) => <Input {...field} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="w-24" />}
        </FormField>
        <CheckboxField label={t(`${C}.form.restart`)} checked={restart} onCheckedChange={(v) => setRestart(v === true)} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={save.isPending || undefined}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
