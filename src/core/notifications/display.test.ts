import { afterEach, describe, expect, it } from 'vitest'
import { resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { noticeAge, noticeLinkPath } from './display'

afterEach(() => resetClinicTimezone())

describe('noticeLinkPath', () => {
  it.each(['/professionnels/abc', '/accueil', '/parametres/courriels?onglet=journal#x'])('keeps the app path %s', (path) => {
    expect(noticeLinkPath(path)).toBe(path)
  })

  it.each([null, '', 'https://evil.test/x', '//evil.test', '/\\evil.test', 'professionnels', '/a\tb', 'javascript:alert(1)'])(
    'refuses %s',
    (path) => {
      expect(noticeLinkPath(path)).toBeNull()
    },
  )
})

describe('noticeAge', () => {
  // 2026-10-08 14:30 in the clinic (America/Toronto, EDT).
  const now = Date.parse('2026-10-08T18:30:00Z')

  it('says « À l’instant » under a minute', () => {
    expect(noticeAge('2026-10-08T18:29:31Z', now)).toBe("À l'instant")
    // A clock a little ahead of the server's.
    expect(noticeAge('2026-10-08T18:30:20Z', now)).toBe("À l'instant")
  })

  it('counts minutes, then hours within the same clinic day', () => {
    expect(noticeAge('2026-10-08T18:25:00Z', now)).toBe('il y a 5 min')
    expect(noticeAge('2026-10-08T16:29:00Z', now)).toBe('il y a 2 h')
  })

  // 23:30 on 2026-10-07 in the clinic, 20:30 in the browser's zone (America/Vancouver, the tests' TZ);
  // read at 01:00 on 2026-10-08 in the clinic, still 22:00 on the 7th in Vancouver.
  const lateEvening = '2026-10-08T03:30:00Z'
  const afterMidnight = Date.parse('2026-10-08T05:00:00Z')

  it('counts calendar days in the clinic timezone, not the browser’s', () => {
    expect(noticeAge(lateEvening, afterMidnight)).toBe('Hier')
    expect(noticeAge('2026-10-05T12:00:00Z', now)).toBe('il y a 3 j')
  })

  it('follows the clinic timezone setting', () => {
    setClinicTimezone('America/Vancouver')
    expect(noticeAge(lateEvening, afterMidnight)).toBe('il y a 1 h')
  })

  it('gives the date from a week back', () => {
    expect(noticeAge('2026-10-01T12:00:00Z', now)).toBe('01 oct. 2026')
    expect(noticeAge('2026-09-20T12:00:00Z', now)).toBe('20 sept. 2026')
  })
})
