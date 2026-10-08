import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { invitationsSchema, toInvitationsFormValues } from './invitations'

const V = 'modules.professionals.settings.invitations.validation'
const parse = (expiryDays: string, reminderEnabled: boolean, reminderDays: string) => invitationsSchema.safeParse({ expiryDays, reminderEnabled, reminderDays })
const messages = (result: ReturnType<typeof parse>) => (result.success ? [] : result.error.issues.map((i) => [i.path.join('.'), i.message]))

describe('invitationsSchema', () => {
  it('saves whole days, a reminder switched off as null', () => {
    expect(parse(' 7 ', true, '3')).toMatchObject({ success: true, data: { invitationExpiryDays: 7, invitationReminderAfterDays: 3 } })
    expect(parse('30', false, 'abc')).toMatchObject({ success: true, data: { invitationExpiryDays: 30, invitationReminderAfterDays: null } })
  })

  it.each(['0', '31', '7.5', '', 'sept'])('refuses a lifetime of « %s »', (value) => {
    expect(messages(parse(value, false, '3'))).toEqual([['expiryDays', t(`${V}.expiryRange`)]])
  })

  it('refuses a reminder outside 1–29 days', () => {
    expect(messages(parse('30', true, '0'))).toEqual([['reminderDays', t(`${V}.reminderRange`)]])
    expect(messages(parse('30', true, '30'))).toEqual([['reminderDays', t(`${V}.reminderRange`)]])
  })

  it('refuses a reminder that would leave once the link has expired (P4-308)', () => {
    expect(messages(parse('7', true, '7'))).toEqual([['reminderDays', t(`${V}.reminderBeforeExpiry`, { max: '7' })]])
    expect(parse('7', true, '6').success).toBe(true)
  })
})

describe('toInvitationsFormValues', () => {
  it('keeps a delay ready when the reminder is off, shorter than the lifetime', () => {
    expect(toInvitationsFormValues({ invitationExpiryDays: 7, invitationReminderAfterDays: 4 })).toEqual({ expiryDays: '7', reminderEnabled: true, reminderDays: '4' })
    expect(toInvitationsFormValues({ invitationExpiryDays: 7, invitationReminderAfterDays: null })).toEqual({ expiryDays: '7', reminderEnabled: false, reminderDays: '3' })
    expect(toInvitationsFormValues({ invitationExpiryDays: 2, invitationReminderAfterDays: null }).reminderDays).toBe('1')
  })
})
