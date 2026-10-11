import { t, type TranslationKey } from '@/i18n'
import { signingFailureText } from './status'

/** « Plateforme » for core; the module's name (`modules.<key>.name`), else its key. */
export function moduleLabel(moduleKey: string): string {
  if (moduleKey === 'core') return t('settings.signing.templates.coreModule')
  const key = `modules.${moduleKey}.name` as TranslationKey
  const name = t(key)
  return name === key ? moduleKey : name
}

/**
 * Why a request could not be verified, in plain French: « pas encore reprise par le suivi » when it
 * never failed (`null`: the runs have not reached it), else the reason as every signing status
 * says it (`signingFailureText`, C-7: « Erreur inattendue » for a code with no words).
 */
export function syncFailureLabel(code: string | null): string {
  return code === null ? t('settings.signing.unverified.failures.none') : signingFailureText(code)
}
