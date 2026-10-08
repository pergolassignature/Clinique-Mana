import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { coreSettingsSections } from './sections'

// Uniqueness across core and modules is checked in src/app/settings-sections.test.ts (core may not import app).

// The core permission keys, mirroring public.permissions (module 'core') in the migrations
// (20261007140517_core_access, 20261007192359_core_roles_split, 20261008015825_core_editable_roles,
// 20261008033613_core_shared_permissions).
// A typo in the registry fails here.
const CORE_PERMISSION_KEYS = [
  'settings.view',
  'settings.manage',
  'settings.bank_manage',
  'users.view',
  'users.manage',
  'modules.manage',
  'audit.view',
  'roles.manage',
  'settings.email_manage',
  'settings.integrations_manage',
]
describe('coreSettingsSections', () => {
  it('registers the sections in menu order, with English ids and French paths', () => {
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
      ['jobs', 'taches-planifiees', 'plateforme'],
      ['email', 'courriels', 'plateforme'],
      ['signing', 'signature-electronique', 'plateforme'],
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
      'Tâches planifiées',
      'Courriels',
      'Signature électronique',
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
      // Any of them: the « Rôles » tab needs roles.manage only, and is hers to change with it.
      users: [['users.view', 'roles.manage'], ['users.manage', 'roles.manage']],
      modules: ['modules.manage', undefined],
      audit: ['audit.view', undefined],
      jobs: ['settings.view', 'settings.manage'],
      // Any of them: the sender and templates need settings.email_manage, the keys settings.integrations_manage.
      email: ['settings.view', ['settings.email_manage', 'settings.integrations_manage']],
      // Every part (address, keys, expiry, test tools) is an integration setting.
      signing: ['settings.view', 'settings.integrations_manage'],
    })
  })

  it('uses only known core permission keys', () => {
    for (const s of coreSettingsSections) {
      for (const permission of typeof s.permission === 'string' ? [s.permission] : s.permission) expect(CORE_PERMISSION_KEYS).toContain(permission)
      for (const permission of typeof s.editPermission === 'string' ? [s.editPermission] : (s.editPermission ?? [])) expect(CORE_PERMISSION_KEYS).toContain(permission)
    }
  })
})
