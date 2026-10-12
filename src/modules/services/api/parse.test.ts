import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseRpc, policyPayload, pricePayload, servicePayload, UNEXPECTED_SHAPE, variantPayload } from './parse'

const serviceRow = {
  id: 's1',
  family_id: 'f1',
  code: 10150,
  key: 'consultation_50',
  name: 'Consultation individuelle 50 min',
  description: null,
  kind: 'session',
  duration_minutes: 50,
  buffer_after_minutes: 10,
  for_two: false,
  price_source: 'grid',
  fixed_price_cents: null,
  grid_duration: 50,
  tax_rule: 'exempt',
  colour: null,
  is_active: true,
  sort_order: 0,
  updated_at: '2026-10-12T19:00:00Z',
  org_id: 'dropped',
}

describe('services payload parsers', () => {
  it('maps a service row to camelCase and drops unknown columns', () => {
    const service = parseRpc(servicePayload, serviceRow)
    expect(service).toMatchObject({ id: 's1', familyId: 'f1', code: 10150, bufferAfterMinutes: 10, priceSource: 'grid', gridDuration: 50, taxRule: 'exempt' })
    expect(service).not.toHaveProperty('org_id')
  })

  it('refuses an unknown enumeration or grid column with a message that holds no value', () => {
    expect(() => parseRpc(servicePayload, { ...serviceRow, price_source: 'by_profession_category' })).toThrow(UNEXPECTED_SHAPE)
    expect(() => parseRpc(servicePayload, { ...serviceRow, grid_duration: 45 })).toThrow(UNEXPECTED_SHAPE)
    // The exact message: never Zod's issues, which quote the row's values.
    expect(() => parseRpc(servicePayload, { ...serviceRow, name: 42 })).toThrow(new Error(UNEXPECTED_SHAPE))
  })

  it('parses a variant, a policy and a price row', () => {
    expect(
      parseRpc(variantPayload, {
        id: 'v1',
        service_id: 's1',
        variant: 'student',
        profession_title_id: null,
        discount_kind: 'percent',
        amount_cents: null,
        percent: 12.5,
        effective_from: '2026-01-01',
        effective_to: null,
        created_at: '2026-10-01T12:00:00Z',
      }),
    ).toMatchObject({ titleId: null, discountKind: 'percent', percent: 12.5, effectiveTo: null })
    expect(
      parseRpc(policyPayload, {
        id: 'p1',
        effective_from: '2026-01-01',
        effective_to: null,
        late_notice_hours: 24,
        first_fee_percent: 50,
        next_fee_percent: 100,
        file_opening_service_id: null,
        fee_mode: 'confirm',
        created_at: '2026-10-01T12:00:00Z',
      }),
    ).toMatchObject({ lateNoticeHours: 24, feeMode: 'confirm' })
    expect(
      parseRpc(z.array(pricePayload), [
        { service_id: 's1', title_id: 't1', price_cents: 17500, student_price_cents: 12000, reduced_price_cents: null, tax_rule: 'exempt', source: 'grid' },
      ]),
    ).toEqual([{ serviceId: 's1', titleId: 't1', priceCents: 17500, studentPriceCents: 12000, reducedPriceCents: null, taxRule: 'exempt', source: 'grid' }])
  })
})
