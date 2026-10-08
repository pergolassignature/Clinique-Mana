import { assertEquals } from '@std/assert'
import {
  btrim,
  draftBodySchema,
  draftBraceError,
  draftButtonSchema,
  draftSubjectSchema,
  UNCLOSED_BRACES_MESSAGE,
} from './draft.ts'

// Code points, not literals: the formatter would turn escapes into invisible
// characters.
const NBSP = String.fromCodePoint(0xa0)
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000)
const LINE_SEPARATOR = String.fromCodePoint(0x2028)
const BOM = String.fromCodePoint(0xfeff)

Deno.test("btrim: only space, tab, CR and LF, as SQL btrim(…, E' \\t\\r\\n')", () => {
  assertEquals(btrim(' \t\r\n texte \n\t'), 'texte')
  assertEquals(btrim(`${NBSP}texte${NBSP}`), `${NBSP}texte${NBSP}`)
  assertEquals(
    btrim(IDEOGRAPHIC_SPACE + LINE_SEPARATOR + BOM),
    IDEOGRAPHIC_SPACE + LINE_SEPARATOR + BOM,
  )
  assertEquals(btrim('\v\f'), '\v\f')
  assertEquals(btrim('   '), '')
  assertEquals(btrim(''), '')
})

Deno.test('btrim: a long run of spaces is linear (no backtracking)', () => {
  const s = ' '.repeat(200_000) + 'x' + ' '.repeat(200_000)
  assertEquals(btrim(s), 'x')
})

Deno.test('draft schemas: what JS trim() would empty but SQL keeps is accepted', () => {
  assertEquals(draftSubjectSchema.safeParse(NBSP).success, true)
  assertEquals(draftBodySchema.safeParse(IDEOGRAPHIC_SPACE).success, true)
  assertEquals(draftSubjectSchema.safeParse(' \t ').success, false)
  assertEquals(draftBodySchema.safeParse('\r\n').success, false)
  assertEquals(draftButtonSchema.parse(' \t\r\n'), null)
  assertEquals(draftButtonSchema.parse(NBSP), NBSP)
  assertEquals(draftSubjectSchema.parse('\t Objet \n'), 'Objet')
})

Deno.test('draftBraceError: a {{ or }} left once the placeholders are removed', () => {
  assertEquals(draftBraceError('Objet {{clinic.name}}', 'Texte', null), null)
  assertEquals(draftBraceError('{{ clinic.name }}', '{{{x}}}', undefined), null)
  assertEquals(draftBraceError('Objet {single}', 'a } b { c', 'Ouvrir'), null)
  for (
    const texts of [
      ['Objet {{clinic.name', 'Texte', null],
      ['Objet', 'Texte }}', null],
      ['Objet', 'Texte', 'Ouvrir {{'],
      ['Objet', '{{ {{clinic.name}}', null],
      ['Objet', 'A {{multi\nligne}}', null],
      // Joined by a line break: a placeholder cannot cross fields.
      ['Objet {{', 'clinic.name}}', null],
    ] as [string, string, string | null][]
  ) {
    assertEquals(draftBraceError(...texts), UNCLOSED_BRACES_MESSAGE)
  }
})
