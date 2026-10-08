import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from '@std/assert'
import {
  AUTH_SUBJECTS,
  AUTH_TEMPLATE_NAMES,
  type AuthTemplateName,
  authTemplates,
} from './auth-templates.ts'

const templates = authTemplates()

const CONFIRM = '{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}'

/** The exact button href of each linked template (plan Task 3.15), `&` as `&amp;`. */
const HREFS: Record<Exclude<AuthTemplateName, 'reauthentication'>, string> = {
  recovery: `${CONFIRM}&amp;type=recovery`,
  magic_link: `${CONFIRM}&amp;type=email&amp;next={{ .RedirectTo | urlquery }}`,
  email_change: `${CONFIRM}&amp;type=email_change`,
  confirmation: `${CONFIRM}&amp;type=email`,
}

/** The only Go template actions each template may hold. */
const ALLOWED_ACTIONS: Record<AuthTemplateName, string[]> = {
  recovery: ['{{ .SiteURL }}', '{{ .TokenHash }}', '{{ .Email }}'],
  magic_link: [
    '{{ .SiteURL }}',
    '{{ .TokenHash }}',
    '{{ .Email }}',
    '{{ .RedirectTo | urlquery }}',
  ],
  email_change: [
    '{{ .SiteURL }}',
    '{{ .TokenHash }}',
    '{{ .Email }}',
    '{{ .NewEmail }}',
  ],
  confirmation: ['{{ .SiteURL }}', '{{ .TokenHash }}', '{{ .Email }}'],
  reauthentication: ['{{ .SiteURL }}', '{{ .Token }}'],
}

/** Every tag, comment or conditional comment, so what is left is text content. */
const TAG = /<!--[\s\S]*?-->|<[^>]*>/g

const each = (fn: (name: AuthTemplateName, html: string) => void) => {
  for (const name of AUTH_TEMPLATE_NAMES) fn(name, templates[name])
}

Deno.test('authTemplates: the five auth templates, never invite', () => {
  assertEquals(Object.keys(templates).sort(), [
    'confirmation',
    'email_change',
    'magic_link',
    'reauthentication',
    'recovery',
  ])
  assertFalse('invite' in templates)
})

Deno.test('authTemplates: fr-CA documents titled with their subject', () => {
  each((name, html) => {
    assertStringIncludes(html, '<html lang="fr-CA" dir="ltr">', name)
    const title = AUTH_SUBJECTS[name].replaceAll("'", '&#39;')
    assertStringIncludes(html, `<title>${title}</title>`, name)
  })
})

Deno.test('authTemplates: each button links to /connexion/confirmer, & escaped', () => {
  for (const [name, href] of Object.entries(HREFS)) {
    const html = templates[name as AuthTemplateName]
    const links = [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])
    assertEquals(links, [href], name)
    // The copy-this-link fallback shows the same URL.
    assertStringIncludes(html, `break-all">${href}</span>`, name)
  }
})

Deno.test('authTemplates: no raw & in a link and no ConfirmationURL left', () => {
  each((name, html) => {
    assertFalse(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(html), name)
    assertFalse(html.includes('ConfirmationURL'), name)
  })
})

Deno.test('authTemplates: magic link puts next last, URL-encoded', () => {
  const href = HREFS.magic_link
  assert(href.endsWith('&amp;next={{ .RedirectTo | urlquery }}'))
  // RedirectTo never appears without the encoder (a ? or & in it would split the query).
  assertFalse(/\{\{ \.RedirectTo \}\}/.test(templates.magic_link))
})

Deno.test('authTemplates: reauthentication shows the code, no link', () => {
  const html = templates.reauthentication
  assertFalse(html.includes('<a href'))
  assertFalse(html.includes('TokenHash'))
  assert(
    /<p style="[^"]*monospace[^"]*">\{\{ \.Token \}\}<\/p>/.test(html),
    'the code sits alone in a monospace block',
  )
})

Deno.test('authTemplates: only the expected Go actions, no user metadata', () => {
  each((name, html) => {
    const actions = new Set(html.match(/\{\{[^}]*\}\}/g))
    assertEquals([...actions].sort(), [...ALLOWED_ACTIONS[name]].sort(), name)
    assertFalse(html.includes('.Data'), name)
  })
})

Deno.test('authTemplates: user data only in text content, never in a tag', () => {
  each((name, html) => {
    for (const tag of html.match(TAG) ?? []) {
      for (const user of ['.Email', '.NewEmail', '.Token }}']) {
        assertFalse(tag.includes(user), `${name}: ${user} inside ${tag}`)
      }
    }
  })
})

Deno.test('authTemplates: every text character is escaped', () => {
  each((name, html) => {
    const text = html.replace(/^<!doctype html>/i, '').replace(TAG, '')
    assertFalse(/[<>"']/.test(text), `${name}: raw markup character in text`)
    assertFalse(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(text), `${name}: bare &`)
  })
  // The French apostrophes of the copy are entities, not raw quotes.
  assertStringIncludes(templates.recovery, 'qu&#39;une seule fois')
})

Deno.test('authTemplates: the teal button and the app-served wordmark', () => {
  each((name, html) => {
    assertStringIncludes(
      html,
      '<img src="{{ .SiteURL }}/email/wordmark.png"',
      name,
    )
    if (name !== 'reauthentication') {
      assertStringIncludes(html, 'background-color:#1E837C', name)
    }
  })
})

Deno.test('authTemplates: the static clinic footer and why line', () => {
  each((name, html) => {
    assertStringIncludes(html, 'Clinique MANA</p>', name)
    assertStringIncludes(
      html,
      'Ce courriel vous est envoyé parce qu&#39;une action a été demandée pour votre compte. Si ce n&#39;est pas vous, vous pouvez l&#39;ignorer.',
      name,
    )
  })
})

Deno.test('authTemplates: deterministic output', () => {
  assertEquals(authTemplates(), templates)
})
