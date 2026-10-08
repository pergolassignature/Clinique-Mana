import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { signatureStatusLabel } from './status'

describe('signatureStatusLabel', () => {
  it.each([
    ['sent', 'Envoyé', 'neutral'],
    ['viewed', 'Consulté', 'neutral'],
    ['signed', 'Signé', 'success'],
    ['rejected', 'Refusé', 'error'],
    ['cancelled', 'Annulé', 'default'],
    ['expired', 'Expiré', 'warning'],
  ] as const)('reads %s in French', (status, label, tone) => {
    expect(signatureStatusLabel(status, null)).toEqual({ label, tone, detail: null })
  })

  it('reads a draft without an error as a send under way', () => {
    expect(signatureStatusLabel('draft', null)).toEqual({ label: "En cours d'envoi", tone: 'neutral', detail: null })
  })

  it('reads an abandoned draft as « Abandonné », not as a failure', () => {
    expect(signatureStatusLabel('draft', 'abandoned')).toEqual({ label: 'Abandonné', tone: 'default', detail: null })
  })

  it.each([
    ['provider_unavailable', "Le service de signature n'a pas répondu."],
    ['provider_not_configured', "Le service de signature a refusé la clé d'API."],
  ])('names the reason of a failed send (%s) in French, without its code', (code, detail) => {
    expect(signatureStatusLabel('draft', code)).toEqual({ label: "Échec de l'envoi", tone: 'error', detail })
  })

  it('shows « Code : … » for a failure code with no French words', () => {
    expect(signatureStatusLabel('draft', 'mark_sent_failed')).toEqual({
      label: "Échec de l'envoi",
      tone: 'error',
      detail: t('signing.errorCode', { code: 'mark_sent_failed' }),
    })
  })

  it('ignores an error code once the request left the draft state', () => {
    expect(signatureStatusLabel('sent', 'provider_unavailable')).toEqual({ label: 'Envoyé', tone: 'neutral', detail: null })
  })

  it('shows an unknown status as stored', () => {
    expect(signatureStatusLabel('archived', null)).toEqual({ label: 'archived', tone: 'default', detail: null })
  })
})
