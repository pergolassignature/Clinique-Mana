import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { coreSettingsSections } from './sections'

// Uniqueness across core and modules is checked in src/app/settings-sections.test.ts (core may not import app).
describe('coreSettingsSections', () => {
  it('registers the Phase 2 sections in menu order, with English ids and French paths', () => {
    expect(coreSettingsSections.map((s) => [s.id, s.path, s.group])).toEqual([
      ['identity', 'identite', 'clinique'],
      ['tax', 'fiscalite', 'clinique'],
      ['signatory', 'signataire', 'clinique'],
      ['bank', 'banque', 'clinique'],
      ['region', 'region', 'clinique'],
      ['privacy', 'confidentialite', 'clinique'],
      ['users', 'utilisateurs', 'plateforme'],
      ['modules', 'modules', 'plateforme'],
      ['audit', 'journal', 'plateforme'],
    ])
  })

  it('names each section in French', () => {
    expect(coreSettingsSections.map((s) => t(s.labelKey))).toEqual([
      'Identité légale',
      'Fiscalité',
      'Signataire',
      'Coordonnées bancaires',
      'Région',
      'Confidentialité',
      'Utilisateurs et accès',
      'Modules',
      "Journal d'audit",
    ])
  })

  it('gates each section by its view permission, and marks the ones others may only read', () => {
    expect(Object.fromEntries(coreSettingsSections.map((s) => [s.id, [s.permission, s.editPermission]]))).toEqual({
      identity: ['settings.view', 'settings.manage'],
      tax: ['settings.view', 'settings.manage'],
      signatory: ['settings.view', 'settings.manage'],
      bank: ['settings.bank_manage', undefined],
      region: ['settings.view', 'settings.manage'],
      privacy: ['settings.view', 'settings.manage'],
      users: ['users.view', 'users.manage'],
      modules: ['modules.manage', undefined],
      audit: ['audit.view', undefined],
    })
  })
})
