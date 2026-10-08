import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { emailStatusLabel } from './status'

describe('emailStatusLabel', () => {
  it('reads a failed row whose outcome is unknown as « Résultat inconnu », never « Échec »', () => {
    const label = emailStatusLabel('failed', 'provider_unavailable')
    expect(label).toEqual({ label: 'Résultat inconnu', tone: 'warning', detail: t('email.failure.unknownOutcomeHint') })
    expect(label.label).not.toBe(t('email.status.failed'))
  })

  it.each([
    ['invalid_recipient', 'Adresse invalide'],
    ['provider_rejected', "Refusé par le service d'envoi"],
    // The webhook's email.failed: the provider could not send it.
    ['provider_failed', "Refusé par le service d'envoi"],
    ['provider_rate_limited', "Limite d'envoi atteinte"],
  ])('names the reason of %s in French, without its code', (code, label) => {
    expect(emailStatusLabel('failed', code)).toEqual({ label, tone: 'error', detail: null })
  })

  it('shows « Code : … » only for a code with no French word', () => {
    expect(emailStatusLabel('failed', 'resend_mystery')).toEqual({
      label: 'Échec',
      tone: 'error',
      detail: t('email.errorCode', { code: 'resend_mystery' }),
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
    expect(emailStatusLabel(status, null)).toEqual({ label, tone, detail: null })
  })

  it('shows an unknown status as stored', () => {
    expect(emailStatusLabel('scheduled', null)).toEqual({ label: 'scheduled', tone: 'default', detail: null })
  })
})
