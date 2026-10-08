import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from '@std/assert'
import {
  type RenderInput,
  renderTemplate,
  type TemplateVariable,
} from './render.ts'

const v = (
  path: string,
  kind: TemplateVariable['kind'] = 'text',
  required = true,
  sample = `[${path}]`,
): TemplateVariable => ({ path, label: path, sample, required, kind })

const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  subject: 'Votre accès à {{clinic.name}}',
  body: 'Bonjour {{ invitee.display_name }},\n\nÀ bientôt.',
  buttonLabel: 'Créer mon accès',
  variables: [v('clinic.name'), v('invitee.display_name')],
  values: {
    clinic: { name: 'Clinique MANA' },
    invitee: { display_name: 'Ana' },
  },
  timezone: 'America/Toronto',
  ...over,
})

function ok(over: Partial<RenderInput> = {}) {
  const result = renderTemplate(input(over))
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.code} (${result.path})`)
  }
  return result
}

Deno.test('renderTemplate: fills subject, HTML, text and button label', () => {
  const r = ok()
  assertEquals(r.subject, 'Votre accès à Clinique MANA')
  assertStringIncludes(r.html, 'Bonjour Ana,</p>')
  assertEquals(r.text, 'Bonjour Ana,\n\nÀ bientôt.')
  assertEquals(r.buttonLabel, 'Créer mon accès')
})

Deno.test('renderTemplate: a null button label stays null', () => {
  assertEquals(ok({ buttonLabel: null }).buttonLabel, null)
})

Deno.test('renderTemplate: placeholders in the button label are filled', () => {
  assertEquals(
    ok({ buttonLabel: 'Rejoindre {{clinic.name}}' }).buttonLabel,
    'Rejoindre Clinique MANA',
  )
})

Deno.test('escaping: <script> in a value is escaped in HTML, raw in text', () => {
  const r = ok({
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: '<script>alert("x")</script>' },
    },
  })
  assertStringIncludes(
    r.html,
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  )
  assertFalse(r.html.includes('<script'))
  assertStringIncludes(r.text, '<script>alert("x")</script>')
})

Deno.test('escaping: a value is never read as markup (bold, bullets, placeholders)', () => {
  const r = ok({
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: '**x**\n\n- y {{clinic.name}}' },
    },
  })
  assertFalse(r.html.includes('<strong>'))
  assertFalse(r.html.includes('<li'))
  assertStringIncludes(r.html, '**x**')
  assertStringIncludes(r.html, '{{clinic.name}}') // inserted once, not re-scanned
})

Deno.test('escaping: the button label is plain text (the layout escapes it)', () => {
  const r = ok({
    buttonLabel: '{{invitee.display_name}}',
    values: { clinic: { name: 'C' }, invitee: { display_name: '<b>Ana</b>' } },
  })
  assertEquals(r.buttonLabel, '<b>Ana</b>')
})

Deno.test('subject: plain text, line breaks removed (also from values)', () => {
  const r = ok({
    subject: 'Accès\r\nà {{clinic.name}}',
    values: {
      clinic: { name: 'A <b>\nBcc: x@y.test' },
      invitee: { display_name: 'Ana' },
    },
  })
  assertEquals(r.subject, 'Accès à A <b> Bcc: x@y.test')
})

Deno.test('variables: an unknown placeholder → unknown_variable', () => {
  assertEquals(
    renderTemplate(input({ body: 'Bonjour {{ invitee.first_name }}' })),
    {
      ok: false,
      code: 'unknown_variable',
      path: 'invitee.first_name',
    },
  )
})

Deno.test('variables: unknown placeholders are found in the subject and the button too', () => {
  assertEquals(renderTemplate(input({ subject: '{{x.y}}' })), {
    ok: false,
    code: 'unknown_variable',
    path: 'x.y',
  })
  assertEquals(renderTemplate(input({ buttonLabel: '{{ z }}' })), {
    ok: false,
    code: 'unknown_variable',
    path: 'z',
  })
})

Deno.test('variables: an unknown placeholder fails even in sample mode', () => {
  assertEquals(
    renderTemplate(input({ body: '{{nope}}', sample: true })).ok,
    false,
  )
})

Deno.test('variables: prototype keys are never read', () => {
  const r = renderTemplate(input({
    body: '{{clinic.constructor}}',
    variables: [
      v('clinic.name'),
      v('invitee.display_name'),
      v('clinic.constructor', 'text', false),
    ],
  }))
  assert(r.ok)
  assertEquals(r.text, '')
})

Deno.test('variables: a missing required value → missing_variable', () => {
  assertEquals(renderTemplate(input({ values: { clinic: { name: 'C' } } })), {
    ok: false,
    code: 'missing_variable',
    path: 'invitee.display_name',
  })
})

Deno.test('variables: null, blank and non-scalar values count as missing', () => {
  for (const display_name of [null, '  ', { a: 1 }, ['a'], Number.NaN]) {
    const r = renderTemplate(
      input({ values: { clinic: { name: 'C' }, invitee: { display_name } } }),
    )
    assertEquals(r.ok ? 'ok' : r.code, 'missing_variable')
  }
})

Deno.test('variables: a required variable not used in the text is still required', () => {
  const r = renderTemplate(
    input({ body: 'Bonjour', values: { clinic: { name: 'C' } } }),
  )
  assertEquals(r.ok ? 'ok' : r.path, 'invitee.display_name')
})

Deno.test('variables: a missing optional value → empty string', () => {
  const r = ok({
    body: 'Bonjour {{invitee.display_name}}{{note}}.',
    variables: [
      v('clinic.name'),
      v('invitee.display_name'),
      v('note', 'text', false),
    ],
  })
  assertEquals(r.text, 'Bonjour Ana.')
})

Deno.test('variables: numbers are accepted as text', () => {
  const r = ok({
    body: '{{n}}',
    variables: [v('clinic.name'), v('invitee.display_name'), v('n')],
    values: { clinic: { name: 'C' }, invitee: { display_name: 'A' }, n: 3 },
  })
  assertEquals(r.text, '3')
})

Deno.test('sample mode: missing values use the sample, verbatim; given values win', () => {
  const r = ok({
    sample: true,
    values: { invitee: { display_name: 'Ana' } },
    variables: [
      v('clinic.name', 'text', true, 'Clinique <MANA>'),
      v('invitee.display_name'),
    ],
  })
  assertEquals(r.subject, 'Votre accès à Clinique <MANA>')
  assertStringIncludes(r.html, 'Bonjour Ana,')
})

Deno.test('sample mode: date samples are display text, inserted as is', () => {
  const r = ok({
    sample: true,
    body: '{{invitation.expires_at}}',
    variables: [
      v('clinic.name'),
      v('invitee.display_name'),
      v('invitation.expires_at', 'datetime', true, '15 octobre 2026 à 14 h 30'),
    ],
    values: {},
  })
  assertEquals(r.text, '15 octobre 2026 à 14 h 30')
})

Deno.test('dates: datetime 2026-07-15T18:30:00Z in America/Toronto → 14 h 30', () => {
  const r = ok({
    body: 'Valide jusqu’au {{invitation.expires_at}}.',
    variables: [
      v('clinic.name'),
      v('invitee.display_name'),
      v('invitation.expires_at', 'datetime'),
    ],
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: 'A' },
      invitation: { expires_at: '2026-07-15T18:30:00Z' },
    },
  })
  assertStringIncludes(r.text, '14 h 30')
  assertEquals(r.text, 'Valide jusqu’au 15 juillet 2026 à 14 h 30.')
})

Deno.test('dates: the same instant in winter follows DST (13 h 30)', () => {
  const r = ok({
    body: '{{t}}',
    variables: [
      v('clinic.name'),
      v('invitee.display_name'),
      v('t', 'datetime'),
    ],
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: 'A' },
      t: '2026-01-15T18:30:00Z',
    },
  })
  assertEquals(r.text, '15 janvier 2026 à 13 h 30')
})

Deno.test('dates: date 2020-01-01 → 1 janvier 2020 (the CLAUDE.md §9 bug case)', () => {
  const r = ok({
    body: '{{d}}',
    variables: [v('clinic.name'), v('invitee.display_name'), v('d', 'date')],
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: 'A' },
      d: '2020-01-01',
    },
  })
  assertEquals(r.text, '1 janvier 2020')
})

Deno.test('dates: date 2026-03-08 in Pacific/Kiritimati → 8 mars 2026 (no shift)', () => {
  const r = ok({
    body: '{{d}}',
    timezone: 'Pacific/Kiritimati',
    variables: [v('clinic.name'), v('invitee.display_name'), v('d', 'date')],
    values: {
      clinic: { name: 'C' },
      invitee: { display_name: 'A' },
      d: '2026-03-08',
    },
  })
  assertEquals(r.text, '8 mars 2026')
})

Deno.test('dates: an unparseable date or datetime → missing_variable (fail closed)', () => {
  for (
    const [kind, value] of [
      ['date', '2026-02-30'],
      ['datetime', '2026-07-15'],
      ['datetime', 'bientôt'],
    ] as const
  ) {
    const r = renderTemplate(input({
      body: '{{d}}',
      variables: [v('clinic.name'), v('invitee.display_name'), v('d', kind)],
      values: {
        clinic: { name: 'C' },
        invitee: { display_name: 'A' },
        d: value,
      },
    }))
    assertEquals(
      r,
      { ok: false, code: 'missing_variable', path: 'd' },
      `${kind} ${value}`,
    )
  }
})

const urlInput = (link: unknown, allowLocalHttp = false) =>
  renderTemplate(input({
    body: '{{link}}',
    variables: [v('clinic.name'), v('invitee.display_name'), v('link', 'url')],
    values: { clinic: { name: 'C' }, invitee: { display_name: 'A' }, link },
    allowLocalHttp,
  }))

Deno.test('urls: https is accepted and escaped in HTML', () => {
  const r = urlInput('https://app.cliniquemana.com/x?a=1&b=2')
  assert(r.ok)
  assertStringIncludes(r.html, 'https://app.cliniquemana.com/x?a=1&amp;b=2')
  assertEquals(r.text, 'https://app.cliniquemana.com/x?a=1&b=2')
})

Deno.test('urls: anything but https → missing_variable', () => {
  for (
    const link of [
      'javascript:alert(1)',
      'http://app.cliniquemana.com',
      'data:text/html,x',
      'mailto:a@b.test',
      '/relative',
      'pas une url',
    ]
  ) {
    assertEquals(urlInput(link), {
      ok: false,
      code: 'missing_variable',
      path: 'link',
    }, link)
  }
})

Deno.test('urls: http://localhost only when the app itself is local', () => {
  assertEquals(urlInput('http://localhost:5173/x').ok, false)
  assertEquals(urlInput('http://localhost:5173/x', true).ok, true)
  assertEquals(urlInput('http://127.0.0.1:5173/x', true).ok, true)
  assertEquals(urlInput('http://evil.test/x', true).ok, false)
})
