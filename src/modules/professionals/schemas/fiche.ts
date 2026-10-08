import { z } from 'zod'
import { t } from '@/i18n'
import { EMAIL_PATTERN } from '@/shared/lib/email'
import { withoutControlChars } from '@/shared/lib/field-schemas'

/** The longest message `professionals-fiche` takes. */
export const FICHE_MESSAGE_MAX = 1_000

/**
 * What a message never carries (the function refuses it): control characters but the tab and line
 * breaks, the line and paragraph separators, the bidirectional controls. Invisible when pasted, so
 * they are removed rather than refused.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

const S = 'modules.professionals.fiche.send'

/** « Envoyer par courriel » (Task 4c.5): the client's address, an optional message, the title when there are two. */
export const sendFicheSchema = z.object({
  to: withoutControlChars(
    z
      .string()
      .min(1, { error: t(`${S}.emailRequired`) })
      .max(254, { error: t(`${S}.invalidEmail`) })
      .regex(EMAIL_PATTERN, { error: t(`${S}.invalidEmail`) }),
  ),
  message: z
    .string()
    .transform((m) => m.replace(INVISIBLE, '').trim())
    .pipe(z.string().max(FICHE_MESSAGE_MAX, { error: t(`${S}.messageTooLong`, { max: String(FICHE_MESSAGE_MAX) }) })),
  titleId: z.string().nullable(),
})

export type SendFicheValues = z.input<typeof sendFicheSchema>
export type SendFicheInput = z.output<typeof sendFicheSchema>
