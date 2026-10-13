import { useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog } from '@/shared/ui/dialog'
import type { MatchCriteria, MatchedProfessional } from '../../api/matching'
import { useDemandeMatch } from '../../hooks/use-matching'
import { usePropositions } from '../../hooks/use-propositions'
import { criteriaLines, fitLines, placesLabel, reasonLabel, warningLabels } from '../../lib/matching'
import { ProposeForm } from './PropositionsCard'
import { useDemandeRecord } from './record-context'

const M = 'modules.demandes.matching'

/**
 * « Jumelage » (D4): the professionals for this request, in the documented order (the fit — the
 * request's motifs she holds, a ★ clientèle, the periods — then places left, then the name), each
 * with its places, « À prioriser », the warnings (a refused motif: R-66, never a filter; the
 * insurance; an age or a sex to check) and « Bon à savoir ». Those left out follow, folded, with
 * why. « Proposer » opens the proposal (D3b) with her preset; an expired insurance asks first
 * (rule 8). Staff only: the tab shows with professionals.view.
 */
export function MatchingTab() {
  const { id, bundle, canEdit } = useDemandeRecord()
  const { can } = useAccess()
  const match = useDemandeMatch(id)
  const propositions = usePropositions(id)
  const [showOthers, setShowOthers] = useState(false)
  const [confirming, setConfirming] = useState<MatchedProfessional | null>(null)
  const [proposing, setProposing] = useState<MatchedProfessional | null>(null)

  if (match.isError && !match.data) {
    return <LoadError message={t(`${M}.loadError`)} retrying={match.isFetching} onRetry={() => void match.refetch()} />
  }
  if (!match.data) return <Loading />
  const { criteria, professionals } = match.data
  const eligible = professionals.filter((p) => p.eligible)
  const others = professionals.filter((p) => !p.eligible)
  const pending = (propositions.data ?? []).some((p) => p.response === 'pending')
  const open = ['accepted', 'waitlist', 'proposed'].includes(bundle.demande.state)
  const canPropose = canEdit && open && !pending && can('appointments.view')
  const propose = (p: MatchedProfessional) => (p.warnings.includes('insurance_expired') ? setConfirming(p) : setProposing(p))

  return (
    <div className="container-inline space-y-5">
      <SettingsCard as="section" layout="section" title={t(`${M}.criteriaTitle`)} description={t(`${M}.description`)}>
        <CriteriaList criteria={criteria} />
      </SettingsCard>

      <SettingsCard as="section" layout="section" title={t(`${M}.eligible`, { count: String(eligible.length) })}>
        {canEdit && pending && <p className="text-sm text-muted-foreground">{t(`${M}.pending`)}</p>}
        {canEdit && !open && <p className="text-sm text-muted-foreground">{t(`${M}.notOpen`)}</p>}
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${M}.noneEligible`)}</p>
        ) : (
          <ol aria-label={t(`${M}.title`)} className="divide-y divide-border-light">
            {eligible.map((p) => (
              <ProfessionalRow key={p.professional_id} professional={p} criteria={criteria} onPropose={canPropose ? () => propose(p) : undefined} />
            ))}
          </ol>
        )}
      </SettingsCard>

      {others.length > 0 && (
        <section aria-labelledby="matching-others" className="space-y-2">
          <Button
            id="matching-others"
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
            className="max-sm:h-11"
          >
            {t(`${M}.others`, { count: String(others.length) })}
          </Button>
          {showOthers && (
            <ul className="divide-y divide-border-light rounded-lg border border-border">
              {others.map((p) => (
                <li key={p.professional_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {p.display_name}
                    {p.title_label && <span className="font-normal text-muted-foreground"> · {p.title_label}</span>}
                  </span>
                  <span className="text-muted-foreground">{p.reasons.map(reasonLabel).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${M}.confirmInsurance.title`, { name: confirming?.display_name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${M}.confirmInsurance.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setProposing(confirming)
                setConfirming(null)
              }}
            >
              {t(`${M}.confirmInsurance.action`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={proposing !== null} onOpenChange={(next) => !next && setProposing(null)}>
        {proposing && <ProposeForm initial={{ id: proposing.professional_id, name: proposing.display_name }} onDone={() => setProposing(null)} />}
      </Dialog>
    </div>
  )
}

function CriteriaList({ criteria }: { criteria: MatchCriteria }) {
  return (
    <ul className="space-y-1 text-sm">
      {criteriaLines(criteria).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

function ProfessionalRow({ professional: p, criteria, onPropose }: { professional: MatchedProfessional; criteria: MatchCriteria; onPropose?: () => void }) {
  const places = placesLabel(p)
  const warnings = warningLabels(p)
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-xs text-muted-foreground">{p.rank}.</span>
            <span className="font-medium">{p.display_name}</span>
            {p.title_label && <span className="text-sm text-muted-foreground">{p.title_label}</span>}
            {p.priority_reason && <Badge variant="info">{t(`${M}.priority`)}</Badge>}
            {places && <Badge variant={places.tone === 'warning' ? 'warning' : 'secondary'}>{places.label}</Badge>}
          </p>
          {p.priority_reason && <p className="text-xs text-muted-foreground">{p.priority_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm" className="max-sm:h-11">
            <Link to={`/professionnels/${p.professional_id}/jumelage`}>{t(`${M}.openFile`)}</Link>
          </Button>
          {onPropose && (
            <Button type="button" variant="outline" size="sm" onClick={onPropose} aria-label={t(`${M}.proposeTo`, { name: p.display_name })} className="max-sm:h-11">
              {t(`${M}.propose`)}
            </Button>
          )}
        </div>
      </div>
      <ul className="space-y-0.5 text-sm">
        {fitLines(p, criteria).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <ul aria-label={t(`${M}.warningsLabel`)} className="flex flex-wrap gap-1.5">
          {warnings.map((w) => (
            <li key={w.key}>
              <Badge variant={w.tone}>{w.label}</Badge>
            </li>
          ))}
        </ul>
      )}
      {p.matching_note && (
        <p className="text-sm">
          <span className="font-medium">{t(`${M}.note`)} : </span>
          <span className="whitespace-pre-line text-muted-foreground">{p.matching_note}</span>
        </p>
      )}
    </li>
  )
}
