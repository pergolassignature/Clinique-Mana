import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { FAMILIES, SERVICES, SIDS } from '../test/fixtures'
import { emptyServiceForm, serviceFormValues, serviceSchema, type ServiceFormValues } from './service'

const V = 'modules.services.validation'
const schema = serviceSchema({ families: FAMILIES, others: SERVICES })

const valid = (overrides: Partial<ServiceFormValues> = {}): ServiceFormValues => ({
  ...emptyServiceForm(SIDS.familyIndividual),
  code: '10 160',
  key: 'consultation_60',
  name: '  Consultation   individuelle 60 min ',
  ...overrides,
})

/** The first message per field. */
function errors(values: ServiceFormValues): Record<string, string> {
  const result = schema.safeParse(values)
  if (result.success) return {}
  const out: Record<string, string> = {}
  for (const issue of result.error.issues) out[issue.path.join('.')] ??= issue.message
  return out
}

describe('serviceSchema', () => {
  it('turns a valid form into what save_service takes (spaces, tidy name, grid column)', () => {
    const result = schema.parse(valid({ colour: '#1A2B3C' }))
    expect(result).toMatchObject({
      familyId: SIDS.familyIndividual,
      code: 10160,
      key: 'consultation_60',
      name: 'Consultation individuelle 60 min',
      description: null,
      durationMinutes: 50,
      bufferAfterMinutes: 10,
      priceSource: 'grid',
      gridDuration: 50,
      fixedPriceCents: null,
      colour: '#1a2b3c',
      titleIds: [],
    })
  })

  it('keeps the code inside its family and refuses a code or key taken by another service', () => {
    expect(errors(valid({ code: '50160' })).code).toBe(t(`${V}.codeFamily`, { from: '10 000', to: '10 999' }))
    expect(errors(valid({ code: '10150' })).code).toBe(t(`${V}.codeTaken`))
    expect(errors(valid({ key: 'consultation_50' })).key).toBe(t(`${V}.keyTaken`))
    expect(errors(valid({ key: 'Consultation-50' })).key).toBe(t(`${V}.key`))
    expect(errors(valid({ code: '9999' })).code).toBe(t(`${V}.code`))
  })

  it('asks the fixed price for a fixed source and the column for a grid source; drops them otherwise', () => {
    expect(errors(valid({ priceSource: 'fixed', fixedPrice: '' })).fixedPrice).toBe(t(`${V}.fixedPrice`))
    expect(errors(valid({ priceSource: 'fixed', fixedPrice: '37,834' })).fixedPrice).toBe(t(`${V}.fixedPrice`))
    expect(schema.parse(valid({ priceSource: 'fixed', fixedPrice: '37,83 $' }))).toMatchObject({ fixedPriceCents: 3783, gridDuration: null })
    expect(errors(valid({ gridDuration: '' })).gridDuration).toBe(t(`${V}.gridDuration`))
    expect(schema.parse(valid({ priceSource: 'entered', fixedPrice: '12', gridDuration: '' }))).toMatchObject({ fixedPriceCents: null, gridDuration: null })
  })

  it('bounds the durations and the order, and refuses a colour that is not hex', () => {
    expect(errors(valid({ durationMinutes: '481' })).durationMinutes).toBe(t(`${V}.duration`))
    expect(errors(valid({ bufferAfterMinutes: '-5' })).bufferAfterMinutes).toBe(t(`${V}.buffer`))
    expect(errors(valid({ sortOrder: '1,5' })).sortOrder).toBe(t(`${V}.sortOrder`))
    expect(errors(valid({ colour: 'bleu' })).colour).toBe(t(`${V}.colour`))
  })

  it('round-trips an existing service through its form values', () => {
    const opening = SERVICES.find((s) => s.code === 10100)
    if (!opening) throw new Error('fixture')
    const own = serviceSchema({ families: FAMILIES, others: SERVICES.filter((s) => s.id !== opening.id) })
    const values = serviceFormValues(opening, [])
    expect(values).toMatchObject({ code: '10100', fixedPrice: '37,83', gridDuration: '', taxRule: 'taxable' })
    expect(own.parse(values)).toMatchObject({ code: 10100, fixedPriceCents: 3783, priceSource: 'fixed', taxRule: 'taxable' })
  })
})
