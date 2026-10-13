// The price gap report (plan §9 I1, risk « grid prices differ from GOrendezvous's »): for each
// profession title and catalogue code, the prices GOrendezvous actually invoiced (« Revenus par
// service-produit ») against the app's grid price for that title (`list_service_prices`). Pure:
// the lines, the mappings and the grid come from the caller. The report names titles and codes
// only: never a client, and no professional either (prices are per profession).
import { fmtMoney } from './report.mjs'

/** A line's price before taxes for one unit: the unit price when exported, else (total − taxes) / quantity. */
export function unitPriceCents(line) {
  if (line.unit_price_cents !== null && line.unit_price_cents !== undefined) return line.unit_price_cents
  // A discount may be exported either sign (« Rabais » is not documented, I-2): it is added back.
  const net = line.total_cents - (line.tps_cents ?? 0) - (line.tvq_cents ?? 0) + Math.abs(line.discount_cents ?? 0)
  return Math.round(net / (line.quantity || 1))
}

/**
 * Groups the lines by (title, code); a professional counts under her primary title (I-12). `professionalFor(label)` → `{ id, titleId }`, `{ excluded }`
 * or null; `codeFor(line)` → a code or null; `gridPrice(code, titleId)` → cents or null.
 * Returns `{ groups, skipped }`: `groups` [{ titleId, code, lines, prices: [[cents, count]] (most
 * frequent first), observed (the most frequent), grid, gap (observed − grid) }]; `skipped`: the
 * lines left out, by reason (`no_professional`, `excluded`, `unknown_professional`, `no_code`,
 * `no_title`, `free`), counts only.
 */
export function priceGaps(lines, { professionalFor, codeFor, gridPrice }) {
  const groups = new Map()
  const skipped = {}
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }
  for (const line of lines) {
    if (!line.professional) {
      skip('no_professional')
      continue
    }
    const pro = professionalFor(line.professional)
    if (pro === null) {
      skip('unknown_professional')
      continue
    }
    if (pro.excluded) {
      skip('excluded')
      continue
    }
    if (!pro.titleId) {
      skip('no_title')
      continue
    }
    const code = codeFor(line)
    if (!code) {
      skip('no_code')
      continue
    }
    const price = unitPriceCents(line)
    if (price <= 0) {
      skip('free')
      continue
    }
    const key = `${pro.titleId}|${code}`
    if (!groups.has(key)) groups.set(key, { titleId: pro.titleId, code, lines: 0, counts: new Map(), from: null, to: null })
    const group = groups.get(key)
    group.lines++
    if (line.date) {
      if (!group.from || line.date < group.from) group.from = line.date
      if (!group.to || line.date > group.to) group.to = line.date
    }
    group.counts.set(price, (group.counts.get(price) ?? 0) + 1)
  }
  const result = [...groups.values()].map((g) => {
    const prices = [...g.counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const observed = prices[0][0]
    const grid = gridPrice(g.code, g.titleId)
    return { titleId: g.titleId, code: g.code, lines: g.lines, from: g.from, to: g.to, prices, observed, grid, gap: grid === null ? null : observed - grid }
  })
  return { groups: result, skipped }
}

export const SKIP_LABELS = {
  no_professional: 'sans professionnel',
  unknown_professional: 'professionnel absent du fichier des employés',
  excluded: 'agenda exclu (conseillère, Administration, Z MATRICE)',
  no_title: 'professionnel sans titre principal',
  no_code: 'service sans code du catalogue (à ajouter au fichier des services)',
  free: 'gratuit ou crédité',
}

const signed = (cents) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${fmtMoney(Math.abs(cents))}`

/**
 * The report's lines: per title (its name), per code (its name), the most frequent price with its
 * count, the others, the grid's price and the gap; then the lines left out. `titleName(id)`,
 * `serviceName(code)` name them.
 */
export function priceGapReport({ groups, skipped }, { titleName, serviceName, on }) {
  const out = [`== Écarts de prix : GOrendezvous (prix facturés) et grilles de l’app au ${on}`]
  const byTitle = new Map()
  for (const g of groups) {
    if (!byTitle.has(g.titleId)) byTitle.set(g.titleId, [])
    byTitle.get(g.titleId).push(g)
  }
  const gaps = groups.filter((g) => g.gap !== null && g.gap !== 0).length
  out.push(`Combinaisons titre et service : ${groups.length} ; avec un écart : ${gaps} ; sans prix dans l’app : ${groups.filter((g) => g.grid === null).length}`)
  for (const [titleId, list] of [...byTitle].sort((a, b) => titleName(a[0]).localeCompare(titleName(b[0]), 'fr'))) {
    out.push(`${titleName(titleId)} :`)
    for (const g of list.sort((a, b) => a.code.localeCompare(b.code))) {
      const others = g.prices.slice(1, 4).map(([cents, n]) => `${fmtMoney(cents)} ×${n}`)
      // The period invoiced: an old price from before a rise shows as a gap; the dates say so.
      const period = g.from ? `, du ${g.from} au ${g.to}` : ''
      const observed = `${fmtMoney(g.observed)} (${g.prices[0][1]} ligne${g.prices[0][1] > 1 ? 's' : ''}${others.length > 0 ? ` ; aussi ${others.join(', ')}` : ''}${period})`
      const grid = g.grid === null ? 'pas de prix dans l’app' : `app ${fmtMoney(g.grid)}`
      const gap = g.gap === null ? '' : g.gap === 0 ? ' · aucun écart' : ` · écart (app − GOrendezvous) ${signed(-g.gap)}`
      out.push(`  - ${g.code} ${serviceName(g.code)} : GOrendezvous ${observed} · ${grid}${gap}`)
    }
  }
  const left = Object.entries(skipped)
  if (left.length > 0) out.push(`Lignes laissées de côté : ${left.map(([reason, n]) => `${SKIP_LABELS[reason] ?? reason} (${n})`).join(', ')}`)
  return out
}
