import { describe, expect, it } from 'vitest'
import type { InvoiceRow } from '../api/invoices'
import { invoicesCsv } from './invoices-csv'

const row = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 'i1',
  number: '2026-12',
  status: 'issued',
  payerKind: 'client',
  paidCents: 5000,
  paymentStatus: 'partial',
  clientId: 'c1',
  clientName: 'Alice Essai',
  clientNumber: 12,
  payerId: 'c1',
  payerName: 'Alice Essai',
  issuedOn: '2026-10-02',
  totalCents: 17500,
  createdAt: '2026-10-02T14:00:00Z',
  ...over,
})

const lines = (content: string) => content.replace(/^\uFEFF/, '').split('\r\n')

describe('invoicesCsv (L7)', () => {
  it('the tab’s invoices with what is paid and due', () => {
    const file = invoicesCsv(
      [
        row(),
        row({ id: 'i2', number: null, status: 'draft', issuedOn: null, paidCents: 0, payerKind: 'organisation', payerId: 'o1', payerName: 'IVAC' }),
      ],
      'toutes',
      '2026-10-14',
    )
    expect(file.fileName).toBe('factures-toutes-2026-10-14.csv')
    const [header, issued, draft] = lines(file.content)
    expect(header).toBe('Numéro;Émise le;N° de dossier;Client;Facturé à;Total;Payé;Solde;État;Paiement')
    expect(issued).toMatch(/^2026-12;2026-10-02;CLI-000012;Alice Essai;Le client;175,00;50,00;125,00;[^;]+;[^;]+$/)
    expect(draft).toMatch(/^Brouillon;;CLI-000012;Alice Essai;IVAC;175,00;0,00;0,00;[^;]+;$/)
  })
})
