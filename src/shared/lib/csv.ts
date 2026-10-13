/**
 * CSV exports made in the browser (plan §12: no file stored), for Excel fr-CA: semicolon-separated,
 * a decimal comma, CRLF line ends, a BOM for the accents.
 *
 * Formula injection: a text cell starting with `= + - @`, a tab or a carriage return gets a `'`
 * (a spreadsheet never reads a client's name or a typed reference as a formula). Numbers the app
 * computes (`csvMoney`, `csvNumber`) are written as they are, never guarded.
 */

/** A cell: text (guarded), a number the app computed, or empty. */
export type CsvCell = string | null | undefined | { readonly number: string }

/** A text field, guarded, quoted when it holds a separator, a quote or a line break. */
export function csvField(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Cents as an amount: `17500` → « 175,00 ». */
export const csvMoney = (cents: number): CsvCell => ({ number: (cents / 100).toFixed(2).replace('.', ',') })

/** A number the app computed: `1.5` → « 1,5 », `10150` → « 10150 ». */
export const csvNumber = (value: number): CsvCell => ({ number: String(value).replace('.', ',') })

const cell = (value: CsvCell): string =>
  value == null ? '' : typeof value === 'string' ? csvField(value) : value.number

/** The file: a header, then the rows. */
export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return '\uFEFF' + [header.map(csvField).join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n') + '\r\n'
}

/** Hands the file to the browser (« Exporter »). */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
