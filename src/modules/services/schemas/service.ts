import { z } from 'zod'
import { t } from '@/i18n'
import type { ServiceInput } from '../api/catalogue'
import type { Service, ServiceFamily } from '../api/parse'
import { PRICE_SOURCES, SERVICE_KINDS, TAX_RULES, type PriceSource, type ServiceKind, type TaxRule } from '../lib/constants'
import { centsInput, parseDollars } from '../lib/format'
import { tidyText } from './text'

/**
 * The service sheet's form (plan S3.2), mirroring `save_service`: a five-digit code inside its
 * family's range, a key of lower-case letters, digits and `_`, a tidy name (120) and description
 * (1 000), durations 0–480 and 0–120, a fixed price 0,01 $ to 10 000 $ when the source is
 * `fixed`, the grid's column when it is `grid`, a hex colour or none. The key, the code and the
 * family are typed once (`locked` on an existing service). The database stays authoritative;
 * its refusals carry a HINT naming the field.
 */

const V = 'modules.services.validation'

export interface ServiceFormValues {
  familyId: string
  code: string
  key: string
  name: string
  description: string
  kind: ServiceKind
  durationMinutes: string
  bufferAfterMinutes: string
  forTwo: boolean
  priceSource: PriceSource
  fixedPrice: string
  gridDuration: string
  taxRule: TaxRule
  colour: string
  sortOrder: string
  titleIds: string[]
}

/** The sheet's output: what `save_service` takes, plus the titles. */
export type ServiceFormOutput = Omit<ServiceInput, 'id'> & { titleIds: string[] }

const wholeNumber = (min: number, max: number, message: string) =>
  z.string().transform((v, ctx) => {
    const compact = v.replace(/\s/g, '')
    if (!/^[0-9]+$/.test(compact) || Number(compact) < min || Number(compact) > max) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return Number(compact)
  })

/** The keys and codes already used by other services (NFKC is not needed: both are ASCII). */
export interface ServiceSchemaContext {
  families: readonly ServiceFamily[]
  /** Every other service (archived ones included): a code or a key already taken is refused. */
  others: readonly Service[]
}

export function serviceSchema({ families, others }: ServiceSchemaContext) {
  return z
    .object({
      familyId: z.string().min(1, { error: t(`${V}.family`) }),
      code: wholeNumber(10000, 89999, t(`${V}.code`)),
      key: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{0,49}$/, { error: t(`${V}.key`) }),
      name: tidyText({ max: 120, requiredMessage: t(`${V}.name`) }),
      description: tidyText({ max: 1000 }),
      kind: z.enum(SERVICE_KINDS, { error: t(`${V}.kind`) }),
      durationMinutes: wholeNumber(0, 480, t(`${V}.duration`)),
      bufferAfterMinutes: wholeNumber(0, 120, t(`${V}.buffer`)),
      forTwo: z.boolean(),
      priceSource: z.enum(PRICE_SOURCES, { error: t(`${V}.priceSource`) }),
      fixedPrice: z.string(),
      gridDuration: z.string(),
      taxRule: z.enum(TAX_RULES, { error: t(`${V}.taxRule`) }),
      colour: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(#[0-9a-f]{6})?$/, { error: t(`${V}.colour`) }),
      sortOrder: wholeNumber(0, 100000, t(`${V}.sortOrder`)),
      titleIds: z.array(z.string()),
    })
    .superRefine((values, ctx) => {
      const family = families.find((f) => f.id === values.familyId)
      if (family && Math.floor(values.code / 1000) !== family.code) {
        ctx.addIssue({ code: 'custom', path: ['code'], message: t(`${V}.codeFamily`, { from: `${family.code} 000`, to: `${family.code} 999` }) })
      }
      if (others.some((s) => s.code === values.code)) ctx.addIssue({ code: 'custom', path: ['code'], message: t(`${V}.codeTaken`) })
      if (others.some((s) => s.key === values.key)) ctx.addIssue({ code: 'custom', path: ['key'], message: t(`${V}.keyTaken`) })
      if (values.priceSource === 'fixed') {
        const cents = parseDollars(values.fixedPrice)
        if (cents === null || cents < 1 || cents > 1_000_000) ctx.addIssue({ code: 'custom', path: ['fixedPrice'], message: t(`${V}.fixedPrice`) })
      }
      if (values.priceSource === 'grid' && !['60', '50', '30'].includes(values.gridDuration)) {
        ctx.addIssue({ code: 'custom', path: ['gridDuration'], message: t(`${V}.gridDuration`) })
      }
    })
    .transform(
      (values): ServiceFormOutput => ({
        familyId: values.familyId,
        code: values.code,
        key: values.key,
        name: values.name,
        description: values.description,
        kind: values.kind,
        durationMinutes: values.durationMinutes,
        bufferAfterMinutes: values.bufferAfterMinutes,
        forTwo: values.forTwo,
        priceSource: values.priceSource,
        fixedPriceCents: values.priceSource === 'fixed' ? parseDollars(values.fixedPrice) : null,
        gridDuration: values.priceSource === 'grid' ? (Number(values.gridDuration) as 60 | 50 | 30) : null,
        taxRule: values.taxRule,
        colour: values.colour === '' ? null : values.colour,
        sortOrder: values.sortOrder,
        titleIds: values.titleIds,
      }),
    )
}

/** A new service's form: the family and the code are typed; a session has a 10 min pause after by default (R-13). */
export function emptyServiceForm(familyId = ''): ServiceFormValues {
  return {
    familyId,
    code: '',
    key: '',
    name: '',
    description: '',
    kind: 'session',
    durationMinutes: '50',
    bufferAfterMinutes: '10',
    forTwo: false,
    priceSource: 'grid',
    fixedPrice: '',
    gridDuration: '50',
    taxRule: 'exempt',
    colour: '',
    sortOrder: '0',
    titleIds: [],
  }
}

/** An existing service as its form values. */
export function serviceFormValues(service: Service, titleIds: readonly string[]): ServiceFormValues {
  return {
    familyId: service.familyId,
    code: String(service.code),
    key: service.key,
    name: service.name,
    description: service.description ?? '',
    kind: service.kind,
    durationMinutes: String(service.durationMinutes),
    bufferAfterMinutes: String(service.bufferAfterMinutes),
    forTwo: service.forTwo,
    priceSource: service.priceSource,
    fixedPrice: service.fixedPriceCents === null ? '' : centsInput(service.fixedPriceCents),
    gridDuration: service.gridDuration === null ? '' : String(service.gridDuration),
    taxRule: service.taxRule,
    colour: service.colour ?? '',
    sortOrder: String(service.sortOrder),
    titleIds: [...titleIds].sort(),
  }
}
