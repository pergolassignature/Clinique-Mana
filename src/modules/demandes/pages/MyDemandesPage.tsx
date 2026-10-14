import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { t } from '@/i18n'
import { DescriptionList, type DescriptionItem } from '@/shared/components/DescriptionList'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { fetchMyDemandes, type MyDemande, type MyDemandes } from '../api/mine'
import { demandesKeys } from '../hooks/keys'
import { optionLabel } from '../lib/display'
import { mainPerson, motifGroups } from '../lib/mine'

const M = 'modules.demandes.mine'
const I = 'modules.demandes.intake'

/** A yes / no answer, the items named after « Oui » (« Oui : Coparentalité »); null when not answered. */
function yesNo(answer: boolean | null, named: readonly string[], group: string): string | null {
  if (answer === null) return null
  if (!answer) return optionLabel('yesNo', 'no')
  const yes = optionLabel('yesNo', 'yes')
  return named.length === 0 ? yes : t(`${M}.yesWith`, { items: named.map((v) => optionLabel(group, v)).join(', ') })
}

const list = (values: readonly (string | number)[], group: string) => values.map((v) => optionLabel(group, String(v))).join(', ')

/** One block per line (a category's motifs, a participant). */
const lines = (items: readonly string[]): ReactNode =>
  items.length === 0 ? null : (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )

function DemandeCard({ demande, data }: { demande: MyDemande; data: MyDemandes }) {
  const person = mainPerson(demande)
  const motifs = motifGroups(demande.motif_ids, data.motifs).map((g) =>
    g.category === null ? g.names.join(', ') : t(`${M}.motifCategory`, { category: g.category, motifs: g.names.join(', ') }),
  )
  const people = demande.participants.map((p) => {
    const name = p.display_name?.trim() || t('modules.demandes.unnamed')
    return p.relationship ? t(`${M}.participant`, { name, relationship: optionLabel('relationship', p.relationship) }) : name
  })
  const need: DescriptionItem[] = [
    { label: t(`${I}.need.beneficiary`), value: demande.beneficiary && optionLabel('beneficiary', demande.beneficiary) },
    { label: t(`${M}.people`), value: lines(people) },
    { label: t(`${I}.need.title_`), value: demande.profession_title_id && data.titles.get(demande.profession_title_id) },
    { label: t(`${I}.need.clientele`), value: demande.clientele_id && data.clienteles.get(demande.clientele_id) },
    { label: t(`${I}.need.motifs`), value: lines(motifs) },
    { label: t(`${I}.need.motifOther`), value: demande.motif_other },
    { label: t(`${I}.need.concerns`), value: demande.concerns && <span className="whitespace-pre-line">{demande.concerns}</span> },
    { label: t(`${I}.need.issues`), value: yesNo(demande.has_issues, demande.issues, 'issue') },
    ...(demande.has_issues ? [{ label: t(`${I}.need.issuesComment`), value: demande.issues_comment }] : []),
    { label: t(`${I}.need.previousTherapy`), value: yesNo(demande.previous_therapy, demande.previous_professionals, 'previousProfessional') },
    ...(demande.previous_therapy ? [{ label: t(`${I}.need.previousComment`), value: demande.previous_comment }] : []),
    { label: t(`${I}.need.legal`), value: yesNo(demande.has_legal_context, demande.legal_context, 'legalContext') },
    ...(demande.has_legal_context ? [{ label: t(`${I}.need.legalDetail`), value: demande.legal_detail }] : []),
  ]
  const prefs: DescriptionItem[] = [
    { label: t(`${I}.prefs.language`), value: optionLabel('language', demande.language) },
    { label: t(`${I}.prefs.modality`), value: optionLabel('modality', demande.modality) },
    { label: t(`${I}.prefs.gender`), value: optionLabel('gender', demande.preferred_pro_gender) },
    { label: t(`${I}.prefs.periods`), value: list(demande.availability_periods, 'period'), empty: t(`${I}.any`) },
    { label: t(`${I}.prefs.days`), value: list(demande.availability_days, 'day'), empty: t(`${I}.any`) },
    { label: t(`${I}.prefs.availabilityOther`), value: demande.availability_other },
    { label: t(`${I}.prefs.payer`), value: optionLabel('payer', demande.payer_kind) },
    { label: t(`${I}.prefs.insurer`), value: demande.insurer },
  ]
  const dates = [
    t(`${M}.received`, { date: formatClinicDateShort(demande.received_at) }),
    ...(demande.matched_at ? [t(`${M}.matched`, { date: formatClinicDateShort(demande.matched_at) })] : []),
  ].join(t(`${M}.separator`))
  return (
    <SettingsCard as="section" title={person ? t(`${M}.cardTitle`, { reference: demande.reference, name: person }) : demande.reference} description={dates}>
      {demande.is_urgent && (
        <Badge variant="error" filled className="self-start">
          {t(`${I}.need.urgent`)}
        </Badge>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t(`${I}.need.title`)}</h3>
        <DescriptionList items={need} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t(`${I}.prefs.title`)}</h3>
        <DescriptionList items={prefs} />
      </div>
    </SettingsCard>
  )
}

/**
 * « Mes demandes » (R-80): the requests matched to the professional while « Jumelée », with the
 * whole intake (« Autre motif », « Autres disponibilités », the follow-up answers and their
 * comments); never the contact (« Mes clients »), the source, the counselor or the internal note.
 * Read-only.
 */
export function MyDemandesPage() {
  usePageTitle(t(`${M}.title`))
  const mine = useQuery({ queryKey: demandesKeys.mine(), queryFn: fetchMyDemandes })
  let content: ReactNode
  if (mine.isError && !mine.data) content = <LoadError message={t(`${M}.loadError`)} onRetry={() => void mine.refetch()} retrying={mine.isFetching} />
  else if (!mine.data) content = <Loading />
  else if (mine.data.demandes.length === 0) content = <EmptyState title={t(`${M}.empty.title`)} body={t(`${M}.empty.body`)} />
  else {
    const data = mine.data
    content = (
      <div className="space-y-4">
        {data.demandes.map((demande) => (
          <DemandeCard key={demande.id} demande={demande} data={data} />
        ))}
      </div>
    )
  }
  return (
    <>
      <PageHeader level={1} title={t(`${M}.title`)} description={t(`${M}.description`)} />
      {content}
    </>
  )
}
