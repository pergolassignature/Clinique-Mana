import type { CancellationsReport, FollowUpReport, RevenueReport } from '../api/reports'

const options = {
  professionals: [{ id: 'p1', name: 'Pro Un' }],
  services: [{ id: 's1', code: 10150, name: 'Consultation individuelle 50 min' }],
  modes: [{ code: 'interac', name: 'Virement Interac' }, { code: 'stripe', name: 'Carte (Stripe)' }],
}

export const invoiceReport: Extract<RevenueReport, { view: 'invoice' }> = {
  view: 'invoice',
  rows: [
    {
      invoice_id: 'f1', number: '2026-1', issued_on: '2026-09-05', client_id: 'c1', client_name: '=Alice Essai', client_number: 12,
      payer_name: null, professional_names: 'Pro Un', subtotal_cents: 17500, gst_cents: 0, qst_cents: 0, total_cents: 17500,
      paid_cents: 10000, balance_cents: 7500,
    },
  ],
  totals: { count: 1, subtotal_cents: 17500, gst_cents: 0, qst_cents: 0, total_cents: 17500, paid_cents: 10000, balance_cents: 7500 },
  truncated: false,
  credited: { count: 1, total_cents: 9000 },
  options,
}

export const serviceReport: Extract<RevenueReport, { view: 'service' }> = {
  view: 'service',
  rows: [
    {
      line_id: 'l1', invoice_id: 'f1', number: '2026-1', issued_on: '2026-09-05', client_id: 'c1', client_name: 'Alice Essai',
      client_number: 12, professional_name: 'Pro Un', line_type: 'service', service_code: 10150,
      service_name: 'Consultation individuelle 50 min', description: 'Consultation', quantity: 1, unit_price_cents: 17500,
      subtotal_cents: 17500, gst_cents: 0, qst_cents: 0, total_cents: 17500,
    },
  ],
  by_service: [
    { service_id: 's1', service_code: 10150, service_name: 'Consultation individuelle 50 min', line_type: null, lines: 1, quantity: 1, total_cents: 17500 },
  ],
  totals: { count: 1, quantity: 1, subtotal_cents: 17500, gst_cents: 0, qst_cents: 0, total_cents: 17500 },
  truncated: false,
  credited: { count: 0, total_cents: 0 },
  options,
}

export const paymentReport: Extract<RevenueReport, { view: 'payment' }> = {
  view: 'payment',
  rows: [
    {
      kind: 'refund', row_id: 'z1', payment_id: 'y1', paid_on: '2026-09-20', invoice_id: 'f1', number: '2026-1', client_id: 'c1',
      client_name: 'Alice Essai', client_number: 12, payer_name: null, mode_code: 'interac', mode_name: 'Virement Interac',
      amount_cents: -2500, reference: null,
    },
    {
      kind: 'payment', row_id: 'y1', payment_id: 'y1', paid_on: '2026-09-06', invoice_id: 'f1', number: '2026-1', client_id: 'c1',
      client_name: 'Alice Essai', client_number: 12, payer_name: null, mode_code: 'interac', mode_name: 'Virement Interac',
      amount_cents: 10000, reference: '-ref',
    },
  ],
  by_mode: [
    { mode_code: 'interac', mode_name: 'Virement Interac', count: 1, amount_cents: 10000, refunds_count: 1, refunds_cents: 2500, net_cents: 7500 },
  ],
  totals: { count: 1, amount_cents: 10000, refunds_count: 1, refunds_cents: 2500, net_cents: 7500 },
  truncated: true,
  options,
}

export const cancellationsReport: CancellationsReport = {
  rows: [
    {
      appointment_id: 'e1', starts_at: '2026-09-08T14:00:00Z', kind: 'cancelled', client_id: 'c1', client_name: 'Alice Essai', client_number: 12,
      professional_name: 'Pro Un', service_code: 10150, service_name: 'Consultation individuelle 50 min', reason_name: 'Plus requis', late: true,
      kept_on_schedule: false, cancelled_at: '2026-09-08T10:00:00Z', later_starts_at: null,
    },
    {
      appointment_id: 'e2', starts_at: '2026-09-09T14:00:00Z', kind: 'absent', client_id: 'c2', client_name: 'Bruno Essai', client_number: 13,
      professional_name: 'Pro Un', service_code: 10150, service_name: 'Consultation individuelle 50 min', reason_name: null, late: false,
      kept_on_schedule: false, cancelled_at: null, later_starts_at: '2026-10-20T14:00:00Z',
    },
  ],
  by_reason: [
    { kind: 'absent', reason_id: null, reason_name: null, count: 1, late: 0 },
    { kind: 'cancelled', reason_id: 'r1', reason_name: 'Plus requis', count: 1, late: 1 },
  ],
  totals: { cancelled: 1, late: 1, absent: 1 },
  truncated: false,
  options: { professionals: [{ id: 'p1', name: 'Pro Un' }], reasons: [{ id: 'r1', name: 'Plus requis' }] },
}

export const followUpReport: FollowUpReport = {
  rows: [
    {
      client_id: 'c1', client_name: 'Alice Essai', client_number: 12, starts_at: '2026-09-08T14:00:00Z', kind: 'cancelled',
      reason_name: 'Plus requis', late: true, professional_name: 'Pro Un', service_code: 10150,
      service_name: 'Consultation individuelle 50 min', events: 2,
    },
  ],
  total: 1,
  truncated: false,
  options: { professionals: [{ id: 'p1', name: 'Pro Un' }] },
}
