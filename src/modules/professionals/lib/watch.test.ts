import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { recordWatchSubject, watchFlags, type WatchSubject } from './watch'
import { listRowFixture, recordFixture } from '../test/fixtures-domain'

const subject = (overrides: Partial<WatchSubject> = {}): WatchSubject => ({ status: 'active', matchingComplete: true, emailMatchesLogin: true, ...overrides })

describe('watchFlags', () => {
  it.each<[string, Partial<WatchSubject>, string[]]>([
    ['nothing to report', {}, []],
    ['incomplete matching profile', { matchingComplete: false }, ['matching_incomplete']],
    ['login email differs', { emailMatchesLogin: false }, ['login_email_mismatch']],
    ['both, matching first', { matchingComplete: false, emailMatchesLogin: false }, ['matching_incomplete', 'login_email_mismatch']],
    ['an inactive file is not watched', { status: 'inactive', matchingComplete: false, emailMatchesLogin: false }, []],
    ['a draft is watched', { status: 'draft', matchingComplete: false }, ['matching_incomplete']],
  ])('%s', (_, overrides, keys) => {
    expect(watchFlags(subject(overrides)).map((f) => f.key)).toEqual(keys)
  })

  it('labels and tones the flags', () => {
    expect(watchFlags(subject({ matchingComplete: false }))).toEqual([
      { key: 'matching_incomplete', label: t('modules.professionals.watch.matching_incomplete'), tone: 'muted' },
    ])
  })

  it('reads a list row as is', () => {
    expect(watchFlags(listRowFixture({ matchingComplete: false })).map((f) => f.key)).toEqual(['matching_incomplete'])
  })
})

describe('recordWatchSubject', () => {
  it('reads the record’s readiness item and warnings', () => {
    const record = recordFixture()
    expect(recordWatchSubject(record)).toEqual({ status: 'draft', matchingComplete: false, emailMatchesLogin: true })
    const complete = {
      ...record,
      readiness: { ...record.readiness, items: [{ key: 'matching_profile' as const, done: true, missing: [] }], warnings: ['login_email_mismatch' as const] },
    }
    expect(recordWatchSubject(complete)).toEqual({ status: 'draft', matchingComplete: true, emailMatchesLogin: false })
  })
})
