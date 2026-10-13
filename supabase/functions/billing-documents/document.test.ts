import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { checkDocument, type PdfDocument } from '../_shared/pdf/model.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import {
  invoiceDoc,
  PROFESSIONALS,
  receiptDoc,
  statementDoc,
} from '../_shared/testing/billing-fixtures.ts'
import {
  billingDocumentSchema,
  billingEmail,
  billingPdf,
  day,
  money,
} from './document.ts'

const parse = (value: unknown) => billingDocumentSchema.parse(value)

/** Every text a document prints, in order (headings, runs, list items, table cells). */
function texts(doc: PdfDocument): string {
  const out: string[] = [doc.header?.text ?? '', doc.footer.text]
  for (const block of doc.blocks) {
    if (block.type === 'heading') out.push(block.text)
    if (block.type === 'paragraph') {
      out.push(block.runs.map((r) => r.text).join(''))
    }
    if (block.type === 'list') {
      for (const item of block.items) out.push(item.map((r) => r.text).join(''))
    }
    if (block.type === 'table') {
      out.push(block.columns.map((c) => c.label).join(' | '))
      for (const row of block.rows) out.push(row.join(' | '))
    }
  }
  return out.join('\n')
}

Deno.test('money and dates: French and English, never shifted', () => {
  assertEquals(money(123456, 'fr'), '1\u00A0234,56\u00A0$')
  assertEquals(money(5, 'fr'), '0,05\u00A0$')
  assertEquals(money(123456, 'en'), '$1,234.56')
  assertEquals(day('2026-01-01', 'fr'), '1 janvier 2026')
  assertEquals(day('2026-10-13', 'en'), 'October 13, 2026')
})

Deno.test('the receipt names the person served, the payer, the amount, and the intern’s supervisor with her order and licence (R-60)', () => {
  const doc = billingPdf(parse(receiptDoc()), { logo: false })
  assertEquals(checkDocument(doc).ok, true)
  const all = texts(doc)
  assertStringIncludes(all, 'Reçu R-2026-87')
  assertStringIncludes(
    all,
    'Payé par\u00A0: Camille Essai (dossier n°\u00A013)',
  )
  assertStringIncludes(
    all,
    'Services rendus à\u00A0: Léa Essai (dossier n°\u00A012)',
  )
  assertStringIncludes(
    all,
    'Montant payé\u00A0: 173,49\u00A0$ le 14 octobre 2026 (Virement Interac)',
  )
  assertStringIncludes(all, 'Pour la facture\u00A0: 2026-412')
  assertStringIncludes(
    all,
    'Simon Stagiaire, stagiaire, sous la supervision de Hélène Superviseure, Psychologue — Ordre des psychologues du Québec (OPQ), N° de permis L-1',
  )
  assertStringIncludes(
    all,
    '12 octobre 2026 | Consultation individuelle 50 min',
  )
  assertStringIncludes(all, '50\u00A0min')
  assertStringIncludes(
    all,
    'Clinique MANA · TPS 123456789RT0001 · TVQ 1234567890TQ0001',
  )
  assertStringIncludes(all, '100 rue Exemple, Montréal QC H2X 1Y4')
})

Deno.test('a professional who is not supervised prints her own title, order and licence', () => {
  const own = {
    ...PROFESSIONALS[0],
    name: 'Hélène Superviseure',
    licence_number: 'L-1',
    supervisor_id: null,
    supervisor_name: null,
  }
  const all = texts(
    billingPdf(parse(invoiceDoc({ professionals: [own] })), { logo: false }),
  )
  assertStringIncludes(
    all,
    'Hélène Superviseure, Psychologue — Ordre des psychologues du Québec (OPQ), N° de permis L-1',
  )
  assert(!all.includes('stagiaire'))
})

Deno.test('the invoice: billed to the payer, taxes per line with their rates, the note; a draft says it is a preview', () => {
  const all = texts(billingPdf(parse(invoiceDoc()), { logo: true }))
  assertStringIncludes(all, 'Facture 2026-412')
  assertStringIncludes(all, 'Facturé à\u00A0: Camille Essai')
  assertStringIncludes(all, 'TPS 5\u00A0% (123456789RT0001) | 1,89\u00A0$')
  assertStringIncludes(all, 'TVQ 9,975\u00A0% (1234567890TQ0001) | 3,77\u00A0$')
  assertStringIncludes(all, 'Total | 173,49\u00A0$')
  assertStringIncludes(all, 'Note\u00A0: Merci !')
  const draft = texts(
    billingPdf(parse(invoiceDoc({ number: null })), { logo: false }),
  )
  assertStringIncludes(draft, 'Aperçu du brouillon de facture')
  assertStringIncludes(draft, 'ne vaut pas facture')
  const exempt = texts(billingPdf(
    parse(
      invoiceDoc({ invoice: { ...invoiceDoc().invoice, tax_exempt: true } }),
    ),
    { logo: false },
  ))
  assertStringIncludes(exempt, 'Exempté de taxes (Statut Indien)')
})

Deno.test('in the payer’s language: English', () => {
  const doc = parse(invoiceDoc({
    payer: {
      id: 'p',
      name: 'Camille Essai',
      first_name: 'Camille',
      client_number: 13,
      language: 'en',
    },
  }))
  const all = texts(billingPdf(doc, { logo: false }))
  assertStringIncludes(all, 'Invoice 2026-412')
  assertStringIncludes(all, 'Billed to: Camille Essai (file no.\u00A013)')
  assertStringIncludes(all, 'GST 5% (123456789RT0001) | $1.89')
  const email = billingEmail(doc, 'Camille')
  assertEquals(email.templateKey, 'billing.invoice_en')
  assertEquals(email.filename, 'Invoice 2026-412.pdf')
})

Deno.test('the statement: the year’s invoices and payments, the balance', () => {
  const doc = billingPdf(parse(statementDoc()), { logo: false })
  assertEquals(checkDocument(doc).ok, true)
  const all = texts(doc)
  assertStringIncludes(all, 'Relevé 2026')
  assertStringIncludes(all, 'Période\u00A0: 1 janvier 2026 au 13 octobre 2026')
  assertStringIncludes(
    all,
    '2026-412 | 13 octobre 2026 | Émise | 173,49\u00A0$',
  )
  assertStringIncludes(
    all,
    'R-2026-87 | 14 octobre 2026 | Virement Interac | 173,49\u00A0$',
  )
  assertStringIncludes(all, 'Solde | 0,00\u00A0$')
})

Deno.test('the emails: the template by kind and language, the values, a safe file name', () => {
  const receipt = billingEmail(parse(receiptDoc()), 'Camille')
  assertEquals(receipt.templateKey, 'billing.receipt')
  assertEquals(receipt.filename, 'Reçu R-2026-87.pdf')
  assertEquals(receipt.values, {
    recipient: { first_name: 'Camille' },
    client: { first_name: 'Léa' },
    clinic: { name: 'Clinique MANA' },
    document: {
      number: 'R-2026-87',
      amount: '173,49\u00A0$',
      invoice_number: '2026-412',
    },
  })
  const credit = billingEmail(
    parse(invoiceDoc({ kind: 'credit_note', number: 'NC-2026-3' })),
    'Camille',
  )
  assertEquals([credit.templateKey, credit.filename], [
    'billing.credit_note',
    'Note de crédit NC-2026-3.pdf',
  ])
  const statement = billingEmail(parse(statementDoc()), 'Camille')
  assertEquals(statement.templateKey, 'billing.statement')
  assertEquals(statement.values.document, {
    period: '2026',
    amount: '173,49\u00A0$',
  })
})

Deno.test('the receipt renders: one page, a real PDF', async () => {
  const pdf = await renderPdf(
    billingPdf(parse(receiptDoc()), { logo: false }),
    {},
  )
  assertEquals(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), '%PDF-')
  assertEquals(pdf.pageCount, 1)
})
