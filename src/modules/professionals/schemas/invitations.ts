import { z } from 'zod'
import { t } from '@/i18n'
import type { ProfessionalsSettings } from '../api/parse'

const V = 'modules.professionals.settings.invitations.validation'

/** The settings' bounds (4b.1's `validate_professionals_setting`): the link lives 1–30 days, the reminder leaves after 1–29. */
const INVITATION_EXPIRY_MAX = 30
export const INVITATION_REMINDER_MAX = 29
/** A reminder switched on with no delay saved yet starts here (4b.1's default). */
const DEFAULT_REMINDER_DAYS = 3

/** The « Invitations » form: whole days as typed (strings), and the reminder's switch. */
type InvitationsFormValues = {
  expiryDays: string
  reminderEnabled: boolean
  reminderDays: string
}

type InvitationsSettingsPatch = Pick<ProfessionalsSettings, 'invitationExpiryDays' | 'invitationReminderAfterDays'>

/** The stored settings as form values; a reminder that is off keeps a delay ready for the switch. */
export function toInvitationsFormValues(settings: InvitationsSettingsPatch): InvitationsFormValues {
  const after = settings.invitationReminderAfterDays
  return {
    expiryDays: String(settings.invitationExpiryDays),
    reminderEnabled: after !== null,
    reminderDays: String(after ?? Math.min(DEFAULT_REMINDER_DAYS, Math.max(1, settings.invitationExpiryDays - 1))),
  }
}

/** A whole number of days within [1, max], or null. */
function days(value: string, max: number): number | null {
  const trimmed = value.trim()
  if (!/^[0-9]{1,3}$/.test(trimmed)) return null
  const n = Number(trimmed)
  return n >= 1 && n <= max ? n : null
}

/**
 * What `set_professionals_settings` checks, before it does: the lifetime 1–30 days; the reminder,
 * when on, 1–29 days and before the link expires (P4-308). A reminder that is off saves null; its
 * delay field is then ignored.
 */
export const invitationsSchema: z.ZodType<InvitationsSettingsPatch, InvitationsFormValues> = z
  .object({ expiryDays: z.string(), reminderEnabled: z.boolean(), reminderDays: z.string() })
  .superRefine((v, ctx) => {
    const expiry = days(v.expiryDays, INVITATION_EXPIRY_MAX)
    if (expiry === null) ctx.addIssue({ code: 'custom', path: ['expiryDays'], message: t(`${V}.expiryRange`) })
    if (!v.reminderEnabled) return
    const reminder = days(v.reminderDays, INVITATION_REMINDER_MAX)
    if (reminder === null) ctx.addIssue({ code: 'custom', path: ['reminderDays'], message: t(`${V}.reminderRange`) })
    else if (expiry !== null && reminder >= expiry) {
      ctx.addIssue({ code: 'custom', path: ['reminderDays'], message: t(`${V}.reminderBeforeExpiry`, { max: String(expiry) }) })
    }
  })
  .transform((v) => ({
    invitationExpiryDays: Number(v.expiryDays.trim()),
    invitationReminderAfterDays: v.reminderEnabled ? Number(v.reminderDays.trim()) : null,
  }))
