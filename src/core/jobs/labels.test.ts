import { describe, expect, it } from 'vitest'
import { runDetailLabel, runStatusLabel, runStatusTone, runTriggerLabel } from './labels'

describe('runStatusLabel', () => {
  it.each([
    ['ok', 'Réussie', 'success'],
    ['error', 'Erreur', 'error'],
    ['skipped', 'Ignorée', 'neutral'],
    ['running', 'En cours', 'warning'],
  ] as const)('%s → « %s » with a %s dot', (status, label, tone) => {
    expect(runStatusLabel(status)).toBe(label)
    expect(runStatusTone(status)).toBe(tone)
  })

  it('shows an unknown status as is, with a neutral dot', () => {
    expect(runStatusLabel('paused')).toBe('paused')
    expect(runStatusTone('paused')).toBe('neutral')
  })
})

describe('runTriggerLabel', () => {
  it('names the trigger', () => {
    expect(runTriggerLabel('cron')).toBe('Planifiée')
    expect(runTriggerLabel('manual')).toBe('Manuelle')
  })
})

describe('runDetailLabel', () => {
  it.each([
    ['configuration_missing', 'Configuration manquante (voir Mise en service)'],
    ['23514', 'Erreur technique (code 23514)'],
    ['P0001', 'Erreur technique (code P0001)'],
    ['abandoned', 'Interrompue : aucune fin après 15 minutes'],
    ['timeout', 'Délai dépassé'],
    ['network', 'Service injoignable'],
    ['no_response', 'Aucune réponse du service'],
    ['http_404', 'Erreur technique (HTTP 404)'],
    ['http_unknown', 'Erreur technique (HTTP inconnu)'],
    ['provider_error', 'Erreur technique (provider_error)'],
  ])('%s → « %s »', (detail, label) => {
    expect(runDetailLabel(detail)).toBe(label)
  })

  it('has nothing to say without a detail', () => {
    expect(runDetailLabel(null)).toBeNull()
    expect(runDetailLabel('')).toBeNull()
  })
})
