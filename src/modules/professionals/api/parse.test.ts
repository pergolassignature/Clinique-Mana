import { describe, expect, it } from 'vitest'
import {
  catalogPayload,
  historyEntryPayload,
  listRowPayload,
  parseRpc,
  publicProfilePayload,
  readinessPayload,
  recordPayload,
  settingsPayload,
  statusChangePayload,
} from './parse'
import { CATALOG_JSON, HISTORY_ROW_JSON, IDS, LIST_ROW_JSON, PUBLIC_PROFILE_JSON, READINESS_JSON, RECORD_JSON } from '../test/fixtures'

const SHAPE_ERROR = 'professionals: unexpected RPC shape'

describe('parseRpc', () => {
  it('throws a value-free error when the payload does not match', () => {
    const run = () => parseRpc(settingsPayload, { collect_sin: 'Marie Tremblay' })
    expect(run).toThrow(new Error(SHAPE_ERROR))
    try {
      run()
    } catch (error) {
      expect(String(error)).not.toContain('Marie')
    }
  })
})

describe('catalogPayload', () => {
  const catalog = parseRpc(catalogPayload, CATALOG_JSON)

  it('maps the nine lists to camelCase, in the order received', () => {
    expect(catalog.orders).toEqual([
      {
        id: IDS.opq,
        key: 'opq',
        name: 'Ordre des psychologues du Québec',
        acronym: 'OPQ',
        licenceLabel: 'N° de permis',
        licencePattern: '^[0-9]{5}$',
        isSystem: false,
        sortOrder: 10,
        isActive: true,
      },
    ])
    expect(catalog.titles.map((t) => [t.key, t.categoryId, t.orderId, t.isActive])).toEqual([
      ['psychologue', IDS.psychologie, IDS.opq, true],
      ['naturopathe', IDS.naturopathie, null, true],
      ['ancien_titre', IDS.psychologie, null, false],
    ])
    expect(catalog.clienteles.map((c) => [c.key, c.minAge, c.maxAge])).toEqual([
      ['children', 0, 12],
      ['seniors', 65, null],
      ['couples', null, null],
    ])
    expect(catalog.motifCategories[0]).toMatchObject({ key: 'inner_life', icon: 'Brain', description: expect.any(String) })
    expect(catalog.motifs.find((m) => m.key === 'psychose')).toMatchObject({ categoryId: IDS.innerLife, isRestricted: true })
    expect(catalog.languages[0]).toEqual({ id: IDS.fr, code: 'fr', name: 'Français', isSystem: true, sortOrder: 10, isActive: true })
    expect(catalog.deactivationReasons.find((r) => r.key === 'other')).toMatchObject({ requiresNote: true, disablesAccount: false })
    expect(catalog.categories).toHaveLength(2)
    expect(catalog.specialties).toHaveLength(1)
  })

  it('reads the nine empty lists of a caller without access', () => {
    const empty = Object.fromEntries(Object.keys(CATALOG_JSON).map((k) => [k, []]))
    expect(Object.values(parseRpc(catalogPayload, empty)).every((list) => Array.isArray(list) && list.length === 0)).toBe(true)
  })

  it('refuses an icon outside the 20 of the editor', () => {
    const bad = { ...CATALOG_JSON, motif_categories: [{ ...CATALOG_JSON.motif_categories[0], icon: 'Skull' }] }
    expect(() => parseRpc(catalogPayload, bad)).toThrow(SHAPE_ERROR)
  })
})

describe('recordPayload', () => {
  it('maps the record, its 1:1 rows, its sets and its readiness', () => {
    const record = parseRpc(recordPayload, RECORD_JSON)
    expect(record?.professional).toMatchObject({
      id: IDS.professional,
      profileId: null,
      firstName: 'Marie',
      lastName: 'Tremblay',
      personalPhone: '+15145551234',
      addressLine1: '123, rue Saint-Denis',
      province: 'QC',
      yearsExperience: 12,
      gender: null,
      status: 'draft',
      deactivationDisabledAccount: false,
      createdBy: IDS.admin,
    })
    expect(record?.publicProfile).toEqual({ bio: null, approach: null, publicEmail: null, publicPhone: null, updatedAt: '2026-10-08T12:00:00+00:00' })
    expect(record?.matchingProfile).toEqual({
      acceptingNewClients: true,
      availabilityPeriods: ['am', 'evening'],
      availabilityNote: null,
      updatedAt: '2026-10-08T12:00:00+00:00',
    })
    expect(record?.professions).toEqual([{ id: IDS.professionRow, titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true }])
    expect(record?.clienteles).toEqual([{ id: IDS.couples, specialized: true }])
    expect(record?.specialties).toEqual([])
    expect(record?.motifIds).toEqual([IDS.anxiete])
    expect(record?.languageIds).toEqual([IDS.fr])
    expect(record?.payerNumbers).toEqual([{ type: 'ivac', number: '123456' }])
    expect(record?.readiness).toEqual({
      complete: false,
      done: 0,
      total: 1,
      items: [{ key: 'matching_profile', done: false, missing: ['clientele', 'motif'] }],
      warnings: [],
    })
  })

  it('is null when the caller cannot read the professional', () => {
    expect(parseRpc(recordPayload, null)).toBeNull()
  })

  it('ignores columns added by later batches', () => {
    const record = parseRpc(recordPayload, { ...RECORD_JSON, professional: { ...RECORD_JSON.professional, photo_file_id: 'x' } })
    expect(record?.professional).not.toHaveProperty('photo_file_id')
  })

  it('refuses a status the database does not allow', () => {
    expect(() => parseRpc(recordPayload, { ...RECORD_JSON, professional: { ...RECORD_JSON.professional, status: 'pending' } })).toThrow(SHAPE_ERROR)
  })
})

describe('readinessPayload', () => {
  it('reads warnings and a complete file', () => {
    expect(
      parseRpc(readinessPayload, {
        ...READINESS_JSON,
        complete: true,
        done: 1,
        items: [{ key: 'matching_profile', done: true, missing: [] }],
        warnings: ['login_email_mismatch'],
      }),
    ).toMatchObject({ complete: true, done: 1, warnings: ['login_email_mismatch'] })
  })

  it('is null for a professional the caller cannot read', () => {
    expect(parseRpc(readinessPayload, null)).toBeNull()
  })

  it('refuses an unknown gap', () => {
    expect(() => parseRpc(readinessPayload, { ...READINESS_JSON, items: [{ key: 'matching_profile', done: false, missing: ['photo'] }] })).toThrow(SHAPE_ERROR)
  })
})

describe('publicProfilePayload', () => {
  it('maps names, groups and approaches', () => {
    expect(parseRpc(publicProfilePayload, PUBLIC_PROFILE_JSON)).toEqual({
      firstName: 'Marie',
      lastName: 'Tremblay',
      bio: 'Vingt ans de pratique.',
      approach: null,
      publicEmail: null,
      publicPhone: null,
      primaryTitleName: 'Psychologue',
      orderAcronym: 'OPQ',
      licenceNumber: '12345',
      motifGroups: [
        { categoryKey: 'inner_life', categoryName: 'Vie intérieure', icon: 'Brain', motifs: ['Anxiété'] },
        { categoryKey: 'autres', categoryName: 'Autres', icon: null, motifs: ['Deuil'] },
      ],
      clienteles: [{ name: 'Couples', minAge: null, maxAge: null, specialized: true }],
      approaches: [{ name: 'Thérapie cognitivo-comportementale (TCC)', specialized: false }],
    })
  })

  it('is null when the caller cannot read the professional', () => {
    expect(parseRpc(publicProfilePayload, null)).toBeNull()
  })
})

describe('listRowPayload', () => {
  it('narrows the view row (the generated types make every column nullable)', () => {
    expect(parseRpc(listRowPayload, LIST_ROW_JSON)).toEqual({
      id: IDS.professional,
      firstName: 'Marie',
      lastName: 'Tremblay',
      email: 'marie.t@exemple.ca',
      status: 'draft',
      statusChangedAt: '2026-10-08T12:00:00+00:00',
      deactivationReasonId: null,
      hasAccount: false,
      primaryTitleId: IDS.psychologue,
      primaryLicenceNumber: '12345',
      languageIds: [IDS.fr],
      clienteleIds: [IDS.couples],
      specialtyIds: [],
      motifIds: [IDS.anxiete],
      acceptingNewClients: true,
      matchingComplete: true,
      ready: true,
      emailMatchesLogin: true,
      createdAt: '2026-10-08T12:00:00+00:00',
      updatedAt: '2026-10-08T12:00:00+00:00',
    })
  })

  it('reads a missing matching profile as not accepting new clients', () => {
    expect(parseRpc(listRowPayload, { ...LIST_ROW_JSON, accepting_new_clients: null }).acceptingNewClients).toBe(false)
  })
})

describe('historyEntryPayload', () => {
  it('maps an audit row, with null actor for system rows', () => {
    expect(parseRpc(historyEntryPayload, HISTORY_ROW_JSON)).toEqual({
      id: 4012,
      createdAt: '2026-10-08T12:05:00+00:00',
      tableName: 'professional_motifs',
      recordId: `${IDS.professional}:${IDS.anxiete}`,
      action: 'insert',
      changedFields: { motif_id: IDS.anxiete },
      actorId: IDS.admin,
      actorName: 'Admin Local',
      actorRole: 'admin',
      source: 'app',
    })
    expect(
      parseRpc(historyEntryPayload, { ...HISTORY_ROW_JSON, actor_id: null, actor_name: null, actor_role: null, changed_fields: null, source: 'seed:professionals_reference' }),
    ).toMatchObject({ actorId: null, actorName: null, actorRole: null, changedFields: null })
  })
})

describe('settingsPayload', () => {
  it('maps the module settings', () => {
    expect(parseRpc(settingsPayload, { collect_sin: false })).toEqual({ collectSin: false })
  })
})

describe('statusChangePayload', () => {
  it('reads the null account change and profile the generated types call non-null', () => {
    expect(parseRpc(statusChangePayload, [{ status: 'active', account_change: null, profile_id: null }])).toEqual({
      status: 'active',
      accountChange: null,
      profileId: null,
    })
    expect(parseRpc(statusChangePayload, [{ status: 'inactive', account_change: 'disabled', profile_id: IDS.admin }])).toEqual({
      status: 'inactive',
      accountChange: 'disabled',
      profileId: IDS.admin,
    })
  })

  it('refuses anything but one row', () => {
    expect(() => parseRpc(statusChangePayload, [])).toThrow(SHAPE_ERROR)
  })
})
