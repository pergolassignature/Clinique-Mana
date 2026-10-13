import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import {
  clinicTimeToUTC,
  formatClinicDateFull,
  formatClinicDateTime,
  getClinicDateString,
  shiftCalendarDay,
} from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'
import { toast } from '@/shared/ui/sonner'
import { StatusDot } from '@/shared/ui/status-dot'
import { Textarea } from '@/shared/ui/textarea'
import {
  EXIT_REASONS,
  WAITLIST_CONTACT_KINDS,
  WAITLIST_OUTCOMES,
  type ExitReason,
  type WaitlistContactKind,
  type WaitlistEntryDetail,
  type WaitlistOutcome,
} from '../../api/waitlist'
import {
  useWaitlistActions,
  useWaitlistEntry,
  useWaitlistLists,
} from '../../hooks/use-waitlist'
import { demandePath, optionLabel, personLabel } from '../../lib/display'
import { demandesError } from '../../lib/errors'
import {
  consentLabel,
  consentSettled,
  entryStateLabel,
  entryStateTone,
  exitReasonLabel,
  feeLabel,
  feeSettled,
  moneyLabel,
  rankLabel,
  waitedLabel,
} from '../../lib/waitlist'

const W = 'modules.demandes.waitlist'
const E = `${W}.sheet`

/**
 * One entry of the waiting list, in a side sheet (D3): where it stands (rank, days waited,
 * priority, criteria, consent, fee), and — with `demandes.waitlist`, while it is open — the
 * priority and the bridge professional, the fee (« Payés », « Exonérés » with a reason; « Facturer
 * l'inscription » comes with Facturation), the follow-ups, an offer made by phone and its answer,
 * and leaving the list with a reason. The consent is sent from the client's file (Clients).
 */
export function EntrySheet({
  entryId,
  onClose,
}: {
  entryId: string | null
  onClose: () => void
}) {
  const entry = useWaitlistEntry(entryId)
  const data = entry.data
  return (
    <Sheet open={entryId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {data ? personLabel(data.entry) : t(`${E}.title`)}
          </SheetTitle>
          {data && (
            <SheetDescription>
              {t(`${E}.subtitle`, {
                list: data.entry.target_name ?? '',
                reference: data.entry.reference,
              })}
            </SheetDescription>
          )}
        </SheetHeader>
        <SheetBody>
          {entry.isError && !data ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`${E}.loadError`)}
            </p>
          ) : !data ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : (
            <EntryDetail key={data.entry.id} data={data} onClose={onClose} />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border-light pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function EntryDetail({
  data,
  onClose,
}: {
  data: WaitlistEntryDetail
  onClose: () => void
}) {
  const e = data.entry
  const open = e.state !== 'closed'
  const canEdit = data.can.manage && open
  const actions = useWaitlistActions(e.id, e.demande_id)
  const rank = rankLabel(e)
  const fail = (failure: unknown) => toast.error(demandesError(failure))

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t(`${E}.state`)}</dt>
        <dd className="inline-flex items-center gap-1.5">
          <StatusDot tone={entryStateTone(e.state)} />
          {entryStateLabel(e.state)}
          {e.exit_reason && (
            <span className="text-muted-foreground">
              · {exitReasonLabel(e.exit_reason)}
            </span>
          )}
        </dd>
        {rank && (
          <>
            <dt className="text-muted-foreground">{t(`${E}.rank`)}</dt>
            <dd className="tabular">{rank}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t(`${E}.registered`)}</dt>
        <dd>
          {formatClinicDateFull(e.registered_at)} · {waitedLabel(e.waited_days)}
        </dd>
        <dt className="text-muted-foreground">{t(`${E}.criteria`)}</dt>
        <dd className="space-y-0.5">
          <p>
            {[
              optionLabel('modality', e.modality),
              optionLabel('language', e.language),
              e.preferred_pro_gender !== 'any'
                ? optionLabel('gender', e.preferred_pro_gender)
                : null,
              optionLabel('payer', e.payer_kind),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {e.availability_periods.length > 0 && (
            <p>
              {e.availability_periods
                .map((p) => optionLabel('period', p))
                .join(', ')}
            </p>
          )}
        </dd>
        <dt className="text-muted-foreground">{t(`${E}.file`)}</dt>
        <dd className="space-x-3">
          <Link
            to={demandePath(e.demande_id, 'suivi')}
            onClick={onClose}
            className="text-link underline-offset-2 hover:underline"
          >
            {t(`${E}.openDemande`)}
          </Link>
          {e.client_id && (
            <Link
              to={`/clients/${e.client_id}/consentements`}
              onClick={onClose}
              className="text-link underline-offset-2 hover:underline"
            >
              {t(`${E}.openFile`, { number: String(e.client_number ?? '') })}
            </Link>
          )}
        </dd>
      </dl>

      <Section title={t(`${E}.priorityTitle`)}>
        {canEdit ? (
          <PriorityForm data={data} actions={actions} />
        ) : (
          <p className="text-sm">
            {t(`${W}.priority.${e.priority}`)}
            {e.priority_reason && (
              <span className="text-muted-foreground">
                {' '}
                · {e.priority_reason}
              </span>
            )}
            {e.bridge_name && (
              <span className="block text-muted-foreground">
                {t(`${E}.bridgeIs`, { name: e.bridge_name })}
              </span>
            )}
          </p>
        )}
      </Section>

      {open && (
        <Section title={t(`${E}.completeTitle`)}>
          <p className="text-sm text-muted-foreground">
            {t(`${E}.completeHelp`)}
          </p>
          <div className="space-y-1 text-sm">
            <p className="inline-flex items-center gap-1.5">
              <StatusDot
                tone={consentSettled(e.consent_state) ? 'success' : 'warning'}
              />
              {e.consent_state
                ? consentLabel(e.consent_state)
                : t(`${W}.consent.none`)}
            </p>
            {e.consent_state &&
              !consentSettled(e.consent_state) &&
              e.client_id && (
                <p className="text-xs text-muted-foreground">
                  {t(`${E}.consentHelp`)}
                </p>
              )}
          </div>
          <FeeBlock data={data} canEdit={canEdit} actions={actions} />
        </Section>
      )}

      <Section title={t(`${E}.followUpTitle`)}>
        {e.followup_unanswered && (
          <p className="text-sm font-medium text-foreground">
            {t(`${W}.followupUnanswered`)}
          </p>
        )}
        {e.next_contact_at && (
          <p className="text-sm">
            {t(`${E}.nextContact`, {
              date: formatClinicDateTime(e.next_contact_at),
            })}
          </p>
        )}
        {canEdit && <ContactForm actions={actions} />}
        {data.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${E}.noContact`)}</p>
        ) : (
          <ul aria-label={t(`${E}.contacts`)} className="space-y-1 text-sm">
            {data.contacts.map((c) => (
              <li key={c.id}>
                <span className="tabular text-muted-foreground">
                  {formatClinicDateTime(c.at)}
                </span>{' '}
                ·{' '}
                {t(`${W}.contactLine`, {
                  kind: t(`${W}.contactKinds.${c.kind}` as never),
                  outcome: t(`${W}.outcomes.${c.outcome}` as never),
                })}
                {c.by_name && (
                  <span className="text-muted-foreground"> · {c.by_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t(`${E}.offersTitle`)}>
        <OffersBlock
          data={data}
          canEdit={canEdit}
          actions={actions}
          fail={fail}
        />
      </Section>

      {canEdit && (
        <Section title={t(`${E}.exitTitle`)}>
          <ExitForm actions={actions} onDone={onClose} />
        </Section>
      )}
    </div>
  )
}

type Actions = ReturnType<typeof useWaitlistActions>

function useProfessionals() {
  const lists = useWaitlistLists()
  return (lists.data ?? [])
    .filter((l) => l.target_kind === 'professional')
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

function PriorityForm({
  data,
  actions,
}: {
  data: WaitlistEntryDetail
  actions: Actions
}) {
  const e = data.entry
  const professionals = useProfessionals()
  const [priority, setPriority] = useState(e.priority)
  const [reason, setReason] = useState(e.priority_reason ?? '')
  const [bridge, setBridge] = useState(e.bridge_professional_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const dirty =
    priority !== e.priority ||
    (priority === 'priority' && reason.trim() !== (e.priority_reason ?? '')) ||
    bridge !== (e.bridge_professional_id ?? '')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (actions.update.isPending || !dirty) return
    if (priority === 'priority' && !reason.trim()) {
      setError(t(`${W}.register.reasonNeeded`))
      return
    }
    setError(null)
    actions.update.mutate(
      {
        priority,
        ...(priority === 'priority' && { priority_reason: reason.trim() }),
        bridge_professional_id: bridge || null,
      },
      {
        onSuccess: () => toast.success(t(`${E}.saved`)),
        onError: (failure) => setError(demandesError(failure)),
      }
    )
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <SegmentedToggle
        label={t(`${W}.register.priority`)}
        value={priority}
        onChange={setPriority}
        options={[
          { value: 'normal', label: t(`${W}.priority.normal`) },
          { value: 'priority', label: t(`${W}.priority.priority`) },
        ]}
      />
      {priority === 'priority' && (
        <FormField label={t(`${W}.register.reason`)}>
          {(field) => (
            <Textarea
              {...field}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              maxLength={300}
              rows={2}
            />
          )}
        </FormField>
      )}
      <FormField label={t(`${E}.bridge`)} help={t(`${E}.bridgeHelp`)}>
        {(field) => (
          <Select
            {...field}
            value={bridge}
            onChange={(ev) => setBridge(ev.target.value)}
          >
            <option value="">{t(`${E}.noBridge`)}</option>
            {professionals.map((p) => (
              <option key={p.target_id} value={p.target_id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-disabled={!dirty || actions.update.isPending || undefined}
        className="max-sm:h-11"
      >
        {t('common.save')}
      </Button>
    </form>
  )
}

function FeeBlock({
  data,
  canEdit,
  actions,
}: {
  data: WaitlistEntryDetail
  canEdit: boolean
  actions: Actions
}) {
  const e = data.entry
  const [waiving, setWaiving] = useState(false)
  const [reason, setReason] = useState('')
  const set = (status: 'to_invoice' | 'paid' | 'waived', why: string | null) =>
    actions.fee.mutate(
      { status, reason: why },
      {
        onSuccess: () => {
          setWaiving(false)
          toast.success(t(`${E}.feeSaved`, { status: feeLabel(status) }))
        },
        onError: (failure) => toast.error(demandesError(failure)),
      }
    )
  return (
    <div className="space-y-2 text-sm">
      <p className="inline-flex items-center gap-1.5">
        <StatusDot tone={feeSettled(e.fee_status) ? 'success' : 'warning'} />
        {feeLabel(e.fee_status)}
        {e.fee_waived_reason && (
          <span className="text-muted-foreground">· {e.fee_waived_reason}</span>
        )}
      </p>
      {data.fee && data.fee.price_cents !== null && (
        <p className="text-xs text-muted-foreground">
          {t(
            data.fee.tax_rule === 'taxable'
              ? `${E}.feePriceTaxes`
              : `${E}.feePrice`,
            { name: data.fee.name, price: moneyLabel(data.fee.price_cents) }
          )}
        </p>
      )}
      {canEdit && !waiving && (
        <div className="flex flex-wrap gap-2">
          {e.fee_status !== 'paid' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set('paid', null)}
              className="max-sm:h-11"
            >
              {t(`${E}.markPaid`)}
            </Button>
          )}
          {e.fee_status !== 'waived' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWaiving(true)}
              className="max-sm:h-11"
            >
              {t(`${E}.waive`)}
            </Button>
          )}
          {e.fee_status !== 'to_invoice' && e.fee_status !== 'invoiced' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set('to_invoice', null)}
              className="max-sm:h-11"
            >
              {t(`${E}.backToInvoice`)}
            </Button>
          )}
        </div>
      )}
      {canEdit && waiving && (
        <form
          noValidate
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason.trim()) set('waived', reason.trim())
          }}
        >
          <FormField label={t(`${E}.waiveReason`)} help={t(`${E}.waiveHelp`)}>
            {(field) => (
              <Input
                {...field}
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                maxLength={300}
              />
            )}
          </FormField>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              aria-disabled={
                !reason.trim() || actions.fee.isPending || undefined
              }
            >
              {t(`${E}.waiveSave`)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWaiving(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function ContactForm({ actions }: { actions: Actions }) {
  const [kind, setKind] = useState<WaitlistContactKind>('call')
  const [outcome, setOutcome] = useState<WaitlistOutcome>('reached')
  const [later, setLater] = useState(false)
  const [date, setDate] = useState(() =>
    shiftCalendarDay(getClinicDateString(new Date()), 7)
  )
  const [time, setTime] = useState('10:00')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (actions.contact.isPending) return
    actions.contact.mutate(
      {
        kind,
        outcome,
        nextContactAt:
          later && date && time ? clinicTimeToUTC(date, time) : null,
      },
      {
        onSuccess: () => {
          setLater(false)
          toast.success(t(`${E}.contactSaved`))
        },
        onError: (failure) => toast.error(demandesError(failure)),
      }
    )
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t(`${E}.logContact`)}
      className="space-y-2 rounded-md border border-border-light p-3"
    >
      <FormRow>
        <FormField label={t(`${E}.kind`)}>
          {(field) => (
            <Select
              {...field}
              value={kind}
              onChange={(ev) => setKind(ev.target.value as WaitlistContactKind)}
            >
              {WAITLIST_CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`${W}.contactKinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${E}.outcome`)}>
          {(field) => (
            <Select
              {...field}
              value={outcome}
              onChange={(ev) => setOutcome(ev.target.value as WaitlistOutcome)}
            >
              {WAITLIST_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(`${W}.outcomes.${o}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </FormRow>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={later}
          onChange={(ev) => setLater(ev.target.checked)}
          className="size-4"
        />
        {t(`${E}.callAgain`)}
      </label>
      {later && (
        <FormRow>
          <FormField label={t(`${E}.nextDate`)}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={date}
                onChange={(ev) => setDate(ev.target.value)}
              />
            )}
          </FormField>
          <FormField label={t(`${E}.nextTime`)}>
            {(field) => (
              <Input
                {...field}
                type="time"
                value={time}
                onChange={(ev) => setTime(ev.target.value)}
              />
            )}
          </FormField>
        </FormRow>
      )}
      <Button
        type="submit"
        size="sm"
        aria-disabled={actions.contact.isPending || undefined}
        className="max-sm:h-11"
      >
        {t(`${E}.logContact`)}
      </Button>
    </form>
  )
}

interface SlotDraft {
  date: string
  start: string
  end: string
}

function OffersBlock({
  data,
  canEdit,
  actions,
  fail,
}: {
  data: WaitlistEntryDetail
  canEdit: boolean
  actions: Actions
  fail: (e: unknown) => void
}) {
  const professionals = useProfessionals()
  const e = data.entry
  const pending = data.offers.find((o) => o.response === 'pending')
  const [adding, setAdding] = useState(false)
  const [professionalId, setProfessionalId] = useState(
    e.target_kind === 'professional' ? e.target_id : ''
  )
  const [slots, setSlots] = useState<SlotDraft[]>([])
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (actions.offer.isPending) return
    if (!professionalId) {
      setError(t(`${E}.offerProNeeded`))
      return
    }
    setError(null)
    actions.offer.mutate(
      {
        professionalId,
        slots: slots
          .filter((s) => s.date && s.start && s.end)
          .map((s) => ({
            starts_at: clinicTimeToUTC(s.date, s.start),
            ends_at: clinicTimeToUTC(s.date, s.end),
          })),
      },
      {
        onSuccess: () => {
          setAdding(false)
          setSlots([])
          toast.success(t(`${E}.offerSaved`))
        },
        onError: (failure) => setError(demandesError(failure)),
      }
    )
  }

  return (
    <div className="space-y-3 text-sm">
      {pending && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="font-medium">
            {t(`${E}.pendingOffer`, {
              name: pending.professional_name ?? '',
              date: formatClinicDateTime(pending.offered_at),
            })}
          </p>
          {pending.slots.length > 0 && (
            <ul className="text-xs text-muted-foreground">
              {pending.slots.map((s) => (
                <li key={s.starts_at}>{formatClinicDateTime(s.starts_at)}</li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  actions.answer.mutate(
                    { offerId: pending.id, response: 'accepted' },
                    {
                      onSuccess: () => toast.success(t(`${E}.placed`)),
                      onError: fail,
                    }
                  )
                }
                className="max-sm:h-11"
              >
                {t(`${E}.accepted`)}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  actions.answer.mutate(
                    { offerId: pending.id, response: 'declined' },
                    { onError: fail }
                  )
                }
                className="max-sm:h-11"
              >
                {t(`${E}.declined`)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  actions.answer.mutate(
                    { offerId: pending.id, response: 'withdrawn' },
                    { onError: fail }
                  )
                }
                className="max-sm:h-11"
              >
                {t(`${E}.withdrawn`)}
              </Button>
            </div>
          )}
        </div>
      )}
      {canEdit && !pending && e.state !== 'incomplete' && !adding && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="max-sm:h-11"
        >
          {t(`${E}.addOffer`)}
        </Button>
      )}
      {canEdit && e.state === 'incomplete' && (
        <p className="text-xs text-muted-foreground">
          {t(`${E}.offerIncomplete`)}
        </p>
      )}
      {adding && (
        <form
          onSubmit={submit}
          noValidate
          aria-label={t(`${E}.addOffer`)}
          className="space-y-2 rounded-md border border-border-light p-3"
        >
          <FormField label={t(`${E}.offerPro`)}>
            {(field) => (
              <Select
                {...field}
                value={professionalId}
                onChange={(ev) => setProfessionalId(ev.target.value)}
              >
                <option value="">{t(`${E}.choosePro`)}</option>
                {professionals.map((p) => (
                  <option key={p.target_id} value={p.target_id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {slots.map((s, i) => (
            <fieldset key={i} className="space-y-1">
              <legend className="text-xs font-medium text-muted-foreground">
                {t(`${E}.slot`, { n: String(i + 1) })}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="date"
                  aria-label={t(`${E}.slotDate`, { n: String(i + 1) })}
                  value={s.date}
                  onChange={(ev) =>
                    setSlots(
                      slots.map((x, j) =>
                        j === i ? { ...x, date: ev.target.value } : x
                      )
                    )
                  }
                  className="w-40"
                />
                <Input
                  type="time"
                  aria-label={t(`${E}.slotStart`, { n: String(i + 1) })}
                  value={s.start}
                  onChange={(ev) =>
                    setSlots(
                      slots.map((x, j) =>
                        j === i ? { ...x, start: ev.target.value } : x
                      )
                    )
                  }
                  className="w-28"
                />
                <Input
                  type="time"
                  aria-label={t(`${E}.slotEnd`, { n: String(i + 1) })}
                  value={s.end}
                  onChange={(ev) =>
                    setSlots(
                      slots.map((x, j) =>
                        j === i ? { ...x, end: ev.target.value } : x
                      )
                    )
                  }
                  className="w-28"
                />
              </div>
            </fieldset>
          ))}
          {slots.length < 3 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() =>
                setSlots([
                  ...slots,
                  {
                    date: shiftCalendarDay(getClinicDateString(new Date()), 1),
                    start: '10:00',
                    end: '10:50',
                  },
                ])
              }
            >
              {t(`${E}.addSlot`)}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              aria-disabled={actions.offer.isPending || undefined}
            >
              {t(`${E}.saveOffer`)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      {data.offers.filter((o) => o.response !== 'pending').length > 0 && (
        <ul
          aria-label={t(`${E}.pastOffers`)}
          className="space-y-1 text-xs text-muted-foreground"
        >
          {data.offers
            .filter((o) => o.response !== 'pending')
            .map((o) => (
              <li key={o.id}>
                {t(`${E}.pastOffer`, {
                  date: formatClinicDateTime(o.offered_at),
                  name: o.professional_name ?? '',
                  response: t(`${W}.offerResponses.${o.response}` as never),
                })}
              </li>
            ))}
        </ul>
      )}
      {data.offers.length === 0 && !adding && (
        <p className="text-muted-foreground">{t(`${E}.noOffer`)}</p>
      )}
    </div>
  )
}

function ExitForm({
  actions,
  onDone,
}: {
  actions: Actions
  onDone: () => void
}) {
  const professionals = useProfessionals()
  const [reason, setReason] = useState<ExitReason>('withdrew')
  const [professionalId, setProfessionalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (actions.exit.isPending) return
    if (reason === 'placed' && !professionalId) {
      setError(t(`${E}.offerProNeeded`))
      return
    }
    setError(null)
    actions.exit.mutate(
      { reason, professionalId: reason === 'placed' ? professionalId : null },
      {
        onSuccess: () => {
          toast.success(t(`${E}.exited`, { reason: exitReasonLabel(reason) }))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      }
    )
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t(`${E}.exitTitle`)}
      className="space-y-2"
    >
      <p className="text-sm text-muted-foreground">{t(`${E}.exitHelp`)}</p>
      <FormField label={t(`${E}.exitReason`)}>
        {(field) => (
          <Select
            {...field}
            value={reason}
            onChange={(ev) => setReason(ev.target.value as ExitReason)}
          >
            {EXIT_REASONS.map((r) => (
              <option key={r} value={r}>
                {exitReasonLabel(r)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {reason === 'placed' && (
        <FormField label={t(`${E}.placedWith`)}>
          {(field) => (
            <Select
              {...field}
              value={professionalId}
              onChange={(ev) => setProfessionalId(ev.target.value)}
            >
              <option value="">{t(`${E}.choosePro`)}</option>
              {professionals.map((p) => (
                <option key={p.target_id} value={p.target_id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-disabled={actions.exit.isPending || undefined}
        className="max-sm:h-11"
      >
        {t(`${E}.exit`)}
      </Button>
    </form>
  )
}
