import { t } from '@/i18n'
import type { ConsentState, DemandeFileConsents } from '../api/demandes'

const C = 'modules.demandes.participants.consents'

/** What needs doing first: the order a file's consents are told in. */
const ORDER: Record<ConsentState, number> = { missing: 0, resign: 1, overdue: 2, pending: 3, signed: 4 }

export type ConsentTone = 'success' | 'warning' | 'info' | 'secondary'

/**
 * A file's consents in plain words (D-39): « Consentements valides », or each one still to settle,
 * by name (« Consentement général : à faire signer »). Never blocks: a warning to act on.
 */
export function fileConsentStatus(file: DemandeFileConsents | undefined): { tone: ConsentTone; label: string; valid: boolean } {
  if (!file || file.consents.length === 0) return { tone: 'secondary', label: t(`${C}.noneRequired`), valid: true }
  const open = file.consents.filter((c) => c.state !== 'signed').sort((a, b) => ORDER[a.state] - ORDER[b.state])
  if (open.length === 0) return { tone: 'success', label: t(`${C}.valid`), valid: true }
  const waiting = open.every((c) => c.state === 'pending')
  return {
    tone: waiting ? 'info' : 'warning',
    label: open.map((c) => t(`${C}.state.${c.state}`, { name: c.name })).join(' · '),
    valid: false,
  }
}

/** Whether every file of the request has its required consents in force. */
export function allConsentsValid(files: DemandeFileConsents[]): boolean {
  return files.every((file) => fileConsentStatus(file).valid)
}
