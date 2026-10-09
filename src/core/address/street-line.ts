/**
 * Line 1 in the province's convention (P4-222), for what the browser writes itself: the typed civic
 * number put back in front of a street Google returned without one, and the suggestion's street
 * when the chosen place cannot be read. The same rule as the `places` function
 * (`supabase/functions/places/address.ts`, `streetLine`); `street-line.test.ts` keeps the two equal.
 *
 * In Québec the OQLF / Canada Post French form `1234, rue Saint-Denis` (a comma after the number,
 * the French generic in lower case); elsewhere `1234 Main Street`.
 */

/** French street generics written in lower case after the number in Québec. */
export const FRENCH_GENERICS: ReadonlySet<string> = new Set([
  'allée',
  'autoroute',
  'avenue',
  'boulevard',
  'carré',
  'carrefour',
  'chemin',
  'circuit',
  'cité',
  'concession',
  'côte',
  'cours',
  'croissant',
  'esplanade',
  'impasse',
  'jardin',
  'montée',
  'parc',
  'passage',
  'place',
  'pointe',
  'promenade',
  'quai',
  'rampe',
  'rang',
  'rond-point',
  'route',
  'rue',
  'ruelle',
  'sentier',
  'square',
  'terrasse',
  'voie',
])

/** A civic number at the start of a line: `1234`, `1234A`, `1234-1236`. */
const CIVIC_NUMBER = /^\s*(\d+[A-Za-z]?(?:-\d+)?)\b/

/** `Rue Saint-Denis` → `rue Saint-Denis` when the first word is a French generic. */
function lowerGeneric(route: string): string {
  const match = /^(\S+)(\s.*)$/u.exec(route)
  if (!match) return route
  const word = match[1]!.toLocaleLowerCase('fr-CA')
  return FRENCH_GENERICS.has(word) ? word + match[2] : route
}

/** True when the street's first word is a French generic (`Rue …`, `Rang …`). */
export function startsWithGeneric(route: string): boolean {
  const word = /^(\S+)\s/u.exec(route.trim())?.[1]
  return word !== undefined && FRENCH_GENERICS.has(word.toLocaleLowerCase('fr-CA'))
}

/** Number and route in the province's convention; null without a route. */
export function streetLine(number: string | null, route: string | null, quebec: boolean): string | null {
  if (!route) return null
  const street = quebec ? lowerGeneric(route) : route
  if (!number) return street
  return quebec ? `${number}, ${street}` : `${number} ${street}`
}

/** The civic number a line starts with (`1234` in « 1234 rue st-d »), or null. */
export function civicNumber(line: string): string | null {
  return CIVIC_NUMBER.exec(line)?.[1] ?? null
}

/**
 * A line split into its civic number and the rest: `1234 Rue Saint-Denis` and `1234, rue
 * Saint-Denis` → `['1234', 'Rue Saint-Denis']`; no number → `[null, line]`.
 */
export function splitCivicNumber(line: string): [string | null, string] {
  const number = civicNumber(line)
  if (!number) return [null, line.trim()]
  return [number, line.trim().slice(number.length).replace(/^\s*,?\s*/, '')]
}
