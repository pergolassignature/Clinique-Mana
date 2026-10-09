import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { emailProblemText, invitationFunctionMessage } from './use-invitations'

const O = 'modules.professionals.onboarding'
const UPDATE = { kind: 'update', firstName: 'Marie' } as const
const ADVICE = "La demande reste ouverte : dites à Marie qu'une mise à jour l'attend dans son questionnaire."

describe('emailProblemText', () => {
  it('an invitation: « Renvoyer » advised only where it can help', () => {
    expect(emailProblemText({ code: 'provider_error', retryAfter: null }, { kind: 'invitation' })).toBe(
      `${t(`${O}.emailProblems.provider_error`)} ${t(`${O}.emailAdvice.invitation`)}`,
    )
    expect(emailProblemText({ code: 'invalid_request', retryAfter: null }, { kind: 'invitation' })).toBe(
      "Le service d'envoi a refusé cette adresse. Corrigez-la dans l'onglet « Identité et permis », puis utilisez « Envoyer l'invitation ».",
    )
    expect(emailProblemText({ code: 'not_configured', retryAfter: null }, { kind: 'invitation' })).toBe(t(`${O}.emailProblems.not_configured`))
    expect(emailProblemText({ code: 'rate_limited', retryAfter: 2700 }, { kind: 'invitation' })).toBe(
      `${t(`${O}.emailProblems.rate_limited`)} Réessayez dans environ 45 minutes.`,
    )
  })

  it.each(['provider_error', 'rate_limited', 'not_configured', 'module_disabled', 'internal'])(
    'an update request (%s): the request stays open, always said, never « Renvoyer »',
    (code) => {
      const text = emailProblemText({ code, retryAfter: 60 }, UPDATE)
      expect(text.endsWith(ADVICE)).toBe(true)
      expect(text).not.toMatch(/Renvoyer|Réessayez/)
    },
  )

  it('an update request to a refused address: corrected in « Mon compte », no invitation to re-send', () => {
    expect(emailProblemText({ code: 'invalid_request', retryAfter: null }, UPDATE)).toBe(
      "Le service d'envoi a refusé l'adresse du dossier. Marie a un compte : c'est dans « Mon compte » que cette adresse se modifie (il n'y a pas d'invitation à renvoyer). " +
        ADVICE,
    )
  })
})

describe('invitationFunctionMessage', () => {
  it('a 429 names neither limit (its body does not say which): too many calls, and when to retry', () => {
    expect(invitationFunctionMessage(new FunctionCallError('rate_limited', 429, 'Too many', {}, 5))).toBe('Trop de demandes en peu de temps. Réessayez dans un instant.')
    expect(invitationFunctionMessage(new FunctionCallError('rate_limited', 429, 'Too many', {}, 2700))).toBe(
      'Trop de demandes en peu de temps. Réessayez dans environ 45 minutes.',
    )
  })

  it('leaves the RPC refusals it passes on to showMutationError', () => {
    expect(invitationFunctionMessage({ code: 'P0001', message: 'Aucune invitation en cours.' })).toBeNull()
  })
})
