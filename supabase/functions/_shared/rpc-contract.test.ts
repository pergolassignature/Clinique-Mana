/**
 * Every `.rpc('<name>', { … })` call of the deployed functions names a public
 * function the migrations define, with argument names it takes: PostgREST
 * finds a function by its name and its argument names, so a renamed or
 * dropped argument would only fail at run time (and the fakes of the unit
 * tests answer whatever is asked). The migrations are read in order: `create
 * [or replace] function public.<name>(…)` adds or replaces a signature,
 * `drop function [if exists] public.<name>(…)` removes it. A call matches a
 * signature when it passes every argument without a default and nothing
 * else. Calls with a computed name (a link purpose's `resolve_rpc`) or a
 * spread argument object are skipped. Test-only files are not scanned.
 */
import { assert, assertEquals } from '@std/assert'

const FUNCTIONS = new URL('../', import.meta.url)
const MIGRATIONS = new URL('../../migrations/', import.meta.url)

interface Signature {
  types: string
  args: { name: string; optional: boolean }[]
}

/** The text between the parenthesis at `open` and its match, and the index after it. */
function balanced(text: string, open: number): [string, number] {
  let depth = 0
  let quoted = false
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'") quoted = !quoted
    if (quoted) continue
    if (c === '(') depth++
    if (c === ')' && --depth === 0) return [text.slice(open + 1, i), i + 1]
  }
  throw new Error(`unbalanced parenthesis at ${open}`)
}

/** Splits at the top-level commas (outside quotes and parentheses). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") quoted = !quoted
    if (quoted) continue
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

const TYPE_ALIASES: Record<string, string> = {
  'timestamp with time zone': 'timestamptz',
  integer: 'int',
  int4: 'int',
  boolean: 'bool',
  'character varying': 'varchar',
}
const normaliseType = (type: string) => {
  const t = type.toLowerCase().replace(/\s+/g, ' ').replace(/^public\./, '')
    .trim()
  return TYPE_ALIASES[t] ?? t
}

/** One argument of a definition: `[in|out|inout|variadic] name type [default …]`. */
function parseArg(
  text: string,
): { name: string; type: string; optional: boolean; out: boolean } {
  const m =
    /^(?:(in|out|inout|variadic)\s+)?([a-z_][a-z0-9_]*)\s+([\s\S]+?)(?:\s+(?:default|=)\s+[\s\S]+)?$/i
      .exec(text.replace(/\s+/g, ' '))
  if (!m) throw new Error(`unreadable argument: ${text}`)
  return {
    name: m[2],
    type: normaliseType(m[3]),
    optional: /\s(default|=)\s/i.test(` ${text} `),
    out: m[1]?.toLowerCase() === 'out',
  }
}

async function definitions(): Promise<Map<string, Signature[]>> {
  const files = []
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name)
  }
  files.sort()
  const functions = new Map<string, Signature[]>()
  const statement =
    /\b(create(?:\s+or\s+replace)?\s+function|drop\s+function(?:\s+if\s+exists)?)\s+public\.([a-z_][a-z0-9_]*)\s*(\(?)/gi
  for (const file of files) {
    // Comments out: their prose names functions too.
    const sql = (await Deno.readTextFile(new URL(file, MIGRATIONS)))
      .replace(/--[^\n]*/g, '')
    for (const m of sql.matchAll(statement)) {
      const name = m[2]
      const list = functions.get(name) ?? []
      if (/^drop/i.test(m[1]) && m[3] === '') {
        functions.delete(name)
        continue
      }
      const [inside] = balanced(sql, m.index! + m[0].length - 1)
      if (/^drop/i.test(m[1])) {
        // A drop names types only (`uuid, text`).
        const types = splitTopLevel(inside).map(normaliseType).join(',')
        functions.set(name, list.filter((s) => s.types !== types))
        continue
      }
      const args = splitTopLevel(inside).map(parseArg).filter((a) => !a.out)
      const signature = {
        types: args.map((a) => a.type).join(','),
        args: args.map(({ name, optional }) => ({ name, optional })),
      }
      functions.set(name, [
        ...list.filter((s) => s.types !== signature.types),
        signature,
      ])
    }
  }
  return functions
}

interface Call {
  file: string
  name: string
  keys: string[] | null
}

/** The top-level keys of an object literal's text (`{ a: 1, b, c: { d } }` → a, b, c). */
function objectKeys(text: string): string[] | null {
  const keys: string[] = []
  for (
    const part of splitTopLevel(
      text.replace(/[{}]/g, (c) => c === '{' ? '(' : ')'),
    )
  ) {
    if (part.startsWith('...')) return null
    const m = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(part)
    if (!m) throw new Error(`unreadable rpc argument: ${part}`)
    keys.push(m[1])
  }
  return keys
}

async function calls(): Promise<Call[]> {
  const found: Call[] = []
  async function walk(dir: URL, rel: string) {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${rel}${entry.name}`
      if (entry.isDirectory) {
        if (entry.name !== 'testing' && entry.name !== 'vendor') {
          await walk(new URL(`${entry.name}/`, dir), `${path}/`)
        }
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue
      }
      const source = await Deno.readTextFile(new URL(entry.name, dir))
      for (const m of source.matchAll(/\.rpc\(\s*/g)) {
        const start = m.index! + m[0].length
        const literal = /^'([a-z_][a-z0-9_]*)'\s*(,\s*)?/.exec(
          source.slice(start),
        )
        if (!literal) continue // a computed name
        if (!literal[2]) {
          found.push({ file: path, name: literal[1], keys: [] })
          continue
        }
        const argStart = start + literal[0].length
        if (source[argStart] !== '{') continue // an argument object built elsewhere
        // The object literal, braces balanced (as parentheses for `balanced`).
        const rest = source.slice(argStart).replace(
          /[{}]/g,
          (c) => c === '{' ? '(' : ')',
        )
        const [inside] = balanced(rest, 0)
        found.push({ file: path, name: literal[1], keys: objectKeys(inside) })
      }
    }
  }
  await walk(FUNCTIONS, '')
  return found
}

Deno.test('rpc contract: every literal .rpc call names a public function and its argument names', async () => {
  const functions = await definitions()
  const found = await calls()
  assert(found.length >= 40, `only ${found.length} calls found: the scan broke`)
  const problems: string[] = []
  for (const call of found) {
    const signatures = functions.get(call.name)
    if (!signatures?.length) {
      problems.push(`${call.file}: ${call.name} is not a public function`)
      continue
    }
    if (call.keys === null) continue // a spread: cannot be checked here
    const keys = call.keys
    const fits = signatures.some((s) =>
      keys.every((k) => s.args.some((a) => a.name === k)) &&
      s.args.every((a) => a.optional || keys.includes(a.name))
    )
    if (!fits) {
      problems.push(
        `${call.file}: ${call.name}(${keys.join(', ')}) matches none of ${
          signatures.map((s) =>
            `(${
              s.args.map((a) => a.name + (a.optional ? '?' : '')).join(', ')
            })`
          ).join(' ')
        }`,
      )
    }
  }
  assertEquals(problems, [])
})

Deno.test('rpc contract: the parser reads defaults, out arguments, replacements and drops', () => {
  assertEquals(parseArg('p_limit int default 100'), {
    name: 'p_limit',
    type: 'int',
    optional: true,
    out: false,
  })
  assertEquals(parseArg('out total bigint').out, true)
  assertEquals(
    parseArg('p_before timestamp with time zone default null').type,
    'timestamptz',
  )
  assertEquals(objectKeys(' p_a: x, p_b, p_c: { d: 1, e: f(g, h) } '), [
    'p_a',
    'p_b',
    'p_c',
  ])
  assertEquals(objectKeys('...rest, p_a: 1'), null)
})
