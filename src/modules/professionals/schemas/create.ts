import { z } from 'zod'
import { t } from '@/i18n'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import type { CatalogView } from '../lib/catalog-view'
import type { NewProfessional } from '../api/record'
import { checkLicence, licenceNumberField } from './professions'
import { loginEmailField } from './contact'
import { personNameField } from './identity'

/**
 * « Ajouter un professionnel » (design §5.2, P4-35), as `create_professional` checks it: names,
 * the login email (lower-cased), an optional title, and its licence: required when the title has
 * an order, in that order's format. A licence without a title is dropped (the RPC refuses it).
 * The title select lists active titles only; an archived one (a stale draft) is refused.
 */
export function createProfessionalSchema(catalog: CatalogView) {
  return z
    .object({
      firstName: personNameField(t('modules.professionals.validation.firstNameRequired')),
      lastName: personNameField(t('modules.professionals.validation.lastNameRequired')),
      email: loginEmailField(),
      titleId: z.string().transform((v) => (v === '' ? null : v)),
      licenceNumber: licenceNumberField(),
    })
    .superRefine((v, ctx) => {
      if (v.titleId === null) return
      if (catalog.byId.titles.get(v.titleId)?.isActive === false) {
        ctx.addIssue({ code: 'custom', path: ['titleId'], message: t('modules.professionals.validation.titleArchived') })
      }
      checkLicence(catalog, v.titleId, v.licenceNumber, ctx, ['licenceNumber'])
    })
    .transform((v): NewProfessional => ({ ...v, licenceNumber: v.titleId === null ? null : v.licenceNumber }))
}
export type CreateProfessionalValues = z.input<ReturnType<typeof createProfessionalSchema>>

export const CREATE_PROFESSIONAL_DEFAULTS: CreateProfessionalValues = { firstName: '', lastName: '', email: '', titleId: '', licenceNumber: '' }

/** The HINT of a `create_professional` refusal → the field it is about (migration `…_professionals_core.sql`). */
const FIELD_BY_HINT = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  title: 'titleId',
  licence: 'licenceNumber',
} as const satisfies Record<string, keyof CreateProfessionalValues>
type CreateErrorField = (typeof FIELD_BY_HINT)[keyof typeof FIELD_BY_HINT]

/**
 * Where a refusal of `create_professional` belongs: the field its HINT names (P0001 only, the
 * messages users read), else null (above the buttons). Never by the wording: « Le prénom contient
 * des caractères invisibles ou non permis. » says « permis » and is about the first name.
 */
export function createErrorField(error: unknown): CreateErrorField | null {
  if (rpcErrorCode(error) !== 'P0001') return null
  const hint = rpcErrorHint(error)
  return hint !== undefined && Object.hasOwn(FIELD_BY_HINT, hint) ? FIELD_BY_HINT[hint as keyof typeof FIELD_BY_HINT] : null
}
