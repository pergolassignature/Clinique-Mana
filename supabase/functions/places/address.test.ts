import { assertEquals } from '@std/assert'
import {
  type AddressComponent,
  canonicalPostalCode,
  provinceCode,
  streetLine,
  toPlaceAddress,
} from './address.ts'
import { FAKE_PLACES } from '../_shared/testing/fake-places.ts'

const map = (name: keyof typeof FAKE_PLACES) =>
  toPlaceAddress(
    [...FAKE_PLACES[name].components],
    FAKE_PLACES[name].formattedAddress,
  )

Deno.test('address: Montréal, Le Plateau-Mont-Royal → the city is Montréal, not the arrondissement; line 1 in the Québec form', () => {
  assertEquals(map('plateau'), {
    line1: '1234, rue Saint-Denis',
    line2: null,
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H2X 3J6',
    country: 'CA',
  })
})

Deno.test('address: Montréal, Verdun → Montréal (the arrondissement is a sublocality)', () => {
  const address = map('verdun')
  assertEquals(address.city, 'Montréal')
  assertEquals(address.line1, '4100, rue Wellington')
  assertEquals(address.postal_code, 'H4G 1V7')
})

Deno.test('address: Lévis (sector Desjardins) and Gatineau (sector Hull) → the city, not the sector', () => {
  assertEquals(map('levis').city, 'Lévis')
  assertEquals(map('levis').line1, '5955, rue Saint-Laurent')
  assertEquals(map('gatineau').city, 'Gatineau')
  assertEquals(map('gatineau').line1, '25, rue Laurier')
  assertEquals(map('gatineau').postal_code, 'J8X 4C8')
})

Deno.test('address: a rural rang without a locality → the municipality (administrative_area_level_3)', () => {
  assertEquals(map('rural'), {
    line1: '1500, rang Saint-Joseph',
    line2: null,
    city: 'Saint-Liboire',
    province: 'QC',
    postal_code: 'J0H 1R0',
    country: 'CA',
  })
})

Deno.test('address: a numbered route keeps its number: « 2200, route 132 »', () => {
  assertEquals(map('route132').line1, '2200, route 132')
  assertEquals(map('route132').city, 'Sainte-Flavie')
})

Deno.test('address: a unit goes to line 2 as Google gives it, never into line 1', () => {
  const address = map('unit')
  assertEquals(address.line1, '3450, rue Drummond')
  assertEquals(address.line2, '402')
  assertEquals(address.city, 'Montréal')
  assertEquals(address.postal_code, 'H3G 1Y2')
})

// The function does not know the typed text: the app puts the typed civic number back in front
// (`src/core/address/autofill.ts`, « 12, chemin du Lac-Écho »).
Deno.test('address: a road without a number → the road alone (the app keeps the typed number); a postal prefix (J0R) → no postal code', () => {
  const address = map('noNumber')
  assertEquals(address.line1, 'chemin du Lac-Écho')
  assertEquals(address.postal_code, null)
  assertEquals(address.city, 'Prévost')
})

Deno.test('address: outside Québec, the number has no comma and the street keeps its case', () => {
  assertEquals(map('toronto'), {
    line1: '100 Queen Street West',
    line2: null,
    city: 'Toronto',
    province: 'ON',
    postal_code: 'M5H 2N2',
    country: 'CA',
  })
})

Deno.test('address: outside Québec, a French-named street keeps Google’s form (no comma, capitalised generic)', () => {
  const address = toPlaceAddress([
    { longText: '100', types: ['street_number'] },
    { longText: 'Rue Principale', types: ['route'] },
    { longText: 'Caraquet', types: ['locality', 'political'] },
    {
      longText: 'Nouveau-Brunswick',
      shortText: 'NB',
      types: ['administrative_area_level_1', 'political'],
    },
    { longText: 'E1W 1A1', types: ['postal_code'] },
    { longText: 'Canada', shortText: 'CA', types: ['country', 'political'] },
  ])
  assertEquals(address.line1, '100 Rue Principale')
  assertEquals(address.province, 'NB')
  assertEquals(
    streetLine('5', 'Boulevard Saint-Pierre', false),
    '5 Boulevard Saint-Pierre',
  )
})

Deno.test('address: the newer French generics are lowered in Québec too', () => {
  for (
    const [route, expected] of [
      ['Rond-Point Des Érables', 'rond-point Des Érables'],
      ['Carrefour Du Lac', 'carrefour Du Lac'],
      ['Parc Industriel', 'parc Industriel'],
      ['Pointe Saint-Charles', 'pointe Saint-Charles'],
      ['Cité Des Jeunes', 'cité Des Jeunes'],
      ['Jardin Des Lilas', 'jardin Des Lilas'],
      ['Rampe Du Quai', 'rampe Du Quai'],
      ['Concession 4', 'concession 4'],
    ]
  ) {
    assertEquals(streetLine('10', route, true), `10, ${expected}`)
  }
})

Deno.test('address: the generic is lowered only when it is a French generic', () => {
  assertEquals(
    streetLine('10', 'Boulevard René-Lévesque Ouest', true),
    '10, boulevard René-Lévesque Ouest',
  )
  assertEquals(
    streetLine('10', 'Côte Sainte-Catherine', true),
    '10, côte Sainte-Catherine',
  )
  assertEquals(
    streetLine('10', 'Montée Saint-Michel', true),
    '10, montée Saint-Michel',
  )
  assertEquals(streetLine('10', 'Saint-Denis', true), '10, Saint-Denis')
  assertEquals(streetLine('10', 'Avenue Road', false), '10 Avenue Road')
  assertEquals(streetLine('10', null, true), null)
  assertEquals(streetLine(null, 'Rue Principale', true), 'rue Principale')
})

Deno.test('address: city fallbacks in order: locality, postal_town, sublocality_level_1, sublocality, administrative_area_level_3', () => {
  const comp = (type: string, text: string) => ({
    longText: text,
    shortText: text,
    types: [type],
  })
  assertEquals(
    toPlaceAddress([comp('postal_town', 'A'), comp('sublocality_level_1', 'B')])
      .city,
    'A',
  )
  assertEquals(
    toPlaceAddress([
      comp('sublocality_level_1', 'B'),
      comp('administrative_area_level_3', 'C'),
    ]).city,
    'B',
  )
  assertEquals(
    toPlaceAddress([
      comp('sublocality', 'D'),
      comp('administrative_area_level_3', 'C'),
    ]).city,
    'D',
  )
  assertEquals(
    toPlaceAddress([comp('administrative_area_level_3', 'C')]).city,
    'C',
  )
  assertEquals(toPlaceAddress([]).city, null)
})

Deno.test('address: the province from its short code, else its French or English name; a state → null', () => {
  const area = (longText?: string, shortText?: string) => ({
    longText,
    shortText,
    types: ['administrative_area_level_1'],
  })
  assertEquals(provinceCode(area('Québec', 'QC')), 'QC')
  assertEquals(provinceCode(area('Québec', 'Qué.')), 'QC')
  assertEquals(provinceCode(area('Quebec')), 'QC')
  assertEquals(provinceCode(area('Colombie-Britannique')), 'BC')
  assertEquals(provinceCode(area('Île-du-Prince-Édouard')), 'PE')
  assertEquals(provinceCode(area('Nouvelle-Écosse')), 'NS')
  assertEquals(provinceCode(area('New York', 'NY')), null)
  assertEquals(provinceCode(undefined), null)
})

Deno.test('address: postal codes are canonical A1A 1A1, anything else null', () => {
  assertEquals(canonicalPostalCode('h2x3j6'), 'H2X 3J6')
  assertEquals(canonicalPostalCode('H2X-3J6'), 'H2X 3J6')
  assertEquals(canonicalPostalCode(' H2X 3J6 '), 'H2X 3J6')
  assertEquals(canonicalPostalCode('J0R'), null)
  assertEquals(canonicalPostalCode('90210'), null)
  assertEquals(canonicalPostalCode(null), null)
})

Deno.test("address: no route → the formatted address's first segment, unless it is just the city", () => {
  const montreal = {
    longText: 'Montréal',
    shortText: 'Montréal',
    types: ['locality'],
  }
  assertEquals(toPlaceAddress([montreal], 'Montréal, QC, Canada').line1, null)
  assertEquals(
    toPlaceAddress([montreal], 'Complexe Desjardins, Montréal, QC').line1,
    'Complexe Desjardins',
  )
  assertEquals(toPlaceAddress([montreal]).line1, null)
})

Deno.test('address: a place that is no address (a sublocality, a neighbourhood, a province, a country) → no line 1, so line 1 stays as typed', () => {
  const c = (types: string[], longText: string, shortText = longText) => ({
    longText,
    shortText,
    types,
  })
  const QC = c(['administrative_area_level_1', 'political'], 'Québec', 'QC')
  const CA = c(['country', 'political'], 'Canada', 'CA')
  const MTL = c(['locality', 'political'], 'Montréal')
  const cases: Array<[AddressComponent[], string]> = [
    [
      [
        c(
          ['sublocality_level_1', 'sublocality', 'political'],
          'Le Plateau-Mont-Royal',
        ),
        MTL,
        QC,
        CA,
      ],
      'Le Plateau-Mont-Royal, Montréal, QC, Canada',
    ],
    [
      [c(['neighborhood', 'political'], 'Mile End'), MTL, QC, CA],
      'Mile End, Montréal, QC, Canada',
    ],
    [[QC, CA], 'Québec, Canada'],
    [[CA], 'Canada'],
    // A province named in the text but absent from the components.
    [[CA], 'Ontario, Canada'],
  ]
  for (const [components, formatted] of cases) {
    assertEquals(toPlaceAddress(components, formatted).line1, null, formatted)
  }
  // A named place is still a line 1.
  assertEquals(
    toPlaceAddress([MTL, QC, CA], 'Complexe Desjardins, Montréal, QC, Canada')
      .line1,
    'Complexe Desjardins',
  )
})

Deno.test('address: whitespace and control characters are cleaned; a malformed country is dropped', () => {
  const address = toPlaceAddress([
    { longText: '  12\u0000 ', types: ['street_number'] },
    { longText: 'Rue   Principale\n', types: ['route'] },
    { shortText: 'Canada', longText: 'Canada', types: ['country'] },
  ])
  assertEquals(address.line1, '12 Rue Principale')
  assertEquals(address.country, null)
})
