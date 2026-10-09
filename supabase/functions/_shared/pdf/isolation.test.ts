// Guards the bundle isolation of pdfmake (ADR 0008, CLAUDE.md §7): the
// edge-runtime bundler ships every npm package of deno.lock in every
// function, so pdfmake must stay vendored and reachable only through
// render.ts. Also guards the vendored file's integrity and the notices that
// travel with the vendored code and fonts.
import { assert, assertEquals, assertMatch } from '@std/assert'

const FUNCTIONS = new URL('../../', import.meta.url)
const RENDER = new URL('./render.ts', import.meta.url).href
const VENDOR = new URL('./vendor/pdfmake.js', import.meta.url).href
/** `import … from '…'`, `import '…'`, `export … from '…'` (multi-line too). */
const IMPORT = /^\s*(?:import|export)\s(?:[^'";]*?\sfrom\s)?['"]([^'"]+)['"]/gm

/** The local modules `entry` imports, transitively (static imports only). */
async function graph(entry: URL): Promise<Set<string>> {
  const seen = new Set<string>()
  const visit = async (url: URL) => {
    if (seen.has(url.href)) return
    seen.add(url.href)
    if (url.href === VENDOR) return
    const source = await Deno.readTextFile(url)
    for (const [, specifier] of source.matchAll(IMPORT)) {
      if (specifier.startsWith('.')) await visit(new URL(specifier, url))
    }
  }
  await visit(entry)
  return seen
}

/** Every .ts file under supabase/functions. */
async function sources(dir: URL, out: URL[] = []): Promise<URL[]> {
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.name + (entry.isDirectory ? '/' : ''), dir)
    if (entry.isDirectory) await sources(url, out)
    else if (entry.name.endsWith('.ts')) out.push(url)
  }
  return out
}

Deno.test('pdfmake: not an npm dependency of the functions', async () => {
  const { imports } = JSON.parse(
    await Deno.readTextFile(new URL('deno.json', FUNCTIONS)),
  )
  const lock = await Deno.readTextFile(new URL('deno.lock', FUNCTIONS))
  assert(!JSON.stringify(imports).includes('pdfmake'), 'deno.json maps pdfmake')
  assert(!/pdfmake|pdfkit|fontkit/.test(lock), 'deno.lock resolves pdfmake')
})

Deno.test('pdfmake: the model, template and asset modules do not reach it', async () => {
  assert((await graph(new URL(RENDER))).has(VENDOR), 'the walker finds imports')
  for (const name of ['model.ts', 'template.ts', 'assets.ts']) {
    const reached = await graph(new URL(`./${name}`, import.meta.url))
    assert(!reached.has(RENDER), `${name} imports render.ts`)
    assert(!reached.has(VENDOR), `${name} imports the vendored pdfmake`)
  }
})

Deno.test('pdfmake: the signing functions that do not render never reach it', async () => {
  for (
    const name of [
      'signing-webhook',
      'signing-sync',
      'signing-test-connection',
      '_shared/signing-events.ts',
    ]
  ) {
    const entry = new URL(
      name.endsWith('.ts') ? name : `${name}/index.ts`,
      FUNCTIONS,
    )
    const reached = await graph(entry)
    assert(reached.size > 3, `${name}: the walker follows its imports`)
    assert(!reached.has(RENDER), `${name} reaches render.ts`)
    assert(!reached.has(VENDOR), `${name} reaches the vendored pdfmake`)
  }
  const sender = await graph(
    new URL('signing-test-document/index.ts', FUNCTIONS),
  )
  assert(sender.has(RENDER), 'signing-test-document renders')
  const contract = await graph(
    new URL('professionals-contract-send/index.ts', FUNCTIONS),
  )
  assert(contract.has(RENDER), 'professionals-contract-send renders')
})

Deno.test('pdfmake: only render.ts (and tests) import the vendored module', async () => {
  const importers: string[] = []
  for (const url of await sources(FUNCTIONS)) {
    const source = await Deno.readTextFile(url)
    for (const [, specifier] of source.matchAll(IMPORT)) {
      if (new URL(specifier, url).href === VENDOR) {
        importers.push(url.href.slice(FUNCTIONS.href.length))
      }
    }
  }
  assertEquals(
    importers.filter((path) => !path.endsWith('.test.ts')),
    ['_shared/pdf/render.ts'],
  )
})

Deno.test('pdfmake: the vendored file matches its committed SHA-256', async () => {
  // Written by `npm run build:pdfmake` next to the file (sha256sum format).
  const [expected, name] = (
    await Deno.readTextFile(new URL(`${VENDOR}.sha256`))
  ).trim().split(/\s+/)
  assertMatch(expected, /^[0-9a-f]{64}$/)
  assertEquals(name, 'pdfmake.js')
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', await Deno.readFile(new URL(VENDOR))),
  )
  const actual = [...digest].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  assertEquals(actual, expected, 'vendor/pdfmake.js was edited by hand')
})

Deno.test('pdfmake and Inter: their license notices ship with them', async () => {
  const vendored = await Deno.readTextFile(new URL(VENDOR))
  const header = vendored.slice(0, vendored.indexOf('*/'))
  for (const pkg of ['fontkit@', 'brotli@', 'dfa@', 'pdfkit@', 'pdfmake@']) {
    const at = header.indexOf(` * ${pkg}`)
    assert(at !== -1, `no notice for ${pkg}`)
    const notice = header.slice(at, header.indexOf(' * ----', at))
    assert(notice.includes('Permission is hereby granted'), `${pkg}: no text`)
  }
  const fonts = await Deno.readTextFile(new URL('./fonts.ts', import.meta.url))
  assert(fonts.includes('./OFL-Inter.txt'), 'fonts.ts names the OFL file')
  const ofl = await Deno.readTextFile(
    new URL('./OFL-Inter.txt', import.meta.url),
  )
  assert(ofl.includes('The Inter Project Authors'))
  assert(ofl.includes('SIL OPEN FONT LICENSE Version 1.1'))
})
