import { assertEquals } from '@std/assert'
import {
  appPageUrl,
  invitationValues,
  isExpectedRpcError,
  professionalDocumentsPath,
  professionalsRpcError,
  profileUpdateValues,
  QUESTIONNAIRE_PATH,
  submissionReceivedValues,
} from './professionals.ts'
import { withEnv } from './testing/env.ts'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

/** The `variables` paths a seeded template declares, from the migration text. */
async function declaredPaths(key: string): Promise<string[]> {
  let text = ''
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.name.endsWith('_professionals_onboarding.sql')) {
      text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS))
    }
  }
  const seeds = text.indexOf('insert into public.email_template_defaults')
  const start = text.indexOf(`('${key}', 'professionals',`, seeds)
  if (seeds < 0 || start < 0) throw new Error(`template ${key} not seeded`)
  const end = text.indexOf("'professionals.view')", start)
  return [...text.slice(start, end).matchAll(/"path": "([a-z_.]+)"/g)]
    .map((m) => m[1]).sort()
}

/** The dotted paths of a values object's leaves. */
function leafPaths(values: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(values).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? leafPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  ).sort()
}

Deno.test('professionals: each builder fills exactly the variables its template declares', async () => {
  const invite = invitationValues({
    firstName: 'Nadia',
    clinicName: 'Clinique MANA',
    expiresAt: '2026-10-15T15:00:00Z',
  })
  assertEquals(leafPaths(invite), await declaredPaths('professionals.invite'))
  assertEquals(
    leafPaths(invite),
    await declaredPaths('professionals.invite_reminder'),
  )
  assertEquals(
    leafPaths(
      profileUpdateValues({ firstName: 'Nadia', clinicName: 'Clinique MANA' }),
    ),
    await declaredPaths('professionals.profile_update'),
  )
  assertEquals(
    leafPaths(submissionReceivedValues({ fullName: 'Nadia Côté' })),
    await declaredPaths('professionals.submission_received'),
  )
  assertEquals(invite, {
    professional: { first_name: 'Nadia' },
    clinic: { name: 'Clinique MANA' },
    invitation: { expires_at: '2026-10-15T15:00:00Z' },
  })
})

Deno.test('professionals: appPageUrl only on an accepted origin and a plain app path', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assertEquals(
    appPageUrl('https://app.cliniquemana.com/', QUESTIONNAIRE_PATH),
    'https://app.cliniquemana.com/mon-profil/questionnaire',
  )
  assertEquals(
    appPageUrl(' http://localhost:5173 ', professionalDocumentsPath(id)),
    `http://localhost:5173/professionnels/${id}/documents`,
  )
  for (
    const appUrl of [
      undefined,
      '',
      'http://app.cliniquemana.com',
      'https://app.cliniquemana.com/app',
      'https://x.test?y',
    ]
  ) {
    assertEquals(appPageUrl(appUrl, QUESTIONNAIRE_PATH), null, String(appUrl))
  }
  for (
    const path of ['//evil.test', '/a?b', '/a#b', '/../x', 'mon-profil', '/A']
  ) {
    assertEquals(appPageUrl('https://app.test', path), null, path)
  }
})

Deno.test('professionals: a P0001 refusal carries its HINT as field and, for sections, the keys', async () => {
  await withEnv({ ALLOWED_ORIGINS: undefined }, async () => {
    const res = professionalsRpcError({
      code: 'P0001',
      message: 'Certaines sections sont incomplètes.',
      hint: 'sections',
      details: 'personal,tax_bank',
    })
    assertEquals(res.status, 400)
    assertEquals(await res.json(), {
      error: {
        code: 'invalid_request',
        message: 'Certaines sections sont incomplètes.',
        refusal: true,
        field: 'sections',
        sections: ['personal', 'tax_bank'],
      },
    })

    const plain = await professionalsRpcError({
      code: 'P0001',
      message: 'Une soumission est déjà en cours.',
      hint: 'submission',
      details: 'ignored',
    }).json()
    assertEquals(plain.error.field, 'submission')
    assertEquals(plain.error.sections, undefined)

    // A HINT that is a sentence, or a DETAIL that is not a key list, is not passed on.
    const odd = await professionalsRpcError({
      code: 'P0001',
      message: 'Refusé.',
      hint: 'Vérifiez le numéro.',
    }).json()
    assertEquals(odd.error, {
      code: 'invalid_request',
      message: 'Refusé.',
      refusal: true,
    })
    const oddSections = await professionalsRpcError({
      code: 'P0001',
      message: 'Refusé.',
      hint: 'sections',
      details: 'Failing row contains (x)',
    }).json()
    assertEquals(oddSections.error.sections, undefined)

    // Other codes as rpcErrorResponse.
    assertEquals(
      (await professionalsRpcError({ code: '42501', hint: 'x' }).json()).error
        .code,
      'forbidden',
    )
    const internal = professionalsRpcError({ code: 'XX000', message: 'boom' })
    assertEquals([internal.status, (await internal.json()).error.code], [
      500,
      'internal',
    ])
    assertEquals(
      ['P0001', '42501', '22023', 'XX000', undefined].map((code) =>
        isExpectedRpcError({ code })
      ),
      [true, true, true, false, false],
    )
  })
})
