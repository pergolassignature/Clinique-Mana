import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'

const STATUSES: Readonly<Record<string, { label: 'ok' | 'error' | 'skipped' | 'running'; tone: StatusTone }>> = {
  ok: { label: 'ok', tone: 'success' },
  error: { label: 'error', tone: 'error' },
  skipped: { label: 'skipped', tone: 'neutral' },
  running: { label: 'running', tone: 'warning' },
}

/** « Réussie », « Erreur », « Ignorée », « En cours »; an unknown status as is. */
export function runStatusLabel(status: string): string {
  const known = Object.hasOwn(STATUSES, status) ? STATUSES[status] : undefined
  return known ? t(`settings.jobs.status.${known.label}`) : status
}

/** The dot next to the status word. */
export function runStatusTone(status: string): StatusTone {
  return (Object.hasOwn(STATUSES, status) ? STATUSES[status]?.tone : undefined) ?? 'neutral'
}

/** « Planifiée » (cron) or « Manuelle » (« Exécuter maintenant »). */
export function runTriggerLabel(trigger: string): string {
  return trigger === 'manual' ? t('settings.jobs.trigger.manual') : t('settings.jobs.trigger.cron')
}

const SQLSTATE = /^[0-9A-Z]{5}$/
const HTTP = /^http_(\d{3}|unknown)$/
const DETAILS = ['configuration_missing', 'abandoned', 'timeout', 'network', 'no_response'] as const

/**
 * The French reading of a failed run's detail (an error code, never personal data): the known
 * codes, a SQLSTATE (« Erreur technique (code 23514) »), an HTTP status, else the code in brackets.
 */
export function runDetailLabel(detail: string | null): string | null {
  if (!detail) return null
  const known = DETAILS.find((code) => code === detail)
  if (known) return t(`settings.jobs.detail.${known}`)
  if (SQLSTATE.test(detail)) return t('settings.jobs.detail.sqlstate', { code: detail })
  const http = HTTP.exec(detail)?.[1]
  if (http) return t('settings.jobs.detail.http', { status: http === 'unknown' ? t('settings.jobs.detail.httpUnknown') : http })
  return t('settings.jobs.detail.other', { code: detail })
}
