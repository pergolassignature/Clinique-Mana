import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { ConsentState, EntryState, ExitReason, FeeStatus, TargetKind, WaitlistEntry } from '../api/waitlist'

const W = 'modules.demandes.waitlist'

/** `/liste-attente`, optionally on one list (`liste=t-<id>` a profession, `p-<id>` a professional). */
export function waitlistPath(target?: { kind: TargetKind; id: string } | null, state?: EntryState): string {
  const params = new URLSearchParams()
  if (target) params.set('liste', `${target.kind === 'title' ? 't' : 'p'}-${target.id}`)
  if (state) params.set('etat', STATE_PARAM[state])
  const query = params.toString()
  return query ? `/liste-attente?${query}` : '/liste-attente'
}

/** The address's words for the states (French). */
export const STATE_PARAM: Record<EntryState, string> = {
  incomplete: 'incompletes',
  active: 'actives',
  to_call: 'a-rappeler',
  offered: 'offres',
  closed: 'sorties',
}

/** `t-<uuid>` / `p-<uuid>` → the list, else null. */
export function targetFromParam(raw: string | null): { kind: TargetKind; id: string } | null {
  const match = /^([tp])-([0-9a-f-]{36})$/i.exec(raw ?? '')
  if (!match) return null
  return { kind: match[1] === 't' ? 'title' : 'professional', id: match[2]! }
}

export const entryStateLabel = (state: EntryState) => t(`${W}.states.${state}`)

export function entryStateTone(state: EntryState): StatusTone {
  switch (state) {
    case 'incomplete':
      return 'warning'
    case 'to_call':
      return 'error'
    case 'offered':
      return 'info'
    case 'active':
      return 'success'
    case 'closed':
      return 'neutral'
  }
}

export const feeLabel = (status: FeeStatus) => t(`${W}.fee.status.${status}`)
export const consentLabel = (state: ConsentState) => t(`${W}.consent.${state}`)
export const exitReasonLabel = (reason: ExitReason) => t(`${W}.exit.reasons.${reason}`)

/** The fee and the consent settle an entry (D-16). */
export const feeSettled = (status: FeeStatus) => status === 'paid' || status === 'waived'
export const consentSettled = (state: ConsentState | null) => state === 'signed' || state === 'resign' || state === 'not_required'

/** « 1re sur 12 », « 7e sur 23 »: a place in the list. */
export function rankLabel(entry: Pick<WaitlistEntry, 'rank' | 'list_size'>): string | null {
  if (entry.rank === null || entry.list_size === null) return null
  const size = String(entry.list_size)
  return entry.rank === 1 ? t(`${W}.rankFirst`, { size }) : t(`${W}.rank`, { rank: String(entry.rank), size })
}

/** « Depuis aujourd'hui », « Depuis 1 jour », « Depuis 34 jours ». */
export function waitedLabel(days: number): string {
  if (days <= 0) return t(`${W}.waited.today`)
  if (days === 1) return t(`${W}.waited.one`)
  return t(`${W}.waited.many`, { days: String(days) })
}

/** « 18,91 $ » from cents. */
export function moneyLabel(cents: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}
