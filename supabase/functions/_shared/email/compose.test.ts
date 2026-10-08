/**
 * Update the snapshot after an intended layout change:
 * deno test --frozen --allow-env --allow-read --allow-write \
 *   --config supabase/functions/deno.json supabase/functions/_shared/email/compose.test.ts -- --update
 */
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from '@std/assert'
import { assertSnapshot } from '@std/testing/snapshot'
import {
  composeEmail,
  type ComposeInput,
  type EmailContext,
} from './compose.ts'

/** Shaped like the core.staff_invite catalogue row (Task 3.6), with samples. */
const context: EmailContext = {
  template: {
    subject: 'Votre accès à {{clinic.name}}',
    body: [
      'Bonjour {{invitee.display_name}},',
      '{{inviter.display_name}} vous invite à créer votre accès à l’espace de travail de **{{clinic.name}}**.',
      'Le lien ci-dessous est personnel. Il est valide jusqu’au {{invitation.expires_at}}.',
    ].join('\n\n'),
    buttonLabel: 'Créer mon accès',
    whyLine:
      'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.',
    variables: [
      {
        path: 'invitee.display_name',
        label: 'Personne invitée',
        sample: 'Ana Gagnon',
        required: true,
        kind: 'text',
      },
      {
        path: 'inviter.display_name',
        label: 'Personne qui invite',
        sample: 'Christine Tremblay',
        required: true,
        kind: 'text',
      },
      {
        path: 'clinic.name',
        label: 'Nom de la clinique',
        sample: 'Clinique MANA',
        required: true,
        kind: 'text',
      },
      {
        path: 'invitation.expires_at',
        label: 'Expiration',
        sample: '15 octobre 2026 à 14 h 30',
        required: true,
        kind: 'datetime',
      },
    ],
  },
  clinic: {
    name: 'Clinique MANA',
    addressLine1: '123, rue Saint-Denis',
    addressLine2: 'Bureau 200',
    city: 'Montréal',
    province: 'QC',
    postalCode: 'H2X 1Y4',
    phone: '+15145551234',
    website: 'https://cliniquemana.com',
    privacyOfficerName: 'Christine Tremblay',
    privacyOfficerEmail: 'confidentialite@cliniquemana.com',
  },
  timezone: 'America/Toronto',
}

const values = {
  invitee: { display_name: 'Ana Gagnon' },
  inviter: { display_name: 'Christine Tremblay' },
  clinic: { name: 'Clinique MANA' },
  invitation: { expires_at: '2026-10-15T18:30:00Z' },
}

const send = (over: Partial<ComposeInput> = {}) =>
  composeEmail(context, {
    values,
    actionUrl: 'https://app.cliniquemana.com/invitation#t=abc',
    appUrl: 'https://app.cliniquemana.com',
    ...over,
  })

function ok(over: Partial<ComposeInput> = {}) {
  const result = send(over)
  if (!result.ok) {
    const path = 'path' in result ? ` (${result.path})` : ''
    throw new Error(`expected ok, got ${result.code}${path}`)
  }
  return result
}

Deno.test('composeEmail: subject, HTML and text from template, values and layout', () => {
  const r = ok()
  assertEquals(r.subject, 'Votre accès à Clinique MANA')
  assertStringIncludes(r.html, 'Bonjour Ana Gagnon,')
  assertStringIncludes(r.html, '<strong')
  assertStringIncludes(
    r.html,
    'href="https://app.cliniquemana.com/invitation#t=abc"',
  )
  assertStringIncludes(r.text, 'valide jusqu’au 15 octobre 2026 à 14 h 30.')
  assertStringIncludes(
    r.text,
    'Créer mon accès :\nhttps://app.cliniquemana.com/invitation#t=abc',
  )
  assertFalse(r.text.includes('**'))
})

Deno.test('composeEmail: the wordmark is served by the app (P3-10)', () => {
  assertStringIncludes(
    ok().html,
    'src="https://app.cliniquemana.com/email/wordmark.png"',
  )
  assertStringIncludes(
    ok({ appUrl: 'http://localhost:5173/' }).html,
    'src="http://localhost:5173/email/wordmark.png"',
  )
})

Deno.test('composeEmail: footer from the clinic identity (formatted phone, address lines)', () => {
  const r = ok()
  assertStringIncludes(
    r.text,
    [
      '--',
      'Clinique MANA',
      '123, rue Saint-Denis',
      'Bureau 200',
      'Montréal QC H2X 1Y4',
      '514 555-1234',
      'https://cliniquemana.com',
      'Confidentialité : Christine Tremblay, confidentialite@cliniquemana.com',
      '',
      context.template.whyLine,
    ].join('\n'),
  )
})

Deno.test('composeEmail: an incomplete identity leaves the missing lines out', () => {
  const r = composeEmail(
    {
      ...context,
      clinic: {
        name: 'Clinique MANA',
        addressLine1: null,
        addressLine2: null,
        city: 'Montréal',
        province: null,
        postalCode: null,
        phone: null,
        website: null,
        privacyOfficerName: null,
        privacyOfficerEmail: 'p@c.test',
      },
    },
    { values, actionUrl: 'https://a.test/x', appUrl: 'https://a.test' },
  )
  assert(r.ok)
  assertStringIncludes(
    r.text,
    '--\nClinique MANA\nMontréal\nConfidentialité : p@c.test\n',
  )
})

Deno.test('composeEmail: preview uses samples and no prefix', () => {
  const r = ok({ mode: 'preview', values: {}, actionUrl: null })
  assertEquals(r.subject, 'Votre accès à Clinique MANA')
  assertStringIncludes(r.text, 'valide jusqu’au 15 octobre 2026 à 14 h 30.')
  // Without a URL, the preview's button points at the app (normalised).
  assertStringIncludes(r.html, 'href="https://app.cliniquemana.com/"')
})

Deno.test('composeEmail: the app URL fallback (preview, test) must pass safeUrl', () => {
  for (const mode of ['preview', 'test'] as const) {
    for (
      const appUrl of [
        'javascript:alert(1)',
        'http://app.cliniquemana.com',
        'https://user:pass@app.cliniquemana.com',
      ]
    ) {
      assertEquals(send({ mode, values: {}, actionUrl: null, appUrl }), {
        ok: false,
        code: 'missing_variable',
        path: 'action_url',
      }, `${mode} ${appUrl}`)
    }
  }
  const local = send({
    mode: 'preview',
    actionUrl: null,
    appUrl: 'http://localhost:5173',
  })
  assert(local.ok)
  assertStringIncludes(local.html, 'href="http://localhost:5173/"')
})

Deno.test('composeEmail: in preview and test the button URL is optional', () => {
  for (const mode of ['preview', 'test'] as const) {
    assert(send({ mode, values: {}, actionUrl: null }).ok, mode)
  }
})

Deno.test('composeEmail: an invalid clinic timezone → invalid_timezone (no throw)', () => {
  assertEquals(
    composeEmail({ ...context, timezone: 'Mars/Olympus' }, {
      values,
      actionUrl: 'https://a.test',
      appUrl: 'https://a.test',
    }),
    { ok: false, code: 'invalid_timezone' },
  )
})

Deno.test('composeEmail: the subject is the document title, « [Test] » included', () => {
  assertStringIncludes(
    ok().html,
    '<title>Votre accès à Clinique MANA</title>',
  )
  assertStringIncludes(
    ok({ mode: 'test', values: {} }).html,
    '<title>[Test] Votre accès à Clinique MANA</title>',
  )
})

Deno.test('composeEmail: test mode adds « [Test] » and uses samples', () => {
  const r = ok({ mode: 'test', values: {} })
  assertEquals(r.subject, '[Test] Votre accès à Clinique MANA')
  assertStringIncludes(r.text, 'Bonjour Ana Gagnon,')
})

Deno.test('composeEmail: render failures pass through (nothing composed)', () => {
  assertEquals(send({ values: { ...values, invitee: {} } }), {
    ok: false,
    code: 'missing_variable',
    path: 'invitee.display_name',
  })
  assertEquals(
    composeEmail(
      { ...context, template: { ...context.template, body: '{{secret}}' } },
      { values, actionUrl: 'https://a.test', appUrl: 'https://a.test' },
    ),
    { ok: false, code: 'unknown_variable', path: 'secret' },
  )
})

Deno.test('composeEmail: a button without its URL fails closed when sending', () => {
  assertEquals(send({ actionUrl: null }), {
    ok: false,
    code: 'missing_variable',
    path: 'action_url',
  })
})

Deno.test('composeEmail: the action URL must be https (or local http for a local app)', () => {
  for (
    const actionUrl of [
      'javascript:alert(1)',
      'http://app.cliniquemana.com/x',
      'https://a.test/\n<x>',
    ]
  ) {
    const r = send({ actionUrl })
    if (actionUrl.startsWith('https://a.test')) {
      // The URL parser drops line breaks and encodes < >: the href is the normalised URL.
      assert(r.ok)
      assertStringIncludes(r.html, 'href="https://a.test/%3Cx%3E"')
    } else {
      assertEquals(r, {
        ok: false,
        code: 'missing_variable',
        path: 'action_url',
      }, actionUrl)
    }
  }
  const local = send({
    actionUrl: 'http://localhost:5173/invitation',
    appUrl: 'http://localhost:5173',
  })
  assert(local.ok)
})

Deno.test('composeEmail: a template without a button ignores no URL', () => {
  const r = composeEmail(
    { ...context, template: { ...context.template, buttonLabel: null } },
    { values, actionUrl: null, appUrl: 'https://a.test' },
  )
  assert(r.ok)
  assertFalse(r.html.includes('<a '))
})

Deno.test('composeEmail: a URL from code without a label gets the default label', () => {
  const r = composeEmail(
    { ...context, template: { ...context.template, buttonLabel: null } },
    { values, actionUrl: 'https://a.test/x', appUrl: 'https://a.test' },
  )
  assert(r.ok)
  assertStringIncludes(r.text, 'Ouvrir le lien :\nhttps://a.test/x')
})

Deno.test('composeEmail: a blank button label counts as none', () => {
  const r = composeEmail(
    { ...context, template: { ...context.template, buttonLabel: '  ' } },
    { values, actionUrl: null, appUrl: 'https://a.test' },
  )
  assert(r.ok)
  assertFalse(r.html.includes('<a '))
})

Deno.test('composeEmail: no preheader (it would only repeat the first line)', () => {
  const r = ok()
  assertFalse(r.html.includes('display:none'))
  assertFalse(r.html.includes('mso-hide:all'))
})

Deno.test('composeEmail: staff-invite HTML snapshot (layout regressions)', async (t) => {
  await assertSnapshot(t, ok().html)
})
