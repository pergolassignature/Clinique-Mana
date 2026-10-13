import { useState } from 'react'
import { CircleAlert, Plus } from 'lucide-react'
import { t } from '@/i18n'
import { DescriptionList } from '@/shared/components/DescriptionList'
import { EmptyState } from '@/shared/components/EmptyState'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { formatDateOnly, formatDateOnlyShort } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import type { ClientInsurance, ClientPayer } from '../../../api/parse'
import { useDeleteClientInsurance, useEndClientPayer, useSaveClientPayer, useUpsertClientInsurance } from '../../../hooks/use-clients'
import { HOLDER_RELATIONS, PAYER_KINDS, type HolderRelation, type PayerKind } from '../../../lib/constants'
import { centsLabel, holderRelationLabel, payerKindLabel } from '../../../lib/display'
import { useClientRecordData } from '../record-context'

const C = 'modules.clients.record.coverage'

/** Typed dollars (« 94,50 ») → cents; null for empty; NaN for unreadable. */
function toCents(value: string): number | null {
  const compact = value.replace(/[\s$]/g, '').replace(',', '.')
  if (compact === '') return null
  return /^[0-9]+(\.[0-9]{1,2})?$/.test(compact) ? Math.round(Number(compact) * 100) : Number.NaN
}
const centsInput = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','))
const textOrNull = (value: string) => value.trim() || null
const pad2 = (n: number) => String(n).padStart(2, '0')
/** « 31 mars »: a renewal day (a non-leap year: February 29 is refused). */
const renewalLabel = (month: number, day: number) => formatDateOnly(`2001-${pad2(month)}-${pad2(day)}`, 'd MMMM')
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
/** What a PAE pays per session (FP-2): an amount, or a share of the session's price. */
type CoverMode = 'amount' | 'percent'

/** « 20,00 $ · 2 séances, au 5 oct. 2026 »: what the payer covered before the app (FP-1). */
function priorUseText(row: ClientPayer): string | null {
  if (row.priorUsedCents === null && row.priorUsedSessions === null) return null
  const parts = [
    row.priorUsedCents !== null ? centsLabel(row.priorUsedCents) : null,
    row.priorUsedSessions !== null ? t(`${C}.priorSessions`, { count: String(row.priorUsedSessions) }) : null,
  ].filter(Boolean)
  return row.priorUsedOn ? t(`${C}.priorAt`, { used: parts.join(' · '), date: formatDateOnlyShort(row.priorUsedOn) }) : parts.join(' · ')
}

/**
 * « Assurance et payeurs » (plan C3.4): the main and secondary private insurance (receipts for the
 * insurer), and the third-party payers, IVAC or PAE (R-29, R-62: one active per kind; Facturation
 * reads the active ones). An ended payer stays listed: past invoices name it.
 */
export function CoverageTab() {
  const { summary, canEdit } = useClientRecordData()
  const [insurance, setInsurance] = useState<1 | 2 | null>(null)
  const [payer, setPayer] = useState<ClientPayer | 'new' | null>(null)
  const removeInsurance = useDeleteClientInsurance()
  const endPayer = useEndClientPayer()
  // « Retirer » and « Terminer » ask first (as « Retirer » a relation does).
  const [confirm, setConfirm] = useState<{ kind: 'insurance'; rank: 1 | 2 } | { kind: 'payer'; id: string; label: string } | null>(null)
  const confirmPending = removeInsurance.isPending || endPayer.isPending
  const runConfirmed = () => {
    if (!confirm) return
    const done = { onSuccess: () => setConfirm(null) }
    if (confirm.kind === 'insurance') removeInsurance.mutate({ clientId: summary.client.id, rank: confirm.rank }, done)
    else endPayer.mutate(confirm.id, done)
  }
  const byRank = (rank: 1 | 2) => summary.insurances.find((i) => i.rank === rank)
  // FP-12: one active payer per kind; a new one never replaces it (« Modifier » it, or « Terminer »).
  const freeKinds = PAYER_KINDS.filter((k) => !summary.payers.some((p) => p.isActive && p.kind === k))
  return (
    <div className="space-y-5">
      <SettingsCard as="section" title={t(`${C}.insurance`)} description={t(`${C}.insuranceHelp`)}>
        <div className="grid gap-4 md:grid-cols-2">
          {([1, 2] as const).map((rank) => {
            const row = byRank(rank)
            return (
              <section key={rank} className="space-y-2 rounded-md border border-border p-3">
                <h3 className="text-sm font-medium">{t(rank === 1 ? `${C}.main` : `${C}.secondary`)}</h3>
                {row ? (
                  <DescriptionList
                    items={[
                      { label: t(`${C}.insurer`), value: row.insurer },
                      { label: t(`${C}.policy`), value: row.policyNumber },
                      { label: t(`${C}.certificate`), value: row.certificateNumber },
                      { label: t(`${C}.holder`), value: row.holderRelation === 'self' ? holderRelationLabel('self') : [holderRelationLabel(row.holderRelation), row.holderName].filter(Boolean).join(' · ') },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t(`${C}.noInsurance`)}</p>
                )}
                {canEdit && (rank === 1 || byRank(1)) && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setInsurance(rank)}>
                      {t(row ? `${C}.edit` : `${C}.addInsurance`)}
                    </Button>
                    {row && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'insurance', rank })}>
                        {t(`${C}.remove`)}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        as="section"
        title={t(`${C}.payers`)}
        description={t(`${C}.payersHelp`)}
        footer={
          canEdit ? (
            freeKinds.length > 0 ? (
              <Button type="button" onClick={() => setPayer('new')}>
                <Plus aria-hidden />
                {t(`${C}.addPayer`)}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t(`${C}.bothKinds`)}</p>
            )
          ) : undefined
        }
      >
        {summary.payers.length === 0 ? (
          <EmptyState title={t(`${C}.noPayers`)} body={t(`${C}.noPayersBody`)} inCard={false} />
        ) : (
          <ul className="space-y-3">
            {summary.payers.map((row) => (
              <li key={row.id} className="space-y-2 rounded-md border border-border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {payerKindLabel(row.kind)}
                  {row.organisationName && <span className="font-normal">· {row.organisationName}</span>}
                  <Badge variant={row.isActive ? 'success' : 'secondary'}>{t(row.isActive ? `${C}.active` : `${C}.ended`)}</Badge>
                  {row.isActive && row.isStub && <Badge variant="warning">{t(`${C}.stub`)}</Badge>}
                </p>
                {row.isActive && row.isStub && <p className="text-sm text-muted-foreground">{t(`${C}.stubHelp`)}</p>}
                <DescriptionList
                  items={[
                    { label: t(`${C}.fileNumber`), value: row.fileNumber },
                    { label: t(`${C}.sessionAmount`), value: row.sessionAmountCents !== null ? centsLabel(row.sessionAmountCents) : null },
                    { label: t(`${C}.coveragePercent`), value: row.coveragePercent !== null ? t(`${C}.percent`, { value: String(row.coveragePercent) }) : null },
                    { label: t(`${C}.maxSessions`), value: row.maxSessions !== null ? String(row.maxSessions) : null },
                    { label: t(`${C}.maxAmount`), value: row.maxAmountCents !== null ? centsLabel(row.maxAmountCents) : null },
                    {
                      label: t(`${C}.period`),
                      value: row.startsOn || row.expiresOn ? [row.startsOn && formatDateOnlyShort(row.startsOn), row.expiresOn && formatDateOnlyShort(row.expiresOn)].map((v) => v || '…').join(' – ') : null,
                    },
                    {
                      label: t(`${C}.renewal`),
                      value: row.renewalMonth !== null && row.renewalDay !== null ? t(`${C}.renewalEvery`, { day: renewalLabel(row.renewalMonth, row.renewalDay) }) : null,
                    },
                    { label: t(`${C}.priorUse`), value: priorUseText(row) },
                    { label: t(`${C}.note`), value: row.note },
                  ]}
                />
                {canEdit && row.isActive && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPayer(row)}>
                      {t(`${C}.edit`)}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'payer', id: row.id, label: [payerKindLabel(row.kind), row.organisationName].filter(Boolean).join(' · ') })}>
                      {t(`${C}.endPayer`)}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      {insurance !== null && <InsuranceDialog rank={insurance} row={byRank(insurance) ?? null} onClose={() => setInsurance(null)} />}
      {payer !== null && <PayerDialog row={payer === 'new' ? null : payer} kinds={payer === 'new' ? freeKinds : PAYER_KINDS} onClose={() => setPayer(null)} />}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && !confirmPending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirm?.kind === 'payer' ? `${C}.endPayerTitle` : `${C}.removeInsuranceTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'payer'
                ? t(`${C}.endPayerBody`, { payer: confirm.label })
                : t(confirm?.rank === 1 ? `${C}.removeMainBody` : `${C}.removeSecondaryBody`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={confirmPending || undefined}
              onClick={ignoreWhenInactive(confirmPending, runConfirmed)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
            >
              {t(confirm?.kind === 'payer' ? `${C}.endPayer` : `${C}.remove`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InsuranceDialog({ rank, row, onClose }: { rank: 1 | 2; row: ClientInsurance | null; onClose: () => void }) {
  const { summary } = useClientRecordData()
  const [insurer, setInsurer] = useState(row?.insurer ?? '')
  const [policy, setPolicy] = useState(row?.policyNumber ?? '')
  const [certificate, setCertificate] = useState(row?.certificateNumber ?? '')
  const [holderRelation, setHolderRelation] = useState<HolderRelation>(row?.holderRelation ?? 'self')
  const [holderName, setHolderName] = useState(row?.holderName ?? '')
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useUpsertClientInsurance({ onErrorMessage: setRefusal })
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(rank === 1 ? `${C}.main` : `${C}.secondary`)}</DialogTitle>
          <DialogDescription>{t(`${C}.insuranceDialog`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setRefusal(null)
            save.mutate(
              { clientId: summary.client.id, rank, insurer: insurer.trim(), policyNumber: textOrNull(policy), certificateNumber: textOrNull(certificate), holderRelation, holderName: holderRelation === 'self' ? null : textOrNull(holderName) },
              { onSuccess: onClose },
            )
          }}
        >
          <FormField label={t(`${C}.insurer`)} width="full" required>
            {(field) => <Input {...field} value={insurer} onChange={(e) => setInsurer(e.target.value)} autoComplete="off" />}
          </FormField>
          <FormRow>
            <FormField label={t(`${C}.policy`)} width="md">
              {(field) => <Input {...field} value={policy} onChange={(e) => setPolicy(e.target.value)} autoComplete="off" />}
            </FormField>
            <FormField label={t(`${C}.certificate`)} width="md">
              {(field) => <Input {...field} value={certificate} onChange={(e) => setCertificate(e.target.value)} autoComplete="off" />}
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label={t(`${C}.holderRelation`)} width="md">
              {(field) => (
                <Select {...field} value={holderRelation} onChange={(e) => setHolderRelation(e.target.value as HolderRelation)}>
                  {HOLDER_RELATIONS.map((v) => (
                    <option key={v} value={v}>
                      {holderRelationLabel(v)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {holderRelation !== 'self' && (
              <FormField label={t(`${C}.holderName`)} width="md">
                {(field) => <Input {...field} value={holderName} onChange={(e) => setHolderName(e.target.value)} autoComplete="off" />}
              </FormField>
            )}
          </FormRow>
          {refusal && <Refusal message={refusal} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={save.isPending} disabled={insurer.trim() === ''} label={t('common.save')} pendingLabel={t('common.saving')} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PayerDialog({ row, kinds, onClose }: { row: ClientPayer | null; kinds: readonly PayerKind[]; onClose: () => void }) {
  const { summary } = useClientRecordData()
  const [kind, setKind] = useState<PayerKind>(row?.kind ?? kinds[0] ?? 'ivac')
  const [organisation, setOrganisation] = useState(row?.organisationName ?? '')
  const [fileNumber, setFileNumber] = useState(row?.fileNumber ?? '')
  const [sessionAmount, setSessionAmount] = useState(centsInput(row?.sessionAmountCents ?? null))
  const [maxSessions, setMaxSessions] = useState(row?.maxSessions !== null && row?.maxSessions !== undefined ? String(row.maxSessions) : '')
  const [maxAmount, setMaxAmount] = useState(centsInput(row?.maxAmountCents ?? null))
  const [startsOn, setStartsOn] = useState(row?.startsOn ?? '')
  const [expiresOn, setExpiresOn] = useState(row?.expiresOn ?? '')
  const [note, setNote] = useState(row?.note ?? '')
  // FP: a PAE's terms (a new PAE renews on March 31 by default, Christine 12).
  const [coverMode, setCoverMode] = useState<CoverMode>(row?.coveragePercent != null ? 'percent' : 'amount')
  const [percent, setPercent] = useState(row?.coveragePercent != null ? String(row.coveragePercent) : '')
  const [renewalMonth, setRenewalMonth] = useState(row ? (row.renewalMonth !== null ? String(row.renewalMonth) : '') : '3')
  const [renewalDay, setRenewalDay] = useState(row ? (row.renewalDay !== null ? String(row.renewalDay) : '') : '31')
  const [priorAmount, setPriorAmount] = useState(centsInput(row?.priorUsedCents ?? null))
  const [priorSessions, setPriorSessions] = useState(row?.priorUsedSessions != null ? String(row.priorUsedSessions) : '')
  const [priorOn, setPriorOn] = useState(row?.priorUsedOn ?? '')
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveClientPayer({ onErrorMessage: setRefusal })
  const pae = kind === 'pae'
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(row ? `${C}.editPayer` : `${C}.addPayer`)}</DialogTitle>
          <DialogDescription>{t(`${C}.payerDialog`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const byPercent = pae && coverMode === 'percent'
            const session = byPercent ? null : toCents(sessionAmount)
            const max = toCents(maxAmount)
            const sessions = maxSessions.trim() === '' ? null : Number(maxSessions)
            const prior = pae ? toCents(priorAmount) : (row?.priorUsedCents ?? null)
            const priorCount = pae ? (priorSessions.trim() === '' ? null : Number(priorSessions)) : (row?.priorUsedSessions ?? null)
            if (
              Number.isNaN(session) ||
              Number.isNaN(max) ||
              Number.isNaN(prior) ||
              (sessions !== null && !Number.isInteger(sessions)) ||
              (priorCount !== null && !Number.isInteger(priorCount))
            ) {
              setRefusal(t(`${C}.invalidAmount`))
              return
            }
            if (pae && (prior !== null || priorCount !== null) !== (priorOn !== '')) {
              setRefusal(t(`${C}.invalidPrior`))
              return
            }
            const coverage = byPercent ? (percent.trim() === '' ? null : Number(percent)) : null
            if (coverage !== null && (!Number.isInteger(coverage) || coverage < 1 || coverage > 100)) {
              setRefusal(t(`${C}.invalidPercent`))
              return
            }
            const month = pae ? (renewalMonth === '' ? null : Number(renewalMonth)) : (row?.renewalMonth ?? null)
            const day = pae ? (renewalDay.trim() === '' ? null : Number(renewalDay)) : (row?.renewalDay ?? null)
            if ((month === null) !== (day === null) || (day !== null && (!Number.isInteger(day) || day < 1 || day > 31))) {
              setRefusal(t(`${C}.invalidRenewal`))
              return
            }
            setRefusal(null)
            save.mutate(
              {
                clientId: summary.client.id,
                id: row?.id ?? null,
                kind,
                organisationName: textOrNull(organisation),
                fileNumber: textOrNull(fileNumber),
                sessionAmountCents: session,
                maxSessions: sessions,
                maxAmountCents: max,
                startsOn: startsOn || null,
                expiresOn: expiresOn || null,
                note: textOrNull(note),
                // FP: a PAE's terms; an IVAC payer keeps its own as they are.
                coveragePercent: pae ? coverage : (row?.coveragePercent ?? null),
                renewalMonth: month,
                renewalDay: day,
                priorUsedCents: prior,
                priorUsedSessions: priorCount,
                priorUsedOn: pae ? priorOn || null : (row?.priorUsedOn ?? null),
              },
              { onSuccess: onClose },
            )
          }}
        >
          <FormRow>
            <FormField label={t(`${C}.kind`)} width="sm" required readOnly={row !== null}>
              {(field) => (
                <Select {...field} value={kind} onChange={(e) => setKind(e.target.value as PayerKind)}>
                  {(row ? PAYER_KINDS : kinds).map((v) => (
                    <option key={v} value={v}>
                      {payerKindLabel(v)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t(kind === 'pae' ? `${C}.provider` : `${C}.organisation`)} width="md" required={kind === 'pae'}>
              {(field) => <Input {...field} value={organisation} onChange={(e) => setOrganisation(e.target.value)} autoComplete="off" />}
            </FormField>
          </FormRow>
          <FormField label={t(`${C}.fileNumber`)} help={kind === 'pae' ? t(`${C}.paeFileHelp`) : undefined} width="md" required={kind === 'ivac'}>
            {(field) => <Input {...field} value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} autoComplete="off" />}
          </FormField>
          {pae && (
            <FormField label={t(`${C}.coverMode`)} width="md">
              {(field) => (
                <Select {...field} value={coverMode} onChange={(e) => setCoverMode(e.target.value as CoverMode)}>
                  <option value="amount">{t(`${C}.coverAmount`)}</option>
                  <option value="percent">{t(`${C}.coverPercent`)}</option>
                </Select>
              )}
            </FormField>
          )}
          <FormRow>
            {pae && coverMode === 'percent' ? (
              <FormField label={t(`${C}.coveragePercent`)} help={t(`${C}.coveragePercentHelp`)} width="xs">
                {(field) => <Input {...field} value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="numeric" maxLength={3} autoComplete="off" />}
              </FormField>
            ) : (
              <FormField label={t(`${C}.sessionAmount`)} width="sm">
                {(field) => <Input {...field} value={sessionAmount} onChange={(e) => setSessionAmount(e.target.value)} inputMode="decimal" autoComplete="off" />}
              </FormField>
            )}
            <FormField label={t(`${C}.maxSessions`)} width="xs">
              {(field) => <Input {...field} value={maxSessions} onChange={(e) => setMaxSessions(e.target.value)} inputMode="numeric" autoComplete="off" />}
            </FormField>
            <FormField label={t(`${C}.maxAmount`)} width="sm">
              {(field) => <Input {...field} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="decimal" autoComplete="off" />}
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label={t(`${C}.startsOn`)} width="sm">
              {(field) => <Input {...field} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
            </FormField>
            <FormField label={t(`${C}.expiresOn`)} width="sm">
              {(field) => <Input {...field} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}
            </FormField>
          </FormRow>
          {pae && (
            <>
              <FormRow>
                <FormField label={t(`${C}.renewalMonth`)} help={t(`${C}.renewalHelp`)} width="sm">
                  {(field) => (
                    <Select {...field} value={renewalMonth} onChange={(e) => setRenewalMonth(e.target.value)}>
                      <option value="">{t(`${C}.noRenewal`)}</option>
                      {MONTHS.map((m) => (
                        <option key={m} value={String(m)}>
                          {formatDateOnly(`2001-${pad2(m)}-01`, 'MMMM')}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label={t(`${C}.renewalDay`)} width="xs">
                  {(field) => <Input {...field} value={renewalDay} onChange={(e) => setRenewalDay(e.target.value)} inputMode="numeric" maxLength={2} autoComplete="off" />}
                </FormField>
              </FormRow>
              <FormRow>
                <FormField label={t(`${C}.priorAmount`)} help={t(`${C}.priorHelp`)} width="sm">
                  {(field) => <Input {...field} value={priorAmount} onChange={(e) => setPriorAmount(e.target.value)} inputMode="decimal" autoComplete="off" />}
                </FormField>
                <FormField label={t(`${C}.priorSessionsLabel`)} width="xs">
                  {(field) => <Input {...field} value={priorSessions} onChange={(e) => setPriorSessions(e.target.value)} inputMode="numeric" autoComplete="off" />}
                </FormField>
                <FormField label={t(`${C}.priorOn`)} width="sm">
                  {(field) => <Input {...field} type="date" value={priorOn} onChange={(e) => setPriorOn(e.target.value)} />}
                </FormField>
              </FormRow>
            </>
          )}
          <FormField label={t(`${C}.note`)} width="full">
            {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />}
          </FormField>
          {refusal && <Refusal message={refusal} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={save.isPending} label={t('common.save')} pendingLabel={t('common.saving')} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Refusal({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  )
}
