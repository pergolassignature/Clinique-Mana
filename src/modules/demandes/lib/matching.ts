import { t } from '@/i18n'
import type { MatchCriteria, MatchedProfessional, MatchReason, MatchWarning, Period } from '../api/matching'
import { optionLabel } from './display'

const M = 'modules.demandes.matching'

const list = new Intl.ListFormat('fr-CA', { style: 'long', type: 'conjunction' })
/** « Anxiété, Deuil et Stress ». */
export const joinNames = (names: readonly string[]) => list.format(names)

export const periodsText = (periods: readonly Period[]) => joinNames(periods.map((p) => optionLabel('period', p)))

/**
 * Places left in words (rule 11): « 3 places restantes », « 0 place restante » (the workbook's
 * yellow: a warning, the professional stays listed); nothing when she tracks none.
 */
export function placesLabel(p: Pick<MatchedProfessional, 'places_left'>): { label: string; tone: 'neutral' | 'warning' } | null {
  if (p.places_left === null) return null
  if (p.places_left === 0) return { label: t(`${M}.placesNone`), tone: 'warning' }
  return {
    label: p.places_left === 1 ? t(`${M}.placesLeftOne`) : t(`${M}.placesLeftOther`, { count: String(p.places_left) }),
    tone: 'neutral',
  }
}

export const reasonLabel = (reason: MatchReason) => t(`${M}.reasons.${reason}`)

/** Every warning in words; « 0 place restante » is the places badge's, so it is left out here. */
export function warningLabels(p: Pick<MatchedProfessional, 'warnings' | 'refused_hits'>): { key: MatchWarning; label: string; tone: 'warning' | 'error' }[] {
  return p.warnings
    .filter((w) => w !== 'no_places')
    .map((w) => ({
      key: w,
      label: w === 'refused_motif' ? t(`${M}.warnings.refused_motif`, { names: joinNames(p.refused_hits.map((m) => m.name)) }) : t(`${M}.warnings.${w}`),
      tone: w === 'insurance_expired' ? 'error' : 'warning',
    }))
}

/** The fit in words: the request's motifs she holds (every name, P4-249), the ★, the periods. */
export function fitLines(p: MatchedProfessional, criteria: MatchCriteria): string[] {
  const lines: string[] = []
  if (criteria.motifs.length > 0) {
    lines.push(
      p.motif_hits.length === 0
        ? t(`${M}.noMotifHit`)
        : t(`${M}.motifHits`, {
            names: joinNames(p.motif_hits.map((m) => m.name)),
            count: String(p.motif_hits.length),
            total: String(criteria.motifs.length),
          }),
    )
  }
  if (p.specialized) lines.push(t(`${M}.specialized`))
  if (p.period_hits.length > 0) lines.push(t(`${M}.periodHits`, { periods: periodsText(p.period_hits) }))
  return lines
}

/** What the request says, as the panel used it: one short line each. */
export function criteriaLines(c: MatchCriteria): string[] {
  const who: string[] = []
  if (c.beneficiary && c.beneficiary !== 'self') who.push(optionLabel('beneficiary', c.beneficiary))
  who.push(c.age === null ? t(`${M}.ageUnknown`) : t(`${M}.age`, { age: String(c.age) }))
  who.push(c.sex === 'female' || c.sex === 'male' || c.sex === 'other' ? t(`${M}.sex.${c.sex}`) : t(`${M}.sexUnknown`))
  const lines = [[optionLabel('language', c.language), ...who].join(' · ')]
  if (c.profession_title_name) lines.push(t(`${M}.profession`, { name: c.profession_title_name }))
  if (c.ignored.includes('profession')) lines.push(t(`${M}.ignored.profession`))
  if (c.clientele_name) lines.push(t(`${M}.clientele`, { name: c.clientele_name }))
  if (c.ignored.includes('clientele')) lines.push(t(`${M}.ignored.clientele`))
  lines.push(c.motifs.length === 0 ? t(`${M}.noMotifs`) : t(`${M}.motifs`, { names: joinNames(c.motifs.map((m) => m.name)) }))
  lines.push(c.availability_periods.length === 0 ? t(`${M}.noPeriods`) : t(`${M}.periods`, { periods: periodsText(c.availability_periods) }))
  if (c.preferred_pro_gender === 'female' || c.preferred_pro_gender === 'male') lines.push(t(`${M}.preferredGender.${c.preferred_pro_gender}`))
  return lines
}
