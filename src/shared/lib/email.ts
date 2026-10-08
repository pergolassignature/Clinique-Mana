import { z } from 'zod'

/**
 * The app's one email rule: something, `@`, a host with a dot, no whitespace. The same pattern as
 * the SQL checks (`organizations_email_check`, `organization_bank_details_etransfer_email_check`,
 * `set_bank_details`), so the form never accepts what the database refuses, or the reverse.
 * Deliberately loose: Supabase Auth checks deliverability-shaped rules on its side.
 */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** A required email: trimmed, then checked against EMAIL_PATTERN (`message` when it fails). */
export const emailSchema = (message: string) => z.string().trim().regex(EMAIL_PATTERN, { error: message })
