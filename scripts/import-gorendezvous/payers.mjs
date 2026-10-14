// « Payé par » (I2 prep, decision I-17): the « Revenus par facture » export (read by revenue.mjs)
// → one default payer per client for Facturation's `import_default_payer(row, dry_run)`. Pure.
//
// Per client, her latest invoice decides: paid by another person → that person is her default
// payer from that invoice's date; paid by herself, or by an organisation (IVAC, a PAE, an insurer:
// the payers « à compléter » of I-8, never a person's file) → nothing. **The report never prints a
// value from the file** (decision I-6).
import { foldText } from './normalize.mjs'

/** « Payé par » values that name an organisation, not a person (folded, any part of the label). */
const ORGANISATIONS = /\bivac\b|\bpae\b|\beap\b|cnesst|saaq|assuran|insurance|desjardins|sun ?life|manuvie|canada vie|croix bleue|beneva|ssq|programme|employeur|\binc\b|ltee|\blte\b/

export const PAYER_REASON_LABELS = {
  self: 'payée par le client lui-même',
  organisation: 'payée par un organisme (IVAC, PAE, assureur) : payeur « à compléter » dans Clients',
  no_payer: 'sans « Payé par »',
}

/**
 * `invoices` (revenue.mjs's records) → `{ rows, counts }`: `rows`: `{ line, row }` (`row`: the
 * client and the payer by name, the client by the --clients-map when it names the invoice,
 * `effective_from` the invoice's date); `counts`: the clients left out, by reason.
 */
export function defaultPayers(invoices, { refFor = () => null } = {}) {
  const latest = new Map()
  for (const invoice of invoices) {
    const key = foldText(invoice.client)
    const seen = latest.get(key)
    if (!seen || seen.date < invoice.date || (seen.date === invoice.date && seen.invoiceNumber < invoice.invoiceNumber)) latest.set(key, invoice)
  }
  const rows = []
  const counts = { self: 0, organisation: 0, no_payer: 0 }
  for (const invoice of latest.values()) {
    const payer = invoice.payer ? invoice.payer.trim() : ''
    if (payer === '') counts.no_payer += 1
    else if (foldText(payer) === foldText(invoice.client)) counts.self += 1
    else if (ORGANISATIONS.test(foldText(payer))) counts.organisation += 1
    else {
      rows.push({
        line: invoice.line,
        row: { client_ref: refFor(invoice.invoiceNumber), client_name: invoice.client, payer_name: payer, effective_from: invoice.date },
      })
    }
  }
  return { rows: rows.sort((a, b) => a.line - b.line), counts }
}
