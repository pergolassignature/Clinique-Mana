import { describe, expect, it } from 'vitest'
import {
  changedFields,
  comparableName,
  confirmPayload,
  effectiveSection,
  incompleteSections,
  nameMatches,
  nextMarch31,
  sameValue,
  sectionComplete,
  sectionKeys,
  sectionsToConfirm,
  stepFromSlug,
  stepsFor,
  SUBMISSION_SECTIONS,
  type CompletenessContext,
} from './questionnaire'

const ctx = (over: Partial<CompletenessContext> = {}): CompletenessContext => ({
  answered: {},
  privateRow: null,
  onFilePrivate: null,
  onFile: { hasSin: false, hasBankAccount: false },
  collectSin: false,
  consentId: 'consent-v1',
  today: '2026-10-08',
  ...over,
})

describe('steps', () => {
  it('lists the eleven sections in the database order, with no approaches', () => {
    expect(SUBMISSION_SECTIONS).toEqual([
      'personal', 'professional', 'portrait', 'languages', 'clienteles', 'motifs', 'availability', 'photo', 'insurance', 'tax_bank', 'consent',
    ])
  })

  it('shows only the requested sections, in order, then « Révision »', () => {
    expect(stepsFor(['motifs', 'personal'])).toEqual(['personal', 'motifs', 'review'])
    expect(stepsFor([...SUBMISSION_SECTIONS])).toHaveLength(12)
  })

  it('reads a step from its French slug, among the steps shown only', () => {
    const steps = stepsFor(['personal', 'tax_bank'])
    expect(stepFromSlug('fiscalite-et-banque', steps)).toBe('tax_bank')
    expect(stepFromSlug('motifs', steps)).toBeNull()
    expect(stepFromSlug(null, steps)).toBeNull()
  })
})

describe('what is sent', () => {
  it('overlays the answers on the prefill', () => {
    expect(effectiveSection({ personal: { city: 'Laval', province: 'QC' } }, { personal: { city: 'Montréal' } }, 'personal')).toEqual({
      city: 'Montréal',
      province: 'QC',
    })
  })

  it('compares answers whatever the key order, null and missing alike', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(sameValue(null, undefined)).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('autosaves only the fields that differ from what the section holds, never the prefill as is', () => {
    const current = { personal_phone: '+15145551234', city: 'Laval', address_line2: null }
    expect(changedFields({ personal_phone: '+15145551234', city: 'Montréal', address_line2: null }, current)).toEqual({ city: 'Montréal' })
    expect(changedFields({ personal_phone: '+15145551234' }, current)).toEqual({})
  })

  it('« Continuer » adds the required fields never answered, with the value shown (P4-330)', () => {
    const prefill = { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1', address_line2: null }
    // Nothing answered yet, nothing changed: every required field is confirmed, the optional line 2 is not.
    expect(confirmPayload('personal', prefill, prefill, undefined)).toEqual({
      personal_phone: '+15145551234',
      address_line1: '1 rue A',
      city: 'Laval',
      province: 'QC',
      postal_code: 'H7A 1A1',
    })
    // Already answered: only what changed.
    expect(confirmPayload('personal', { ...prefill, city: 'Montréal' }, prefill, prefill)).toEqual({ city: 'Montréal' })
    expect(confirmPayload('personal', prefill, prefill, prefill)).toBeNull()
  })

  it('never confirms an empty required field (the database would count it as missing)', () => {
    expect(confirmPayload('portrait', { bio: null, approach: null }, {}, undefined)).toBeNull()
  })

  it('saves availability once even unchanged, so the step counts as seen', () => {
    expect(confirmPayload('availability', { accepting_new_clients: true }, { accepting_new_clients: true }, undefined)).toEqual({})
    expect(confirmPayload('availability', { accepting_new_clients: true }, { accepting_new_clients: true }, {})).toBeNull()
  })

  it('confirms a prefilled set the picker never opened', () => {
    expect(confirmPayload('languages', { language_ids: ['fr'] }, { language_ids: ['fr'] }, undefined)).toEqual({ language_ids: ['fr'] })
    expect(confirmPayload('languages', { language_ids: [] }, { language_ids: [] }, undefined)).toEqual({ language_ids: [] })
  })
})

describe('completeness (private.submission_gaps, P4-173)', () => {
  it('counts answers only, not the prefill', () => {
    expect(sectionComplete('personal', ctx())).toBe(false)
    const personal = { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' }
    expect(sectionComplete('personal', ctx({ answered: { personal } }))).toBe(true)
    expect(sectionComplete('personal', ctx({ answered: { personal: { ...personal, city: null } } }))).toBe(false)
  })

  it('needs one item in each set, a title and a presentation', () => {
    expect(sectionComplete('professional', ctx({ answered: { professional: { professions: [] } } }))).toBe(false)
    expect(sectionComplete('professional', ctx({ answered: { professional: { professions: [{ title_id: 't' }] } } }))).toBe(true)
    expect(sectionComplete('portrait', ctx({ answered: { portrait: { bio: 'Bonjour' } } }))).toBe(true)
    expect(sectionComplete('languages', ctx({ answered: { languages: { language_ids: ['fr'] } } }))).toBe(true)
    expect(sectionComplete('clienteles', ctx({ answered: { clienteles: { min_client_age: 8 } } }))).toBe(false)
    expect(sectionComplete('motifs', ctx({ answered: { motifs: { motif_ids: ['m'] } } }))).toBe(true)
  })

  it('needs availability saved once, even empty', () => {
    expect(sectionComplete('availability', ctx())).toBe(false)
    expect(sectionComplete('availability', ctx({ answered: { availability: {} } }))).toBe(true)
  })

  it('needs the files, and an insurance not expired (clinic date)', () => {
    expect(sectionComplete('photo', ctx({ answered: { photo: { file_id: 'f' } } }))).toBe(true)
    expect(sectionComplete('photo', ctx({ answered: { photo: { file_id: null } } }))).toBe(false)
    expect(sectionComplete('insurance', ctx({ answered: { insurance: { file_id: 'f', expires_on: '2027-03-31' } } }))).toBe(true)
    expect(sectionComplete('insurance', ctx({ answered: { insurance: { file_id: 'f', expires_on: '2026-10-08' } } }))).toBe(true)
    expect(sectionComplete('insurance', ctx({ answered: { insurance: { file_id: 'f', expires_on: '2026-10-07' } } }))).toBe(false)
    expect(sectionComplete('insurance', ctx({ answered: { insurance: { expires_on: '2027-03-31' } } }))).toBe(false)
  })

  it('needs the private step saved, institution and transit and an account (entered or on file), the SIN while collected', () => {
    const row = { bankInstitution: '815', bankTransit: '30000', bankAccountLast4: '4567', sinLast3: null }
    expect(sectionComplete('tax_bank', ctx())).toBe(false)
    expect(sectionComplete('tax_bank', ctx({ privateRow: row }))).toBe(true)
    expect(sectionComplete('tax_bank', ctx({ privateRow: row, collectSin: true }))).toBe(false)
    expect(sectionComplete('tax_bank', ctx({ privateRow: row, collectSin: true, onFile: { hasSin: true, hasBankAccount: false } }))).toBe(true)
    const kept = { bankInstitution: null, bankTransit: null, bankAccountLast4: null, sinLast3: null }
    expect(sectionComplete('tax_bank', ctx({ privateRow: kept, onFile: { hasSin: false, hasBankAccount: true } }))).toBe(false)
    expect(
      sectionComplete('tax_bank', ctx({ privateRow: kept, onFile: { hasSin: false, hasBankAccount: true }, onFilePrivate: { bankInstitution: '815', bankTransit: '30000' } })),
    ).toBe(true)
  })

  it('needs the latest published consent signed', () => {
    expect(sectionComplete('consent', ctx({ answered: { consent: { consent_version_id: 'consent-v1' } } }))).toBe(true)
    expect(sectionComplete('consent', ctx({ answered: { consent: { consent_version_id: 'consent-v0' } } }))).toBe(false)
    expect(sectionComplete('consent', ctx({ consentId: null, answered: { consent: { consent_version_id: 'consent-v1' } } }))).toBe(false)
  })

  it('lists the requested sections still incomplete, in order', () => {
    expect(incompleteSections(['consent', 'availability', 'personal'], ctx({ answered: { availability: {} } }))).toEqual(['personal', 'consent'])
  })

  it('names the sections only prefilled and never confirmed (« À confirmer », P4-330)', () => {
    const personal = { personal_phone: '+15145551234', address_line1: '1 rue A', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' }
    const prefill = { personal, portrait: { bio: null }, languages: { language_ids: ['fr'] } }
    // personal and languages would be complete as shown; portrait's prefill is empty; motifs has none.
    expect(sectionsToConfirm(['personal', 'portrait', 'languages', 'motifs'], prefill, ctx())).toEqual(['personal', 'languages'])
    // Once answered, a section is complete, not « à confirmer ».
    expect(sectionsToConfirm(['personal', 'languages'], prefill, ctx({ answered: { personal } }))).toEqual(['languages'])
    // A prefill overlaid with an answer that empties a required field is to complete.
    expect(sectionsToConfirm(['personal'], prefill, ctx({ answered: { personal: { city: '' } } }))).toEqual([])
  })

  it('reads a `sections` refusal, known keys only', () => {
    expect(sectionKeys(['photo', 'personal', 'approaches'])).toEqual(['personal', 'photo'])
    expect(sectionKeys('personal')).toEqual([])
  })
})

describe('insurance and consent', () => {
  it('proposes the next March 31', () => {
    expect(nextMarch31('2026-10-08')).toBe('2027-03-31')
    expect(nextMarch31('2027-01-15')).toBe('2027-03-31')
    expect(nextMarch31('2027-03-31')).toBe('2028-03-31')
  })

  it('compares the typed name with the file’s, accents, case and spaces aside', () => {
    expect(nameMatches('  felix   GAUTHIER ', 'Félix', 'Gauthier')).toBe(true)
    expect(nameMatches('Félix Gauthie', 'Félix', 'Gauthier')).toBe(false)
    expect(nameMatches('', 'Félix', 'Gauthier')).toBe(false)
    expect(comparableName('Hélène  Côté-Lœuvre')).toBe('helene cote-loeuvre')
  })

  it('folds what unaccent folds and decomposition does not (ß, Ł, Ø, Æ, Đ, Þ, ’…), as the database checks it', () => {
    // The same string and result as 053_professionals_questionnaire_consent_answer.test.sql.
    expect(comparableName('ß ẞ Ł Ø Đ Ħ ı Ŀ Ŋ Œ Æ Þ Ð ĸ ſ Ĳ ŉ Ŧ ’ é Ç ü')).toBe("ss ss l o d h i l n oe ae th d q s ij 'n t ' e c u")
    expect(nameMatches('lukasz oster', 'Łukasz', 'Øster')).toBe(true)
    expect(nameMatches('Anna Strauss', 'Anna', 'Strauß')).toBe(true)
    expect(nameMatches("Siobhan O'Brien", 'Siobhán', 'O’Brien')).toBe(true)
    expect(nameMatches('Dorte Aero', 'Dorte', 'Ærø')).toBe(true)
    expect(nameMatches('Thora Dottir', 'Þóra', 'Dóttir')).toBe(true)
    expect(nameMatches('Lukas Oster', 'Łukasz', 'Øster')).toBe(false)
  })
})
