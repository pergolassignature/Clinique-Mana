// GOrendezvous tags (étiquettes) → client fields (plan §6.1–6.2 and §9, decision R-7, roadmap
// question 13). The useful tags become fields of `clients` or a payer of `client_payers`; the
// satisfaction and obsolete ones are dropped; the others stay free tags (5 at most per client). The
// mapping is a table so Christine can review it line by line (decision I-4).
import { foldText } from './normalize.mjs'

/** What a tag becomes. `field`: a `clients` column and its value; `payer`: a `client_payers.kind`; `free`: kept as a free tag; `drop`: not imported. */
export const TAG_RULES = [
  { tag: 'Tarif étudiant', field: ['rate_variant', 'student'] },
  { tag: 'Tarif réduit', field: ['rate_variant', 'reduced'] },
  { tag: 'Client banni', field: ['is_banned', true] },
  { tag: 'Dossier incomplet', field: ['file_incomplete', true] },
  { tag: 'Entente de paiement', field: ['payment_plan', true] },
  { tag: 'Facturation personnalisée', field: ['custom_billing', true] },
  // Christine, answer 16: « Statut Indien » means tax-exempt.
  { tag: 'Statut Indien', field: ['tax_exempt_status', true] },
  { tag: 'IVAC', payer: 'ivac' },
  { tag: 'PAE externe', payer: 'pae' },
  { tag: 'Payeur externe', payer: 'employer' },
  // Satisfaction tags disappear (question 13); « Visio » is every client (all sessions are online);
  // the old/new rate tags are the price grid's business now; « Nouveau client » is derived from the
  // visits.
  { tag: 'Satisfaite', drop: 'satisfaction' },
  { tag: 'Très satisfait(e)', drop: 'satisfaction' },
  { tag: 'Très satisfaite', drop: 'satisfaction' },
  { tag: 'Très satisfait', drop: 'satisfaction' },
  { tag: 'Visio', drop: 'obsolete' },
  { tag: 'Ancien tarif', drop: 'obsolete' },
  { tag: 'Nouveau tarif', drop: 'obsolete' },
  { tag: 'Nouveau client', drop: 'derived' },
  // Kept as free tags (5 at most): to review with Christine.
  { tag: 'Annulation ou absence 1re rencontre', free: true },
  { tag: 'Atelier', free: true },
  { tag: 'ATTENTION', free: true },
  { tag: 'Couple', free: true },
  { tag: 'Famille', free: true },
  { tag: 'Entreprise MANA', free: true },
  { tag: 'Fin de suivi', free: true },
  { tag: "Liste d'attente", free: true },
  { tag: 'Mauvais client', free: true },
  { tag: 'Naturopathie', free: true },
  { tag: 'Note de crédit', free: true },
  { tag: 'Offert', free: true },
  { tag: 'Paiement automatique', free: true },
  { tag: 'Payeur', free: true },
]

/** The most free tags a client keeps (`client_tags`, ≤ 5 per client). */
export const MAX_FREE_TAGS = 5

const RULES = new Map(TAG_RULES.map((rule) => [foldText(rule.tag), rule]))

/** The tags of a cell: « , », « ; » or « | » separated, trimmed, the duplicated ones (« IVAC » twice) counted once. */
export function splitTags(cell) {
  const seen = new Map()
  for (const part of String(cell ?? '').split(/[;,|]/)) {
    const text = part.replace(/\s+/g, ' ').trim()
    if (text !== '' && !seen.has(foldText(text))) seen.set(foldText(text), text)
  }
  return [...seen.values()]
}

/**
 * One client's tags → `{ fields, payers, freeTags, dropped, unknown, issues }`. `issues` holds
 * codes for the report: `rate_conflict` (both student and reduced: neither is set, to decide by
 * hand), `free_tags_over_limit` (more than 5 free tags: the first 5 kept). An unknown tag is kept
 * as a free tag and listed in `unknown` (by name: a tag is the clinic's label, not personal data).
 */
export function mapTags(tags) {
  const fields = {}
  const payers = []
  const freeTags = []
  const dropped = []
  const unknown = []
  const issues = []
  const rates = new Set()
  for (const tag of tags) {
    const rule = RULES.get(foldText(tag))
    if (!rule) {
      unknown.push(tag)
      freeTags.push(tag)
    } else if (rule.field) {
      const [column, value] = rule.field
      if (column === 'rate_variant') rates.add(value)
      else fields[column] = value
    } else if (rule.payer) {
      if (!payers.includes(rule.payer)) payers.push(rule.payer)
    } else if (rule.drop) {
      dropped.push(rule.tag)
    } else {
      freeTags.push(rule.tag)
    }
  }
  if (rates.size > 1) issues.push('rate_conflict')
  else if (rates.size === 1) fields.rate_variant = [...rates][0]
  if (freeTags.length > MAX_FREE_TAGS) issues.push('free_tags_over_limit')
  return { fields, payers, freeTags: freeTags.slice(0, MAX_FREE_TAGS), dropped, unknown, issues }
}
