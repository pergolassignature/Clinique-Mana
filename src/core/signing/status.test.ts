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
    expect(signatureStatusLabel(status, null)).toMatchObject({ label, tone, detail: null })
  })

  it('reads a draft without an error as a send under way', () => {
    expect(signatureStatusLabel('draft', null)).toMatchObject({ label: "Envoi en cours", tone: 'neutral', detail: null })
  })

  it('reads an abandoned draft as « Abandonné », not as a failure', () => {
    expect(signatureStatusLabel('draft', 'abandoned')).toMatchObject({ label: 'Abandonné', tone: 'default', detail: null })
  })

  it.each([
    ['provider_unavailable', "Le service de signature n'a pas répondu."],
    ['provider_not_configured', "Le service de signature a refusé la clé d'API."],
    ['provider_invalid_request', 'Le service de signature a refusé le document (sujet ou message trop long, ou adresse en double).'],
    ['provider_not_found', 'Le document est introuvable dans le service de signature (supprimé, ou connexion à une autre instance).'],
    ['provider_rejected', 'Le service de signature a refusé la demande.'],
    ['provider_unreachable', 'Le service de signature est injoignable.'],
    ['not_configured', "Le service de signature a refusé la clé d'API."],
  ])('names the reason of a failed send or settle (%s) in French, without its code', (code, detail) => {
    expect(signatureStatusLabel('draft', code)).toMatchObject({ label: "Échec de l'envoi", tone: 'error', detail, code: null })
  })

  it('reads « Erreur inattendue » for a failure code with no French words, the code kept for a tooltip (C-7)', () => {
    expect(signatureStatusLabel('draft', 'apply_failed')).toMatchObject({
      label: "Échec de l'envoi",
      tone: 'error',
      detail: t('signing.failure.unexpected'),
      code: 'apply_failed',
    })
  })

  it('ignores an error code once the request left the draft state', () => {
    expect(signatureStatusLabel('sent', 'provider_unavailable')).toMatchObject({ label: 'Envoyé', tone: 'neutral', detail: null, code: null })
  })

  it('reads an unknown status as « État inconnu », the value kept for a tooltip', () => {
    expect(signatureStatusLabel('archived', null)).toMatchObject({ label: t('signing.status.unknown'), tone: 'default', detail: null, code: 'archived' })
  })
})
