/**
 * Google Places (New) address components → the app's address fields
 * (P4-222). Pure: no I/O, no env.
 *
 * - `line1`: street number + route. In Québec the OQLF / Canada Post French
 *   form `1234, rue Saint-Denis` (a comma after the number, the generic in
 *   lower case: Google returns `Rue Saint-Denis`); elsewhere `1234 Main
 *   Street`. A route without a number is the route alone (the app puts the
 *   typed civic number back in front, `src/core/address/autofill.ts`);
 *   neither → the first segment of `formattedAddress` (a named place), unless
 *   it is an area (the city, a sublocality, a neighbourhood, the province,
 *   the country: a place that is no address), else null, so line 1 stays as
 *   typed. Outside Québec, a French-named street keeps Google's form
 *   (`100 Rue Principale`).
 * - `line2`: the unit (`subpremise`) as Google gives it (`4`), or null. The
 *   app fills « Appartement ou bureau » with it only when that field is empty.
 * - `city`: `locality`, then `postal_town`, `sublocality_level_1`,
 *   `sublocality`, `administrative_area_level_3`. Montréal's arrondissements
 *   (Verdun, Le Plateau-Mont-Royal) come as sublocalities next to the
 *   `Montréal` locality, so the city stays Montréal.
 * - `province`: one of the 13 two-letter codes, from `shortText`, else from
 *   the French or English name; anything else (a US state) → null.
 * - `postal_code`: `A1A 1A1` (upper case, one space), or null when Google has
 *   none or only a prefix (`postal_code_prefix`, `J0R`).
 * - `country`: the ISO code (`CA`), or null.
 */

/** One `addressComponents` entry of a Places (New) place. */
export interface AddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

/** What `details` answers: every field nullable. */
export interface PlaceAddress {
  line1: string | null
  line2: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
}

/** The 13 codes `organizations_province_check` and the professionals' check allow. */
export const PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const

/** Province names, French and English, folded (`foldName`) → code. */
const PROVINCE_NAMES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  'colombie-britannique': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'nouveau-brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'terre-neuve-et-labrador': 'NL',
  'nova scotia': 'NS',
  'nouvelle-ecosse': 'NS',
  'northwest territories': 'NT',
  'territoires du nord-ouest': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  'ile-du-prince-edouard': 'PE',
  quebec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
}

/**
 * French street generics written in lower case after the number in Québec
 * (`1234, rue Saint-Denis`, `1500, rang Saint-Joseph`, `2200, route 132`).
 * The browser keeps the same list (`src/core/address/street-line.ts`; a
 * parity test compares them).
 */
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

const CITY_TYPES = [
  'locality',
  'postal_town',
  'sublocality_level_1',
  'sublocality',
  'administrative_area_level_3',
] as const

/**
 * Component types that name an area, not a street: a formatted address whose
 * first segment is one of them is a city, a neighbourhood, a province… and
 * gives no line 1.
 */
const AREA_TYPES = new Set([
  'locality',
  'postal_town',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
  'neighborhood',
  'colloquial_area',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'administrative_area_level_6',
  'administrative_area_level_7',
  'country',
  'postal_code',
  'postal_code_prefix',
])

const POSTAL_CODE = /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/

/** Lower case, accents removed: `Québec` → `quebec`, `Île-du-Prince-Édouard` → `ile-du-prince-edouard`. */
function foldName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .trim()
}

/** Trims and collapses whitespace; empty → null. Control characters become spaces. */
function clean(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  // deno-lint-ignore no-control-regex -- removing control characters is the point
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

/** The component of `type` (its long text, else its short text), or null. */
function pick(
  components: AddressComponent[],
  type: string,
  which: 'longText' | 'shortText' = 'longText',
): string | null {
  const found = components.find((c) => c.types?.includes(type))
  if (!found) return null
  const other = which === 'longText' ? 'shortText' : 'longText'
  return clean(found[which]) ?? clean(found[other])
}

/** `h2x3j6`, `H2X-3J6`, `H2X 3J6` → `H2X 3J6`; anything else → null. */
export function canonicalPostalCode(value: string | null): string | null {
  if (!value) return null
  const compact = value.toUpperCase().replace(/[\s-]/g, '')
  return POSTAL_CODE.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : null
}

/** The province's code, from Google's short text or its name; null when not one of the 13. */
export function provinceCode(
  component: AddressComponent | undefined,
): string | null {
  if (!component) return null
  const short = clean(component.shortText)?.toUpperCase()
  if (short && (PROVINCES as readonly string[]).includes(short)) return short
  for (const text of [component.longText, component.shortText]) {
    const code = PROVINCE_NAMES[foldName(clean(text) ?? '')]
    if (code) return code
  }
  return null
}

/** `Rue Saint-Denis` → `rue Saint-Denis` when the first word is a French generic. */
function lowerGeneric(route: string): string {
  const [, first, rest] = /^(\S+)(\s.*)$/u.exec(route) ?? []
  if (first === undefined || rest === undefined) return route
  const word = first.toLocaleLowerCase('fr-CA')
  return FRENCH_GENERICS.has(word) ? word + rest : route
}

/** Line 1: number and route in the province's convention (see the module comment). */
export function streetLine(
  number: string | null,
  route: string | null,
  quebec: boolean,
): string | null {
  // A number alone says nothing: the caller falls back to the formatted address.
  if (!route) return null
  const street = quebec ? lowerGeneric(route) : route
  if (!number) return street
  return quebec ? `${number}, ${street}` : `${number} ${street}`
}

/** True when `segment` names one of the place's areas, or a province. */
function isAreaName(segment: string, components: AddressComponent[]): boolean {
  const folded = foldName(segment)
  if (PROVINCE_NAMES[folded]) return true
  if ((PROVINCES as readonly string[]).includes(segment.toUpperCase())) {
    return true
  }
  return components.some((c) =>
    c.types?.some((type) => AREA_TYPES.has(type)) &&
    [c.longText, c.shortText].some((text) => {
      const name = clean(text)
      return name !== null && foldName(name) === folded
    })
  )
}

/** Maps a place's components (and formatted address, for line 1's fallback). */
export function toPlaceAddress(
  components: AddressComponent[],
  formattedAddress?: string,
): PlaceAddress {
  const province = provinceCode(
    components.find((c) => c.types?.includes('administrative_area_level_1')),
  )
  let city: string | null = null
  for (const type of CITY_TYPES) {
    city = pick(components, type)
    if (city) break
  }
  let line1 = streetLine(
    pick(components, 'street_number'),
    pick(components, 'route'),
    province === 'QC',
  )
  if (!line1) {
    // A named place without a route (rare in Canada): its first segment, unless it is an area.
    const first = clean(formattedAddress?.split(',')[0])
    line1 = first && !isAreaName(first, components) ? first : null
  }
  const country = pick(components, 'country', 'shortText')?.toUpperCase() ??
    null
  return {
    line1,
    line2: pick(components, 'subpremise'),
    city,
    province,
    postal_code: canonicalPostalCode(pick(components, 'postal_code')),
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
  }
}
