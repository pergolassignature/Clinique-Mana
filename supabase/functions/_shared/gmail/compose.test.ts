import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert'
import {
  buildMime,
  encodeWord,
  fillPlaceholders,
  hardenHtml,
  htmlToText,
  type OutgoingMessage,
  referencesHeader,
} from './compose.ts'

const decoder = new TextDecoder()

const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => {
  let n = 0
  return {
    from: { name: 'Clinique MANA', address: 'info@clinique.test' },
    to: ['alice@exemple.test'],
    cc: [],
    bcc: [],
    subject: 'Votre rendez-vous',
    html: '<p>Bonjour</p>',
    text: 'Bonjour',
    attachments: [],
    random: () => `r${++n}`,
    date: new Date('2026-10-13T15:00:00Z'),
    ...over,
  }
}

/** The decoded base64 parts' texts, in order. */
function partTexts(raw: string): string[] {
  return [
    ...raw.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g,
    ),
  ]
    .map((m) => {
      const bin = atob(m[1].replaceAll('\r\n', ''))
      return decoder.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    })
}

Deno.test('fillPlaceholders: values in, HTML-escaped in the body, one line in the subject', () => {
  const values = {
    'person.first_name': 'Zoé <b>',
    'sender.name': 'Julie\nGagnon',
  }
  assertEquals(
    fillPlaceholders(
      '<p>Bonjour {{ person.first_name }}, {{sender.name}}</p>',
      values,
      { html: true },
    ),
    '<p>Bonjour Zoé &lt;b&gt;, Julie\nGagnon</p>',
  )
  assertEquals(
    fillPlaceholders('De {{sender.name}}', values, { html: false }),
    'De Julie Gagnon',
  )
  // The database refuses these first; here it is a contract break, never a blank.
  assertThrows(() =>
    fillPlaceholders('{{person.last_name}}', values, { html: true })
  )
})

Deno.test('hardenHtml: no script, no handler, no javascript: link; the rest kept', () => {
  const out = hardenHtml(
    '<p onclick="x()">Texte <a href="javascript:alert(1)">lien</a> <a href="https://ok.test">ok</a></p><script>alert(1)</script><iframe src="x"></iframe><img src="data:image/png;base64,AAA">',
  )
  assertFalse(/script|onclick|javascript:|iframe|data:/i.test(out))
  assert(out.includes('<a href="https://ok.test">ok</a>'))
  assert(out.includes('Texte'))
})

Deno.test('hardenHtml: an encoded javascript: (entities, controls, no semicolon) is caught; only http(s), mailto, tel, cid or relative kept', () => {
  for (
    const href of [
      'javascript&colon;alert(1)',
      '&#106;avascript:alert(1)',
      '&#106avascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      'java&#x09;script:alert(1)',
      'java&Tab;script:alert(1)',
      '&#x20;javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
    ]
  ) {
    for (const quoted of [`"${href}"`, `'${href}'`]) {
      const out = hardenHtml(`<a href=${quoted}>lien</a>`)
      assertEquals(out, '<a>lien</a>', href)
    }
  }
  assertEquals(
    hardenHtml('<a href=javascript&colon;alert(1)>x</a>'),
    '<a>x</a>',
  )
  assertEquals(
    hardenHtml('<img src="&#99;id:logo@mana">'),
    '<img src="&#99;id:logo@mana">',
  )
  for (
    const kept of [
      '<a href="https://ok.test/?a=1&amp;b=2">ok</a>',
      '<a href="http://ok.test">ok</a>',
      '<a href="mailto:info@ok.test">ok</a>',
      '<a href="tel:+15145550000">ok</a>',
      '<img src="cid:logo@mana">',
      '<a href="#haut">ok</a>',
      '<a href="/chemin">ok</a>',
    ]
  ) {
    assertEquals(hardenHtml(kept), kept)
  }
})

Deno.test('htmlToText: paragraphs, breaks, lists and links in plain words', () => {
  assertEquals(
    htmlToText(
      '<p>Bonjour&nbsp;Zoé,</p><p>Voici <a href="https://x.test">le lien</a>.<br>Merci</p><ul><li>un</li><li>deux</li></ul>',
    ),
    'Bonjour Zoé,\nVoici le lien (https://x.test).\nMerci\n\n- un\n- deux',
  )
})

Deno.test('encodeWord: ASCII as is, French in UTF-8 encoded words, never a line break', () => {
  assertEquals(encodeWord('Votre rendez-vous'), 'Votre rendez-vous')
  const encoded = encodeWord('Rendez-vous de jeudi : confirmé\r\nBcc: x@y.test')
  assert(encoded.startsWith('=?UTF-8?B?'))
  assertFalse(/\r\n(?! )/.test(encoded))
  const decoded = encoded.split('\r\n ').map((w) => {
    const bin = atob(w.slice(10, -2))
    return decoder.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  }).join('')
  assertEquals(decoded, 'Rendez-vous de jeudi : confirmé Bcc: x@y.test')
})

Deno.test('buildMime: headers, threading, a text and an HTML part', () => {
  const raw = decoder.decode(buildMime(message({
    cc: ['bruno@exemple.test'],
    subject: 'Re : votre demande',
    inReplyTo: '<m1@exemple.test>',
    references: '<m0@exemple.test> <m1@exemple.test>',
  })))
  assert(raw.includes('From: "Clinique MANA" <info@clinique.test>\r\n'))
  assert(raw.includes('To: alice@exemple.test\r\n'))
  assert(raw.includes('Cc: bruno@exemple.test\r\n'))
  assert(raw.includes('In-Reply-To: <m1@exemple.test>\r\n'))
  assert(
    raw.includes('References: <m0@exemple.test>\r\n <m1@exemple.test>\r\n'),
  )
  assert(raw.includes('Message-ID: <r1@clinique.test>\r\n'))
  assert(raw.includes('Content-Type: multipart/alternative; boundary="alt_r2"'))
  assertEquals(partTexts(raw), ['Bonjour', '<p>Bonjour</p>'])
})

Deno.test('buildMime: attachments in a mixed part, their French names in RFC 2231', () => {
  const raw = decoder.decode(buildMime(message({
    attachments: [{
      name: 'reçu été.pdf',
      mimeType: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.4'),
    }],
  })))
  assert(raw.includes('Content-Type: multipart/mixed; boundary="mix_r3"'))
  assert(
    raw.includes(
      `Content-Disposition: attachment; filename="recu ete.pdf"; filename*=UTF-8''re%C3%A7u%20%C3%A9t%C3%A9.pdf`,
    ),
  )
  assertEquals(partTexts(raw)[2], '%PDF-1.4')
})

Deno.test('buildMime: the send’s own Message-ID, the same on every try', () => {
  const raw = decoder.decode(buildMime(message({ messageId: 'send-1' })))
  assert(raw.includes('Message-ID: <send-1@clinique.test>\r\n'))
  assertThrows(() => buildMime(message({ messageId: 'a>\r\nBcc: x@y.test' })))
})

Deno.test('referencesHeader: valid ids only, first and latest of a long chain, folded', () => {
  assertEquals(referencesHeader(null), null)
  assertEquals(
    referencesHeader('<a@x> pas-un-id <b c> <b@x>'),
    '<a@x>\r\n <b@x>',
  )
  const long = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`).join(' ')
  const kept = referencesHeader(long)!.split('\r\n ')
  assertEquals(kept.length, 20)
  assertEquals(kept[0], '<m0@x>')
  assertEquals(kept[1], '<m11@x>')
  assertEquals(kept[19], '<m29@x>')
})

Deno.test('buildMime: refuses a bad address or no recipient; drops a forged Message-ID', () => {
  assertThrows(() =>
    buildMime(message({ to: ['alice@exemple.test\r\nBcc: x@y.test'] }))
  )
  const forged = decoder.decode(
    buildMime(
      message({
        inReplyTo: '<a>\r\nBcc: x@y.test',
        references: '<a>\r\nBcc: x@y.test',
      }),
    ),
  )
  assertFalse(forged.includes('x@y.test'))
  assertFalse(forged.includes('In-Reply-To'))
  assertThrows(() => buildMime(message({ to: [] })))
  assertThrows(() =>
    buildMime(
      message({
        attachments: [{
          name: 'a',
          mimeType: 'text/plain\r\nX: y',
          bytes: new Uint8Array(1),
        }],
      }),
    )
  )
})
