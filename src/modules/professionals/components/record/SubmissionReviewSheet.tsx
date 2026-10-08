import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorHint } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { FormField } from '@/shared/ui/form-field'
import { Label } from '@/shared/ui/label'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { StatusDot } from '@/shared/ui/status-dot'
import { Textarea } from '@/shared/ui/textarea'
import type { ReviewField, SubmissionReview } from '../../api/submissions'
import { useProfessionalPrivate, readableHint } from '../../hooks/use-private'
import { useApplySubmission, useReturnSubmission, useSubmissionReview } from '../../hooks/use-submissions'
import type { SubmissionField } from '../../lib/constants'
import { fullName } from '../../lib/display'
import { sectionLabel } from '../../lib/onboarding'
import { changedFieldKeys, fieldLabel, fieldsToApply, isSetDiffField, reviewPlan, submissionKindLabel, type SectionPlan } from '../../lib/submission-review'
import { Disclosure } from './MotifsSummary'
import { useRecordData } from './record-context'
import { FileProposal, SetChange, SetValue, SideBySide, SideValue, type ValueContext } from './ReviewFieldValue'

const S = 'modules.professionals.submission.sheet'
const V = 'modules.professionals.submission.values'
/** `professional_submissions_decision_note_check`. */
const NOTE_MAX = 1000

interface SheetProps {
  submissionId: string
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * « Réviser le profil » (Task 4b.5, A2.14–A2.16): what the professional sent, field by field, beside
 * what the file holds (« Actuel / Proposé »). Changed fields come first, highlighted and checked;
 * unchanged ones are folded under them. « Appliquer les changements sélectionnés (n) » applies the
 * checked fields in one call; « Renvoyer au professionnel » asks for a note first. Private values
 * are never shown: only whether they changed (P4-175), with the file's masks for whoever reads them.
 */
export function SubmissionReviewSheet({ submissionId, onClose, onCloseAutoFocus }: SheetProps) {
  const { record } = useRecordData()
  const review = useSubmissionReview(submissionId)
  // While a decision is being saved the sheet stays open (Échap, the overlay and the X wait).
  const [busy, setBusy] = useState(false)
  const data = review.data
  const name = fullName(record.professional)
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="sm:max-w-[720px]" aria-busy={busy || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{t(`${S}.title`, { name })}</SheetTitle>
          <SheetDescription>
            {data
              ? data.submission.submittedAt
                ? t(`${S}.sentOn`, { kind: submissionKindLabel(data.submission.kind), date: formatClinicDateTime(data.submission.submittedAt) })
                : submissionKindLabel(data.submission.kind)
              : t(`${S}.loadingDescription`)}
          </SheetDescription>
        </SheetHeader>
        {review.isPending ? (
          <SheetBody>
            <Loading />
          </SheetBody>
        ) : data === undefined ? (
          <SheetBody>
            <LoadError message={moduleErrorMessage(review.error, t(`${S}.loadError`), 'professionals')} retrying={review.isFetching} onRetry={() => void review.refetch()} />
          </SheetBody>
        ) : data === null ? (
          <SheetBody>
            <p className="text-sm text-muted-foreground">{t(`${S}.gone`)}</p>
          </SheetBody>
        ) : (
          <ReviewContent key={data.submission.id} review={data} onClose={onClose} onBusyChange={setBusy} />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** A refusal shown above the buttons: the message, and the HINT when it is a sentence (P4-165). */
interface Refusal {
  message: string
  hint: string | null
  /** Retrying cannot help (decided elsewhere, the reviewer's own file): « Fermer » only. */
  final: boolean
}

/** HINTs that say the submission is no longer this reviewer's to decide (P4-304, decided or closed meanwhile). */
const FINAL_HINTS = new Set(['status', 'submission'])

function ReviewContent({ review, onClose, onBusyChange }: { review: SubmissionReview; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const { record, catalog } = useRecordData()
  const { can } = useAccess()
  const { professional } = record
  const ctx: ValueContext = { catalog, gender: professional.gender }
  const plan = useMemo(() => reviewPlan(review), [review])
  const changed = useMemo(() => changedFieldKeys(review), [review])
  const [checked, setChecked] = useState<ReadonlySet<SubmissionField>>(() => new Set(changed))
  const [mode, setMode] = useState<'decide' | 'return'>('decide')
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [noneChecked, setNoneChecked] = useState(false)
  // The file's masks, for the account and the SIN, only for whoever reads them (never a value).
  const masks = useProfessionalPrivate(professional.id, can('professionals.private')).data ?? null
  const onRefusal = (message: string, error: unknown) => {
    const hint = rpcErrorHint(error)
    setRefusal({ message, hint: readableHint(error), final: hint !== undefined && FINAL_HINTS.has(hint) })
  }
  const apply = useApplySubmission({ onErrorMessage: onRefusal })
  const back = useReturnSubmission({ onErrorMessage: onRefusal })
  const pending = apply.isPending || back.isPending
  const calling = useRef(false)
  const waiting = review.submission.status === 'submitted'
  const toApply = fieldsToApply(review, checked)

  /** One call at a time: a second press before the first renders as pending is ignored. */
  const run = (call: () => Promise<unknown>) => {
    if (calling.current) return
    calling.current = true
    setRefusal(null)
    onBusyChange(true)
    call()
      .then(onClose, () => undefined)
      .finally(() => {
        calling.current = false
        onBusyChange(false)
      })
  }

  const onApply = () => {
    if (changed.length > 0 && toApply.length === 0) {
      setNoneChecked(true)
      return
    }
    run(() => apply.mutateAsync({ professionalId: professional.id, submissionId: review.submission.id, kind: review.submission.kind, fields: toApply }))
  }

  const toggle = (field: SubmissionField, value: boolean) => {
    const next = new Set(checked)
    if (value) next.add(field)
    else next.delete(field)
    setChecked(next)
    if (next.size > 0) setNoneChecked(false)
  }

  return (
    <>
      <SheetBody className="space-y-5">
        {!waiting && (
          <Alert variant="warning" role="status">
            <CircleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t(`${S}.notWaiting`)}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          {changed.length === 0
            ? t(`${S}.noChange`)
            : t(changed.length === 1 ? `${S}.summaryOne` : `${S}.summary`, { count: String(changed.length) })}
        </p>
        {plan.map((section) => (
          <ReviewSectionBlock
            key={section.section}
            plan={section}
            ctx={ctx}
            checked={checked}
            onToggle={toggle}
            disabled={!waiting || pending || mode === 'return'}
            masks={masks}
          />
        ))}
      </SheetBody>
      {mode === 'return' ? (
        <ReturnForm
          firstName={professional.firstName}
          pending={back.isPending}
          refusal={refusal}
          onBack={() => {
            setRefusal(null)
            setMode('decide')
          }}
          onSend={(note) =>
            run(() => back.mutateAsync({ professionalId: professional.id, submissionId: review.submission.id, note, firstName: professional.firstName }))
          }
          onClose={onClose}
        />
      ) : (
        <SheetFooter className="sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2 sm:flex-1">
            <RefusalAlert refusal={refusal} />
            {noneChecked && (
              <p role="alert" className="text-xs text-destructive">
                {t(`${S}.noneChecked`)}
              </p>
            )}
            {waiting && changed.length > 0 && !refusal?.final && (
              <p className="text-xs text-muted-foreground">{t(`${S}.checkedCount`, { checked: String(toApply.length), total: String(changed.length) })}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            {!waiting || refusal?.final ? (
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={pending || undefined}
                  onClick={ignoreWhenInactive(pending, () => {
                    setRefusal(null)
                    setMode('return')
                  })}
                  className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
                >
                  {t(`${S}.return`)}
                </Button>
                <Button
                  type="button"
                  aria-disabled={pending || undefined}
                  onClick={ignoreWhenInactive(pending, onApply)}
                  className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}
                >
                  {apply.isPending
                    ? t(`${S}.applying`)
                    : changed.length === 0
                      ? t(`${S}.approveUnchanged`)
                      : t(`${S}.apply`, { count: String(toApply.length) })}
                </Button>
              </>
            )}
          </div>
        </SheetFooter>
      )}
    </>
  )
}

function RefusalAlert({ refusal }: { refusal: Refusal | null }) {
  if (!refusal) return null
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">
        {refusal.message}
        {refusal.hint && <span className="mt-1 block text-muted-foreground">{refusal.hint}</span>}
      </AlertDescription>
    </Alert>
  )
}

type Masks = { bankAccountLast4: string | null; sinLast3: string | null } | null

interface SectionBlockProps {
  plan: SectionPlan
  ctx: ValueContext
  checked: ReadonlySet<SubmissionField>
  onToggle: (field: SubmissionField, value: boolean) => void
  disabled: boolean
  masks: Masks
}

/** One section: its changed fields (checkbox, « Modifié », Actuel / Proposé), then the unchanged ones folded. */
function ReviewSectionBlock({ plan, ctx, checked, onToggle, disabled, masks }: SectionBlockProps) {
  const headingId = useId()
  const counts = [
    plan.changed.length > 0 && t(plan.changed.length === 1 ? `${S}.changedOne` : `${S}.changedMany`, { count: String(plan.changed.length) }),
    plan.unchanged.length > 0 && t(plan.unchanged.length === 1 ? `${S}.unchangedOne` : `${S}.unchangedMany`, { count: String(plan.unchanged.length) }),
  ].filter(Boolean)
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border pb-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {sectionLabel(plan.section)}
        </h3>
        <span className="text-xs text-muted-foreground">{counts.join(' · ')}</span>
      </div>
      {plan.changed.length > 0 && (
        <ul className="space-y-2">
          {plan.changed.map((field) => (
            <ChangedFieldRow key={field.field} field={field} ctx={ctx} checked={checked.has(field.field)} onToggle={onToggle} disabled={disabled} masks={masks} />
          ))}
        </ul>
      )}
      {plan.unchanged.length > 0 && (
        <Disclosure label={<span className="text-xs text-muted-foreground">{t(`${S}.showUnchanged`, { count: String(plan.unchanged.length) })}</span>}>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            {plan.unchanged.map((field) => (
              <div key={field.field} className="contents">
                <dt className="text-muted-foreground">{fieldLabel(field.field)}</dt>
                <dd className="min-w-0 break-words text-foreground">
                  <UnchangedValue field={field} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      )}
    </section>
  )
}

/** A changed field: its checkbox and label, « Modifié », then what changes, in words. */
function ChangedFieldRow({
  field,
  ctx,
  checked,
  onToggle,
  disabled,
  masks,
}: { field: ReviewField } & Pick<SectionBlockProps, 'ctx' | 'onToggle' | 'disabled' | 'masks'> & { checked: boolean }) {
  const id = useId()
  return (
    <li className="rounded-md border border-border border-l-2 border-l-primary p-3">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onToggle(field.field, value === true)}
          aria-describedby={`${id}-values`}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Label htmlFor={id}>{fieldLabel(field.field)}</Label>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot tone="warning" />
              {t(`${V}.changed`)}
            </span>
          </div>
          <div id={`${id}-values`} className="text-sm text-foreground">
            <ChangedValue field={field} ctx={ctx} masks={masks} />
          </div>
        </div>
      </div>
    </li>
  )
}

/** The private field's mask on file (account, SIN), for whoever reads the masks; never a value. */
function maskOnFile(field: SubmissionField, masks: Masks): string | null {
  if (field === 'bank_account' && masks?.bankAccountLast4) return t(`${V}.maskAccount`, { last4: masks.bankAccountLast4 })
  if (field === 'sin' && masks?.sinLast3) return t(`${V}.maskSin`, { last3: masks.sinLast3 })
  return null
}

function ChangedValue({ field, ctx, masks }: { field: ReviewField; ctx: ValueContext; masks: Masks }) {
  const key = field.field
  if (field.kind === 'private') {
    return (
      <SideBySide
        current={<span className="text-muted-foreground">{maskOnFile(key, masks) ?? t(`${V}.privateHidden`)}</span>}
        submitted={t(`${V}.privateSent`)}
      />
    )
  }
  if (key === 'photo' || key === 'insurance') return <FileProposal field={key} value={field.submitted} />
  if (isSetDiffField(key)) return <SetChange field={key} current={field.current} submitted={field.submitted} ctx={ctx} />
  return (
    <SideBySide
      current={<SideValue field={key} value={field.current} side="current" ctx={ctx} />}
      submitted={<SideValue field={key} value={field.submitted} side="submitted" ctx={ctx} />}
    />
  )
}

/** An unchanged field: the file's value, and whether the professional confirmed it or left it unanswered. */
function UnchangedValue({ field, ctx }: { field: ReviewField; ctx: ValueContext }) {
  const key = field.field
  const status = <span className="text-muted-foreground"> — {t(field.answered ? `${V}.confirmed` : `${V}.notAnswered`)}</span>
  if (field.kind === 'private' || field.kind === 'file') {
    return <span className="text-muted-foreground">{t(field.answered ? `${V}.confirmed` : `${V}.notSent`)}</span>
  }
  if (isSetDiffField(key)) {
    return (
      <>
        <SetValue field={key} value={field.current} ctx={ctx} />
        {status}
      </>
    )
  }
  return (
    <>
      <SideValue field={key} value={field.current} side="current" ctx={ctx} />
      {status}
    </>
  )
}

interface ReturnFormProps {
  firstName: string
  pending: boolean
  refusal: Refusal | null
  onBack: () => void
  onSend: (note: string) => void
  onClose: () => void
}

/**
 * « Renvoyer au professionnel »: the note is required (1–1000 characters, P4-170). The professional
 * reads it on top of her questionnaire; no email is sent, and the sheet says so.
 */
function ReturnForm({ firstName, pending, refusal, onBack, onSend, onClose }: ReturnFormProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const length = [...note.trim()].length
  const field = useRef<HTMLTextAreaElement>(null)
  // The form replaces the buttons that opened it: focus moves to the note.
  useEffect(() => field.current?.focus(), [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (length === 0) return setError(t(`${S}.noteRequired`, { firstName }))
    if (length > NOTE_MAX) return setError(t(`${S}.noteTooLong`, { max: String(NOTE_MAX) }))
    setError(null)
    onSend(note.trim())
  }
  return (
    <SheetFooter className="block">
      <form onSubmit={submit} noValidate aria-busy={pending || undefined} className="space-y-3">
        <FormField
          label={t(`${S}.noteLabel`, { firstName })}
          required
          help={
            <>
              {t(`${S}.noteHelp`, { firstName })}{' '}
              <span className="tabular">{t(`${S}.noteCounter`, { count: String(length), max: String(NOTE_MAX) })}</span>
            </>
          }
          error={error ?? undefined}
        >
          {(props) => <Textarea {...props} ref={field} value={note} onChange={(event) => setNote(event.target.value)} rows={3} />}
        </FormField>
        <RefusalAlert refusal={refusal} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {refusal?.final ? (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                aria-disabled={pending || undefined}
                onClick={ignoreWhenInactive(pending, onBack)}
                className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {t(`${S}.backToReview`)}
              </Button>
              <Button type="submit" aria-disabled={pending || undefined} onClick={ignoreWhenInactive(pending)} className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}>
                {pending ? t(`${S}.returning`) : t(`${S}.sendBack`)}
              </Button>
            </>
          )}
        </div>
      </form>
    </SheetFooter>
  )
}
