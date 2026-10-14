import { beforeAll, describe, expect, it } from 'vitest'
import { setClinicTimezone } from '@/shared/lib/timezone'
import type { WaitlistEntry } from '../api/waitlist'
import { waitlistCsv } from './waitlist-csv'

beforeAll(() => setClinicTimezone('America/Toronto'))

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: 'w1',
  demande_id: 'd1',
  reference: 'DEM-0042',
  client_id: 'c1',
  client_number: 12,
  person_name: 'Alice Essai',
  target_kind: 'title',
  target_id: 't1',
  target_name: 'Psychologue',
  priority: 'priority',
  priority_reason: 'Raison privée',
  registered_at: '2026-09-01T03:30:00Z',
  waited_days: 43,
  state: 'to_call',
  fee_status: 'paid',
  fee_waived_reason: null,
  consent_state: null,
  last_contact_at: null,
  next_contact_at: '2026-10-20T14:00:00Z',
  bridge_professional_id: null,
  bridge_name: null,
  exit_reason: null,
  exited_at: null,
  rank: 1,
  list_size: 3,
  pending_offer: false,
  followup_unanswered: false,
  ...over,
})

const lines = (content: string) => content.replace(/^\uFEFF/, '').split('\r\n')

describe('waitlistCsv (L7)', () => {
  it('the entries in their order, the clinic’s dates, never the priority’s reason', () => {
    const file = waitlistCsv([entry()], '2026-10-14')
    expect(file.fileName).toBe('liste-attente-2026-10-14.csv')
    const [header, row] = lines(file.content)
    expect(header?.split(';')).toHaveLength(14)
    // Registered Sep 1 03:30Z: Aug 31 at the clinic.
    expect(row).toMatch(/^1;DEM-0042;Alice Essai;CLI-000012;Psychologue;[^;]+;2026-08-31;43;[^;]+;;[^;]+;[^;]+;;2026-10-20$/)
    expect(file.content).not.toContain('Raison privée')
  })
})
