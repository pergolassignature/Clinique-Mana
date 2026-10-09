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
    expect(noticeAge('2026-10-08T18:25:00Z', now)).toBe('Il y a 5 min')
    expect(noticeAge('2026-10-08T16:29:00Z', now)).toBe('Il y a 2 h')
  })

  // 23:30 on 2026-10-07 in the clinic, 20:30 in the browser's zone (America/Vancouver, the tests' TZ);
  // read at 01:00 on 2026-10-08 in the clinic, still 22:00 on the 7th in Vancouver.
  const lateEvening = '2026-10-08T03:30:00Z'
  const afterMidnight = Date.parse('2026-10-08T05:00:00Z')

  it('counts calendar days in the clinic timezone, not the browser’s', () => {
    expect(noticeAge(lateEvening, afterMidnight)).toBe('Hier')
    expect(noticeAge('2026-10-05T12:00:00Z', now)).toBe('Il y a 3 j')
  })

  it('follows the clinic timezone setting', () => {
    setClinicTimezone('America/Vancouver')
    expect(noticeAge(lateEvening, afterMidnight)).toBe('Il y a 1 h')
  })

  // 2026-11-01: the clinic falls back from EDT to EST at 02:00 (a 25-hour day). The browser's
  // zone (America/Vancouver) falls back three hours later, at 09:00Z.
  describe('on the night clocks fall back', () => {
    it('counts elapsed hours, not wall-clock hours', () => {
      // 00:30 EDT → 03:30 EST: three hours on the wall clock, four elapsed.
      expect(noticeAge('2026-11-01T04:30:00Z', Date.parse('2026-11-01T08:30:00Z'))).toBe('Il y a 4 h')
    })

    it('keeps the 25-hour day one calendar day', () => {
      // 00:10 EDT → 23:50 EST the same day: 24 h 40 elapsed, still today.
      expect(noticeAge('2026-11-01T04:10:00Z', Date.parse('2026-11-02T04:50:00Z'))).toBe('Il y a 24 h')
      // 23:50 EDT on Oct 31 → 23:10 EST on Nov 1: yesterday.
      expect(noticeAge('2026-11-01T03:50:00Z', Date.parse('2026-11-02T04:10:00Z'))).toBe('Hier')
      // 23:50 EDT on Oct 31 → 00:10 EST on Nov 2: two calendar days.
      expect(noticeAge('2026-11-01T03:50:00Z', Date.parse('2026-11-02T05:10:00Z'))).toBe('Il y a 2 j')
    })
  })

  it('gives the date from a week back', () => {
    expect(noticeAge('2026-10-01T12:00:00Z', now)).toBe('1 oct. 2026')
    expect(noticeAge('2026-09-20T12:00:00Z', now)).toBe('20 sept. 2026')
  })
})
