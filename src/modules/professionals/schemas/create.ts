import { z } from 'zod'
import { t } from '@/i18n'
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

/**
 * Where a refusal of `create_professional` belongs. The RPC's French messages name their field
 * (« Ce courriel est déjà utilisé. », « Le numéro de permis… », « Ce titre est archivé. »); any
 * other shows above the buttons.
 */
export function createErrorField(message: string): 'email' | 'licenceNumber' | 'titleId' | null {
  if (/courriel/i.test(message)) return 'email'
  if (/\bpermis\b/i.test(message)) return 'licenceNumber'
  if (/\btitre\b/i.test(message)) return 'titleId'
  return null
}
