/**
 * The professional's invoice to the clinic for a validated payroll period
 * (FPay, « Générer ma facture »): her name and address, the clinic, the
 * number she chose and its date, one row per line of the summary and the
 * total. Clients appear by file number only (« Dossier 1042 »), never by
 * name: the clinic's copy needs no more (Loi 25).
 *
 * pdfmake-free: plain model data, rendered by `handler.ts`.
 */
import { z } from 'zod'
import { formatDateOnly } from '../_shared/format.ts'
import { frenchSpacing, NNBSP } from '../_shared/french.ts'
import type { Block, PdfDocument } from '../_shared/pdf/model.ts'

const text = z.string().nullable().optional()

/** What `prepare_professional_invoice` returns (only the fields printed). */
export const preparedSchema = z.object({
  org_id: z.guid(),
  period_id: z.guid(),
  month: z.string(),
  month_label: z.string(),
  total_cents: z.number().int(),
  title_name: text,
  professional: z.object({
    display_name: z.string(),
    title_label: text,
    address_line1: text,
    address_line2: text,
    city: text,
    province: text,
    postal_code: text,
    gst_number: text,
    qst_number: text,
  }),
  clinic: z.object({
    name: z.string(),
    address_line1: text,
    address_line2: text,
    city: text,
    province: text,
    postal_code: text,
  }),
  today: z.string(),
  lines: z.array(z.object({
    kind: z.enum([
      'session',
      'late_cancellation',
      'other_fees',
      'workshop',
      'adjustment',
    ]),
    occurred_on: z.string(),
    client_number: z.number().int().nullable().optional(),
    service_code: z.number().int().nullable().optional(),
    service_name: text,
    base_cents: z.number().int().nullable().optional(),
    retention_pct: z.number().nullable().optional(),
    amount_cents: z.number().int().nullable().optional(),
    note: text,
  })).max(400),
})

/** The prepared invoice. */
export type PreparedInvoice = z.infer<typeof preparedSchema>

/** « 1 234,56 $ » with French spacing. */
export function money(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const units = Math.floor(abs / 100).toString().replace(
    /\B(?=(\d{3})+(?!\d))/g,
    NNBSP,
  )
  const rest = (abs % 100).toString().padStart(2, '0')
  return `${negative ? '−' : ''}${units},${rest}${NNBSP}$`
}

/** « 28 % », « 27,5 % ». */
function percent(value: number): string {
  return `${value.toString().replace('.', ',')}${NNBSP}%`
}

const KIND_LABEL: Record<PreparedInvoice['lines'][number]['kind'], string> = {
  session: 'Rencontre',
  late_cancellation: 'Annulation tardive ou absence',
  other_fees: 'Autres frais',
  workshop: 'Atelier',
  adjustment: 'Ajustement',
}

function cut(value: string, max: number): string {
  let out = ''
  for (const char of value) {
    if (out.length + char.length > max) break
    out += char
  }
  return out
}

function addressLines(a: {
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
}): string[] {
  const city = [a.city, a.province].filter(Boolean).join(' (') +
    (a.city && a.province ? ')' : '')
  return [
    a.address_line1,
    a.address_line2,
    [city, a.postal_code].filter(Boolean).join('  '),
  ]
    .filter((line): line is string => !!line && line.trim() !== '')
}

/** The invoice document. */
export function payoutInvoiceDocument(
  invoice: PreparedInvoice,
  number: string,
  issuedOn: string,
): PdfDocument {
  const pro = invoice.professional
  const from = [pro.display_name, pro.title_label ?? '', ...addressLines(pro)]
    .filter((line) => line !== '')
  if (pro.gst_number) from.push(`TPS${NNBSP}: ${pro.gst_number}`)
  if (pro.qst_number) from.push(`TVQ${NNBSP}: ${pro.qst_number}`)
  const to = [invoice.clinic.name, ...addressLines(invoice.clinic)]

  const rows = invoice.lines.map((line) => {
    const what = line.kind === 'adjustment'
      ? `Ajustement : ${line.note ?? ''}`
      : [
        KIND_LABEL[line.kind],
        line.service_code
          ? `${line.service_code} ${line.service_name ?? ''}`.trim()
          : null,
      ]
        .filter(Boolean).join(' · ')
    return [
      formatDateOnly(line.occurred_on) ?? line.occurred_on,
      line.client_number ? `Dossier ${line.client_number}` : '',
      cut(frenchSpacing(what), 500),
      line.base_cents == null ? '' : money(line.base_cents),
      line.retention_pct == null ? '' : percent(line.retention_pct),
      line.amount_cents == null ? '' : money(line.amount_cents),
    ]
  })

  const blocks: Block[] = [
    { type: 'heading', level: 1, text: `Facture ${cut(number, 40)}` },
    {
      type: 'paragraph',
      runs: [{
        text: frenchSpacing(`Date : ${formatDateOnly(issuedOn) ?? issuedOn}`),
      }],
    },
    {
      type: 'paragraph',
      runs: [{ text: frenchSpacing(`Période : ${invoice.month_label}`) }],
    },
    { type: 'heading', level: 3, text: 'De' },
    {
      type: 'paragraph',
      runs: from.map((line, i) => ({
        text: (i ? '\n' : '') + line,
        bold: i === 0,
      })),
    },
    { type: 'heading', level: 3, text: 'À' },
    {
      type: 'paragraph',
      runs: to.map((line, i) => ({
        text: (i ? '\n' : '') + line,
        bold: i === 0,
      })),
    },
    {
      type: 'table',
      columns: [
        { label: 'Date', width: 14 },
        { label: 'Dossier', width: 13 },
        { label: 'Service', width: 37 },
        { label: 'Prix', width: 12 },
        { label: 'Rétention', width: 10 },
        { label: 'Montant', width: 14 },
      ],
      rows: rows.slice(0, 200),
    },
  ]
  if (rows.length > 200) {
    blocks.push({
      type: 'table',
      columns: [
        { label: 'Date', width: 14 },
        { label: 'Dossier', width: 13 },
        { label: 'Service', width: 37 },
        { label: 'Prix', width: 12 },
        { label: 'Rétention', width: 10 },
        { label: 'Montant', width: 14 },
      ],
      rows: rows.slice(200, 400),
    })
  }
  blocks.push({
    type: 'paragraph',
    runs: [{
      text: frenchSpacing(`Total : ${money(invoice.total_cents)}`),
      bold: true,
    }],
  })

  return {
    title: cut(`Facture ${number} — ${pro.display_name}`, 200),
    footer: { text: cut(`${pro.display_name} · Facture ${number}`, 120) },
    blocks,
  }
}
