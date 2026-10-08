import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
} from '@std/assert'
import {
  buildObjectPath,
  extensionForMime,
  inspectStream,
  isMissingObject,
  sha256Hex,
  sniff,
  type SniffedType,
  sniffMatchesMime,
} from './storage.ts'

// ---------------------------------------------------------------------------
// Fixtures, built as bytes (no binary file is committed)
// ---------------------------------------------------------------------------
const ascii = (s: string) => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
}

function u32(n: number): Uint8Array {
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ])
}

const PDF_MIME = 'application/pdf'
const DOC_MIME = 'application/msword'
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function pdf(body = '1 0 obj\n<< /Type /Catalog >>\nendobj\n'): Uint8Array {
  return ascii(`%PDF-1.7\n%âã\n${body}trailer\n<< >>\n%%EOF\n`)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]

/** A PNG chunk; the CRC is not checked by `sniff`, so it is zero. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length
  return concat(
    new Uint8Array([len >>> 24, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len]),
    ascii(type),
    data,
    new Uint8Array(4),
  )
}

function png(...extraChunks: Uint8Array[]): Uint8Array {
  return concat(
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('IHDR', new Uint8Array(13)),
    ...extraChunks,
    new Uint8Array(PNG_IEND),
  )
}

function jpeg(...segments: Uint8Array[]): Uint8Array {
  return concat(
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0xff, 0xe0, 0x00, 0x10]),
    ascii('JFIF\0'),
    new Uint8Array(9),
    ...segments,
    new Uint8Array([0xff, 0xd9]),
  )
}

/** A JPEG comment (COM) segment. */
function jpegComment(text: string): Uint8Array {
  const data = ascii(text)
  return concat(new Uint8Array([0xff, 0xfe]), u16BE(data.length + 2), data)
}

function u16BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff])
}

function u32BE(n: number): Uint8Array {
  return new Uint8Array([
    n >>> 24,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ])
}

function webp(): Uint8Array {
  const chunk = concat(ascii('VP8L'), u32(6), new Uint8Array(6))
  const body = concat(ascii('WEBP'), chunk)
  return concat(ascii('RIFF'), u32(body.length), body)
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** An OLE compound file: a 512-byte header and two 512-byte sectors. */
function doc(size = 1536): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(OLE_SIGNATURE)
  bytes.set([0x3e, 0x00, 0x03, 0x00, 0xfe, 0xff, 0x09, 0x00], 24)
  return bytes
}

/**
 * A ZIP with the given entries stored (no compression). `data` pads the first
 * entry, so the archive can be made larger than the sniffing window. `listed`
 * replaces the names written in the central directory (same count). `prefix`
 * is written before the first entry, with offsets that account for it (as in
 * a self-extracting archive).
 */
function zip(
  names: string[],
  {
    data = new Uint8Array(0),
    comment = '',
    listed = names,
    prefix = new Uint8Array(0),
  } = {},
): Uint8Array {
  const locals: Uint8Array[] = [prefix]
  const centrals: Uint8Array[] = []
  let offset = prefix.length
  names.forEach((name, i) => {
    const n = ascii(name)
    const ln = ascii(listed[i])
    const body = i === 0 ? data : new Uint8Array(0)
    const local = concat(
      ascii('PK\x03\x04'),
      u16(20),
      u16(0),
      u16(0),
      u32(0),
      u32(0),
      u32(body.length),
      u32(body.length),
      u16(n.length),
      u16(0),
      n,
      body,
    )
    centrals.push(concat(
      ascii('PK\x01\x02'),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u32(0),
      u32(0),
      u32(body.length),
      u32(body.length),
      u16(ln.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      ln,
    ))
    locals.push(local)
    offset += local.length
  })
  const cd = concat(...centrals)
  const c = ascii(comment)
  const eocd = concat(
    ascii('PK\x05\x06'),
    u16(0),
    u16(0),
    u16(names.length),
    u16(names.length),
    u32(cd.length),
    u32(offset),
    u16(c.length),
    c,
  )
  return concat(...locals, cd, eocd)
}

const DOCX_NAMES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
const docx = () => zip(DOCX_NAMES)

const FIXTURES: Record<Exclude<SniffedType, 'unknown'>, () => Uint8Array> = {
  pdf: () => pdf(),
  png: () => png(),
  jpeg: () => jpeg(),
  webp,
  doc: () => doc(),
  docx,
}

/** `bytes` as a stream of `chunkSize`-byte chunks. */
function streamOf(bytes: Uint8Array, chunkSize: number) {
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(at, at + chunkSize))
      at += chunkSize
    },
  })
}

// ---------------------------------------------------------------------------
// sniff: one minimal fixture per type
// ---------------------------------------------------------------------------
for (const [type, make] of Object.entries(FIXTURES)) {
  Deno.test(`sniff: a minimal ${type} is ${type}`, () => {
    assertEquals(sniff(make()), type)
  })
}

Deno.test('sniff: PDF 2.0 and a header line with CRLF are pdf', () => {
  assertEquals(sniff(ascii('%PDF-2.0\r\n%%EOF')), 'pdf')
})

Deno.test('sniff: %%EOF may sit anywhere in the last 1024 bytes', () => {
  const trailing = new Uint8Array(1000).fill(0x20)
  assertEquals(sniff(concat(pdf(), trailing)), 'pdf')
  const tooFar = new Uint8Array(1100).fill(0x20)
  assertEquals(sniff(concat(pdf(), tooFar)), 'unknown')
})

Deno.test('sniff: the PDF header must be at offset 0', () => {
  assertEquals(sniff(concat(ascii(' '), pdf())), 'unknown')
})

Deno.test('sniff: a JPEG with Exif (APP1) or a quantisation table first', () => {
  const exif = concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08]),
    ascii('Exif\0\0'),
    new Uint8Array([0xff, 0xd9]),
  )
  const dqt = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
  assertEquals(sniff(exif), 'jpeg')
  assertEquals(sniff(dqt), 'jpeg')
})

Deno.test('sniff: a JPEG may carry data after EOI (phone motion photos)', () => {
  assertEquals(sniff(concat(jpeg(), new Uint8Array(4096).fill(7))), 'jpeg')
})

Deno.test('sniff: a WebP with VP8 or VP8X first chunk', () => {
  for (const fourcc of ['VP8 ', 'VP8X']) {
    const body = concat(ascii('WEBP'), ascii(fourcc), u32(2), new Uint8Array(2))
    assertEquals(sniff(concat(ascii('RIFF'), u32(body.length), body)), 'webp')
  }
})

Deno.test('sniff: a docx with a ZIP comment and a large first entry', () => {
  const big = zip(DOCX_NAMES, {
    data: new Uint8Array(200_000).fill(0x41),
    comment: 'written by a word processor',
  })
  assertEquals(sniff(big), 'docx')
})

// ---------------------------------------------------------------------------
// sniff: refusals
// ---------------------------------------------------------------------------
Deno.test('sniff: an empty file is unknown', () => {
  assertEquals(sniff(new Uint8Array(0)), 'unknown')
})

Deno.test('sniff: a ZIP without word/document.xml is unknown', () => {
  assertEquals(sniff(zip(['[Content_Types].xml', '_rels/.rels'])), 'unknown')
  assertEquals(
    sniff(zip(['[Content_Types].xml', 'xl/workbook.xml'])),
    'unknown',
  )
  assertEquals(sniff(zip(['word/document.xml'])), 'unknown')
})

Deno.test('sniff: names in local headers only do not make a docx', () => {
  const listed = ['[Content_Types].xml', '_rels/.rels', 'word/other.xml']
  assertEquals(sniff(zip(DOCX_NAMES, { listed })), 'unknown')
})

Deno.test('sniff: data prepended to a docx is unknown', () => {
  assertEquals(sniff(concat(ascii('MZ'), docx())), 'unknown')
  // Even with offsets that account for it (a self-extracting archive).
  assertEquals(sniff(zip(DOCX_NAMES, { prefix: ascii('MZ') })), 'unknown')
})

Deno.test('sniff: a docx whose end record has the wrong directory size is unknown', () => {
  const bytes = docx()
  bytes[bytes.length - 10]++ // the central directory size, low byte
  assertEquals(sniff(bytes), 'unknown')
})

Deno.test('sniff: a split (multi-disk) ZIP is unknown', () => {
  const bytes = docx()
  bytes[bytes.length - 18] = 1 // number of this disk
  assertEquals(sniff(bytes), 'unknown')
})

Deno.test('sniff: data appended to a docx is unknown', () => {
  assertEquals(sniff(concat(docx(), new Uint8Array(16))), 'unknown')
})

Deno.test('sniff: an SVG, an HTML page and plain text are unknown', () => {
  for (
    const text of [
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      '<svg onload="alert(1)"></svg>',
      '<!DOCTYPE html><html><body>x</body></html>',
      '  <html><script>alert(1)</script>',
      'Bonjour, ceci est un fichier texte.',
    ]
  ) {
    assertEquals(sniff(ascii(text)), 'unknown', text)
  }
})

Deno.test('sniff: truncated files are unknown', () => {
  const cases: Record<string, Uint8Array> = {
    'PDF magic only': ascii('%PDF'),
    'PDF header, no %%EOF': ascii('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n'),
    'PNG signature only': new Uint8Array(PNG_SIGNATURE),
    'PNG without IEND': png().subarray(0, png().length - 12),
    'PNG cut inside IEND': png().subarray(0, png().length - 1),
    'JPEG SOI only': new Uint8Array([0xff, 0xd8, 0xff]),
    'WebP shorter than its RIFF size': webp().subarray(0, webp().length - 2),
    'WebP header only': ascii('RIFF\x10\x00\x00\x00WEBP'),
    'OLE shorter than a header and two sectors': doc(1535),
    'OLE signature only': new Uint8Array(OLE_SIGNATURE),
    'docx without its end record': docx().subarray(0, docx().length - 22),
    'docx cut in half': docx().subarray(0, docx().length >> 1),
  }
  for (const [name, bytes] of Object.entries(cases)) {
    assertEquals(sniff(bytes), 'unknown', name)
  }
})

Deno.test('sniff: a bad PDF version, PNG first chunk or WebP chunk is unknown', () => {
  assertEquals(sniff(ascii('%PDF-x.y\n%%EOF')), 'unknown')
  assertEquals(sniff(ascii('%PDF-\n%%EOF')), 'unknown')
  const noIhdr = concat(
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('tEXt', new Uint8Array(13)),
    new Uint8Array(PNG_IEND),
  )
  assertEquals(sniff(noIhdr), 'unknown')
  const body = concat(ascii('WEBP'), ascii('ABCD'), u32(2), new Uint8Array(2))
  assertEquals(sniff(concat(ascii('RIFF'), u32(body.length), body)), 'unknown')
})

Deno.test('sniff: SOI not followed by a segment marker is unknown', () => {
  for (const marker of [0xff, 0xd8, 0xd9, 0xd0, 0x00, 0x41]) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, marker, 0x00, 0x02])
    assertEquals(sniff(bytes), 'unknown', marker.toString(16))
  }
})

Deno.test('sniff: OLE headers must be little-endian version 3 or 4', () => {
  const bigEndian = doc()
  bigEndian.set([0xff, 0xfe], 28)
  assertEquals(sniff(bigEndian), 'unknown')
  const badShift = doc()
  badShift[30] = 0x0c // version 3 with 4096-byte sectors
  assertEquals(sniff(badShift), 'unknown')
  const v4 = (size: number) => {
    const bytes = doc(size)
    bytes.set([0x04, 0x00, 0xfe, 0xff, 0x0c, 0x00], 26)
    return bytes
  }
  assertEquals(sniff(v4(3 * 4096)), 'doc')
  assertEquals(sniff(v4(3 * 4096 - 1)), 'unknown')
})

Deno.test('sniff: a WebP with data after its RIFF size is unknown', () => {
  assertEquals(sniff(concat(webp(), new Uint8Array(2))), 'unknown')
})

Deno.test('sniff: a RIFF that is not WebP (WAV) is unknown', () => {
  const body = concat(ascii('WAVE'), ascii('fmt '), u32(0))
  assertEquals(sniff(concat(ascii('RIFF'), u32(body.length), body)), 'unknown')
})

Deno.test('sniff: polyglots with markup in the leading bytes are unknown', () => {
  const cases: Record<string, Uint8Array> = {
    'PDF header then HTML': ascii(
      '%PDF-1.7\n<html><body><script>alert(1)</script></body></html>\n%%EOF\n',
    ),
    'PDF with an upper-case SCRIPT tag': pdf('<SCRIPT>alert(1)</SCRIPT>\n'),
    'PDF with an iframe': pdf('<iframe src=x>\n'),
    'PDF with a doctype': pdf('<!doctype html>\n'),
    'JPEG with a script in a comment': jpeg(jpegComment('<script>x</script>')),
    'PNG with a script in a text chunk': png(
      pngChunk('tEXt', ascii('c\0<script>alert(1)</script>')),
    ),
    'a small ZIP with markup in its comment': zip(DOCX_NAMES, {
      comment: '<html>',
    }),
  }
  for (const [name, bytes] of Object.entries(cases)) {
    assertEquals(sniff(bytes), 'unknown', name)
  }
})

Deno.test('sniff: SVG and XML in legitimate files are not refused', () => {
  // C2PA content credentials: a JUMBF box in a `caBX` chunk, with an SVG.
  const c2pa = png(
    pngChunk(
      'caBX',
      concat(
        u32BE(64),
        ascii('jumb'),
        u32BE(32),
        ascii('jumdc2pa'),
        new Uint8Array(16),
        ascii('<svg width="716" height="716" viewBox="0 0 716 716">'),
      ),
    ),
  )
  assertEquals(sniff(c2pa), 'png', 'C2PA PNG')
  // A docx whose first entry is stored, so its XML sits in the leading bytes.
  const stored = zip(DOCX_NAMES, {
    data: ascii(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/' +
        'content-types"><Default Extension="xml" ContentType="application/' +
        'xml"/></Types>',
    ),
  })
  assertEquals(sniff(stored), 'docx', 'stored-entry docx')
  // Uncompressed XMP metadata in the first KB of a PDF.
  const xmp = pdf(
    '2 0 obj\n<< /Type /Metadata /Subtype /XML /Length 200 >>\nstream\n' +
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' +
      'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>\n' +
      '<?xpacket end="w"?>\nendstream\nendobj\n',
  )
  assertEquals(sniff(xmp), 'pdf', 'PDF with XMP')
})

Deno.test('sniff: a PDF that is also an HTML page is still refused', () => {
  const polyglot = pdf(
    '<?xml version="1.0"?>\n<!DOCTYPE html><html><body>x</body></html>\n',
  )
  assertEquals(sniff(polyglot), 'unknown')
})

Deno.test('sniff: a docx with a VBA project (macros) is unknown', () => {
  for (const name of ['word/vbaProject.bin', 'WORD/VBAPROJECT.BIN']) {
    assertEquals(sniff(zip([...DOCX_NAMES, name])), 'unknown', name)
  }
  // Another .bin part (e.g. an embedded object) is not a VBA project.
  assertEquals(
    sniff(zip([...DOCX_NAMES, 'word/embeddings/oleObject1.bin'])),
    'docx',
  )
})

Deno.test('sniff: PDF dictionaries and hex strings are not markup', () => {
  assertEquals(sniff(pdf('<< /A <48656c6c6f> /B <</C 1>> >>\n')), 'pdf')
  assertEquals(sniff(pdf('(a <b> c) (<p> <a href>)\n')), 'pdf')
})

Deno.test('sniff: markup past the leading 1445 bytes is not scanned', () => {
  const filler = '%' + ' '.repeat(1500) + '\n'
  assertEquals(sniff(pdf(`${filler}<script>x</script>\n`)), 'pdf')
})

// ---------------------------------------------------------------------------
// sniffMatchesMime and extensionForMime: one strict map
// ---------------------------------------------------------------------------
Deno.test('sniffMatchesMime: each type matches its own MIME type only', () => {
  const mimes: Record<Exclude<SniffedType, 'unknown'>, string> = {
    pdf: PDF_MIME,
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    doc: DOC_MIME,
    docx: DOCX_MIME,
  }
  for (const [type, mime] of Object.entries(mimes)) {
    for (const [otherType, otherMime] of Object.entries(mimes)) {
      assertEquals(
        sniffMatchesMime(type as SniffedType, otherMime),
        type === otherType,
        `${type} vs ${otherMime}`,
      )
    }
    assertFalse(sniffMatchesMime('unknown', mime))
  }
})

Deno.test('sniffMatchesMime: a PNG renamed .pdf (declared as PDF) mismatches', () => {
  const type = sniff(png())
  assertEquals(type, 'png')
  assertFalse(sniffMatchesMime(type, PDF_MIME))
  assert(sniffMatchesMime(type, 'image/png'))
})

Deno.test('sniffMatchesMime: aliases, case, parameters and SVG are refused', () => {
  for (
    const mime of [
      'image/jpg',
      'image/pjpeg',
      'IMAGE/PNG',
      'image/png; charset=binary',
      ' image/png',
      'image/svg+xml',
      'text/html',
      'application/octet-stream',
      '',
    ]
  ) {
    for (const type of Object.keys(FIXTURES) as SniffedType[]) {
      assertFalse(sniffMatchesMime(type, mime), `${type} vs ${mime}`)
    }
  }
})

Deno.test('extensionForMime: the fixed map', () => {
  assertEquals(extensionForMime(PDF_MIME), 'pdf')
  assertEquals(extensionForMime('image/png'), 'png')
  assertEquals(extensionForMime('image/jpeg'), 'jpg')
  assertEquals(extensionForMime('image/webp'), 'webp')
  assertEquals(extensionForMime(DOC_MIME), 'doc')
  assertEquals(extensionForMime(DOCX_MIME), 'docx')
})

Deno.test('extensionForMime: anything else is null', () => {
  for (
    const mime of [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
      'image/heic',
      'image/jpg',
      'Image/Png',
      'toString',
      '__proto__',
    ]
  ) {
    assertEquals(extensionForMime(mime), null, mime)
  }
})

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------
Deno.test('sha256Hex: FIPS 180-2 vectors, lower-case hex', () => {
  assertEquals(
    sha256Hex(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assertEquals(
    sha256Hex(ascii('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

// ---------------------------------------------------------------------------
// inspectStream: one pass for size, hash and type, with a size cap
// ---------------------------------------------------------------------------
Deno.test('inspectStream: chunked input gives the same result as sniff', async () => {
  const big = zip(DOCX_NAMES, { data: new Uint8Array(150_000).fill(0x42) })
  const inputs = [...Object.values(FIXTURES).map((make) => make()), big]
  for (const bytes of inputs) {
    // 65_557 is the tail window; larger chunks replace the kept tail.
    for (const chunkSize of [1, 7, 4096, 65_536, 65_557, 70_000, 200_000]) {
      if (chunkSize === 1 && bytes.length > 10_000) continue
      const result = await inspectStream(streamOf(bytes, chunkSize), 1_000_000)
      assertEquals(result, {
        status: 'ok',
        type: sniff(bytes),
        size: bytes.length,
        sha256: sha256Hex(bytes),
      })
    }
  }
})

Deno.test('inspectStream: a docx whose end record spans chunks', async () => {
  const bytes = zip(DOCX_NAMES, { data: new Uint8Array(70_000) })
  const result = await inspectStream(streamOf(bytes, 70_013), 1_000_000)
  assertEquals(result.status === 'ok' && result.type, 'docx')
})

Deno.test('inspectStream: a zero-byte file is ok, unknown, with the empty hash', async () => {
  assertEquals(await inspectStream(streamOf(new Uint8Array(0), 10), 10), {
    status: 'ok',
    type: 'unknown',
    size: 0,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
})

Deno.test('inspectStream: exactly maxBytes is accepted', async () => {
  const bytes = png()
  const result = await inspectStream(streamOf(bytes, 5), bytes.length)
  assertEquals(result.status === 'ok' && result.size, bytes.length)
})

Deno.test('inspectStream: oversize stops reading and cancels the stream', async () => {
  let pulls = 0
  let cancelled = false
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++
      controller.enqueue(new Uint8Array(1024))
    },
    cancel() {
      cancelled = true
    },
  })
  assertEquals(await inspectStream(endless, 10 * 1024 + 1), {
    status: 'too_large',
  })
  assert(cancelled)
  assert(pulls <= 13, `read ${pulls} chunks`)
})

Deno.test('inspectStream: oversize is too_large even if the cancel rejects', async () => {
  const stubborn = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024))
    },
    cancel() {
      return Promise.reject(new Error('cannot cancel'))
    },
  })
  assertEquals(await inspectStream(stubborn, 1024), { status: 'too_large' })
})

Deno.test('inspectStream: one byte over the cap is too large', async () => {
  const bytes = pdf()
  assertEquals(
    await inspectStream(streamOf(bytes, 3), bytes.length - 1),
    { status: 'too_large' },
  )
})

Deno.test('inspectStream: a stream error propagates', async () => {
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('network reset'))
    },
  })
  await assertRejects(() => inspectStream(broken, 100), Error, 'network reset')
})

Deno.test('inspectStream: maxBytes must be a positive safe integer', async () => {
  for (const max of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => inspectStream(streamOf(new Uint8Array(1), 1), max),
      TypeError,
    )
  }
})

// ---------------------------------------------------------------------------
// buildObjectPath: {org}/{module}/{subject}/{file}.{ext}, no user name
// ---------------------------------------------------------------------------
const ORG = '0b9a3c1e-2f4d-4a6b-8c7d-9e0f1a2b3c4d'
const SUBJECT = '11111111-2222-4333-8444-555555555555'
const FILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const parts = {
  orgId: ORG,
  moduleKey: 'core',
  subjectId: SUBJECT,
  fileId: FILE,
  mimeType: 'image/png',
}

Deno.test('buildObjectPath: the path is ids and an extension from the MIME type', () => {
  assertEquals(buildObjectPath(parts), `${ORG}/core/${SUBJECT}/${FILE}.png`)
  assertEquals(
    buildObjectPath({
      ...parts,
      moduleKey: 'professionals',
      mimeType: 'image/jpeg',
    }),
    `${ORG}/professionals/${SUBJECT}/${FILE}.jpg`,
  )
})

Deno.test('buildObjectPath: anything but canonical ids and a module key throws', () => {
  const bad: Array<Partial<typeof parts>> = [
    { orgId: ORG.toUpperCase() },
    { orgId: '' },
    { subjectId: '../etc' },
    { subjectId: `${SUBJECT}/x` },
    { fileId: 'photo-de-moi.png' },
    { fileId: `${FILE}.png` },
    { moduleKey: 'Core' },
    { moduleKey: 'core/x' },
    { moduleKey: '_core' },
    { moduleKey: '' },
    { mimeType: 'image/svg+xml' },
    { mimeType: 'text/html' },
  ]
  for (const override of bad) {
    assertThrows(
      () => buildObjectPath({ ...parts, ...override }),
      TypeError,
      undefined,
      JSON.stringify(override),
    )
  }
})

Deno.test('isMissingObject: status 400 or 404, or statusCode 404; anything else is a failure', () => {
  for (
    const error of [{ status: 400 }, { status: 404 }, { statusCode: '404' }]
  ) {
    assert(isMissingObject(error), JSON.stringify(error))
  }
  for (const error of [null, undefined, { status: 500 }, { statusCode: 404 }]) {
    assertFalse(isMissingObject(error), JSON.stringify(error))
  }
})
