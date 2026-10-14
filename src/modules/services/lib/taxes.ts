/**
 * The after-tax preview of « Prix » (parity audit L27): a taxable price with the GST and the QST in
 * force that day, each tax rounded to the cent on its own, as an invoice line computes them
 * (Facturation's `billing_line_amounts`, §F). A preview only: the invoice computes in SQL.
 */
export interface TaxRatesOn {
  gst: number | null
  qst: number | null
}

/** `cents` with both taxes, or null while a rate is unknown (none in force: Paramètres → Fiscalité). */
export function withTaxes(cents: number, rates: TaxRatesOn): number | null {
  if (rates.gst === null || rates.qst === null) return null
  return cents + Math.round(cents * rates.gst) + Math.round(cents * rates.qst)
}
