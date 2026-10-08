import {
  assertEquals,
  assertFalse,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import {
  type ClinicFooter,
  type LayoutInput,
  renderLayout,
  renderLayoutText,
} from './layout.ts'

const footer: ClinicFooter = {
  name: 'Clinique MANA',
  addressLines: ['123, rue Saint-Denis', 'Montréal QC H2X 1Y4'],
  phone: '514 555-1234',
  website: 'https://cliniquemana.com',
  privacyOfficer: {
    name: 'Christine Tremblay',
    email: 'confidentialite@cliniquemana.com',
  },
}

const layout = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  title: 'Votre accès à Clinique MANA',
  preheader: 'Votre accès vous attend.',
  contentHtml: '<p>Bonjour Ana,</p>',
  button: {
    label: 'Créer mon accès',
    href: 'https://app.cliniquemana.com/invitation#t=abc',
  },
  footer,
  whyLine:
    'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.',
  wordmarkUrl: 'https://app.cliniquemana.com/email/wordmark.png',
  ...over,
})

Deno.test('renderLayout: a complete fr-CA document with the content', () => {
  const { html } = renderLayout(layout())
  assertMatch(html, /^<!doctype html>/i)
  assertStringIncludes(html, '<html lang="fr-CA" dir="ltr">')
  assertStringIncludes(html, '<meta charset="utf-8">')
  assertStringIncludes(html, '<title>Votre accès à Clinique MANA</title>')
  assertStringIncludes(html, '<p>Bonjour Ana,</p>')
  // The outer wrapper repeats lang and dir for clients that drop <html>.
  assertMatch(html, /<body[^>]*>\n<div[^>]*>[^<]*<\/div>\n<table [^>]*lang="fr-CA" dir="ltr"/)
})

Deno.test('renderLayout: the title is escaped', () => {
  const { html } = renderLayout(layout({ title: '<b>A & B</b>' }))
  assertStringIncludes(html, '<title>&lt;b&gt;A &amp; B&lt;/b&gt;</title>')
})

Deno.test('renderLayout: no preheader element without a preheader', () => {
  for (const preheader of [undefined, '']) {
    const { html } = renderLayout(layout({ preheader }))
    assertFalse(html.includes('display:none'), String(preheader))
    assertMatch(html, /<body[^>]*>\n<table /)
  }
})

Deno.test('renderLayout: the button cell has Outlook padding (mso-padding-alt)', () => {
  const { html } = renderLayout(layout())
  assertMatch(html, /<td style="[^"]*mso-padding-alt:12px 20px[^"]*">\n<a href=/)
})

Deno.test('renderLayout: table-based, inline-styled, 560 px wide, no <style> or script', () => {
  const { html } = renderLayout(layout())
  assertStringIncludes(html, 'role="presentation"')
  assertStringIncludes(html, 'max-width:560px')
  assertFalse(/<style|<script|<link|class=/i.test(html))
})

Deno.test('renderLayout: design-system tokens (teal button, ink text, hairline, Inter stack)', () => {
  const { html } = renderLayout(layout())
  assertStringIncludes(html, 'background-color:#1E837C')
  assertStringIncludes(html, 'color:#1F1F20')
  assertStringIncludes(html, 'color:#6B6B6E')
  assertStringIncludes(html, '#E4E4E7')
  assertStringIncludes(
    html,
    "font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif",
  )
})

Deno.test('renderLayout: the only image is the wordmark, with the clinic name as alt', () => {
  const { html } = renderLayout(layout())
  const images = html.match(/<img\b[^>]*>/g) ?? []
  assertEquals(images.length, 1)
  const image = images.join('')
  assertStringIncludes(
    image,
    'src="https://app.cliniquemana.com/email/wordmark.png"',
  )
  assertStringIncludes(image, 'alt="Clinique MANA"')
  assertStringIncludes(image, 'width="120"')
})

Deno.test('renderLayout: no tracking parameter or pixel', () => {
  const { html } = renderLayout(layout())
  assertFalse(/utm_|track|pixel|width="1"/i.test(html))
})

Deno.test('renderLayout: the button href is attribute-escaped', () => {
  const href = 'https://app.test/x?a=1&b="><script>alert(1)</script>'
  const { html } = renderLayout(layout({ button: { label: 'Ouvrir', href } }))
  const escaped =
    'https://app.test/x?a=1&amp;b=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
  assertStringIncludes(html, `href="${escaped}"`)
  assertFalse(html.includes('<script'))
})

Deno.test('renderLayout: the fallback line repeats the URL as text', () => {
  const { html } = renderLayout(layout())
  assertStringIncludes(html, 'Si le bouton ne fonctionne pas, copiez ce lien :')
  assertStringIncludes(html, '>https://app.cliniquemana.com/invitation#t=abc<')
})

Deno.test('renderLayout: the button label and preheader are escaped', () => {
  const { html } = renderLayout(
    layout({
      preheader: '<i>p</i>',
      button: { label: '<b>x</b>', href: 'https://a.test' },
    }),
  )
  assertStringIncludes(html, '&lt;i&gt;p&lt;/i&gt;')
  assertStringIncludes(html, '&lt;b&gt;x&lt;/b&gt;')
})

Deno.test('renderLayout: without a button there is no link and no fallback line', () => {
  const { html } = renderLayout(layout({ button: undefined }))
  assertFalse(html.includes('<a '))
  assertFalse(html.includes('Si le bouton'))
})

Deno.test('renderLayout: the footer lists identity, privacy officer and why line', () => {
  const { html } = renderLayout(layout())
  for (
    const part of [
      'Clinique MANA',
      '123, rue Saint-Denis',
      'Montréal QC H2X 1Y4',
      '514 555-1234',
      'https://cliniquemana.com',
      'Confidentialité : Christine Tremblay, confidentialite@cliniquemana.com',
      'parce que la clinique vous invite',
    ]
  ) assertStringIncludes(html, part)
})

Deno.test('renderLayout: footer values are escaped', () => {
  const { html } = renderLayout(
    layout({ footer: { ...footer, name: 'A & <B>' } }),
  )
  assertStringIncludes(html, 'A &amp; &lt;B&gt;')
})

Deno.test('renderLayout: a minimal footer (auth emails: name only)', () => {
  const { html } = renderLayout(layout({
    footer: {
      name: 'Clinique MANA',
      addressLines: [],
      phone: null,
      website: null,
      privacyOfficer: null,
    },
  }))
  assertFalse(html.includes('Confidentialité'))
  assertFalse(html.includes('514'))
})

Deno.test('renderLayout: Go template tokens pass through (Task 3.15)', () => {
  const { html } = renderLayout(layout({
    wordmarkUrl: '{{ .SiteURL }}/email/wordmark.png',
    button: {
      label: 'Choisir',
      href:
        '{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&type=recovery',
    },
  }))
  assertStringIncludes(
    html,
    'href="{{ .SiteURL }}/connexion/confirmer?token_hash={{ .TokenHash }}&amp;type=recovery"',
  )
  assertStringIncludes(html, 'src="{{ .SiteURL }}/email/wordmark.png"')
})

Deno.test('renderLayoutText: content, button URL, footer and why line, no HTML', () => {
  const text = renderLayoutText({
    contentText: 'Bonjour Ana,\n\nÀ bientôt.',
    button: { label: 'Créer mon accès', href: 'https://app.test/x?a=1&b=2' },
    footer: { ...footer, name: 'A & <B>' },
    whyLine: 'Pourquoi.',
  })
  assertEquals(
    text,
    [
      'Bonjour Ana,',
      '',
      'À bientôt.',
      '',
      'Créer mon accès :',
      'https://app.test/x?a=1&b=2',
      '',
      '--',
      'A & <B>',
      '123, rue Saint-Denis',
      'Montréal QC H2X 1Y4',
      '514 555-1234',
      'https://cliniquemana.com',
      'Confidentialité : Christine Tremblay, confidentialite@cliniquemana.com',
      '',
      'Pourquoi.',
    ].join('\n'),
  )
  assertFalse(/<[a-z/!]/i.test(text.replace('<B>', '')))
})

Deno.test('renderLayoutText: without a button or optional footer lines', () => {
  assertEquals(
    renderLayoutText({
      contentText: 'Bonjour.',
      footer: {
        name: 'Clinique MANA',
        addressLines: [],
        phone: null,
        website: null,
        privacyOfficer: null,
      },
      whyLine: 'Pourquoi.',
    }),
    'Bonjour.\n\n--\nClinique MANA\n\nPourquoi.',
  )
})
