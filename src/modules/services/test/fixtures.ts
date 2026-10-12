import type { ServicesSettings } from '../api/catalogue'
import type { BillingPolicy, ProfessionTitle, RateVariantRow, Service, ServiceFamily, ServicePrice } from '../api/parse'

/**
 * A small catalogue in the shape the settings page reads (`fetchServicesSettings`,
 * `fetchServicePrices`): two families, three services, two titles, one student rate and one
 * policy, with the seeded grid prices of the psychologist. Test-only.
 */

export const SIDS = {
  familyIndividual: '00000000-0000-4000-8000-000000000101',
  familyAdmin: '00000000-0000-4000-8000-000000000105',
  opening: '00000000-0000-4000-8000-000000000201',
  session50: '00000000-0000-4000-8000-000000000202',
  waitlist: '00000000-0000-4000-8000-000000000203',
  archived: '00000000-0000-4000-8000-000000000204',
  psychologue: '00000000-0000-4000-8000-000000000301',
  sexologue: '00000000-0000-4000-8000-000000000302',
  student: '00000000-0000-4000-8000-000000000401',
  policy: '00000000-0000-4000-8000-000000000501',
} as const

export const FAMILIES: ServiceFamily[] = [
  { id: SIDS.familyIndividual, code: 10, name: 'Individuel', sortOrder: 10 },
  { id: SIDS.familyAdmin, code: 50, name: 'Administratif', sortOrder: 50 },
]

const base: Omit<Service, 'id' | 'familyId' | 'code' | 'key' | 'name'> = {
  description: null,
  kind: 'session',
  durationMinutes: 50,
  bufferAfterMinutes: 10,
  forTwo: false,
  priceSource: 'grid',
  fixedPriceCents: null,
  gridDuration: 50,
  taxRule: 'exempt',
  colour: null,
  isActive: true,
  sortOrder: 0,
  updatedAt: '2026-10-12T19:00:00Z',
}

export const SERVICES: Service[] = [
  {
    ...base,
    id: SIDS.opening,
    familyId: SIDS.familyIndividual,
    code: 10100,
    key: 'ouverture_individuel',
    name: 'Ouverture de dossier – individuel',
    kind: 'fee',
    durationMinutes: 0,
    bufferAfterMinutes: 0,
    priceSource: 'fixed',
    fixedPriceCents: 3783,
    gridDuration: null,
    taxRule: 'taxable',
  },
  { ...base, id: SIDS.session50, familyId: SIDS.familyIndividual, code: 10150, key: 'consultation_50', name: 'Consultation individuelle 50 min' },
  {
    ...base,
    id: SIDS.waitlist,
    familyId: SIDS.familyAdmin,
    code: 50100,
    key: 'inscription_liste_attente',
    name: "Inscription liste d'attente",
    kind: 'admin',
    durationMinutes: 0,
    bufferAfterMinutes: 0,
    priceSource: 'fixed',
    fixedPriceCents: 1891,
    gridDuration: null,
    taxRule: 'taxable',
  },
  {
    ...base,
    id: SIDS.archived,
    familyId: SIDS.familyAdmin,
    code: 50999,
    key: 'ancien_service',
    name: 'Ancien service',
    kind: 'admin',
    durationMinutes: 0,
    bufferAfterMinutes: 0,
    priceSource: 'entered',
    gridDuration: null,
    isActive: false,
  },
]

export const TITLES: ProfessionTitle[] = [
  { id: SIDS.psychologue, key: 'psychologue', name: 'Psychologue', sortOrder: 1 },
  { id: SIDS.sexologue, key: 'sexologue', name: 'Sexologue', sortOrder: 2 },
]

export const VARIANTS: RateVariantRow[] = [
  {
    id: SIDS.student,
    serviceId: SIDS.session50,
    variant: 'student',
    titleId: SIDS.psychologue,
    discountKind: 'price',
    amountCents: 12000,
    percent: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    createdAt: '2026-10-01T12:00:00Z',
  },
]

export const POLICIES: BillingPolicy[] = [
  {
    id: SIDS.policy,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    lateNoticeHours: 24,
    firstFeePercent: 50,
    nextFeePercent: 100,
    fileOpeningServiceId: SIDS.opening,
    feeMode: 'confirm',
    createdAt: '2026-10-01T12:00:00Z',
  },
]

export function servicesSettings(overrides: Partial<ServicesSettings> = {}): ServicesSettings {
  return {
    families: FAMILIES,
    services: SERVICES,
    titleIdsByService: new Map([[SIDS.session50, [SIDS.psychologue, SIDS.sexologue]]]),
    variants: VARIANTS,
    policies: POLICIES,
    titles: TITLES,
    ...overrides,
  }
}

/** `list_service_prices` today: the psychologist at 175 $ (student 120 $), the sexologist without a grid. */
export const PRICES: ServicePrice[] = [
  { serviceId: SIDS.opening, titleId: null, priceCents: 3783, studentPriceCents: null, reducedPriceCents: null, taxRule: 'taxable', source: 'fixed' },
  { serviceId: SIDS.session50, titleId: SIDS.psychologue, priceCents: 17500, studentPriceCents: 12000, reducedPriceCents: null, taxRule: 'exempt', source: 'grid' },
  { serviceId: SIDS.session50, titleId: SIDS.sexologue, priceCents: null, studentPriceCents: null, reducedPriceCents: null, taxRule: 'exempt', source: 'grid' },
  { serviceId: SIDS.waitlist, titleId: null, priceCents: 1891, studentPriceCents: null, reducedPriceCents: null, taxRule: 'taxable', source: 'fixed' },
]
