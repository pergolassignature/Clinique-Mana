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
  it('says each stored failure as every signing status does, a 404 apart from a 500 (C-7)', () => {
    expect(syncFailureLabel('provider_not_found')).toBe(t('signing.failure.providerNotFound'))
    expect(syncFailureLabel('provider_error')).toBe(t('signing.failure.providerError'))
    expect(syncFailureLabel('provider_not_found')).not.toBe(syncFailureLabel('provider_error'))
    expect(syncFailureLabel('signing_foreign_document')).toBe(t('signing.failure.foreignDocument'))
  })

  it('a request never failed is one the runs have not reached; an unknown code reads in French, never raw', () => {
    expect(syncFailureLabel(null)).toBe(t('settings.signing.unverified.failures.none'))
    expect(syncFailureLabel('apply_failed')).toBe(t('signing.failure.unexpected'))
    expect(syncFailureLabel('apply_failed')).not.toContain('apply_failed')
  })
})
