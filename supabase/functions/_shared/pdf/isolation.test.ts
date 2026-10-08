// Guards the bundle isolation of pdfmake (ADR 0008, CLAUDE.md §7): the
// edge-runtime bundler ships every npm package of deno.lock in every
// function, so pdfmake must stay vendored and reachable only through
// render.ts.
import { assert, assertEquals } from '@std/assert'

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
