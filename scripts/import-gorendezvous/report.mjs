// The dry-run report (plan §9, I1 acceptance): counts, rejected rows with their reasons, duplicates,
// money totals. **No personal value is ever printed**: rows are named by their line in the file,
// reasons by their French label; no name, email, phone, birth date, address, note or ClientId.
import { REASON_LABELS } from './clients.mjs'
import { LIST_REASON_LABELS } from './lists.mjs'
import { REVENUE_REASON_LABELS } from './revenue.mjs'

const LABELS = { ...REASON_LABELS, ...REVENUE_REASON_LABELS, ...LIST_REASON_LABELS }

export const DUPLICATE_REASON_LABELS = {
  email: 'même courriel',
  phone: 'même téléphone',
  same_name: 'même nom',
  similar_name: 'nom semblable',
  birthday: 'même date de naissance',
  birthday_differs: 'dates de naissance différentes',
  shared_contact: 'coordonnée partagée (un proche ?)',
  partial_email: 'courriel presque identique',
  partial_phone: 'mêmes 7 derniers chiffres',
}

const fmtCount = (n) => n.toLocaleString('fr-CA')
/** « 1 paire », « 3 paires ». */
const plural = (n, one, other) => `${fmtCount(n)} ${n === 1 ? one : other}`

/** What a tag became, in French. */
export const TAG_FIELD_LABELS = {
  'rate_variant=student': 'tarif étudiant',
  'rate_variant=reduced': 'tarif réduit',
  'is_banned=true': 'client banni',
  'file_incomplete=true': 'dossier incomplet',
  'special_agreement=true': 'entente particulière (paiement ou facturation)',
  'tax_exempt=true': 'exemption de taxes (Statut Indien)',
  'payer=ivac': 'payeur IVAC à compléter',
  'payer=pae': 'payeur PAE à compléter',
  'payer=external': 'payeur externe à compléter',
}

/** The payment methods Facturation records, in French. */
export const PAYMENT_METHOD_LABELS = {
  card_qbo_payments: 'Carte (QuickBooks Payments)',
  card_stripe: 'Carte (Stripe)',
  interac: 'Interac',
  credit_note: 'Note de crédit',
  cheque: 'Chèque',
  bank_transfer: 'Virement bancaire',
}
/** Cents as « 1 234,56 $ ». */
export const fmtMoney = (cents) =>
  `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`

/** Line numbers, at most `max` of them, then « … et N autres ». */
function lineList(lines, max = 30) {
  const sorted = [...lines].sort((a, b) => a - b)
  const shown = sorted.slice(0, max).join(', ')
  return sorted.length > max ? `${shown} … et ${sorted.length - max} autres` : shown
}

/** Groups `{ line, reasons }` items by reason: « label (N) : lignes … ». */
function byReason(items) {
  const groups = new Map()
  for (const { line, reasons } of items) {
    for (const reason of reasons) {
      if (!groups.has(reason)) groups.set(reason, [])
      groups.get(reason).push(line)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reason, lines]) => `  - ${LABELS[reason] ?? reason} (${fmtCount(lines.length)}) : lignes ${lineList(lines)}`)
}

/** The clients section: counts, rejects, flags, tag mapping, duplicates. */
export function clientsReport({ clients, rejected, columns }, duplicates) {
  const out = ['== Clients']
  const active = clients.filter((c) => !c.archived).length
  out.push(`Lignes lues : ${fmtCount(clients.length + rejected.length)} ; gardées : ${fmtCount(clients.length)} (actives ${fmtCount(active)}, archivées ${fmtCount(clients.length - active)}) ; rejetées : ${fmtCount(rejected.length)}`)
  const count = (pred) => fmtCount(clients.filter(pred).length)
  out.push(
    `Sans courriel : ${count((c) => !c.email)} ; sans aucun téléphone : ${count((c) => !c.mobile_e164 && !c.home_e164 && !c.work_e164)} ; sans date de naissance : ${count((c) => !c.birthday)} ; sans professionnel principal : ${count((c) => !c.primary_professional_label)}`,
  )
  if (columns.unused.length > 0) out.push(`Colonnes non lues : ${columns.unused.join(', ')}`)
  if (rejected.length > 0) out.push('Rejetées :', ...byReason(rejected))
  const flagged = clients.filter((c) => c.flags.length > 0).map((c) => ({ line: c.line, reasons: c.flags }))
  if (flagged.length > 0) out.push('Gardées avec une valeur laissée vide ou à vérifier :', ...byReason(flagged))

  const fieldCounts = new Map()
  for (const c of clients) {
    for (const [field, value] of Object.entries(c.tagFields)) fieldCounts.set(`${field}=${value}`, (fieldCounts.get(`${field}=${value}`) ?? 0) + 1)
    for (const payer of c.payers) fieldCounts.set(`payer=${payer}`, (fieldCounts.get(`payer=${payer}`) ?? 0) + 1)
  }
  if (fieldCounts.size > 0) {
    out.push(`Étiquettes devenues des champs : ${[...fieldCounts].map(([k, n]) => `${TAG_FIELD_LABELS[k] ?? k} (${fmtCount(n)})`).join(', ')}`)
  }
  const unknown = new Set(clients.flatMap((c) => c.unknownTags))
  if (unknown.size > 0) out.push(`Étiquettes inconnues (gardées libres, à ajouter à la table) : ${[...unknown].join(', ')}`)

  if (duplicates) out.push(...duplicatesReport(duplicates))
  return out
}

/** HIGH and MEDIUM pairs by line numbers, the groups, the crowded contacts. */
export function duplicatesReport({ pairs, groups, crowded }) {
  const out = []
  const high = pairs.filter((p) => p.level === 'high')
  const medium = pairs.filter((p) => p.level === 'medium')
  const where = (r) => (r.source === 'app' ? 'client déjà dans l’app' : `ligne ${r.line}`)
  const pairLine = (p) => `  - ${where(p.a)} ↔ ${where(p.b)} : ${p.reasons.map((r) => DUPLICATE_REASON_LABELS[r] ?? r).join(', ')}`
  out.push(
    `Doublons : HIGH ${plural(high.length, 'paire', 'paires')} (${plural(groups.length, 'personne', 'personnes')} en plusieurs fiches), MEDIUM ${plural(medium.length, 'paire', 'paires')} à trancher`,
  )
  if (high.length > 0) out.push('HIGH (même personne, rattachées) :', ...high.map(pairLine))
  if (medium.length > 0) out.push('MEDIUM (à trancher à la main) :', ...medium.map(pairLine))
  for (const c of crowded) {
    out.push(`  - ${c.kind === 'email' ? 'Un courriel' : 'Un téléphone'} partagé par ${fmtCount(c.size)} fiches : ignoré pour les doublons (valeur générique ?)`)
  }
  return out
}

/** A money section (invoices, lines or payments): counts, rejects, totals per month. */
export function moneyReport(title, { items, rejected, amount, extra = [] }) {
  const out = [`== ${title}`]
  out.push(`Lignes lues : ${fmtCount(items.length + rejected.length)} ; gardées : ${fmtCount(items.length)} ; rejetées : ${fmtCount(rejected.length)}`)
  const months = new Map()
  for (const item of items) {
    const month = item.date ? item.date.slice(0, 7) : '?'
    months.set(month, (months.get(month) ?? 0) + amount(item))
  }
  const total = [...months.values()].reduce((a, b) => a + b, 0)
  out.push(`Total : ${fmtMoney(total)}`)
  for (const [month, cents] of [...months].sort()) out.push(`  - ${month} : ${fmtMoney(cents)}`)
  out.push(...extra)
  if (rejected.length > 0) out.push('Rejetées :', ...byReason(rejected))
  return out
}

/** A section of a list export (waitlist, cancellations): counts and rejects. */
export function listReport(title, { items, rejected, extra = [] }) {
  const out = [`== ${title}`]
  out.push(`Lignes lues : ${fmtCount(items.length + rejected.length)} ; gardées : ${fmtCount(items.length)} ; rejetées : ${fmtCount(rejected.length)}`)
  out.push(...extra)
  const flagged = items.filter((i) => i.flags?.length > 0).map((i) => ({ line: i.line, reasons: i.flags }))
  if (flagged.length > 0) out.push('Gardées avec une valeur laissée vide :', ...byReason(flagged))
  if (rejected.length > 0) out.push('Rejetées :', ...byReason(rejected))
  return out
}
