/**
 * What OpenAI never sees (CM-19): the names and contact details in a draft,
 * replaced before the call and given back after.
 *
 * - The file's person, the sender and the clinic become the composer's own
 *   placeholders (`{{person.first_name}}`, `{{person.last_name}}`,
 *   `{{sender.name}}`, `{{clinic.name}}`): the model writes with them and
 *   gmail-send fills them at the send, never the browser.
 * - The thread's other correspondents (every display name of its messages'
 *   from, to and cc, read by the database: the thread need not be linked to a
 *   file) become numbered tokens (`[[nom-1]]`), each name whole and each of
 *   its words of three letters or more (« Bonjour Alex »), put back by
 *   `unmask`.
 * - Email addresses, phone numbers and long digit runs (a file or an insurance
 *   number, a SIN) become numbered tokens (`[[courriel-1]]`, `[[téléphone-1]]`,
 *   `[[numéro-1]]`) put back in the answer by `unmask`.
 *
 * A name is matched as a whole word, whatever its case; names of one letter
 * are left alone. Pure.
 */

export interface MaskNames {
  firstName?: string | null
  lastName?: string | null
  senderName?: string | null
  clinicName?: string | null
  /** The thread's correspondents' display names (`correspondent_names`). */
  others?: readonly string[] | null
}

export interface Masker {
  mask(text: string): string
  unmask(text: string): string
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A whole-word, case-insensitive pattern for a name (letters around it end the match). */
function wordPattern(name: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${
      escape(name).replace(/\s+/g, '\\s+')
    }(?![\\p{L}\\p{N}])`,
    'giu',
  )
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE =
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:poste|p\.|ext\.?|#)\s*\d{1,6})?/gi
const DIGITS = /\d(?:[\s-]?\d){6,}/g
const TOKEN = /\[\[(courriel|téléphone|numéro|nom)-(\d+)\]\]/g
/** What a name never replaces: a placeholder or a token already put in. */
const PROTECTED = /(\{\{[^{}]*\}\}|\[\[[^[\]]*\]\])/
/** Name particles left alone when a correspondent's name is split in words. */
const PARTICLES = new Set([
  'des',
  'del',
  'della',
  'den',
  'der',
  'les',
  'van',
  'von',
  'dos',
  'das',
  'mme',
  'mrs',
  'the',
  'and',
])

/** Applies `replace` outside the placeholders and tokens already in `text`. */
function replaceOutside(
  text: string,
  pattern: RegExp,
  replacement: string,
): string {
  return text.split(PROTECTED).map((part, i) =>
    i % 2 === 1 ? part : part.replace(pattern, replacement)
  ).join('')
}

export function createMasker(names: MaskNames): Masker {
  const originals = new Map<string, string>()
  const counters = { courriel: 0, téléphone: 0, numéro: 0, nom: 0 }
  const tokenFor = (kind: keyof typeof counters, value: string): string => {
    for (const [token, original] of originals) {
      if (original === value && token.startsWith(`[[${kind}-`)) return token
    }
    counters[kind] += 1
    const token = `[[${kind}-${counters[kind]}]]`
    originals.set(token, value)
    return token
  }

  // Longest first: « Camille Fictive » before « Camille ».
  const replacements: [RegExp, string][] = []
  const add = (value: string | null | undefined, placeholder: string) => {
    const name = value?.trim()
    if (name && name.length >= 2) {
      replacements.push([wordPattern(name), placeholder])
    }
  }
  const first = names.firstName?.trim()
  const last = names.lastName?.trim()
  if (first && last) {
    add(`${first} ${last}`, '{{person.first_name}} {{person.last_name}}')
  }
  if (first && last) {
    add(`${last} ${first}`, '{{person.first_name}} {{person.last_name}}')
  }
  add(names.clinicName, '{{clinic.name}}')
  add(names.senderName, '{{sender.name}}')
  add(first, '{{person.first_name}}')
  add(last, '{{person.last_name}}')

  // The thread's correspondents: a numbered token each (a name already a
  // placeholder above is left to it, as are the words of the clinic's name).
  const fold = (value: string) => value.trim().toLocaleLowerCase('fr-CA')
  const known = new Set(
    [
      first,
      last,
      first && last ? `${first} ${last}` : null,
      names.senderName,
      names.clinicName,
    ].filter((v): v is string => !!v && v.trim() !== '').map(fold),
  )
  const clinicWords = new Set(
    (names.clinicName ?? '').split(/\s+/).filter(Boolean).map(fold),
  )
  const seen = new Set<string>()
  const addOther = (value: string) => {
    const name = value.trim().replace(/\s+/g, ' ')
    const key = fold(name)
    if (name.length < 2 || known.has(key) || seen.has(key)) return
    seen.add(key)
    replacements.push([wordPattern(name), tokenFor('nom', name)])
  }
  for (const other of names.others ?? []) {
    const full = other.trim()
    if (!full || known.has(fold(full))) continue
    addOther(full)
    for (const word of full.split(/[\s,;()"]+/)) {
      const clean = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      if (
        clean.length >= 3 && !PARTICLES.has(fold(clean)) &&
        !clinicWords.has(fold(clean))
      ) {
        addOther(clean)
      }
    }
  }
  replacements.sort((a, b) => b[0].source.length - a[0].source.length)

  return {
    mask(text) {
      let out = text.replace(EMAIL, (m) => tokenFor('courriel', m))
      out = out.replace(PHONE, (m) => tokenFor('téléphone', m))
      out = out.replace(DIGITS, (m) => tokenFor('numéro', m))
      for (const [pattern, placeholder] of replacements) {
        out = replaceOutside(out, pattern, placeholder)
      }
      return out
    },
    unmask(text) {
      return text.replace(TOKEN, (token) => originals.get(token) ?? '')
    },
  }
}
