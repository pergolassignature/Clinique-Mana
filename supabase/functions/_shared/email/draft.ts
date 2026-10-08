/**
 * The request schema of an unsaved template (« Modèles » editor), shared by
 * `email-preview` and `email-test-send`. Rules as `save_email_template`
 * (Task 3.6): trimmed; subject 1–200 characters on one line, body 1–10 000,
 * button label at most 60, an empty one meaning « no button ». Lengths count
 * characters (code points), as SQL does.
 */
import { z } from 'zod'

/** `email_template_defaults.key`: `<module>.<name>`. */
export const templateKeySchema = z.string().max(100).regex(
  /^[a-z_]+\.[a-z0-9_]+$/,
)

/** Trimmed text of 1 to `max` characters (code points). */
const text = (max: number) =>
  z.string().trim().refine((s) => s.length > 0 && [...s].length <= max)

/** The draft's subject. */
export const draftSubjectSchema = text(200).refine((s) => !/[\r\n]/.test(s))
/** The draft's body. */
export const draftBodySchema = text(10_000)
/** The draft's button label; empty or null → null. */
export const draftButtonSchema = z.string().trim()
  .refine((s) => [...s].length <= 60)
  .nullable()
  .transform((s) => s || null)
