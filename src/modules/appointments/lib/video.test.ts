import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { fixedLinkError, videoReadiness } from './video'

describe('video readiness (R-55)', () => {
  it('Zoom connected wins, then a Zoom to reconnect, then the fixed link, else none', () => {
    expect(videoReadiness({ zoom_state: 'connected', fixed_url: 'https://x.test' })).toBe('zoom')
    expect(videoReadiness({ zoom_state: 'needs_reconnect', fixed_url: 'https://x.test' })).toBe('reconnect')
    expect(videoReadiness({ zoom_state: 'disconnected', fixed_url: 'https://x.test' })).toBe('fixed')
    expect(videoReadiness({ zoom_state: null, fixed_url: null })).toBe('none')
    expect(videoReadiness(null)).toBe('none')
  })

  it('a fixed link is a full https address of at most 500 characters (the database checks it again)', () => {
    expect(fixedLinkError('')).toBeNull()
    expect(fixedLinkError(' https://meet.google.com/abc-defg-hij ')).toBeNull()
    expect(fixedLinkError('https://teams.microsoft.com/l/meetup-join/19%3a?context=x')).toBeNull()
    expect(fixedLinkError('http://meet.google.com/abc')).toBe(t('modules.appointments.video.fixed.invalid'))
    expect(fixedLinkError('meet.google.com/abc')).toBe(t('modules.appointments.video.fixed.invalid'))
    expect(fixedLinkError('https://user:pw@meet.google.com')).toBe(t('modules.appointments.video.fixed.invalid'))
    expect(fixedLinkError(`https://x.test/${'a'.repeat(500)}`)).toBe(t('modules.appointments.video.fixed.tooLong'))
  })
})
