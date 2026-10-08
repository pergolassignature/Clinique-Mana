import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseUrlSchema, normalizeBaseUrl } from './schemas'

/**
 * The Documenso address rule twice: the browser (`baseUrlSchema`) and the database
 * (`private.signing_base_url_valid`, P3-34). The SQL function is read from its migration and run
 * here: each `when` clause and the host checks of its `else`, POSIX classes as JavaScript reads
 * them. A clause of another shape fails the test, so a change to the SQL rule is never missed.
 * The browser must accept exactly the addresses whose stored form (what it would send) the
 * database accepts.
 */
const migration = readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261008073909_core_signing.sql'), 'utf8')

/** POSIX bracket classes the SQL uses, in JavaScript. */
const toJs = (posix: string) => new RegExp(posix.replace(/\[:space:\]/g, '\\s'), 'u')

type Check = (value: string) => boolean
type Clause = { when: Check; then: boolean }

/** `pg_catalog.length(x) > n`, `x ~ 're'`, `x !~ 're'`, `x is null`: one condition on one value. */
function condition(text: string, name: string): Check {
  const t = text.trim()
  let m = new RegExp(`^pg_catalog\\.length\\(${name}\\) (>|<=) (\\d+)$`).exec(t)
  if (m) {
    const n = Number(m[2])
    return m[1] === '>' ? (v) => Array.from(v).length > n : (v) => Array.from(v).length <= n
  }
  m = new RegExp(`^${name} (!?~) '((?:[^']|'')*)'$`).exec(t)
  if (m) {
    const re = toJs((m[2] ?? '').replace(/''/g, "'"))
    return m[1] === '~' ? (v) => re.test(v) : (v) => !re.test(v)
  }
  throw new Error(`unexpected condition in signing_base_url_valid: ${t}`)
}

function sqlRule(): Check {
  const body = /create function private\.signing_base_url_valid\(p_url text\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(migration)?.[1]
  if (!body) throw new Error('private.signing_base_url_valid not found')
  const cases = /select case([\s\S]*?)\n\s*else ([\s\S]*?)\n\s*end\s*$/.exec(body.trim())
  if (!cases) throw new Error('signing_base_url_valid is no longer one case expression')
  const clauses: Clause[] = []
  for (const [, when = '', then] of (cases[1] ?? '').matchAll(/when ([\s\S]*?) then (true|false|null)\b/g)) {
    if (when.trim() === 'p_url is null') continue // null in, null out: the browser sends null for empty
    clauses.push({ when: condition(when, 'p_url'), then: then === 'true' })
  }
  // else (select <h checks joined by and> from pg_catalog.substring(p_url, '<re>') h)
  const otherwise = /^\(select ([\s\S]*?)\s+from pg_catalog\.substring\(p_url, '([^']*)'\) h\)$/.exec((cases[2] ?? '').trim())
  if (!otherwise) throw new Error('unexpected else in signing_base_url_valid')
  const [, checks = '', hostPattern = ''] = otherwise
  const host = new RegExp(hostPattern)
  const hostChecks = checks.split(/\s+and\s+/).map((part) => condition(part, 'h'))
  expect(clauses.length).toBe(3)
  expect(hostChecks.length).toBe(4)
  return (url) => {
    for (const clause of clauses) if (clause.when(url)) return clause.then
    const h = host.exec(url)?.[1]
    return h !== undefined && hostChecks.every((check) => check(h))
  }
}

const VALID = [
  'https://sign.cliniquemana.com',
  'https://sign.cliniquemana.com/api',
  'https://sign.cliniquemana.com:8443/api/v2',
  'https://a-b.c-d.ca',
  'https://xn--bcher-kva.example',
  'https://sign.example.co.uk/',
  'SIGN.Example.com',
  'sign.example.com/documenso',
  'http://host.docker.internal:55390',
  'http://host.docker.internal:55390/',
  `https://${'a'.repeat(63)}.example.com`,
]
const INVALID = [
  'http://sign.example.com',
  'ftp://sign.example.com',
  'https://localhost',
  'https://foo.localhost',
  'https://x.internal',
  'https://printer.local',
  'https://127.0.0.1',
  'https://127.1',
  'https://0x7f.1',
  'https://intranet',
  'https://[::1]',
  'https://sign.example.com?x=1',
  'https://sign.example.com/#a',
  'https://sign.example.com/a b',
  'https://-bad.example.com',
  'https://bad-.example.com',
  'https://a..b.com',
  'https://sign.example.com:123456',
  'https://user@sign.example.com',
  'https://sign_x.example.com',
  `https://${'a'.repeat(64)}.example.com`,
  `https://${Array.from({ length: 64 }, () => 'abc').join('.')}.ca`,
  `https://sign.example.com/${'a'.repeat(2048)}`,
  'http://host.docker.internal',
  'http://host.docker.internal:55390?x',
]

describe('Documenso address: the browser and private.signing_base_url_valid', () => {
  const sql = sqlRule()

  it.each([...VALID.map((v) => [v, true] as const), ...INVALID.map((v) => [v, false] as const)])('%s → %s in both', (typed, valid) => {
    const sent = normalizeBaseUrl(typed.trim())
    const browser = baseUrlSchema.safeParse({ base_url: typed })
    expect(browser.success).toBe(valid)
    expect(sql(sent)).toBe(valid)
    if (browser.success) expect(browser.data.base_url).toBe(sent)
  })
})
