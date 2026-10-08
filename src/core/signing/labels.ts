import { t, type TranslationKey } from '@/i18n'

/** « Plateforme » for core; the module's name (`modules.<key>.name`), else its key. */
export function moduleLabel(moduleKey: string): string {
  if (moduleKey === 'core') return t('settings.signing.templates.coreModule')
  const key = `modules.${moduleKey}.name` as TranslationKey
  const name = t(key)
  return name === key ? moduleKey : name
}

/** The failure codes the signing reconcile stores (`failureCode`, `_shared/signing-events.ts`) that read in plain French. */
const FAILURES = [
  'provider_not_found',
  'provider_rejected',
  'provider_unreachable',
  'provider_error',
  'not_configured',
  'signing_foreign_document',
] as const

/**
 * Why a request could not be verified, in plain French: a known code, « pas encore reprise par le
 * suivi » when it never failed (`null`: the runs have not reached it), else the code in brackets.
 */
export function syncFailureLabel(code: string | null): string {
  if (code === null) return t('settings.signing.unverified.failures.none')
  const known = FAILURES.find((failure) => failure === code)
  return known ? t(`settings.signing.unverified.failures.${known}`) : t('settings.signing.unverified.failures.other', { code })
}
