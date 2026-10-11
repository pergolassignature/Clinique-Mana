import { t } from '@/i18n'
import { retryInText } from '@/shared/lib/retry-after'
import { FunctionCallError, refusalMessage } from './functions'

/** The outside service a function depends on: it names `not_configured` and `provider_error`. */
export type FunctionService = 'email' | 'signing'

/** Who reads the text: staff may be sent to Paramètres; a professional never is, and never reads « Documenso ». */
export type FunctionAudience = 'staff' | 'professional'

export interface FunctionErrorOptions {
  service?: FunctionService
  audience?: FunctionAudience
  /**
   * A feature's own text for a code whose meaning differs there (C-4): `conflict` and `not_found`
   * always (« Un envoi est déjà en cours. », « Ce modèle n'existe plus. »), a limit that names what
   * is limited (`rate_limited`: « Trop de fiches envoyées en peu de temps. », the delay is added
   * here), or a test of the settings themselves (`not_configured` in Signature électronique).
   */
  overrides?: Readonly<Partial<Record<string, () => string>>>
}

/**
 * The one French text of an edge function's error code (C-4, P3-28), shared by every feature:
 * a refusal the function passed on (`refusalMessage`) as written; then the feature's override for
 * the code, if any; then the common text of the code. Null for a code with no text here (the
 * caller reports it and shows its generic text). These are expected: never reported.
 *
 * - `network`, `unauthenticated`, `forbidden`, `module_disabled`: one text everywhere;
 * - `rate_limited`: « Trop de demandes en peu de temps. » (or the feature's noun), then when to retry;
 * - `not_configured` / `provider_error`: named by the service (email or signing), the staff text
 *   pointing to Paramètres; without a service (storage, a missing server secret), or `auth_unavailable`
 *   / `internal`: « Le service est momentanément indisponible. ».
 */
export function functionErrorText(error: unknown, { service, audience = 'staff', overrides = {} }: FunctionErrorOptions = {}): string | null {
  if (!(error instanceof FunctionCallError)) return null
  const refusal = refusalMessage(error)
  if (refusal !== null) return refusal
  const override = Object.hasOwn(overrides, error.code) ? overrides[error.code] : undefined
  if (error.code === 'rate_limited') return `${override ? override() : t('common.functionErrors.rateLimited')} ${retryInText(error.retryAfter)}`
  if (override) return override()
  switch (error.code) {
    case 'network':
      return t('common.functionErrors.network')
    case 'unauthenticated':
      return t('common.functionErrors.unauthenticated')
    case 'forbidden':
      return t('common.errors.forbidden')
    case 'module_disabled':
      return t('common.functionErrors.moduleDisabled')
    case 'not_configured':
      return service ? t(`common.functionErrors.notConfigured.${service}.${audience}`) : t('common.functionErrors.unavailable')
    case 'provider_error':
      return service ? t(`common.functionErrors.providerError.${service}`) : t('common.functionErrors.unavailable')
    case 'auth_unavailable':
      return t('common.functionErrors.unavailable')
    default:
      return null
  }
}
