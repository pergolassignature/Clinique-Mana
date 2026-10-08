import { Fragment, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { MutationFeedback } from '../../hooks/mutation-feedback'
import { datedStatus, lastDay, type DatedRow } from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'

const W = 'modules.professionals.compensation'

/** Phone: 8 px cells, none at the edges (as « Fiscalité »'s rates). */
const PHONE_TABLE =
  'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 max-sm:[&_td:first-child]:pl-0 max-sm:[&_th:first-child]:pl-0 max-sm:[&_td:last-child]:pr-0 max-sm:[&_th:last-child]:pr-0'

export interface DatedTermsGroup<R extends DatedRow> {
  key: string
  /** A header row naming the group (a kind), or null for a single series. */
  name: string | null
  rows: readonly R[]
}

interface DatedTermsTableProps<R extends DatedRow> {
  /** The table's accessible name (the card's title). */
  label: string
  headers: { value: string; from: string; to: string; status: string; actions: string }
  groups: readonly DatedTermsGroup<R>[]
  /** The value cell (« 25–30 % », the rule's summary). */
  renderValue: (row: R) => ReactNode
  /** Rows « Supprimer » is offered on (the database's rule, P4-145). */
  deletable: (row: R) => boolean
  deleteLabel: (row: R) => string
  confirm: (row: R) => { title: string; body: string }
  /** The deletion's mutation, built by the card with `feedback`. */
  useDelete: (feedback: MutationFeedback) => { mutate: (id: string, options: { onSuccess: () => void }) => void; isPending: boolean; reset: () => void }
  today: string
  /** Where focus goes when the deleted row's button is gone (the card's « Nouvelle … »). */
  fallbackRef: RefObject<HTMLElement | null>
}

/**
 * The dated rows of the clinic's compensation terms, as « Fiscalité »'s rate tables: newest first,
 * the start and the last day (date-only), the status on the clinic's date, and « Supprimer » behind
 * a confirmation on the one row the database will let go. On a phone the end date moves under the
 * start and « Supprimer » becomes an icon.
 */
export function DatedTermsTable<R extends DatedRow>({
  label,
  headers,
  groups,
  renderValue,
  deletable,
  deleteLabel,
  confirm,
  useDelete,
  today,
  fallbackRef,
}: DatedTermsTableProps<R>) {
  const [toDelete, setToDelete] = useState<R | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDelete({ onErrorMessage: (message) => setRefusal(message) })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const anyDeletable = groups.some((group) => group.rows.some(deletable))
  const columns = anyDeletable ? 5 : 4

  return (
    <>
      <Table aria-label={label} className={PHONE_TABLE}>
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{headers.value}</TableHead>
            <TableHead>{headers.from}</TableHead>
            <TableHead className="max-sm:hidden">{headers.to}</TableHead>
            <TableHead>{headers.status}</TableHead>
            {anyDeletable && (
              <TableHead>
                <span className="sr-only">{headers.actions}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {group.name !== null && (
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="colgroup" colSpan={columns} className="h-8 pt-3 text-xs font-semibold text-foreground">
                    {group.name}
                  </TableHead>
                </TableRow>
              )}
              {group.rows.map((row) => {
                const end = lastDay(row.effectiveTo)
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell>{renderValue(row)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateOnlyShort(row.effectiveFrom)}
                      {end !== null && (
                        <span className="block text-xs text-muted-foreground sm:hidden">
                          {t(`${W}.period.until`, { date: formatDateOnlyShort(end) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap max-sm:hidden">{end === null ? '—' : formatDateOnlyShort(end)}</TableCell>
                    <TableCell>
                      <DatedStatusBadge status={datedStatus(row, today)} />
                    </TableCell>
                    {anyDeletable && (
                      <TableCell className="py-1 text-right">
                        {deletable(row) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={deleteLabel(row)}
                            onClick={(event) => {
                              trigger.current = event.currentTarget
                              setRefusal(null)
                              setToDelete(row)
                            }}
                          >
                            <Trash2 aria-hidden className="sm:hidden" />
                            <span className="max-sm:sr-only">{t(`${W}.delete`)}</span>
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={toDelete ? confirm(toDelete).title : ''}
        body={toDelete ? confirm(toDelete).body : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={trigger}
        fallbackRef={fallbackRef}
      />
    </>
  )
}
