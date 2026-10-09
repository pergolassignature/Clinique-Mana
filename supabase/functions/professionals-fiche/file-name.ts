/**
 * The fiche's file name, « Fiche - Prénom Nom.pdf » (P4-200): the attachment's
 * name, built from the name in the database (never from the upload's name).
 * The same rule as the browser's download (`ficheFileName`,
 * `src/modules/professionals/lib/fiche.ts`; parity in its test): letters and
 * digits of every language kept with spaces and `'’()._-`, any other
 * character a space, at most 100 characters with the extension, the
 * `SAFE_FILENAME` rule of `_shared/email/send.ts`. No import: the web app's
 * test reads this file.
 */

const MAX_FILE_NAME = 100
const UNSAFE = /[^\p{L}\p{N} '’()._-]+/gu

export function ficheFileName(
  person: { firstName: string; lastName: string },
): string {
  const name = `${person.firstName} ${person.lastName}`.normalize('NFC')
    .replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  const base = name ? `Fiche - ${name}` : 'Fiche'
  return `${
    Array.from(base).slice(0, MAX_FILE_NAME - 4).join('').trimEnd()
  }.pdf`
}

/**
 * « de » before the name, elided before a vowel or a y (never a h): « d'Aurélie Essai »,
 * « de Marie Tremblay ». The template's `{{professional.of_name}}` (« Fiche d'Aurélie Essai »),
 * the web app's `ofName` (`src/i18n/index.ts`).
 */
export function ofName(name: string): string {
  return /^[aeiouyàâäæéèêëîïôöœùûüÿ]/i.test(name) ? `d'${name}` : `de ${name}`
}
