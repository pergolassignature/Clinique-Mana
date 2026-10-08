import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { moduleLabel, syncFailureLabel } from './labels'

describe('moduleLabel', () => {
  it('reads « Plateforme » for core, the module name otherwise, else the key', () => {
    expect(moduleLabel('core')).toBe(t('settings.signing.templates.coreModule'))
    expect(moduleLabel('professionals')).toBe(t('modules.professionals.name'))
    expect(moduleLabel('unknown_module')).toBe('unknown_module')
  })
})

describe('syncFailureLabel', () => {
  it('says each stored failure in plain French, a 404 apart from a 500', () => {
    expect(syncFailureLabel('provider_not_found')).toBe(t('settings.signing.unverified.failures.provider_not_found'))
    expect(syncFailureLabel('provider_error')).toBe(t('settings.signing.unverified.failures.provider_error'))
    expect(syncFailureLabel('provider_not_found')).not.toBe(syncFailureLabel('provider_error'))
    for (const code of ['provider_rejected', 'provider_unreachable', 'provider_invalid_request', 'not_configured', 'signing_foreign_document'] as const) {
      expect(syncFailureLabel(code)).toBe(t(`settings.signing.unverified.failures.${code}`))
    }
  })

  it('a request never failed is one the runs have not reached; an unknown code is shown in brackets', () => {
    expect(syncFailureLabel(null)).toBe(t('settings.signing.unverified.failures.none'))
    expect(syncFailureLabel('apply_failed')).toBe(t('settings.signing.unverified.failures.other', { code: 'apply_failed' }))
  })
})
