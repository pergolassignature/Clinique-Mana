import { describe, expect, it } from 'vitest'
import { recordWithStatus as record } from '../test/fixtures-domain'
import type { ProfessionalStatus } from './constants'
import { activationLabel, activationMode, statusActions } from './status-actions'

const can = (...keys: string[]) => (permission: string) => keys.includes(permission)
const MANAGE = 'professionals.manage'
const OVERRIDE = 'professionals.activate_override'

describe('statusActions', () => {
  it.each<[string, ProfessionalStatus, boolean, string[], ReturnType<typeof statusActions>]>([
    ['a complete draft: Activer and Désactiver', 'draft', true, [MANAGE], { activate: 'activate', deactivate: true }],
    ['an incomplete draft without the override: Désactiver only', 'draft', false, [MANAGE], { activate: null, deactivate: true }],
    ['an incomplete draft with the override: Activer', 'draft', false, [MANAGE, OVERRIDE], { activate: 'activate', deactivate: true }],
    ['in review, complete', 'in_review', true, [MANAGE], { activate: 'activate', deactivate: true }],
    ['active: Désactiver only', 'active', true, [MANAGE, OVERRIDE], { activate: null, deactivate: true }],
    ['inactive and complete: Réactiver, no menu item', 'inactive', true, [MANAGE], { activate: 'reactivate', deactivate: false }],
    ['inactive, incomplete, without the override: nothing', 'inactive', false, [MANAGE], { activate: null, deactivate: false }],
    ['inactive, incomplete, with the override: Réactiver', 'inactive', false, [MANAGE, OVERRIDE], { activate: 'reactivate', deactivate: false }],
    ['the override alone, without manage: nothing', 'draft', false, [OVERRIDE], { activate: null, deactivate: false }],
    ['read-only: nothing', 'draft', true, ['professionals.view', 'professionals.matching'], { activate: null, deactivate: false }],
  ])('%s', (_, status, complete, keys, expected) => {
    expect(statusActions(record(status, complete), can(...keys))).toEqual(expected)
  })
})

describe('activationLabel', () => {
  it('reads « Activer » or « Réactiver »', () => {
    expect(activationLabel('activate')).toBe('Activer')
    expect(activationLabel('reactivate')).toBe('Réactiver')
  })
})

describe('activationMode', () => {
  it('confirms a complete file, asks the override reason otherwise, and blocks without the override', () => {
    expect(activationMode(record('draft', true), can(MANAGE))).toBe('confirm')
    expect(activationMode(record('draft', false), can(MANAGE, OVERRIDE))).toBe('override')
    expect(activationMode(record('draft', false), can(MANAGE))).toBe('blocked')
  })

  it('has nothing left to do once the professional is active', () => {
    expect(activationMode(record('active', true), can(MANAGE, OVERRIDE))).toBe('done')
    expect(activationMode(record('active', false), can(MANAGE, OVERRIDE))).toBe('done')
  })
})
