/**
 * Text whose accents were mangled by a bad decode.
 *
 * UTF-8 read back as Latin-1 — Excel's plain « CSV » save on Windows, a page served without a
 * charset, an older database — turns every accented character into two: `é` becomes `Ã©`, `à`
 * becomes `Ã` and a no-break space, `’` becomes `â€™`. A title-case running afterwards lowers the
 * first of the pair, which is how « Saint-Irénée » reached the clinic's file as « Saint-Irã©Nã©E ».
 *
 * Nothing in this app mangles text that way, and both importers refuse a file that is not UTF-8.
 * The guard is for what people paste in from elsewhere.
 */

/**
 * The first character of a mangled pair: UTF-8's lead bytes C2, C3 and E2 as Latin-1 reads them
 * (`Â`, `Ã`, `â`), plus the `ã` that a later lower-casing leaves. C2 carries « », ° and §, C3 every
 * French accent, E2 the curly apostrophe and the dashes.
 */
const LEAD = '\\u00c2\\u00c3\\u00e2\\u00e3'

/**
 * The second: what a continuation byte (0x80–0xBF) becomes — the C1 block and Latin-1 punctuation,
 * `©` and the no-break space among them — plus the `€` that opens a three-byte character (`â€™`).
 */
const CONTINUATION = '\\u0080-\\u00bf\\u20ac'

const MOJIBAKE = new RegExp(`[${LEAD}][${CONTINUATION}]`, 'u')

/**
 * Whether the text carries that signature. French never puts one of those first characters in
 * front of a punctuation mark — « Château » has its `â` before a letter, « São » its `ã` — so a
 * real address, city or name does not trip it.
 */
export function looksMojibake(value: string): boolean {
  return MOJIBAKE.test(value)
}
