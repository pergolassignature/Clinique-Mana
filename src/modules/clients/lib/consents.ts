import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { functionErrorText } from '@/core/supabase/function-errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { ConsentRule, ConsentState, ConsentToObtain } from '../api/consents'

const S = 'modules.clients.consents'

/** A consent's state as shown everywhere (record panel, list): one word and its dot. */
export function consentStateLabel(state: ConsentState | null): { label: string; tone: StatusTone } {
  switch (state) {
    case 'signed':
      return { label: t(`${S}.state.signed`), tone: 'success' }
    case 'resign':
      return { label: t(`${S}.state.resign`), tone: 'warning' }
    case 'pending':
      return { label: t(`${S}.state.pending`), tone: 'neutral' }
    case 'overdue':
      return { label: t(`${S}.state.overdue`), tone: 'error' }
    case 'withdrawn':
      return { label: t(`${S}.state.withdrawn`), tone: 'error' }
    default:
      return { label: t(`${S}.state.none`), tone: 'default' }
  }
}

/**
 * An open request's state in « Consentements à obtenir »: the consent's own words (« En retard »,
 * « En attente de signature »), or how far it went (« Signature commencée », « Réponses données »).
 */
export function requestProgressLabel(row: Pick<ConsentToObtain, 'isOverdue' | 'signingStatus' | 'answered'>): { label: string; tone: StatusTone } {
  if (row.isOverdue) return consentStateLabel('overdue')
  if (row.signingStatus === 'sent' || row.signingStatus === 'viewed') return { label: t(`${S}.progress.signing`), tone: 'info' }
  if (row.answered) return { label: t(`${S}.progress.answered`), tone: 'info' }
  return consentStateLabel('pending')
}

/** « Signé le 12 oct. 2026 (version 2) », without the brackets when the version is not known (an import). */
export function signedOnText(signedAt: string, versionLabel: string | null): string {
  const date = formatClinicDateShort(signedAt)
  return versionLabel ? t(`${S}.signedOn`, { date, version: versionLabel }) : t(`${S}.signedOnNoVersion`, { date })
}

const SITUATIONS = ['waitlist', 'file_transfer', 'coaching'] as const

/** What a rule asks for, in words: « Tous les clients », « Le service 10157 », « Payeur : PAE », « Situation : liste d'attente »… */
export function ruleTriggerText(rule: Pick<ConsentRule, 'triggerKind' | 'target'>): string {
  let target = rule.target ?? ''
  if (rule.target === 'pae') target = 'PAE'
  else if (rule.target === 'ivac') target = 'IVAC'
  else if (rule.triggerKind === 'situation' && (SITUATIONS as readonly string[]).includes(target)) {
    target = t(`${S}.settings.rules.situations.${target as (typeof SITUATIONS)[number]}`)
  }
  return t(`${S}.settings.rules.trigger.${rule.triggerKind}`, { target })
}

/**
 * The French text of a failed `clients-consent-send` (a request, or the signed copy with its own
 * fallback): a refusal as written (no published text, no authorised parent, no address, no PDF,
 * the module reserved for testers), a limit with its delay, the shared texts of the other codes;
 * anything else is reported (code and message only).
 */
export function consentSendErrorMessage(error: unknown, fallback: string = t(`${S}.sendError`)): string {
  if (!(error instanceof FunctionCallError)) return moduleErrorMessage(error, fallback, 'clients')
  const text = functionErrorText(error, { service: 'email' })
  if (text !== null) return text
  if (error.code !== 'conflict') {
    const report = new Error(error.message)
    report.name = `FunctionCallError ${error.code}`
    Sentry.captureException(report, { tags: { area: 'clients', code: error.code } })
  }
  return fallback
}
