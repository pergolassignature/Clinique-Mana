import { describe, expect, it } from 'vitest'
import { listRowPayload, parseRpc, summaryPayload, UNEXPECTED_SHAPE } from './parse'

const listRow = {
  id: 'c1',
  client_number: 12,
  first_name: 'Alice',
  last_name: 'Tremblay',
  birthday: '1990-03-04',
  email: null,
  mobile_e164: '+15145550101',
  primary_professional_id: null,
  is_archived: false,
  tag_ids: [],
  rate_variant: null,
  tax_exempt: false,
  is_banned: false,
  file_incomplete: true,
  special_agreement: false,
  sort_last: 'tremblay',
  sort_first: 'alice',
  last_visit_at: '2026-10-02T14:00:00Z',
  sort_visit: null,
  created_at: '2026-10-01T14:00:00Z',
}

describe('clients payloads', () => {
  it('maps a list row with its keyset cursor', () => {
    expect(parseRpc(listRowPayload, listRow)).toMatchObject({ clientNumber: 12, mobile: '+15145550101', fileIncomplete: true, lastVisitAt: '2026-10-02T14:00:00Z', cursor: { last: 'tremblay', first: 'alice', id: 'c1', visit: null, number: 12, created: '2026-10-01T14:00:00Z' } })
  })

  it('refuses an unexpected shape without quoting a value', () => {
    expect(() => parseRpc(listRowPayload, { ...listRow, rate_variant: 'vip' })).toThrow(new Error(UNEXPECTED_SHAPE))
  })

  it('maps the record bundle: relations both ways, the notes, missing notes as null', () => {
    const summary = parseRpc(summaryPayload, {
      client: {
        id: 'c1', client_number: 12, first_name: 'Alice', last_name: 'Tremblay', birth_first_name: null, pronouns: null, sex: null,
        birthday: null, email: null, mobile_e164: null, home_e164: null, work_e164: null, work_ext: null, language: 'fr', time_zone: null,
        reminders_by_sms: true, reminders_by_email: false, address_line1: null, address_line2: null, city: null, province: null,
        postal_code: null, country: 'CA', referral_source_id: null, referred_by: null, custom_field: null, primary_professional_id: null,
        rate_variant: null, tax_exempt: false, is_banned: false, file_incomplete: false, special_agreement: false, shared_custody: false,
        external_ref: null, archived_at: null, merged_into_id: null, anonymized_at: null, created_at: '2026-10-12T15:00:00Z',
        updated_at: '2026-10-12T15:00:00Z', org_id: 'dropped',
      },
      notes: null,
      relations: [
        {
          id: 'r1', related_id: 'c2', related_number: 3, related_name: 'Marc Tremblay', related_archived: false, type: 'parent',
          related_rights: { main_contact: true, manages_appointments: true, receives_communications: false, receives_invoices: true },
          client_rights: { main_contact: false, manages_appointments: false, receives_communications: false, receives_invoices: false },
        },
      ],
      insurances: [],
      payers: [],
      tags: [],
      professionals: [],
      merges: [],
    })
    expect(summary.adminNotes).toBeNull()
    expect(summary.client.remindersByEmail).toBe(false)
    expect(summary.relations[0]).toMatchObject({ relatedName: 'Marc Tremblay', type: 'parent', relatedRights: { manages_appointments: true } })
  })
})
