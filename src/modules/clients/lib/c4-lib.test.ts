import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { CIDS, REFERENCE, clientFixture, summaryFixture } from '../test/fixtures'
import { buildPrivacyContent, toWinAnsi } from '../pdf/privacy-content'
import { toSearchResult } from '../search'
import { groupByDay, readable } from './history'
import { chosenTakes, mergeMoves, mergeRows } from './merge'
import { fromRememberedFilters, toRememberedFilters } from './remembered-filters'

describe('the merge comparison', () => {
  // A file created in the app holds a province (« QC ») without an address.
  const kept = clientFixture({ email: 'alice@exemple.test', birthday: null, mobile: '+15145550101', addressLine1: null, city: null, postalCode: null, province: 'QC' })
  const merged = clientFixture({ id: CIDS.marc, email: 'alicia@exemple.test', birthday: '1990-03-04', mobile: '+15145550101', addressLine1: '1 rue Test', city: 'Laval', postalCode: 'H7A 1A1' })

  it('a choice where both differ, the merged value taken where the kept file has none, nothing where they agree', () => {
    const rows = mergeRows(kept, merged, REFERENCE)
    expect(rows.find((r) => r.key === 'email')).toMatchObject({ choice: true, kept: 'alice@exemple.test', merged: 'alicia@exemple.test' })
    expect(rows.find((r) => r.key === 'birthday')).toMatchObject({ choice: false, kept: null })
    expect(rows.find((r) => r.key === 'address')).toMatchObject({ choice: false, take: 'address' })
    expect(rows.find((r) => r.key === 'mobile')).toBeUndefined()
  })

  it('sends the keys of the values the person took, and the address the kept file lacks (never a value)', () => {
    const rows = mergeRows(kept, merged, REFERENCE)
    expect(chosenTakes(rows, new Set())).toEqual(['address'])
    expect(chosenTakes(rows, new Set(['email', 'birthday']))).toEqual(['email', 'address'])
  })

  it('compares ids, not names: two retired sources are not the same one', () => {
    const rows = mergeRows(clientFixture({ referralSourceId: 'gone-1' }), clientFixture({ referralSourceId: 'gone-2' }), REFERENCE)
    expect(rows.find((r) => r.key === 'referralSourceId')).toMatchObject({ choice: true, take: 'referral_source_id' })
  })

  it('lists what moves, counts only', () => {
    expect(mergeMoves(summaryFixture()).map((m) => [m.key.split('.').at(-1), m.count])).toEqual([
      ['relations', 1],
      ['tags', 1],
      ['professionals', 1],
    ])
  })
})

describe('the remembered filters', () => {
  it('keeps the URL filters, never the search words; nothing narrows → forgotten', () => {
    expect(toRememberedFilters(new URLSearchParams('statut=archives&q=Tremblay&professionnel=p1'))).toEqual({ query: 'statut=archives&professionnel=p1' })
    expect(toRememberedFilters(new URLSearchParams('q=Tremblay'))).toBeNull()
    expect(fromRememberedFilters({ query: 'etiquette=t1&q=x' })?.toString()).toBe('etiquette=t1')
    expect(fromRememberedFilters({ query: 42 })).toBeNull()
    expect(fromRememberedFilters(null)).toBeNull()
  })
})

describe('the Loi 25 export', () => {
  it('prints every section in French, a section without rows as « Aucun », the merged files after', () => {
    const content = buildPrivacyContent(
      { summary: summaryFixture(), mergedFiles: [summaryFixture({ client: clientFixture({ clientNumber: 9, firstName: 'Alicia' }) })], consents: [], exportedAt: '2026-10-13T15:00:00Z' },
      REFERENCE,
      'Clinique MANA (local)',
    )
    expect(content.subtitle).toBe('Alice Tremblay · CLI-000001')
    const identity = content.sections[0]?.groups[0] ?? []
    expect(identity).toContainEqual({ label: t('modules.clients.fields.firstName'), value: 'Alice' })
    expect(identity).toContainEqual({ label: t('modules.clients.fields.birthFirstName'), value: t('modules.clients.privacy.pdf.notGiven') })
    expect(content.sections.find((s) => s.title === t('modules.clients.privacy.pdf.consents'))?.groups).toEqual([])
    expect(content.merged[0]?.heading).toContain('Alicia Tremblay (CLI-000009)')
  })

  it('draws in Helvetica: thin spaces become spaces, another script « ? »', () => {
    expect(toWinAnsi('12 $ – « Élise » œ')).toBe('12 $ – « Élise » œ')
    expect(toWinAnsi('李')).toBe('?')
  })
})

describe('⌘K and the history', () => {
  it('a search row as the palette shows it', () => {
    expect(toSearchResult({ id: CIDS.alice, clientNumber: 1, name: 'Alice Tremblay', birthday: '1990-03-04', email: null, mobile: null, isArchived: true })).toMatchObject({
      title: 'Alice Tremblay',
      href: `/clients/${CIDS.alice}/apercu`,
      badge: { label: t('modules.clients.record.archived') },
    })
  })

  it('leaves ids and timestamps out of the details (names the professional, source and tag ones); groups by clinic day, newest first', () => {
    const entry = { id: 2, created_at: '2026-10-13T15:00:00Z', table_name: 'clients', record_id: 'x', action: 'update', changed_fields: { city: { before: 'A', after: 'B' }, updated_at: { before: 1, after: 2 }, referral_source_id: { before: null, after: 'y' } }, actor_id: null, actor_name: null, actor_role: null, source: 'app' }
    expect(readable(entry).changed_fields).toEqual({ city: { before: 'A', after: 'B' }, referral_source_id: { before: null, after: 'y' } })
    expect(readable(entry, new Map([['y', 'Google']])).changed_fields).toMatchObject({ referral_source_id: { after: 'Google' } })
    const days = groupByDay([entry, { ...entry, id: 1, created_at: '2026-10-13T14:00:00Z' }, { ...entry, id: 0, created_at: '2026-10-11T14:00:00Z' }])
    expect(days.map((d) => d.entries.map((e) => e.id))).toEqual([[2, 1], [0]])
  })
})
