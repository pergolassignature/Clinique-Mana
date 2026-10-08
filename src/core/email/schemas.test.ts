import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  btrim,
  isMailbox,
  PLACEHOLDER_SOURCE,
  placeholderError,
  senderSchema,
  sendingDomainSchema,
  templateDraftSchema,
  toSenderFormValues,
  UNCLOSED_BRACES_MESSAGE,
} from './schemas'

const root = path.resolve(__dirname, '../../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

const PATHS = ['clinic.name', 'invitee.display_name']

/** The issues of a failed parse, as `field: message`. */
function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('the placeholder rule', () => {
  it('is the renderer’s and the SQL check’s rule, character for character', () => {
    expect(PLACEHOLDER_SOURCE).toBe(String.raw`\{\{([^{}\r\n]*)\}\}`)
    expect(read('supabase/functions/_shared/format.ts')).toContain('export const PLACEHOLDER_SOURCE = String.raw`' + PLACEHOLDER_SOURCE + '`')
    expect(read('supabase/migrations/20261008050047_core_email.sql')).toContain(`regexp_matches(p_text, '${PLACEHOLDER_SOURCE}', 'g')`)
    expect(read('supabase/functions/_shared/email/draft.ts')).toContain(`UNCLOSED_BRACES_MESSAGE = '${UNCLOSED_BRACES_MESSAGE}'`)
  })
})

describe('btrim', () => {
  it('trims spaces, tabs, CR and LF only, like SQL btrim(…, E\' \\t\\r\\n\')', () => {
    expect(btrim(' \t\r\n a b \n\t ')).toBe('a b')
    // A non-breaking space is not trimmed (JavaScript's trim() would remove it).
    expect(btrim(' a ')).toBe(' a ')
  })
})

describe('placeholderError', () => {
  it('accepts declared placeholders, with spaces inside the braces', () => {
    expect(placeholderError('Bonjour {{invitee.display_name}} de {{ clinic.name }}', PATHS)).toBeNull()
    expect(placeholderError('Aucune variable', PATHS)).toBeNull()
  })

  it('names the first undeclared placeholder, with the SQL text', () => {
    expect(placeholderError('{{clinic.name}} {{ client.diagnosis }} {{x}}', PATHS)).toBe('Variable inconnue : {{client.diagnosis}}')
  })

  it('cuts a long unknown path to 80 characters, as SQL does', () => {
    const long = 'a'.repeat(100)
    expect(placeholderError(`{{${long}}}`, PATHS)).toBe(`Variable inconnue : {{${'a'.repeat(80)}}}`)
  })

  it('refuses a lone {{ or }} left once the placeholders are removed', () => {
    expect(placeholderError('Bonjour {{clinic.name}', PATHS)).toBe(UNCLOSED_BRACES_MESSAGE)
    expect(placeholderError('Bonjour clinic.name}}', PATHS)).toBe(UNCLOSED_BRACES_MESSAGE)
    // A placeholder cannot cross a line break.
    expect(placeholderError('{{clinic\n.name}}', PATHS)).toBe(UNCLOSED_BRACES_MESSAGE)
    expect(placeholderError('{ single braces }', PATHS)).toBeNull()
  })

  it('names an unknown placeholder before an unclosed brace (SQL order)', () => {
    expect(placeholderError('{{x}} {{', PATHS)).toBe('Variable inconnue : {{x}}')
  })

  it('stays fast on a lone {{ followed by 10 000 spaces', () => {
    const start = performance.now()
    expect(placeholderError(`{{${' '.repeat(10_000)}`, PATHS)).toBe(UNCLOSED_BRACES_MESSAGE)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('templateDraftSchema', () => {
  const schema = templateDraftSchema(PATHS)

  it('trims each field and turns an empty button label into « no button »', () => {
    expect(schema.parse({ subject: '  Votre accès à {{clinic.name}} \n', body: '\nBonjour\n\n', button_label: '  ' })).toEqual({
      subject: 'Votre accès à {{clinic.name}}',
      body: 'Bonjour',
      button_label: null,
    })
    expect(schema.parse({ subject: 'Objet', body: 'Texte', button_label: ' Créer mon accès ' }).button_label).toBe('Créer mon accès')
  })

  it('requires a subject and a text, with the SQL messages', () => {
    expect(issues(schema.safeParse({ subject: ' ', body: '\n', button_label: '' }))).toEqual([
      "subject: L'objet est obligatoire.",
      'body: Le texte est obligatoire.',
    ])
  })

  it('bounds the lengths (in characters) and keeps the subject on one line', () => {
    expect(issues(schema.safeParse({ subject: 'é'.repeat(201), body: 'x'.repeat(10_001), button_label: 'b'.repeat(61) }))).toEqual([
      "subject: L'objet ne peut pas dépasser 200 caractères.",
      'body: Le texte ne peut pas dépasser 10 000 caractères.',
      'button_label: Le libellé du bouton ne peut pas dépasser 60 caractères.',
    ])
    // An emoji is one character, as in SQL (two UTF-16 units).
    expect(schema.safeParse({ subject: '😀'.repeat(200), body: 'x', button_label: '' }).success).toBe(true)
    expect(issues(schema.safeParse({ subject: 'Ligne 1\nLigne 2', body: 'x', button_label: '' }))).toEqual([
      "subject: L'objet doit tenir sur une seule ligne.",
    ])
  })

  it('checks the placeholders of each field', () => {
    expect(issues(schema.safeParse({ subject: '{{clinic.nom}}', body: 'Bonjour {{', button_label: '{{ invitee.display_name }}' }))).toEqual([
      'subject: Variable inconnue : {{clinic.nom}}',
      `body: ${UNCLOSED_BRACES_MESSAGE}`,
    ])
  })
})

describe('isMailbox', () => {
  it.each(['no-reply@gestion.cliniquemana.com', 'Info@Clinique.CA', "o'brien+x@x.xn--p1ai", 'a@b.co'])('accepts %s', (address) => {
    expect(isMailbox(address)).toBe(true)
  })

  it.each([
    'Clinique <info@clinique.ca>',
    'a@b.ca, c@d.ca',
    'a b@clinique.ca',
    'a@clinique',
    'a@-clinique.ca',
    'a@clinique.c',
    'a@@clinique.ca',
    'é@clinique.ca',
    `${'a'.repeat(65)}@clinique.ca`,
    `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.ca`,
  ])('refuses %s', (address) => {
    expect(isMailbox(address)).toBe(false)
  })
})

describe('senderSchema', () => {
  const schema = senderSchema('gestion.cliniquemana.com')

  it('builds the address on the sending domain, lowercased; an empty reply-to clears it', () => {
    expect(schema.parse({ from_name: '  Clinique MANA ', from_local: ' No-Reply ', reply_to: ' ' })).toEqual({
      from_name: 'Clinique MANA',
      from_address: 'no-reply@gestion.cliniquemana.com',
      reply_to: null,
    })
    expect(schema.parse({ from_name: 'Clinique', from_local: 'info', reply_to: ' info@cliniquemana.ca ' }).reply_to).toBe('info@cliniquemana.ca')
  })

  it('refuses what set_email_sender and the checks refuse', () => {
    expect(issues(schema.safeParse({ from_name: ' ', from_local: 'a b', reply_to: 'Clinique <info@x.ca>' }))).toEqual([
      'from_name: Le nom est requis.',
      'from_local: Utilisez seulement des lettres, des chiffres, des points, des tirets et des traits de soulignement.',
      'reply_to: Une seule adresse, sans nom (ex. : info@cliniquemana.ca).',
    ])
    expect(issues(schema.safeParse({ from_name: 'Clinique "MANA" <x>', from_local: 'x', reply_to: '' }))).toEqual([
      'from_name: Le nom ne peut pas contenir les caractères < > ou ".',
    ])
    expect(issues(schema.safeParse({ from_name: 'n'.repeat(81), from_local: 'x'.repeat(65), reply_to: '' }))).toEqual([
      'from_name: 80 caractères maximum.',
      'from_local: 64 caractères maximum.',
    ])
  })

  it('refuses an address over 254 characters with a long domain', () => {
    const domain = `${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(50)}.ca`
    expect(issues(senderSchema(domain).safeParse({ from_name: 'x', from_local: 'x'.repeat(10), reply_to: '' }))).toEqual([
      'from_local: Adresse trop longue.',
    ])
  })
})

describe('toSenderFormValues', () => {
  it('splits the stored address and shows a missing reply-to as empty', () => {
    expect(
      toSenderFormValues({ from_name: 'Clinique MANA', from_address: 'no-reply@gestion.cliniquemana.com', reply_to: null, sending_domain: 'gestion.cliniquemana.com' }),
    ).toEqual({ from_name: 'Clinique MANA', from_local: 'no-reply', reply_to: '' })
  })
})

describe('sendingDomainSchema', () => {
  it('lowercases and accepts a domain like the SQL check', () => {
    expect(sendingDomainSchema.parse(' Courriel.CliniqueMana.com ')).toBe('courriel.cliniquemana.com')
    expect(sendingDomainSchema.parse('xn--clinique-b1a.xn--p1ai')).toBe('xn--clinique-b1a.xn--p1ai')
  })

  it.each(['cliniquemana', '-x.ca', 'x-.ca', 'x..ca', 'x.c', 'x y.ca', 'clinique.ca/'])('refuses %s', (domain) => {
    expect(sendingDomainSchema.safeParse(domain).success).toBe(false)
  })
})
