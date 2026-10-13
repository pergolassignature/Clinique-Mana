import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { MatchCriteria, MatchedProfessional } from '../api/matching'
import { criteriaLines, fitLines, joinNames, placesLabel, warningLabels } from './matching'

const M = 'modules.demandes.matching'

const criteria = (over: Partial<MatchCriteria> = {}): MatchCriteria => ({
  demande_id: 'd1',
  client_id: null,
  language: 'fr',
  beneficiary: 'self',
  profession_title_id: null,
  clientele_id: null,
  preferred_pro_gender: 'any',
  availability_periods: [],
  motifs: [],
  sex: null,
  age: null,
  ...over,
})

const pro = (over: Partial<MatchedProfessional> = {}): MatchedProfessional => ({
  professional_id: 'p1',
  display_name: 'Pro Un',
  title_label: null,
  eligible: true,
  reasons: [],
  warnings: [],
  motif_hits: [],
  refused_hits: [],
  specialized: false,
  period_hits: [],
  fit: 0,
  places_declared: null,
  places_left: null,
  insurance_status: 'valid',
  matching_note: null,
  priority_reason: null,
  availability_periods: [],
  updated_at: null,
  rank: 1,
  ...over,
})

describe('matching in words', () => {
  it('names lists the French way', () => {
    expect(joinNames(['Anxiété'])).toBe('Anxiété')
    expect(joinNames(['Anxiété', 'Deuil', 'Stress'])).toBe('Anxiété, Deuil et Stress')
  })

  it('places left: a number, « 0 place restante » as a warning, nothing when not tracked (rule 11)', () => {
    expect(placesLabel(pro())).toBeNull()
    expect(placesLabel(pro({ places_left: 0 }))).toEqual({ label: t(`${M}.placesNone`), tone: 'warning' })
    expect(placesLabel(pro({ places_left: 1 }))?.label).toBe(t(`${M}.placesLeftOne`))
    expect(placesLabel(pro({ places_left: 4 }))?.label).toBe(t(`${M}.placesLeftOther`, { count: '4' }))
  })

  it('warnings: a refused motif names it (R-66), an expired insurance is an error, the places are the badge', () => {
    const labels = warningLabels(pro({ warnings: ['refused_motif', 'insurance_expired', 'no_places'], refused_hits: [{ id: 'm', name: 'Deuil' }] }))
    expect(labels.map((l) => [l.key, l.tone])).toEqual([
      ['refused_motif', 'warning'],
      ['insurance_expired', 'error'],
    ])
    expect(labels[0]?.label).toBe(t(`${M}.warnings.refused_motif`, { names: 'Deuil' }))
  })

  it('the fit: the motifs held out of the request’s, the ★, the periods', () => {
    const c = criteria({ motifs: [{ id: 'a', name: 'Anxiété' }, { id: 'b', name: 'Deuil' }] })
    expect(fitLines(pro({ motif_hits: [{ id: 'a', name: 'Anxiété' }], specialized: true, period_hits: ['evening'] }), c)).toEqual([
      t(`${M}.motifHits`, { names: 'Anxiété', count: '1', total: '2' }),
      t(`${M}.specialized`),
      t(`${M}.periodHits`, { periods: 'Soir' }),
    ])
    expect(fitLines(pro(), c)).toEqual([t(`${M}.noMotifHit`)])
    expect(fitLines(pro(), criteria())).toEqual([])
  })

  it('the criteria: who, the profession, the motifs, the periods, a preferred gender', () => {
    expect(
      criteriaLines(
        criteria({
          beneficiary: 'teen',
          age: 15,
          sex: 'female',
          profession_title_name: 'Psychologie',
          motifs: [{ id: 'a', name: 'Anxiété' }],
          availability_periods: ['pm', 'evening'],
          preferred_pro_gender: 'female',
        }),
      ),
    ).toEqual([
      'Français · Un adolescent · 15 ans · Une femme',
      t(`${M}.profession`, { name: 'Psychologie' }),
      t(`${M}.motifs`, { names: 'Anxiété' }),
      t(`${M}.periods`, { periods: 'Après-midi et Soir' }),
      t(`${M}.preferredGender.female`),
    ])
    expect(criteriaLines(criteria())).toEqual([
      `Français · ${t(`${M}.ageUnknown`)} · ${t(`${M}.sexUnknown`)}`,
      t(`${M}.noMotifs`),
      t(`${M}.noPeriods`),
    ])
  })
})
