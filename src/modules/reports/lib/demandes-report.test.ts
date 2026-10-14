import { describe, expect, it } from 'vitest'
import { formatBusinessDays, formatDays, monthLabel, utmLabel, weekLabel } from './demandes-report'

const period = { from: '2026-09-01', to: '2026-09-30' }

describe('Indicateurs des demandes: labels', () => {
  it('business hours read as business days (24 per weekday, the promise is 2)', () => {
    expect(formatBusinessDays(37.5)).toBe('1,6 jour ouvrable')
    expect(formatBusinessDays(72)).toBe('3,0 jours ouvrables')
    expect(formatBusinessDays(null)).toBe('Aucune donnée')
    expect(formatDays(1)).toBe('1,0 jour')
    expect(formatDays(14)).toBe('14,0 jours')
  })

  it('a week or a month the period cuts says so', () => {
    expect(weekLabel('2026-08-31', period)).toMatch(/\(partielle\)$/)
    expect(weekLabel('2026-09-07', period)).not.toMatch(/partielle/)
    expect(weekLabel('2026-09-28', period)).toMatch(/\(partielle\)$/)
    expect(monthLabel('2026-09-01', period)).toBe('Septembre 2026')
    expect(monthLabel('2026-09-01', { from: '2026-09-02', to: '2026-09-30' })).toBe('Septembre 2026 (partiel)')
  })

  it('utm: what is missing is said; the folded row reads « Autres valeurs »', () => {
    expect(utmLabel({ source: 'facebook', medium: null, other: false })).toBe('facebook / support non précisé')
    expect(utmLabel({ source: null, medium: null, other: true })).toMatch(/^Autres valeurs/)
  })
})
