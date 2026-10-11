import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { emailProblemLabel, emailStatusLabel } from './status'

describe('emailStatusLabel', () => {
  it('reads a failed row whose outcome is unknown as « Résultat inconnu », never « Échec »', () => {
    const label = emailStatusLabel('failed', 'provider_unavailable')
    expect(label).toMatchObject({ label: 'Résultat inconnu', tone: 'warning', detail: t('email.failure.unknownOutcomeHint') })
    expect(label.label).not.toBe(t('email.status.failed'))
  })

  it.each([
    ['invalid_recipient', 'Adresse invalide'],
    ['provider_rejected', "Refusé par le service d'envoi"],
    // The webhook's email.failed: the provider could not send it.
    ['provider_failed', "Refusé par le service d'envoi"],
    ['provider_rate_limited', "Limite d'envoi atteinte"],
  ])('names the reason of %s in French, without its code', (code, label) => {
    expect(emailStatusLabel('failed', code)).toMatchObject({ label, tone: 'error', detail: null, code: null })
  })

  it('reads « Raison inconnue » for a code with no French word, the code kept for a tooltip only (C-7)', () => {
    expect(emailStatusLabel('failed', 'resend_mystery')).toMatchObject({
      label: 'Échec',
      tone: 'error',
      detail: t('email.failure.unexpected'),
      code: 'resend_mystery',
    })
  })

  it.each([
    ['queued', 'En file', 'neutral'],
    ['sent', 'Envoyé', 'neutral'],
    ['delivered', 'Livré', 'success'],
    ['delivery_delayed', 'Retardé', 'warning'],
    ['bounced', 'Adresse introuvable', 'error'],
    ['complained', 'Signalé comme indésirable', 'error'],
  ] as const)('reads %s in French', (status, label, tone) => {
    expect(emailStatusLabel(status, null)).toMatchObject({ label, tone, detail: null })
  })

  it('reads an unknown status as « Statut inconnu », never raw, the value kept for a tooltip (C-7)', () => {
    expect(emailStatusLabel('scheduled', null)).toEqual({ label: t('email.status.unknown'), tone: 'default', detail: null, code: 'scheduled' })
  })
})

describe('emailProblemLabel (C3)', () => {
  it('words a send-time code as the log words the same failure', () => {
    expect(emailProblemLabel('invalid_request')).toBe(emailStatusLabel('failed', 'invalid_recipient').label)
    expect(emailProblemLabel('rate_limited')).toBe(emailStatusLabel('failed', 'provider_rate_limited').label)
    expect(emailProblemLabel('provider_unavailable')).toBe(t('email.failure.unknownOutcome'))
    expect(emailProblemLabel('not_configured')).toBe(t('email.failure.notConfigured'))
    expect(emailProblemLabel(null)).toBe(t('email.status.failed'))
    expect(emailProblemLabel('internal')).toBe(t('email.status.failed'))
  })
})

describe('every transport code has French words (C-7)', () => {
  it('reads the codes `_shared/email/transport.ts` stores, and fails on one missing here', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/email/transport.ts'), 'utf8')
    const union = /export type TransportFailureCode =([^;]+?)\n\n/s.exec(source)?.[1] ?? ''
    const codes = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '')
    expect(codes.length).toBeGreaterThanOrEqual(4)
    for (const code of [...codes, 'provider_failed']) expect(emailStatusLabel('failed', code).code, code).toBeNull()
  })
})

