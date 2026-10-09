import { t } from '@/i18n'
import { signatureStatusLabel } from '@/core/signing/status'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { ContractAction, ContractRequest, ProfessionalContract } from '../api/contracts'
import type { ContractProgress } from './readiness'

/**
 * The contract card's states and actions (Task 4d.3, A5.1, A10.9), pure. The words of a request's
 * state are core's `signatureStatusLabel` (the same as « Signature électronique »), so the card
 * and the settings never disagree.
 *
 * - `none`: no contract yet → « Préparer et envoyer ».
 * - `sending`: a draft whose send runs (no error yet, its claim younger than `STALE_SEND_MS`)
 *   → « Synchroniser » only.
 * - `failed`: a draft whose send failed, or whose send died without a word (its claim older than
 *   `STALE_SEND_MS`: a fresh claim would still answer 409, so offering a retry is safe) →
 *   « Réessayer l'envoi » (the same request, P4-434) and « Régénérer ».
 * - `sent`, `viewed` → « Synchroniser », « Renvoyer » (the signing email again), « Régénérer ».
 * - `signed` → « Télécharger le PDF signé », « Journal de signature ».
 * - `rejected`, `expired`, `cancelled`, `abandoned` → « Régénérer » (a new contract).
 * Sending needs `professionals.contracts.send` and `professionals.compensation` (P4-436);
 * « Synchroniser » and the PDF need to read the request (`canRead`, P4-435).
 */
export type ContractState =
  | 'none'
  | 'sending'
  | 'failed'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'abandoned'

/** `_shared/signing.ts` STALE_SEND_MS: a send claim older than this no longer holds the request. */
export const STALE_SEND_MS = 10 * 60_000

/** A draft without an error whose send claim (or creation) is older than `STALE_SEND_MS`. */
function sendDied(request: ContractRequest, now: number): boolean {
  const since = Date.parse(request.sendStartedAt ?? request.lastSendAt ?? request.createdAt)
  return Number.isFinite(since) && now - since > STALE_SEND_MS
}

export function contractState(request: ContractRequest | null, now: number = Date.now()): ContractState {
  if (request === null) return 'none'
  switch (request.status) {
    case 'draft':
      if (request.lastError === null) return sendDied(request, now) ? 'failed' : 'sending'
      return request.lastError === 'abandoned' ? 'abandoned' : 'failed'
    case 'sent':
    case 'viewed':
    case 'signed':
    case 'rejected':
    case 'expired':
    case 'cancelled':
      return request.status
    default:
      return 'none'
  }
}

/** A button of the card: an action of the function, or a read. */
export type ContractButton = { kind: 'action'; action: ContractAction; label: string } | { kind: 'sync' } | { kind: 'pdf' }

type Can = (permission: string) => boolean

const A = 'modules.professionals.contract.actions'

/** The card's buttons for a state, in order (module comment). */
export function contractButtons(state: ContractState, request: ContractRequest | null, can: Can): ContractButton[] {
  const sender = can('professionals.contracts.send') && can('professionals.compensation')
  const reader = request?.canRead === true
  const send = (action: ContractAction, label: 'send' | 'retry' | 'regenerate' | 'resend'): ContractButton[] =>
    sender ? [{ kind: 'action', action, label: t(`${A}.${label}`) }] : []
  switch (state) {
    case 'none':
      return send('send', 'send')
    case 'sending':
      return reader ? [{ kind: 'sync' }] : []
    case 'failed':
      return [...send('send', 'retry'), ...send('regenerate', 'regenerate')]
    case 'sent':
    case 'viewed':
      return [...(reader ? [{ kind: 'sync' } as const] : []), ...send('resend', 'resend'), ...send('regenerate', 'regenerate')]
    case 'signed':
      return reader && request?.signedFileId ? [{ kind: 'pdf' }] : []
    case 'rejected':
    case 'expired':
    case 'cancelled':
    case 'abandoned':
      return send('regenerate', 'regenerate')
  }
}

const S = 'modules.professionals.contract.state'

/**
 * The state in words and its tone: core's label, « Aucun contrat » when there is none, « Envoi en
 * cours » while a send runs, « L'envoi n'a pas abouti » once a send died without a word.
 */
export function contractStateLabel(request: ContractRequest | null, now: number = Date.now()): { label: string; tone: StatusTone; detail: string | null } {
  if (request === null) return { label: t(`${S}.none`), tone: 'default', detail: null }
  if (request.status === 'draft' && request.lastError === null) {
    return sendDied(request, now) ? { label: t(`${S}.stalled`), tone: 'error', detail: t(`${S}.stalledDetail`) } : { label: t(`${S}.sending`), tone: 'neutral', detail: null }
  }
  return signatureStatusLabel(request.status, request.lastError)
}

/**
 * « Prochaine action »'s view of the card: nothing out → to send; out → waiting for the first
 * signer who has neither signed nor refused (by name); otherwise (not loaded, a send running,
 * signed) null.
 */
export function contractProgress(contract: ProfessionalContract | null | undefined, now: number = Date.now()): ContractProgress | null {
  if (!contract) return null
  const state = contractState(contract.request, now)
  if (state === 'sent' || state === 'viewed') {
    const next = contract.request?.signers.find((s) => s.signedAt === null && s.rejectedAt === null)
    return next ? { kind: 'awaiting', name: next.name } : null
  }
  if (state === 'sending' || state === 'signed') return null
  return { kind: 'to_send' }
}

/** « Le contrat est signé » is what readiness counts (P4-435: the latest request only). */
export const isContractSigned = (request: ContractRequest | null) => request?.status === 'signed'

const ROLE = 'modules.professionals.contract.roles'

/** « Professionnel », « Clinique », « Client » for a signer role; « Signataire » for any other (never the code). */
export function signerRoleLabel(role: string): string {
  return role === 'professional' || role === 'clinic' || role === 'client' ? t(`${ROLE}.${role}`) : t(`${ROLE}.other`)
}
