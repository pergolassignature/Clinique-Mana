import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { checkDocument, type PdfDocument } from '../_shared/pdf/model.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import {
  CLINIC,
  invoiceDoc,
  PEOPLE_IDS,
  PROFESSIONALS,
  receiptDoc,
  statementDoc,
} from '../_shared/testing/billing-fixtures.ts'
import {
  billingDocumentSchema,
  billingEmail,
  billingPdf,
  billingReminderEmail,
  day,
  money,
  signatureAssets,
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

Deno.test('an IVAC invoice (FP-11, R-84): billed to IVAC, its header as the CNESST’s sample (file, supplier, professional with her IVAC number, permit, event date), due on its date', () => {
  const ivac = invoiceDoc({
    invoice: {
      ...invoiceDoc().invoice,
      due_on: '2026-11-12',
      payer_kind: 'organisation',
      payer_reference: 'IV-1',
    },
    payer: {
      id: 'o1',
      name: 'IVAC',
      first_name: 'IVAC',
      client_number: null,
      language: 'fr',
      organisation_kind: 'ivac',
      provider_number: 'FOURN-1',
      event_on: '2026-03-02',
    },
    payer_numbers: [{
      professional_id: PROFESSIONALS[0].professional_id,
      number: 'IVAC-123',
    }],
  })
  const all = texts(billingPdf(parse(ivac), { logo: false }))
  assertStringIncludes(all, 'Facturé à : IVAC')
  // R-84: the header in the CNESST's order, the event date last.
  const header = [
    'N° de dossier\u00A0: IV-1',
    'Fournisseur\u00A0: Clinique MANA inc. FOURN-1',
    'Professionnel\u00A0: Simon Stagiaire IVAC-123',
    'Permis\u00A0: OPQ S-2',
    'Date de l’évènement\u00A0: 2 mars 2026',
  ]
  let at = -1
  for (const line of header) {
    const next = all.indexOf(line)
    assert(next > at, line)
    at = next
  }
  assert(!all.includes('N° de fournisseur de la clinique'))
  assertStringIncludes(all, 'Échéance : 12 novembre 2026')
  assert(!all.includes('sur réception'))
  assertStringIncludes(all, 'N° IVAC IVAC-123')
  // A client's invoice: due on receipt, no provider nor IVAC number.
  const own = texts(billingPdf(parse(invoiceDoc()), { logo: false }))
  assertStringIncludes(own, 'Échéance : sur réception')
  assert(!own.includes('N° IVAC') && !own.includes('fournisseur'))
})

Deno.test('R-84: an IVAC header without an event date nor a supplier number; an intern without her own permit prints her supervisor’s; a PAE keeps its lines', () => {
  const base = invoiceDoc().invoice
  const ivac = parse(invoiceDoc({
    invoice: { ...base, payer_kind: 'organisation', payer_reference: 'IV-2' },
    payer: {
      id: 'o1',
      name: 'IVAC',
      language: 'fr',
      organisation_kind: 'ivac',
      provider_number: null,
    },
    professionals: [{ ...PROFESSIONALS[0], licence_number: null }],
  }))
  const all = texts(billingPdf(ivac, { logo: false }))
  assertStringIncludes(all, 'Fournisseur\u00A0: Clinique MANA inc.\n')
  assertStringIncludes(all, 'Professionnel\u00A0: Simon Stagiaire\n')
  assertStringIncludes(all, 'Permis\u00A0: OPQ L-1')
  assert(!all.includes('évènement'))
  const pae = texts(billingPdf(
    parse(invoiceDoc({
      invoice: { ...base, payer_kind: 'organisation', payer_reference: 'PX-9' },
      payer: {
        id: 'o2',
        name: 'Fournisseur X',
        language: 'fr',
        organisation_kind: 'pae',
        provider_number: 'F-77',
      },
    })),
    { logo: false },
  ))
  assertStringIncludes(pae, 'N° de fournisseur de la clinique\u00A0: F-77')
  assertStringIncludes(pae, 'N° de dossier\u00A0: PX-9')
  assert(!pae.includes('Permis\u00A0:'))
})

Deno.test('BI-21: an invoice says how to pay by Interac and when the receipt follows; in its email too; never on a receipt', () => {
  const clinic = {
    ...CLINIC,
    etransfer_email: 'paiements@exemple.test',
    invoice_note_fr:
      'Votre reçu vous est envoyé dans les 24 h ouvrables suivant votre paiement.',
    invoice_note_en: 'Your receipt is sent within 24 business hours.',
  }
  const doc = parse(invoiceDoc({ clinic }))
  const all = texts(billingPdf(doc, { logo: false }))
  assertStringIncludes(
    all,
    'Paiement\u00A0: Paiement par virement Interac à paiements@exemple.test (dépôt automatique). Votre reçu vous est envoyé dans les 24 h ouvrables suivant votre paiement.',
  )
  const email = billingEmail(doc, 'Camille')
  assertStringIncludes(
    String((email.values.document as Record<string, unknown>).payment_note),
    'paiements@exemple.test',
  )
  const receipt = texts(
    billingPdf(parse(receiptDoc({ clinic })), { logo: false }),
  )
  assert(!receipt.includes('dépôt automatique'))
  // Neither an address nor a note: nothing printed.
  const bare = texts(
    billingPdf(
      parse(invoiceDoc({ clinic: { ...CLINIC, invoice_note_fr: '' } })),
      { logo: false },
    ),
  )
  assert(!bare.includes('Paiement\u00A0:'))
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

Deno.test('the reminder\u2019s email: the days since the due date and the balance, the invoice\u2019s file', () => {
  const email = billingReminderEmail(parse(invoiceDoc()), 'Camille', 12, 4349)
  assertEquals(email.templateKey, 'billing.reminder')
  assertEquals(email.filename, 'Facture 2026-412.pdf')
  assertEquals(email.values.document, {
    number: '2026-412',
    amount: '43,49\u00A0$',
    days: '12',
  })
})

Deno.test('R-87: a couple’s session prints one receipt naming both people, the file’s client first; the invoice keeps the file’s client', () => {
  const lines = receiptDoc().lines.map((line) =>
    line.line_type === 'service'
      ? {
        ...line,
        served: [
          { id: PEOPLE_IDS.lea, name: 'Léa Essai', client_number: 12 },
          { id: PEOPLE_IDS.marc, name: 'Marc Essai', client_number: 14 },
        ],
      }
      : line
  )
  const receipt = texts(
    billingPdf(parse(receiptDoc({ lines })), { logo: false }),
  )
  assertStringIncludes(
    receipt,
    'Services rendus à\u00A0: Léa Essai (dossier n°\u00A012) et Marc Essai (dossier n°\u00A014)',
  )
  const invoice = texts(
    billingPdf(parse(invoiceDoc({ lines })), { logo: false }),
  )
  assertStringIncludes(
    invoice,
    'Services rendus à\u00A0: Léa Essai (dossier n°\u00A012)\n',
  )
  // An individual session (no `served`): one name.
  const alone = texts(billingPdf(parse(receiptDoc()), { logo: false }))
  assert(!alone.includes(' et '))
})

Deno.test('R-86: the professional’s signature prints above her name on a receipt, never on an invoice; without its image, the list as before', async () => {
  const signatures = [{
    professional_id: PROFESSIONALS[0].professional_id,
    bucket: 'documents',
    object_path: 'org/professionals/p/s.png',
  }]
  const professionals = PROFESSIONALS
  const receipt = parse(receiptDoc())
  assertEquals(signatureAssets(receipt, signatures), [{
    key: 'signature_0',
    bucket: 'documents',
    path: 'org/professionals/p/s.png',
  }])
  assertEquals(signatureAssets(parse(invoiceDoc()), signatures), [])
  assertEquals(signatureAssets(receipt, []), [])
  assertEquals(
    signatureAssets(receipt, [{ ...signatures[0], professional_id: 'other' }]),
    [],
  )

  const doc = billingPdf(receipt, {
    logo: false,
    signatures: new Set(['signature_0']),
  })
  assertEquals(checkDocument(doc).ok, true)
  const at = doc.blocks.findIndex((b) =>
    b.type === 'image' && b.assetKey === 'signature_0'
  )
  assert(at > 0, 'the signature is printed')
  const next = doc.blocks[at + 1]
  assert(
    next?.type === 'paragraph' &&
      next.runs[0]?.text.startsWith('Simon Stagiaire, stagiaire'),
    'her name and the intern’s supervisor follow it (R-60)',
  )
  // Not loaded: the list, no image.
  const without = billingPdf(receipt, { logo: false })
  assert(!without.blocks.some((b) => b.type === 'image'))
  assert(without.blocks.some((b) => b.type === 'list'))
  // An invoice never prints it, even when passed.
  const invoice = billingPdf(parse(invoiceDoc({ professionals })), {
    logo: false,
    signatures: new Set(['signature_0']),
  })
  assert(!invoice.blocks.some((b) => b.type === 'image'))

  const png = await Deno.readFile(
    new URL('../_shared/pdf/fixtures/logo.png', import.meta.url),
  )
  const pdf = await renderPdf(doc, { signature_0: png })
  assertEquals(pdf.pageCount, 1)
})
