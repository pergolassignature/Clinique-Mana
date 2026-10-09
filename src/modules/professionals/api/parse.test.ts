import { describe, expect, it } from 'vitest'
import {
  catalogPayload,
  historyEntryPayload,
  invitationStateRowPayload,
  listRowPayload,
  myRecordPayload,
  onboardingPayload,
  parseRpc,
  recordPayload,
  settingsPayload,
  signinSyncPayload,
  statusChangePayload,
} from './parse'
import { CATALOG_JSON, HISTORY_ROW_JSON, IDS, LIST_ROW_JSON, READINESS_JSON, RECORD_JSON } from '../test/fixtures'

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
  })

  it('reads the eight empty lists of a caller without access', () => {
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
      minClientAge: null,
      womenOnly: false,
      newClientPlaces: null,
      newClientPlacesSetAt: null,
      updatedAt: '2026-10-08T12:00:00+00:00',
    })
    expect(record?.matchingNote).toBeNull()
    expect(record?.photoFileId).toBeNull()
    expect(record?.professions).toEqual([{ id: IDS.professionRow, titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true }])
    expect(record?.clienteles).toEqual([{ id: IDS.couples, specialized: true }])
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

  it('reads the places offered with their date, and the staff note « Bon à savoir » (P4-382, P4-384)', () => {
    const record = parseRpc(recordPayload, {
      ...RECORD_JSON,
      matching_profile: { ...RECORD_JSON.matching_profile, new_client_places: 4, new_client_places_set_at: '2026-10-08T14:00:00+00:00' },
      matching_note: { note: 'Écrire avant de réserver.', updated_at: '2026-10-08T15:00:00+00:00' },
    })
    expect(record?.matchingProfile).toMatchObject({ newClientPlaces: 4, newClientPlacesSetAt: '2026-10-08T14:00:00+00:00' })
    expect(record?.matchingNote).toEqual({ note: 'Écrire avant de réserver.', updatedAt: '2026-10-08T15:00:00+00:00' })
  })

  it('reads the photo\'s stored file id, null without a photo or from a bundle older than the field (A2.1)', () => {
    expect(parseRpc(recordPayload, { ...RECORD_JSON, photo_file_id: 'file-photo' })?.photoFileId).toBe('file-photo')
    expect(parseRpc(recordPayload, { ...RECORD_JSON, photo_file_id: null })?.photoFileId).toBeNull()
    expect(RECORD_JSON).not.toHaveProperty('photo_file_id')
    expect(parseRpc(recordPayload, RECORD_JSON)?.photoFileId).toBeNull()
    expect(() => parseRpc(recordPayload, { ...RECORD_JSON, photo_file_id: 42 })).toThrow(SHAPE_ERROR)
  })

  it('reads the photo in « Mon profil »\'s own record too', () => {
    const own: Record<string, unknown> = { ...RECORD_JSON, photo_file_id: 'file-photo' }
    delete own.readiness
    expect(parseRpc(myRecordPayload, own)?.photoFileId).toBe('file-photo')
  })

  it('ignores columns added by later batches', () => {
    const record = parseRpc(recordPayload, { ...RECORD_JSON, professional: { ...RECORD_JSON.professional, photo_file_id: 'x' } })
    expect(record?.professional).not.toHaveProperty('photo_file_id')
  })

  it('refuses a status the database does not allow', () => {
    expect(() => parseRpc(recordPayload, { ...RECORD_JSON, professional: { ...RECORD_JSON.professional, status: 'pending' } })).toThrow(SHAPE_ERROR)
  })
})

describe('record readiness', () => {
  const withReadiness = (readiness: unknown) => parseRpc(recordPayload, { ...RECORD_JSON, readiness })?.readiness

  it('reads warnings and a complete file', () => {
    expect(
      withReadiness({
        ...READINESS_JSON,
        complete: true,
        done: 1,
        items: [{ key: 'matching_profile', done: true, missing: [] }],
        warnings: ['login_email_mismatch'],
      }),
    ).toMatchObject({ complete: true, done: 1, warnings: ['login_email_mismatch'] })
  })

  it('refuses an unknown gap', () => {
    expect(() => withReadiness({ ...READINESS_JSON, items: [{ key: 'matching_profile', done: false, missing: ['contract'] }] })).toThrow(SHAPE_ERROR)
  })

  it('reads the documents item and its fixed gaps (4c.2)', () => {
    const items = [{ key: 'documents', done: false, missing: ['photo', 'insurance_expired', 'other_documents'] }]
    expect(withReadiness({ ...READINESS_JSON, items })?.items).toEqual(items)
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
      gender: null,
      languageIds: [IDS.fr],
      clienteleIds: [IDS.couples],
      motifIds: [IDS.anxiete],
      acceptingNewClients: true,
      matchingComplete: true,
      ready: true,
      emailMatchesLogin: true,
      createdAt: '2026-10-08T12:00:00+00:00',
      updatedAt: '2026-10-08T12:00:00+00:00',
      insuranceStatus: null,
      insuranceExpiresOn: null,
      // Joined by the list page from list_professional_invitation_states (P4-270).
      onboarding: null,
    })
  })

  it('reads the insurance columns (4c.2) for « À surveiller »', () => {
    const row = parseRpc(listRowPayload, { ...LIST_ROW_JSON, insurance_status: 'expiring', insurance_expires_on: '2026-10-12' })
    expect(row).toMatchObject({ insuranceStatus: 'expiring', insuranceExpiresOn: '2026-10-12' })
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
  it('maps the module settings, the invitation (4b.1) and fiche (P4-353) ones included', () => {
    const json = {
      collect_sin: false,
      invitation_expiry_days: 7,
      invitation_reminder_after_days: 3,
      fiche_show_pro_contact: true,
      fiche_show_clinic_footer: false,
      fiche_show_closing: true,
    }
    expect(parseRpc(settingsPayload, json)).toEqual({
      collectSin: false,
      invitationExpiryDays: 7,
      invitationReminderAfterDays: 3,
      ficheShowProContact: true,
      ficheShowClinicFooter: false,
      ficheShowClosing: true,
    })
    expect(parseRpc(settingsPayload, { ...json, collect_sin: true, invitation_expiry_days: 14, invitation_reminder_after_days: null }).invitationReminderAfterDays).toBeNull()
  })

  it('refuses settings without the invitation or fiche options', () => {
    expect(() => parseRpc(settingsPayload, { collect_sin: false })).toThrow(new Error(SHAPE_ERROR))
    expect(() => parseRpc(settingsPayload, { collect_sin: false, invitation_expiry_days: 7, invitation_reminder_after_days: 3 })).toThrow(new Error(SHAPE_ERROR))
  })
})

describe('onboardingPayload', () => {
  it('maps the record’s onboarding line, null without link or submission', () => {
    expect(
      parseRpc(onboardingPayload, {
        invitation: { state: 'opened', sent_at: '2026-10-08T14:00:00Z', expires_at: '2026-10-15T14:00:00Z', opened_at: '2026-10-09T10:00:00Z', used_at: null },
        submission: { id: 's1', kind: 'onboarding', status: 'draft', submitted_at: null },
        onboarding_approved: false,
      }),
    ).toEqual({
      invitation: { state: 'opened', sentAt: '2026-10-08T14:00:00Z', expiresAt: '2026-10-15T14:00:00Z', openedAt: '2026-10-09T10:00:00Z', usedAt: null, delivery: 'email', emailStatus: null, emailError: null },
      submission: { id: 's1', kind: 'onboarding', status: 'draft', submittedAt: null },
      onboardingApproved: false,
    })
    expect(
      parseRpc(onboardingPayload, {
        invitation: {
          state: 'sent', sent_at: '2026-10-08T14:00:00Z', expires_at: '2026-10-15T14:00:00Z', opened_at: null, used_at: null,
          delivery: 'copied', email_status: null, email_error: null,
        },
        submission: null,
        onboarding_approved: false,
      })?.invitation,
    ).toMatchObject({ delivery: 'copied', emailStatus: null, emailError: null })
    expect(
      parseRpc(onboardingPayload, {
        invitation: { state: 'sent', sent_at: 'x', expires_at: 'x', opened_at: null, used_at: null, delivery: 'email', email_status: 'failed', email_error: 'provider_unavailable' },
        submission: null,
        onboarding_approved: false,
      })?.invitation,
    ).toMatchObject({ delivery: 'email', emailStatus: 'failed', emailError: 'provider_unavailable' })
    expect(parseRpc(onboardingPayload, null)).toBeNull()
    expect(parseRpc(onboardingPayload, { invitation: null, submission: null, onboarding_approved: true })).toEqual({ invitation: null, submission: null, onboardingApproved: true })
  })

  it('refuses a state the UI does not know', () => {
    expect(() => parseRpc(onboardingPayload, { invitation: { state: 'lost', sent_at: 'x', expires_at: 'x', opened_at: null, used_at: null }, submission: null, onboarding_approved: false })).toThrow(SHAPE_ERROR)
  })
})

describe('invitationStateRowPayload', () => {
  const ROW = {
    professional_id: IDS.professional,
    state: null,
    sent_at: null,
    expires_at: null,
    opened_at: null,
    used_at: null,
    submission_id: null,
    submission_kind: null,
    submission_status: null,
    submitted_at: null,
    onboarding_approved: false,
  }

  it('folds the flat row into the onboarding shape', () => {
    expect(parseRpc(invitationStateRowPayload, ROW)).toEqual({ professionalId: IDS.professional, onboarding: { invitation: null, submission: null, onboardingApproved: false } })
    const full = parseRpc(invitationStateRowPayload, {
      ...ROW,
      state: 'sent',
      sent_at: '2026-10-08T14:00:00Z',
      expires_at: '2026-10-15T14:00:00Z',
      submission_id: 's1',
      submission_kind: 'update',
      submission_status: 'submitted',
      submitted_at: '2026-10-09T14:00:00Z',
      onboarding_approved: true,
    })
    expect(full.onboarding).toEqual({
      invitation: { state: 'sent', sentAt: '2026-10-08T14:00:00Z', expiresAt: '2026-10-15T14:00:00Z', openedAt: null, usedAt: null, delivery: 'email', emailStatus: null, emailError: null },
      submission: { id: 's1', kind: 'update', status: 'submitted', submittedAt: '2026-10-09T14:00:00Z' },
      onboardingApproved: true,
    })
  })
})

describe('statusChangePayload (professionals-set-status)', () => {
  it('reads the status, the account change, its profile and whether the sign-in ban followed', () => {
    expect(parseRpc(statusChangePayload, { status: 'active', account_change: null, profile_id: null, signin_synced: true })).toEqual({
      status: 'active',
      accountChange: null,
      profileId: null,
      signinSynced: true,
    })
    expect(parseRpc(statusChangePayload, { status: 'inactive', account_change: 'disabled', profile_id: IDS.admin, signin_synced: false })).toEqual({
      status: 'inactive',
      accountChange: 'disabled',
      profileId: IDS.admin,
      signinSynced: false,
    })
  })

  it('refuses the RPC rows the function used to pass on, or an answer without signin_synced', () => {
    expect(() => parseRpc(statusChangePayload, [{ status: 'active', account_change: null, profile_id: null }])).toThrow(SHAPE_ERROR)
    expect(() => parseRpc(statusChangePayload, { status: 'active', account_change: null, profile_id: null })).toThrow(SHAPE_ERROR)
  })
})

describe('signinSyncPayload (« Réessayer »)', () => {
  it('reads the account status (null without an account) and whether the ban follows it', () => {
    expect(parseRpc(signinSyncPayload, { account_status: 'disabled', signin_synced: true })).toEqual({ accountStatus: 'disabled', signinSynced: true })
    expect(parseRpc(signinSyncPayload, { account_status: null, signin_synced: true })).toEqual({ accountStatus: null, signinSynced: true })
    expect(() => parseRpc(signinSyncPayload, { account_status: 'banned', signin_synced: true })).toThrow(SHAPE_ERROR)
  })
})
