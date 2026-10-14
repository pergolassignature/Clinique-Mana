/**
 * Test fixtures: billing documents as `billing_document` returns them (the
 * migration `*_billing_queue_payments.sql`). Local test data only.
 */
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const CLINIC = {
  name: 'Clinique MANA',
  legal_name: 'Clinique MANA inc.',
  address_line1: '100 rue Exemple',
  address_line2: null,
  city: 'Montréal',
  province: 'QC',
  postal_code: 'H2X 1Y4',
  phone: '+15145550100',
  email: 'administration@exemple.test',
  website: 'https://exemple.test',
  gst_number: '123456789RT0001',
  qst_number: '1234567890TQ0001',
}

export const PROFESSIONALS = [{
  professional_id: id(21),
  name: 'Simon Stagiaire',
  title: 'Psychologue',
  order_name: 'Ordre des psychologues du Québec',
  order_acronym: 'OPQ',
  licence_label: 'N° de permis',
  licence_number: 'S-2',
  supervisor_id: id(20),
  supervisor_name: 'Hélène Superviseure',
  supervisor_title: 'Psychologue',
  supervisor_order_name: 'Ordre des psychologues du Québec',
  supervisor_order_acronym: 'OPQ',
  supervisor_licence_label: 'N° de permis',
  supervisor_licence_number: 'L-1',
}]

const LINES = [
  {
    invoice_id: id(1),
    position: 1,
    line_type: 'service',
    description: 'Consultation individuelle 50 min — 12 octobre 2026',
    service_code: 10150,
    quantity: 1,
    unit_price_cents: 13000,
    tax_rule: 'exempt',
    subtotal_cents: 13000,
    gst_cents: 0,
    qst_cents: 0,
    total_cents: 13000,
    professional_id: id(21),
    service_date: '2026-10-12',
    minutes: 50,
  },
  {
    invoice_id: id(1),
    position: 2,
    line_type: 'file_opening',
    description: 'Ouverture de dossier – individuel',
    service_code: 10100,
    quantity: 1,
    unit_price_cents: 3783,
    tax_rule: 'taxable',
    subtotal_cents: 3783,
    gst_cents: 189,
    qst_cents: 377,
    total_cents: 4349,
    professional_id: null,
    service_date: null,
    minutes: null,
  },
]

const INVOICE = {
  id: id(1),
  number: '2026-412',
  status: 'issued',
  issued_on: '2026-10-13',
  due_on: '2026-10-13',
  tax_exempt: false,
  gst_rate: 0.05,
  qst_rate: 0.09975,
  subtotal_cents: 16783,
  gst_cents: 189,
  qst_cents: 377,
  total_cents: 17349,
  paid_cents: 0,
  notes_client: 'Merci !',
}

/** The people's ids (Marc: Léa's spouse, served with her in a couple's session). */
export const PEOPLE_IDS = { lea: id(31), payer: id(32), marc: id(33) }

const PEOPLE = {
  client: {
    id: id(31),
    name: 'Léa Essai',
    first_name: 'Léa',
    client_number: 12,
    language: 'fr',
  },
  payer: {
    id: id(32),
    name: 'Camille Essai',
    first_name: 'Camille',
    client_number: 13,
    language: 'fr',
  },
}

/** An issued invoice billed to Léa's parent, an intern's session and the file opening. */
export function invoiceDoc(over: Record<string, unknown> = {}) {
  return {
    kind: 'invoice',
    id: id(1),
    number: '2026-412',
    issued_on: '2026-10-13',
    invoice: INVOICE,
    payment: null,
    clinic: CLINIC,
    ...PEOPLE,
    lines: LINES,
    professionals: PROFESSIONALS,
    ...over,
  }
}

/** The receipt of a payment on that invoice. */
export function receiptDoc(over: Record<string, unknown> = {}) {
  return invoiceDoc({
    kind: 'receipt',
    id: id(2),
    number: 'R-2026-87',
    payment: {
      amount_cents: 17349,
      paid_on: '2026-10-14',
      mode: 'Virement Interac',
    },
    ...over,
  })
}

/** Léa's statement for 2026 (one invoice, one payment). */
export function statementDoc(over: Record<string, unknown> = {}) {
  return {
    kind: 'statement',
    id: id(3),
    year: 2026,
    period_from: '2026-01-01',
    period_to: '2026-10-13',
    issued_on: '2026-10-13',
    clinic: CLINIC,
    ...PEOPLE,
    invoices: [{
      id: id(1),
      number: '2026-412',
      issued_on: '2026-10-13',
      status: 'issued',
      total_cents: 17349,
      paid_cents: 17349,
      credit_note_number: null,
    }],
    payments: [{
      receipt_number: 'R-2026-87',
      paid_on: '2026-10-14',
      amount_cents: 17349,
      mode: 'Virement Interac',
      invoice_number: '2026-412',
    }],
    lines: LINES,
    professionals: PROFESSIONALS,
    ...over,
  }
}
