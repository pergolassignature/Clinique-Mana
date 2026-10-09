import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusDot } from '@/shared/ui/status-dot'
import type { SubmissionRow } from '../../api/submissions'
import { prefetchSubmissionReview, useProfessionalSubmissions } from '../../hooks/use-submissions'
import { listLabel } from '../../lib/display'
import { sectionLabel } from '../../lib/onboarding'
import { submissionKindLabel, submissionState, submissionStateLabel, submissionStateTone } from '../../lib/submission-review'
import { CancelSubmissionDialog } from './CancelSubmissionDialog'
import { useRecordData } from './record-context'
import { focusAfterClose } from './status-dialog'
import { SubmissionReviewSheet } from './SubmissionReviewSheet'

const C = 'modules.professionals.submission.card'

/**
 * « Questionnaire et mises à jour » (Documents tab, Task 4b.5): the file's submissions, newest
 * first (`professionals.view`), each with its state in words and its dates in the clinic's time.
 * A submission waiting for review offers « Réviser » to reviewers (`professionals.review`), except
 * on their own file (P4-304: the database refuses it, so the button is not offered). An open update
 * offers « Fermer la demande » to those who ask for updates (`professionals.invite`, P4-421).
 */
export function SubmissionsCard() {
  const { record, focusHeading } = useRecordData()
  const { professional } = record
  const submissions = useProfessionalSubmissions(professional.id)
  const [open, setOpen] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${C}.title`)}</CardTitle>
        <CardDescription>{t(`${C}.description`, { firstName: professional.firstName })}</CardDescription>
      </CardHeader>
      <CardContent>
        {submissions.isPending ? (
          <Loading />
        ) : submissions.data === undefined ? (
          <LoadError
            message={moduleErrorMessage(submissions.error, t(`${C}.loadError`), 'professionals')}
            retrying={submissions.isFetching}
            onRetry={() => void submissions.refetch()}
          />
        ) : submissions.data.length === 0 ? (
          <EmptyState title={t(`${C}.empty.title`)} body={t(`${C}.empty.body`, { firstName: professional.firstName })} />
        ) : (
          <ul className="divide-y divide-border-light border-y border-border-light">
            {submissions.data.map((row) => (
              <SubmissionItem
                key={row.id}
                row={row}
                onReview={(button) => {
                  opener.current = button
                  setOpen(row.id)
                }}
                onCancel={(button) => {
                  opener.current = button
                  setClosing(row.id)
                }}
              />
            ))}
          </ul>
        )}
        {open !== null && (
          <SubmissionReviewSheet
            submissionId={open}
            onClose={() => setOpen(null)}
            onCloseAutoFocus={(event) => focusAfterClose(event, [opener.current], focusHeading)}
          />
        )}
        {closing !== null && (
          <CancelSubmissionDialog
            submissionId={closing}
            onClose={() => setClosing(null)}
            onCloseAutoFocus={(event) => focusAfterClose(event, [opener.current], focusHeading)}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * What happened to a submission and when, in agreement with its kind: « Envoyé le 8 oct. 2026 ·
 * Approuvé le 9 oct. 2026 par Julie Roy » (le questionnaire), « Envoyée … · Approuvée … » (la mise à jour).
 */
function datesLine(row: SubmissionRow): string {
  const { kind } = row
  const parts: string[] = []
  if (row.submittedAt) parts.push(t(`${C}.sentOn.${kind}`, { date: formatClinicDateShort(row.submittedAt) }))
  else parts.push(t(`${C}.startedOn.${kind}`, { date: formatClinicDateShort(row.createdAt) }))
  // The decision's date only where it is the current one: approved, or sent back and not re-sent
  // (a closed submission keeps an earlier return's date, which would read as its last event).
  if (row.reviewedAt && (row.status === 'approved' || submissionState(row) === 'returned')) {
    const date = formatClinicDateShort(row.reviewedAt)
    const by = row.reviewedByName
    if (row.status === 'approved') parts.push(by ? t(`${C}.appliedOnBy.${kind}`, { date, name: by }) : t(`${C}.appliedOn.${kind}`, { date }))
    else parts.push(by ? t(`${C}.returnedOnBy.${kind}`, { date, name: by }) : t(`${C}.returnedOn.${kind}`, { date }))
  }
  if (row.status === 'approved' && row.appliedCount !== null && row.appliedCount > 0) {
    parts.push(t(row.appliedCount === 1 ? `${C}.changesOne` : `${C}.changes`, { count: String(row.appliedCount) }))
  }
  return parts.join(' · ')
}

function SubmissionItem({
  row,
  onReview,
  onCancel,
}: {
  row: SubmissionRow
  onReview: (button: HTMLButtonElement) => void
  onCancel: (button: HTMLButtonElement) => void
}) {
  const { record } = useRecordData()
  const { can } = useAccess()
  const { user_id } = useReadyAccess()
  const queryClient = useQueryClient()
  const state = submissionState(row)
  const ownFile = record.professional.profileId === user_id
  const reviewable = state === 'to_review' && can('professionals.review')
  const closable = row.kind === 'update' && (row.status === 'draft' || row.status === 'submitted') && can('professionals.invite')
  const prefetch = () => void prefetchSubmissionReview(queryClient, row.id)
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          <span className="font-medium text-foreground">{submissionKindLabel(row.kind)}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone={submissionStateTone(state)} />
            {submissionStateLabel(state, row.kind)}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{datesLine(row)}</p>
        {row.kind === 'update' && (
          <p className="text-xs text-muted-foreground">
            {/* Who started it (P4-375): the clinic asked, or the professional chose to from « Mon profil ». */}
            {row.startedByProfessional ? t(`${C}.origin.self`, { firstName: record.professional.firstName }) : t(`${C}.origin.clinic`)}
            {' · '}
            {t(`${C}.sections`, { sections: listLabel(row.requestedSections.map(sectionLabel)) })}
          </p>
        )}
        {state === 'returned' && row.decisionNote && (
          <p className="mt-1 whitespace-pre-line border-l-2 border-border pl-2 text-sm text-foreground">
            <span className="text-muted-foreground">{t(`${C}.note`)} </span>
            {row.decisionNote}
          </p>
        )}
        {reviewable && ownFile && <p className="text-xs text-muted-foreground">{t(`${C}.ownFile`)}</p>}
      </div>
      {((reviewable && !ownFile) || closable) && (
        <div className="flex flex-wrap gap-2 self-start">
          {closable && (
            <Button type="button" size="sm" variant="outline" onClick={(event) => onCancel(event.currentTarget)}>
              {t(`${C}.cancel`)}
            </Button>
          )}
          {reviewable && !ownFile && (
            <Button
              type="button"
              size="sm"
              onPointerEnter={prefetch}
              onFocus={prefetch}
              onClick={(event) => onReview(event.currentTarget)}
              aria-label={t(`${C}.reviewLabel`, { kind: submissionKindLabel(row.kind) })}
            >
              {t(`${C}.review`)}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
