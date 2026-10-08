import { useRef, useState, type ReactNode } from 'react'
import { Info, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { LevelRow, ProfessionalCompensation } from '../../api/compensation'
import { useDeleteProfessionalRecognition } from '../../hooks/use-compensation'
import { canDeleteDated, datedStatus, earliestStart, formatCents, formatPercent, periodLabel } from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'
import { LevelDialog } from './LevelDialog'
import { Disclosure } from './MotifsSummary'

const R = 'modules.professionals.record.compensation.recognition'
const W = 'modules.professionals.compensation'

/** One key/value pair: the term 12 px secondary, the value 13 px (design system). */
function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}

interface RecognitionCardProps {
  professionalId: string
  data: ProfessionalCompensation
}

/**
 * « Programme de reconnaissance » (`professionals.compensation`): the level in force, entered by
 * hand, with its sessions counted, start and note; a coming level; the dated levels behind
 * « Historique ». No amount is computed (P4-8): a permanent line says so, and another while the
 * cap's interpretation is unconfirmed. « Mettre à jour » adds a level; « Supprimer » on the one
 * the database will let go (P4-145).
 */
export function RecognitionCard({ professionalId, data }: RecognitionCardProps) {
  const now = useNow(60_000)
  const today = getClinicDateString(new Date(now))
  const [toDelete, setToDelete] = useState<LevelRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteProfessionalRecognition(professionalId, { onErrorMessage: (message) => setRefusal(message) })
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const updateButton = useRef<HTMLButtonElement>(null)
  const { recognition } = data
  const rule = recognition.rule
  const rows = data.levelRows
  const openRow = rows.find((row) => row.effectiveTo === null)
  const upcoming = openRow && datedStatus(openRow, today) === 'upcoming' ? openRow : null

  return (
    <SettingsCard
      as="section"
      title={t(`${R}.title`)}
      description={t(`${R}.description`)}
      footer={<LevelDialog ref={updateButton} professionalId={professionalId} minDate={earliestStart(rows)} />}
    >
      <Alert>
        <Info aria-hidden />
        <AlertDescription className="text-foreground">
          {t(`${R}.notComputed`)}
          {rule?.capBasis === 'unconfirmed' && <span className="block">{t(`${R}.capUnconfirmed`, { cap: formatPercent(rule.capPct) })}</span>}
        </AlertDescription>
      </Alert>
      {recognition.level === null ? (
        <div>
          <p className="text-sm font-medium">{t(`${R}.none`)}</p>
          <p className="text-sm text-muted-foreground">{t(`${R}.noneBody`)}</p>
        </div>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Item term={t(`${R}.level`)}>
            <span className="tabular">{recognition.level}</span>
          </Item>
          <Item term={t(`${R}.sessions`)}>
            <span className="tabular">{recognition.sessionsCounted}</span>
          </Item>
          <Item term={t(`${R}.since`)}>{formatDateOnlyShort(recognition.effectiveFrom)}</Item>
          {recognition.note && (
            <div className="sm:col-span-3">
              <Item term={t(`${W}.note`)}>{recognition.note}</Item>
            </div>
          )}
        </dl>
      )}
      {upcoming && (
        <p className="text-xs text-muted-foreground">{t(`${R}.upcoming`, { level: String(upcoming.level), date: formatDateOnlyShort(upcoming.effectiveFrom) })}</p>
      )}
      {rule && (
        <p className="text-xs text-muted-foreground">
          {t(`${R}.rule`, {
            step: String(rule.stepSessions),
            bonus50: formatCents(rule.bonusPer50MinCents),
            bonus30: formatCents(rule.bonusPer30MinCents),
            cap: formatPercent(rule.capPct),
          })}
        </p>
      )}
      {rows.length > 0 && (
        <Disclosure label={<span className="text-sm">{t(`${R}.historyLabel`)}</span>}>
          <ol className="divide-y divide-border-light rounded-md border border-border-light">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">{t(`${R}.historyRow`, { level: String(row.level), sessions: String(row.sessionsCounted) })}</span>
                <span className="text-muted-foreground">{periodLabel(row)}</span>
                <DatedStatusBadge status={datedStatus(row, today)} />
                {row.note && <span className="basis-full break-words text-xs text-muted-foreground">{row.note}</span>}
                {canDeleteDated(row, rows, today, now, { keepFirst: false }) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={t(`${R}.deleteLabel`, { level: String(row.level), date: formatDateOnlyShort(row.effectiveFrom) })}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      setRefusal(null)
                      setToDelete(row)
                    }}
                  >
                    <Trash2 aria-hidden className="sm:hidden" />
                    <span className="max-sm:sr-only">{t(`${W}.delete`)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${R}.deleteTitle`)}
        body={toDelete ? t(`${R}.deleteBody`, { level: String(toDelete.level), date: formatDateOnlyShort(toDelete.effectiveFrom) }) : ''}
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
        triggerRef={deleteTrigger}
        fallbackRef={updateButton}
      />
    </SettingsCard>
  )
}
