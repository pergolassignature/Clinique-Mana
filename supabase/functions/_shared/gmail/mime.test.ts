import { assertEquals } from '@std/assert'
import {
  charsetOf,
  decodeBody,
  parseAddress,
  parseAddressList,
  parseMessage,
  splitAddressList,
} from './mime.ts'
import type { GmailMessage } from './client.ts'

const b64 = (text: string, charset = 'utf-8') => {
  const bytes = charset === 'latin1'
    ? Uint8Array.from(text, (c) => c.charCodeAt(0))
    : new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(
    /=+$/,
    '',
  )
}
const NOW = new Date('2026-10-12T15:00:00.000Z')

Deno.test('mime: address lists split on the commas outside quotes and brackets; names and case are handled', () => {
  assertEquals(
    splitAddressList('"Doe, John" <j@x.test>, Alice <a@y.test>,bare@z.test'),
    [
      '"Doe, John" <j@x.test>',
      'Alice <a@y.test>',
      'bare@z.test',
    ],
  )
  assertEquals(parseAddress('"Doe, John" <J@X.test>'), {
    name: 'Doe, John',
    address: 'j@x.test',
  })
  assertEquals(parseAddress('<a@b.test>'), { name: null, address: 'a@b.test' })
  assertEquals(parseAddress('Amélie Tremblay <amelie@example.test>'), {
    name: 'Amélie Tremblay',
    address: 'amelie@example.test',
  })
  assertEquals(parseAddress('nothing here'), null)
  assertEquals(parseAddressList(null), [])
  assertEquals(
    parseAddressList('x@y.test, not-an-address').map((a) => a.address),
    ['x@y.test'],
  )
})

Deno.test('mime: bodies are decoded with their charset', () => {
  assertEquals(charsetOf('text/plain; charset="ISO-8859-1"'), 'iso-8859-1')
  assertEquals(charsetOf('text/html'), null)
  assertEquals(
    decodeBody(
      Uint8Array.from('caf\xe9', (c) => c.charCodeAt(0)),
      'iso-8859-1',
    ),
    'café',
  )
  assertEquals(
    decodeBody(new TextEncoder().encode('café'), 'no-such-charset'),
    'café',
  )
})

Deno.test('mime: a multipart message → headers, bodies, attachments (inline and accepted flagged)', () => {
  const message: GmailMessage = {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Bonjour',
    internalDate: '1791817200000',
    sizeEstimate: 1234,
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      filename: '',
      headers: [
        { name: 'From', value: '"Côté, Marc" <macote@Example.test>' },
        {
          name: 'To',
          value: 'Clinique <info@clinique.test>, autre@clinique.test',
        },
        { name: 'Cc', value: 'cc@x.test' },
        { name: 'Subject', value: 'Attestation' },
        { name: 'Message-ID', value: '<abc@mail.test>' },
        { name: 'In-Reply-To', value: '<prev@mail.test>' },
        { name: 'Reply-To', value: 'reply@x.test' },
      ],
      body: { size: 0 },
      parts: [
        {
          partId: '0',
          mimeType: 'multipart/alternative',
          filename: '',
          body: { size: 0 },
          parts: [
            {
              partId: '0.0',
              mimeType: 'text/plain',
              filename: '',
              headers: [{
                name: 'Content-Type',
                value: 'text/plain; charset="ISO-8859-1"',
              }],
              body: { size: 5, data: b64('caf\xe9', 'latin1') },
            },
            {
              partId: '0.1',
              mimeType: 'text/html',
              filename: '',
              body: {
                size: 30,
                data: b64('<p>caf&eacute; <img src="cid:logo1"></p>'),
              },
            },
          ],
        },
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename: 'formulaire.pdf',
          body: { size: 1000, attachmentId: 'att-1' },
        },
        {
          partId: '2',
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [{ name: 'Content-ID', value: '<logo1>' }],
          body: { size: 200, attachmentId: 'att-2' },
        },
        {
          partId: '3',
          mimeType: 'application/zip',
          filename: 'archive.zip',
          body: { size: 50, attachmentId: 'att-3' },
        },
      ],
    },
  }
  const parsed = parseMessage(message, NOW)
  assertEquals(parsed.from_name, 'Côté, Marc')
  assertEquals(parsed.from_address, 'macote@example.test')
  assertEquals(parsed.to.map((a) => a.address), [
    'info@clinique.test',
    'autre@clinique.test',
  ])
  assertEquals(parsed.cc, [{ name: null, address: 'cc@x.test' }])
  assertEquals(parsed.reply_to_address, 'reply@x.test')
  assertEquals(parsed.rfc_message_id, 'abc@mail.test')
  assertEquals(parsed.in_reply_to, 'prev@mail.test')
  assertEquals(parsed.subject, 'Attestation')
  assertEquals(parsed.sent_at, '2026-10-12T15:00:00.000Z')
  assertEquals(parsed.body_text, 'café')
  assertEquals(parsed.body_html, '<p>caf&eacute; <img src="cid:logo1"></p>')
  assertEquals(parsed.label_ids, ['INBOX', 'UNREAD'])
  assertEquals(
    parsed.attachments.map((
      a,
    ) => [a.part_id, a.filename, a.is_inline, a.accepted]),
    [
      ['1', 'formulaire.pdf', false, true],
      ['2', 'logo.png', true, true],
      ['3', 'archive.zip', false, false],
    ],
  )
  assertEquals(parsed.body_refs, [])
})

Deno.test('mime: a single-part attachment message (Gmail\'s root `partId: ""`) keeps its attachment under the walk\'s id', () => {
  const parsed = parseMessage({
    id: 'm4',
    threadId: 't4',
    internalDate: String(NOW.getTime()),
    payload: {
      partId: '',
      mimeType: 'application/pdf',
      filename: 'facture.pdf',
      headers: [{ name: 'Subject', value: 'Facture' }],
      body: { size: 1200, attachmentId: 'att-root' },
    },
  } as GmailMessage, NOW)
  assertEquals(parsed.attachments.map((a) => [a.part_id, a.filename]), [[
    '0',
    'facture.pdf',
  ]])
})

Deno.test('mime: a body handed out by attachment id is referenced for the sync; the date falls back', () => {
  const parsed = parseMessage({
    id: 'm2',
    threadId: 't2',
    payload: {
      partId: '',
      mimeType: 'text/html',
      filename: '',
      headers: [{ name: 'Date', value: 'Mon, 12 Oct 2026 10:00:00 -0400' }, {
        name: 'Content-Type',
        value: 'text/html; charset=utf-8',
      }],
      body: { size: 90000, attachmentId: 'big-body' },
    },
  }, NOW)
  assertEquals(parsed.body_html, null)
  assertEquals(parsed.body_refs, [{
    kind: 'html',
    attachment_id: 'big-body',
    charset: 'utf-8',
  }])
  assertEquals(parsed.sent_at, '2026-10-12T14:00:00.000Z')
  assertEquals(
    parseMessage({ id: 'm3', threadId: 't3' }, NOW).sent_at,
    NOW.toISOString(),
  )
})
