import { t } from '@/i18n'

/**
 * « Réessayez dans environ 45 minutes. » from a 429's `Retry-After` (seconds; `FunctionCallError`'s
 * `retryAfter`), rounded the way a person says it: under a minute « dans un instant », up to ten
 * minutes to the minute, then up to the next five minutes, an hour or more to the hour. Without a
 * delay, « Réessayez plus tard. ».
 */
export function retryInText(seconds: number | null, language: 'fr' | 'en' = 'fr'): string {
  // A client's English public page says it in English (`common.retryInEn`).
  const K = (language === 'en' ? 'common.retryInEn' : 'common.retryIn') as 'common.retryIn'
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return t(`${K}.later`)
  if (seconds < 60) return t(`${K}.moment`)
  let minutes = Math.ceil(seconds / 60)
  if (minutes > 10) minutes = Math.ceil(minutes / 5) * 5
  if (minutes < 60) return minutes === 1 ? t(`${K}.minuteOne`) : t(`${K}.minutesOther`, { count: String(minutes) })
  const hours = Math.round(seconds / 3600)
  return hours <= 1 ? t(`${K}.hourOne`) : t(`${K}.hoursOther`, { count: String(hours) })
}
