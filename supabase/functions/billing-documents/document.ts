/**
 * What a billing PDF prints (Facturation F2): the invoice, the credit note,
 * the receipt and the statement, built from `billing_document` (the
 * migration `*_billing_queue_payments.sql`) in the payer's language, plus
 * the email's values and the attachment's name.
 *
 * The receipt names the person served and the payer, the professional (an
 * intern's supervisor, her order and licence, R-60), the date, the length,
 * the service, the amount paid, the receipt's number, the clinic's address
 * and tax numbers (roadmap §2.6 bis). A session for several people (AP-5)
 * names every person it served, the file's client first (R-87); each
 * professional's signature image, when she has one and it loaded, prints
 * above her name (R-86; an intern's own).
 *
 * A payer organisation's invoice (FP-4, FP-11) is billed to the organisation
 * with the clinic's provider number and the payer's file number, due on its
 * date; an IVAC invoice also names each professional's IVAC number. Its
 * header follows the CNESST's sample (R-84): « N° de dossier », « Fournisseur »
 * (the clinic and its supplier number), « Professionnel » (her name and IVAC
 * number), « Permis » (her order and permit), « Date de l'évènement ».
 *
 * pdfmake-free: plain model data (`_shared/pdf/model.ts`).
 */
import { z } from 'zod'
import { formatDateOnly } from '../_shared/format.ts'
import type { Block, PdfDocument, Run } from '../_shared/pdf/model.ts'

const text = z.string()
const maybe = z.string().nullable().optional()
const cents = z.number().int()

const personSchema = z.object({
  id: z.string(),
  name: text,
  first_name: maybe,
  client_number: z.number().int().nullable().optional(),
  language: z.enum(['fr', 'en']).nullable().optional(),
  /** FP: an organisation payer's kind and the clinic's provider number with it. */
  organisation_kind: z.enum(['ivac', 'pae']).nullable().optional(),
  provider_number: maybe,
  /** R-84: an IVAC invoice's client's event date (a calendar date). */
  event_on: maybe,
})

const clinicSchema = z.object({
  name: text,
  legal_name: maybe,
  address_line1: maybe,
  address_line2: maybe,
  city: maybe,
  province: maybe,
  postal_code: maybe,
  phone: maybe,
  email: maybe,
  website: maybe,
  gst_number: maybe,
  qst_number: maybe,
  /** BI-21: how to pay by Interac, and the standing note per language ('' = none). */
  etransfer_email: maybe,
  invoice_note_fr: maybe,
  invoice_note_en: maybe,
})

const lineSchema = z.object({
  invoice_id: z.string(),
  line_type: text,
  description: text,
  service_code: z.number().int().nullable().optional(),
  quantity: z.number(),
  unit_price_cents: cents.nullable(),
  subtotal_cents: cents,
  gst_cents: cents,
  qst_cents: cents,
  total_cents: cents,
  professional_id: z.string().nullable().optional(),
  service_date: maybe,
  minutes: z.number().int().nullable().optional(),
  /** R-87: the people a session for several served, in the appointment's order. */
  served: z.array(z.object({
    id: z.string(),
    name: text,
    client_number: z.number().int().nullable().optional(),
  })).max(20).nullable().optional(),
})

const professionalSchema = z.object({
  professional_id: z.string(),
  name: text,
  title: maybe,
  order_name: maybe,
  order_acronym: maybe,
  licence_label: maybe,
  licence_number: maybe,
  supervisor_id: z.string().nullable().optional(),
  supervisor_name: maybe,
  supervisor_title: maybe,
  supervisor_order_name: maybe,
  supervisor_order_acronym: maybe,
  supervisor_licence_label: maybe,
  supervisor_licence_number: maybe,
})

/**
 * R-86: a receipt's signature images as `billing_receipt_signatures_for_service`
 * returns them (service role only: the document itself carries no path).
 */
export const receiptSignaturesSchema = z.array(z.object({
  professional_id: z.string(),
  bucket: z.string(),
  object_path: z.string(),
})).max(50)
export type ReceiptSignature = z.infer<typeof receiptSignaturesSchema>[number]

const invoiceDocSchema = z.object({
  kind: z.enum(['invoice', 'credit_note', 'receipt']),
  id: z.string(),
  number: maybe,
  issued_on: maybe,
  invoice: z.object({
    id: z.string(),
    number: maybe,
    status: text,
    issued_on: maybe,
    tax_exempt: z.boolean(),
    gst_rate: z.number(),
    qst_rate: z.number(),
    subtotal_cents: cents,
    gst_cents: cents,
    qst_cents: cents,
    total_cents: cents,
    paid_cents: cents,
    notes_client: maybe,
    due_on: maybe,
    payer_kind: maybe,
    payer_reference: maybe,
  }),
  payment: z.object({ amount_cents: cents, paid_on: text, mode: maybe })
    .nullable().optional(),
  clinic: clinicSchema,
  client: personSchema,
  payer: personSchema,
  lines: z.array(lineSchema).max(200),
  professionals: z.array(professionalSchema).max(50),
  /** FP-11: an IVAC invoice's professionals' IVAC numbers. */
  payer_numbers: z.array(
    z.object({ professional_id: z.string(), number: text }),
  )
    .max(50).optional(),
})

const statementDocSchema = z.object({
  kind: z.literal('statement'),
  id: z.string(),
  year: z.number().int(),
  period_from: text,
  period_to: text,
  issued_on: text,
  clinic: clinicSchema,
  client: personSchema,
  payer: personSchema,
  invoices: z.array(z.object({
    number: maybe,
    issued_on: maybe,
    status: text,
    total_cents: cents,
    paid_cents: cents,
    credit_note_number: maybe,
  })).max(200),
  payments: z.array(z.object({
    receipt_number: maybe,
    paid_on: text,
    amount_cents: cents,
    mode: maybe,
    invoice_number: maybe,
  })).max(200),
  lines: z.array(lineSchema).max(200),
  professionals: z.array(professionalSchema).max(50),
})

/** A document as `billing_document` returns it. */
export const billingDocumentSchema = z.discriminatedUnion('kind', [
  invoiceDocSchema.extend({ kind: z.literal('invoice') }),
  invoiceDocSchema.extend({ kind: z.literal('credit_note') }),
  invoiceDocSchema.extend({ kind: z.literal('receipt') }),
  statementDocSchema,
])

export type BillingDocument = z.infer<typeof billingDocumentSchema>
type InvoiceDoc = Exclude<BillingDocument, { kind: 'statement' }>
type StatementDoc = Extract<BillingDocument, { kind: 'statement' }>
type Professional = z.infer<typeof professionalSchema>
type Line = z.infer<typeof lineSchema>
export type Language = 'fr' | 'en'

const NBSP = '\u00A0'
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** « 1 234,56 $ » / « $1,234.56 ». */
export function money(value: number, language: Language): string {
  const negative = value < 0
  const abs = Math.abs(value)
  const units = Math.floor(abs / 100).toString()
  const rest = (abs % 100).toString().padStart(2, '0')
  const sep = language === 'fr' ? NBSP : ','
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  const body = language === 'fr'
    ? `${grouped},${rest}${NBSP}$`
    : `$${grouped}.${rest}`
  return negative ? `-${body}` : body
}

/** A calendar date, never shifted: « 13 octobre 2026 » / « October 13, 2026 ». */
export function day(
  value: string | null | undefined,
  language: Language,
): string {
  if (!value) return ''
  if (language === 'fr') return formatDateOnly(value) ?? value
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return value
  return `${EN_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

/** « 9,975 % » / « 9.975% ». */
function percent(rate: number, language: Language): string {
  const value = Number((rate * 100).toFixed(3)).toString()
  return language === 'fr' ? `${value.replace('.', ',')}${NBSP}%` : `${value}%`
}

const LABELS = {
  fr: {
    invoice: 'Facture',
    draft: 'Aperçu du brouillon de facture',
    credit_note: 'Note de crédit',
    receipt: 'Reçu',
    statement: 'Relevé',
    date: 'Date',
    due: 'Échéance\u00A0: sur réception',
    billedTo: 'Facturé à',
    paidBy: 'Payé par',
    servedTo: 'Services rendus à',
    and: 'et',
    file: 'dossier n°',
    service: 'Service',
    professional: 'Professionnel',
    length: 'Durée',
    minutes: 'min',
    amount: 'Montant',
    taxes: 'Taxes',
    total: 'Total',
    subtotal: 'Sous-total',
    gst: 'TPS',
    qst: 'TVQ',
    exempt: 'Exempté de taxes (Statut Indien)',
    professionals: 'Professionnels',
    intern: 'stagiaire',
    supervisedBy: 'sous la supervision de',
    licence: 'N° de permis',
    ivac: 'N° IVAC',
    providerNumber: 'N° de fournisseur de la clinique',
    payerFile: 'N° de dossier',
    dueOn: 'Échéance',
    paying: 'Paiement',
    interac: 'Paiement par virement Interac à {email} (dépôt automatique).',
    paid: 'Montant payé',
    on: 'le',
    forInvoice: 'Pour la facture',
    credits: 'Annule la facture',
    note: 'Note',
    period: 'Période',
    to: 'au',
    invoices: 'Factures',
    payments: 'Paiements',
    number: 'Numéro',
    state: 'État',
    mode: 'Mode',
    receiptNo: 'Reçu',
    credited: 'Créditée',
    issued: 'Émise',
    totalInvoiced: 'Total facturé',
    totalPaid: 'Total payé',
    balance: 'Solde',
    tax: 'Taxes',
    thanks: 'Merci de votre confiance.',
    previewNote:
      'Aperçu\u00A0: ce brouillon n’a pas de numéro et ne vaut pas facture.',
  },
  en: {
    invoice: 'Invoice',
    draft: 'Draft invoice preview',
    credit_note: 'Credit note',
    receipt: 'Receipt',
    statement: 'Statement',
    date: 'Date',
    due: 'Due on receipt',
    billedTo: 'Billed to',
    paidBy: 'Paid by',
    servedTo: 'Services provided to',
    and: 'and',
    file: 'file no.',
    service: 'Service',
    professional: 'Professional',
    length: 'Length',
    minutes: 'min',
    amount: 'Amount',
    taxes: 'Taxes',
    total: 'Total',
    subtotal: 'Subtotal',
    gst: 'GST',
    qst: 'QST',
    exempt: 'Tax exempt (Indian status)',
    professionals: 'Professionals',
    intern: 'intern',
    supervisedBy: 'under the supervision of',
    licence: 'Licence no.',
    ivac: 'IVAC no.',
    providerNumber: 'Clinic provider no.',
    payerFile: 'File no.',
    dueOn: 'Due',
    paying: 'Payment',
    interac: 'Payment by Interac e-Transfer to {email} (autodeposit).',
    paid: 'Amount paid',
    on: 'on',
    forInvoice: 'For invoice',
    credits: 'Cancels invoice',
    note: 'Note',
    period: 'Period',
    to: 'to',
    invoices: 'Invoices',
    payments: 'Payments',
    number: 'Number',
    state: 'Status',
    mode: 'Method',
    receiptNo: 'Receipt',
    credited: 'Credited',
    issued: 'Issued',
    totalInvoiced: 'Total invoiced',
    totalPaid: 'Total paid',
    balance: 'Balance',
    tax: 'Taxes',
    thanks: 'Thank you for your trust.',
    previewNote: 'Preview: this draft has no number and is not an invoice.',
  },
} as const

type Labels = (typeof LABELS)[Language]

/** R-84: the labels of an IVAC invoice's header, as the CNESST's sample has them. */
const IVAC_LABELS = {
  fr: {
    file: 'N° de dossier',
    supplier: 'Fournisseur',
    professional: 'Professionnel',
    permit: 'Permis',
    eventOn: 'Date de l’évènement',
  },
  en: {
    file: 'File no.',
    supplier: 'Supplier',
    professional: 'Professional',
    permit: 'Licence',
    eventOn: 'Date of the event',
  },
} as const

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
function cut(value: string, max: number): string {
  let out = ''
  for (const char of value) {
    if (out.length + char.length > max) break
    out += char
  }
  return out
}

const para = (...runs: Run[]): Block => ({ type: 'paragraph', runs })
/** « Date : » (a no-break space before the colon in French) / « Date: ». */
const label = (value: string, language: Language): Run => ({
  text: language === 'fr' ? `${value}${NBSP}: ` : `${value}: `,
  bold: true,
})
const plain = (value: string): Run => ({ text: cut(value, 5000) })
const bold = (value: string): Run => ({ text: cut(value, 5000), bold: true })
const cell = (value: string) => cut(value, 500)

/** The clinic's lines: name, address, phone, email, site. */
function clinicBlocks(doc: BillingDocument): Block[] {
  const c = doc.clinic
  const address = [
    c.address_line1,
    c.address_line2,
    [c.city, c.province, c.postal_code].filter(Boolean).join(' '),
  ].filter((v) => v && v.trim()).join(', ')
  const contact = [c.phone ? formatPhone(c.phone) : null, c.email, c.website]
    .filter(Boolean).join(' · ')
  const blocks: Block[] = [para(bold(c.legal_name || c.name))]
  if (address) blocks.push(para(plain(address)))
  if (contact) blocks.push(para(plain(contact)))
  return blocks
}

function formatPhone(value: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value)
  return m ? `${m[1]} ${m[2]}-${m[3]}` : value
}

/** « Léa Essai (dossier n° 12) ». */
function personLine(
  p: { name: string; client_number?: number | null },
  l: Labels,
): string {
  return p.client_number
    ? `${p.name} (${l.file}${NBSP}${p.client_number})`
    : p.name
}

/**
 * Who a document's sessions served (R-87): the file's client, then every
 * other person a session for several brought together, once each.
 */
export function servedPeople(
  doc: InvoiceDoc,
): { name: string; client_number?: number | null }[] {
  const people: { id: string; name: string; client_number?: number | null }[] =
    [doc.client]
  for (const line of doc.lines) {
    for (const person of line.served ?? []) {
      if (!people.some((p) => p.id === person.id)) people.push(person)
    }
  }
  return people
}

/** « A », « A et B », « A, B et C ». */
function joinNames(names: string[], l: Labels): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ${l.and} ${names[names.length - 1]}`
}

/** « Psychologue — Ordre des psychologues du Québec (OPQ), N° de permis L-1 ». */
function credentials(
  title: string | null | undefined,
  order: string | null | undefined,
  acronym: string | null | undefined,
  label: string | null | undefined,
  licence: string | null | undefined,
  l: Labels,
): string {
  const orderText = order ? (acronym ? `${order} (${acronym})` : order) : null
  const licenceText = licence ? `${label || l.licence} ${licence}` : null
  const tail = [orderText, licenceText].filter(Boolean).join(', ')
  return [title, tail].filter(Boolean).join(' — ')
}

/**
 * One professional as a receipt prints her: an intern with her supervisor's
 * name, order and licence (R-60).
 */
export function professionalLine(p: Professional, l: Labels): string {
  if (p.supervisor_id && p.supervisor_name) {
    const supervisor = credentials(
      p.supervisor_title,
      p.supervisor_order_name,
      p.supervisor_order_acronym,
      p.supervisor_licence_label,
      p.supervisor_licence_number,
      l,
    )
    return `${p.name}, ${l.intern}, ${l.supervisedBy} ${p.supervisor_name}${
      supervisor ? `, ${supervisor}` : ''
    }`
  }
  const own = credentials(
    p.title,
    p.order_name,
    p.order_acronym,
    p.licence_label,
    p.licence_number,
    l,
  )
  return own ? `${p.name}, ${own}` : p.name
}

function professionalName(
  id: string | null | undefined,
  professionals: Professional[],
  l: Labels,
): string {
  const p = professionals.find((x) => x.professional_id === id)
  if (!p) return ''
  return p.supervisor_id ? `${p.name} (${l.intern})` : p.name
}

function linesTable(
  lines: Line[],
  professionals: Professional[],
  language: Language,
  l: Labels,
): Block {
  return {
    type: 'table',
    columns: [
      { label: l.date, width: 14 },
      { label: l.service, width: 30 },
      { label: l.professional, width: 20 },
      { label: l.length, width: 8 },
      { label: l.amount, width: 10 },
      { label: l.taxes, width: 9 },
      { label: l.total, width: 10 },
    ],
    rows: lines.map((line) => [
      cell(day(line.service_date, language)),
      cell(
        line.quantity !== 1
          ? `${line.description} × ${
            String(line.quantity).replace('.', language === 'fr' ? ',' : '.')
          }`
          : line.description,
      ),
      cell(professionalName(line.professional_id, professionals, l)),
      cell(line.minutes ? `${line.minutes}${NBSP}${l.minutes}` : ''),
      cell(money(line.subtotal_cents, language)),
      cell(
        line.gst_cents + line.qst_cents
          ? money(line.gst_cents + line.qst_cents, language)
          : '',
      ),
      cell(money(line.total_cents, language)),
    ]),
  }
}

function totalsTable(doc: InvoiceDoc, language: Language, l: Labels): Block {
  const i = doc.invoice
  const gst = doc.clinic.gst_number ? ` (${doc.clinic.gst_number})` : ''
  const qst = doc.clinic.qst_number ? ` (${doc.clinic.qst_number})` : ''
  const rows: string[][] = [
    [l.subtotal, money(i.subtotal_cents, language)],
    [
      `${l.gst} ${percent(i.gst_rate, language)}${gst}`,
      money(i.gst_cents, language),
    ],
    [
      `${l.qst} ${percent(i.qst_rate, language)}${qst}`,
      money(i.qst_cents, language),
    ],
    [l.total, money(i.total_cents, language)],
  ]
  if (i.tax_exempt) rows.push([l.exempt, ''])
  return {
    type: 'table',
    columns: [{ label: '', width: 70 }, { label: '', width: 30 }],
    rows: rows.map((r) => r.map(cell)),
  }
}

/** The asset key of the professional's signature image at `index` of `professionals`. */
export function signatureKey(index: number): string {
  return `signature_${index}`
}

/**
 * The signature images a document prints (R-86): those of a receipt's
 * professionals among `signatures`, under `signatureKey(index)`; none on any
 * other document.
 */
export function signatureAssets(
  doc: BillingDocument,
  signatures: readonly ReceiptSignature[],
): { key: string; bucket: string; path: string }[] {
  if (doc.kind !== 'receipt') return []
  return doc.professionals.flatMap((p, i) => {
    const s = signatures.find((x) => x.professional_id === p.professional_id)
    return s
      ? [{ key: signatureKey(i), bucket: s.bucket, path: s.object_path }]
      : []
  })
}

/** A signature's width on the receipt, in points. */
const SIGNATURE_WIDTH = 150

function professionalsBlocks(
  professionals: Professional[],
  l: Labels,
  payerNumbers: { professional_id: string; number: string }[] = [],
  signatures: ReadonlySet<string> = new Set(),
): Block[] {
  if (professionals.length === 0) return []
  const numberOf = (id: string) =>
    payerNumbers.find((n) => n.professional_id === id)?.number
  const lineOf = (p: Professional) => {
    const ivac = numberOf(p.professional_id)
    return plain(
      `${professionalLine(p, l)}${ivac ? `, ${l.ivac} ${ivac}` : ''}`,
    )
  }
  const heading: Block = { type: 'heading', level: 3, text: l.professionals }
  if (!professionals.some((_, i) => signatures.has(signatureKey(i)))) {
    return [heading, {
      type: 'list',
      ordered: false,
      items: professionals.map((p) => [lineOf(p)]),
    }]
  }
  // R-86: each signature above the name it belongs to.
  return [
    heading,
    ...professionals.flatMap((p, i): Block[] => {
      const key = signatureKey(i)
      return signatures.has(key)
        ? [
          { type: 'image', assetKey: key, width: SIGNATURE_WIDTH },
          para(
            lineOf(p),
          ),
        ]
        : [para(lineOf(p))]
    }),
  ]
}

function footer(doc: BillingDocument, l: Labels): PdfDocument['footer'] {
  const parts = [doc.clinic.name]
  if (doc.clinic.gst_number) parts.push(`${l.gst} ${doc.clinic.gst_number}`)
  if (doc.clinic.qst_number) parts.push(`${l.qst} ${doc.clinic.qst_number}`)
  return { text: cut(parts.join(' · '), 120) }
}

/**
 * What an invoice says about paying (BI-21): the Interac line when the clinic has an Interac
 * address, then its standing note in the document's language. Empty when neither is set.
 */
export function paymentNote(doc: BillingDocument, language: Language): string {
  const l = LABELS[language]
  const email = doc.clinic.etransfer_email?.trim()
  const note =
    (language === 'en'
      ? doc.clinic.invoice_note_en
      : doc.clinic.invoice_note_fr)?.trim()
  return [email ? l.interac.replace('{email}', email) : null, note || null]
    .filter(Boolean).join(' ')
}

/** The document's title: « Facture 2026-12 », « Reçu R-2026-3 », « Relevé 2026 ». */
export function documentTitle(
  doc: BillingDocument,
  language: Language,
): string {
  const l = LABELS[language]
  if (doc.kind === 'statement') return `${l.statement} ${doc.year}`
  if (doc.kind === 'invoice' && !doc.number) return l.draft
  return `${l[doc.kind]} ${doc.number ?? ''}`.trim()
}

/** The language a document is written in: the payer's, else French. */
export function documentLanguage(doc: BillingDocument): Language {
  return doc.payer.language === 'en' ? 'en' : 'fr'
}

/**
 * The PDF of a document; `logo` when the clinic's logo is passed as the
 * `logo` asset; `signatures`: the keys of the signature images passed
 * (`signatureAssets`, a receipt only).
 */
export function billingPdf(
  doc: BillingDocument,
  options: { logo: boolean; signatures?: ReadonlySet<string> },
): PdfDocument {
  const language = documentLanguage(doc)
  const l = LABELS[language]
  const title = documentTitle(doc, language)
  const blocks: Block[] = []
  if (options.logo) blocks.push({ type: 'image', assetKey: 'logo', width: 140 })
  blocks.push({ type: 'heading', level: 1, text: cut(title, 300) })
  blocks.push(...clinicBlocks(doc))
  if (doc.kind === 'statement') {
    blocks.push(...statementBlocks(doc, language, l))
  } else {
    blocks.push(
      ...invoiceBlocks(doc, language, l, options.signatures ?? new Set()),
    )
  }
  return {
    title: cut(`${title} — ${doc.clinic.name}`, 200),
    header: { text: cut(title, 120) },
    footer: footer(doc, l),
    blocks,
  }
}

function invoiceBlocks(
  doc: InvoiceDoc,
  language: Language,
  l: Labels,
  signatures: ReadonlySet<string>,
): Block[] {
  const blocks: Block[] = []
  const date = doc.kind === 'invoice' ? doc.invoice.issued_on : doc.issued_on
  if (date) {
    blocks.push(para(label(l.date, language), plain(day(date, language))))
  }
  const organisation = doc.invoice.payer_kind === 'organisation'
  if (doc.kind === 'invoice' && doc.number) {
    // FP-4: an organisation pays in its delay; a client on receipt.
    blocks.push(
      organisation && doc.invoice.due_on
        ? para(
          label(l.dueOn, language),
          plain(day(doc.invoice.due_on, language)),
        )
        : para(plain(l.due)),
    )
  }
  if (doc.kind === 'invoice' && !doc.number) {
    blocks.push(para(bold(l.previewNote)))
  }
  blocks.push(
    para(
      label(doc.kind === 'receipt' ? l.paidBy : l.billedTo, language),
      plain(personLine(doc.payer, l)),
    ),
  )
  if (organisation && doc.payer.organisation_kind === 'ivac') {
    blocks.push(...ivacHeaderBlocks(doc, language))
  } else {
    if (organisation && doc.payer.provider_number) {
      blocks.push(
        para(
          label(l.providerNumber, language),
          plain(doc.payer.provider_number),
        ),
      )
    }
    if (organisation && doc.invoice.payer_reference) {
      blocks.push(
        para(label(l.payerFile, language), plain(doc.invoice.payer_reference)),
      )
    }
  }
  // R-87: a receipt names every person its sessions served.
  const served = doc.kind === 'receipt' ? servedPeople(doc) : [doc.client]
  blocks.push(
    para(
      label(l.servedTo, language),
      plain(joinNames(served.map((p) => personLine(p, l)), l)),
    ),
  )
  if (doc.kind === 'credit_note' && doc.invoice.number) {
    blocks.push(
      para(
        label(l.credits, language),
        plain(
          `${doc.invoice.number} (${day(doc.invoice.issued_on, language)})`,
        ),
      ),
    )
  }
  if (doc.kind === 'receipt' && doc.payment) {
    blocks.push(
      para(
        label(l.paid, language),
        plain(
          `${money(doc.payment.amount_cents, language)} ${l.on} ${
            day(doc.payment.paid_on, language)
          }${doc.payment.mode ? ` (${doc.payment.mode})` : ''}`,
        ),
      ),
    )
    if (doc.invoice.number) {
      blocks.push(
        para(
          label(l.forInvoice, language),
          plain(
            `${doc.invoice.number} (${
              day(doc.invoice.issued_on, language)
            }, ${l.total.toLowerCase()} ${
              money(doc.invoice.total_cents, language)
            })`,
          ),
        ),
      )
    }
  }
  const lines = doc.kind === 'receipt'
    ? doc.lines.filter((x) => x.line_type !== 'adjustment' || x.total_cents)
    : doc.lines
  if (lines.length > 0) {
    blocks.push(linesTable(lines, doc.professionals, language, l))
  }
  blocks.push(totalsTable(doc, language, l))
  blocks.push(
    ...professionalsBlocks(
      doc.professionals,
      l,
      doc.payer_numbers ?? [],
      doc.kind === 'receipt' ? signatures : new Set(),
    ),
  )
  if (doc.kind === 'invoice' && doc.invoice.notes_client) {
    blocks.push(para(label(l.note, language), plain(doc.invoice.notes_client)))
  }
  const paying = doc.kind === 'invoice' ? paymentNote(doc, language) : ''
  if (paying) blocks.push(para(label(l.paying, language), plain(paying)))
  if (doc.kind === 'receipt') blocks.push(para(plain(l.thanks)))
  return blocks
}

/**
 * An IVAC invoice's header (R-84, the CNESST's sample): the client's file
 * number, the clinic with its supplier number, each professional with her
 * IVAC number and her order's permit (an intern without her own: her
 * supervisor's), then the date of the event.
 */
export function ivacHeaderBlocks(doc: InvoiceDoc, language: Language): Block[] {
  const l = IVAC_LABELS[language]
  const blocks: Block[] = []
  if (doc.invoice.payer_reference) {
    blocks.push(
      para(label(l.file, language), plain(doc.invoice.payer_reference)),
    )
  }
  const supplier = [
    doc.clinic.legal_name || doc.clinic.name,
    doc.payer.provider_number,
  ].filter(Boolean).join(' ')
  blocks.push(para(label(l.supplier, language), plain(supplier)))
  for (const p of doc.professionals) {
    const number = doc.payer_numbers?.find((n) =>
      n.professional_id === p.professional_id
    )?.number
    blocks.push(
      para(
        label(l.professional, language),
        plain([p.name, number].filter(Boolean).join(' ')),
      ),
    )
    const own = p.licence_number
    const permit = [
      own
        ? p.order_acronym || p.order_name
        : p.supervisor_order_acronym || p.supervisor_order_name,
      own || p.supervisor_licence_number,
    ].filter(Boolean).join(' ')
    if (permit) blocks.push(para(label(l.permit, language), plain(permit)))
  }
  if (doc.payer.event_on) {
    blocks.push(
      para(
        label(l.eventOn, language),
        plain(day(doc.payer.event_on, language)),
      ),
    )
  }
  return blocks
}

function statementBlocks(
  doc: StatementDoc,
  language: Language,
  l: Labels,
): Block[] {
  const live = doc.invoices.filter((i) => i.status !== 'credited')
  const invoiced = live.reduce((sum, i) => sum + i.total_cents, 0)
  const paid = doc.payments.reduce((sum, p) => sum + p.amount_cents, 0)
  const blocks: Block[] = [
    para(label(l.date, language), plain(day(doc.issued_on, language))),
    para(
      label(l.period, language),
      plain(
        `${day(doc.period_from, language)} ${l.to} ${
          day(doc.period_to, language)
        }`,
      ),
    ),
    para(label(l.billedTo, language), plain(personLine(doc.payer, l))),
    para(label(l.servedTo, language), plain(personLine(doc.client, l))),
  ]
  if (doc.lines.length > 0) {
    blocks.push({ type: 'heading', level: 2, text: l.service })
    blocks.push(linesTable(doc.lines, doc.professionals, language, l))
  }
  blocks.push({ type: 'heading', level: 2, text: l.invoices })
  blocks.push({
    type: 'table',
    columns: [
      { label: l.number, width: 20 },
      { label: l.date, width: 25 },
      { label: l.state, width: 30 },
      { label: l.total, width: 25 },
    ],
    rows: doc.invoices.map((i) => [
      cell(i.number ?? ''),
      cell(day(i.issued_on, language)),
      cell(
        i.status === 'credited'
          ? `${l.credited}${
            i.credit_note_number ? ` (${i.credit_note_number})` : ''
          }`
          : l.issued,
      ),
      cell(money(i.total_cents, language)),
    ]),
  })
  blocks.push({ type: 'heading', level: 2, text: l.payments })
  blocks.push({
    type: 'table',
    columns: [
      { label: l.receiptNo, width: 20 },
      { label: l.date, width: 25 },
      { label: l.mode, width: 30 },
      { label: l.amount, width: 25 },
    ],
    rows: doc.payments.map((p) => [
      cell(p.receipt_number ?? ''),
      cell(day(p.paid_on, language)),
      cell(p.mode ?? ''),
      cell(money(p.amount_cents, language)),
    ]),
  })
  blocks.push({
    type: 'table',
    columns: [{ label: '', width: 70 }, { label: '', width: 30 }],
    rows: [
      [l.totalInvoiced, money(invoiced, language)],
      [l.totalPaid, money(paid, language)],
      [l.balance, money(invoiced - paid, language)],
    ].map((r) => r.map(cell)),
  })
  blocks.push(...professionalsBlocks(doc.professionals, l))
  return blocks
}

/** The email's template, values and the attachment's name. */
export function billingEmail(
  doc: BillingDocument,
  recipientFirstName: string,
): { templateKey: string; values: Record<string, unknown>; filename: string } {
  const language = documentLanguage(doc)
  const suffix = language === 'en' ? '_en' : ''
  const title = documentTitle(doc, language)
  const filename = `${title.replace(/[^\p{L}\p{N} '’()._-]/gu, '').trim()}.pdf`
  const base = {
    recipient: { first_name: recipientFirstName },
    client: { first_name: doc.client.first_name || doc.client.name },
    clinic: { name: doc.clinic.name },
  }
  if (doc.kind === 'statement') {
    const paid = doc.payments.reduce((sum, p) => sum + p.amount_cents, 0)
    return {
      templateKey: `billing.statement${suffix}`,
      filename,
      values: {
        ...base,
        document: { period: String(doc.year), amount: money(paid, language) },
      },
    }
  }
  const amount = doc.kind === 'receipt' && doc.payment
    ? doc.payment.amount_cents
    : doc.invoice.total_cents
  return {
    templateKey: `billing.${doc.kind}${suffix}`,
    filename,
    values: {
      ...base,
      document: {
        number: doc.number ?? '',
        amount: money(amount, language),
        invoice_number: doc.invoice.number ?? '',
        // BI-21: the invoice emails' « Paiement et reçu » (optional variable).
        ...(doc.kind === 'invoice'
          ? { payment_note: paymentNote(doc, language) }
          : {}),
      },
    },
  }
}

/** A reminder's email (F3, R-58): its invoice's PDF, the days since the due date, the balance. */
export function billingReminderEmail(
  doc: BillingDocument,
  recipientFirstName: string,
  days: number,
  balanceCents: number,
): { templateKey: string; values: Record<string, unknown>; filename: string } {
  const language = documentLanguage(doc)
  const invoice = billingEmail(doc, recipientFirstName)
  return {
    templateKey: `billing.reminder${language === 'en' ? '_en' : ''}`,
    filename: invoice.filename,
    values: {
      ...invoice.values,
      document: {
        number: doc.kind === 'statement' ? '' : (doc.number ?? ''),
        amount: money(balanceCents, language),
        days: String(days),
      },
    },
  }
}
