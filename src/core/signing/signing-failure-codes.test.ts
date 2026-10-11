import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKnownSigningFailure } from './status'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'supabase/functions/_shared', path), 'utf8')

/** The string literals of a TypeScript union type `name` in `source`. */
function unionMembers(source: string, name: string): string[] {
  const body = new RegExp(`export type ${name} =([\\s\\S]+?)\\n\\n`).exec(source)?.[1] ?? ''
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '')
}

/**
 * C6, C-7: every code the functions store in `signature_requests.last_error` (or as a reconcile
 * failure) reads in French. This reads the sources, so a new code fails here until it has words in
 * `src/core/signing/status.ts` (an unknown one would read « Erreur inattendue »).
 */
describe('every stored signing failure code has French words', () => {
  it('the send path (`_shared/signing.ts`): markFailed, cancelAndMark, providerFailure and their literals', () => {
    const source = read('signing.ts')
    const codes = new Set<string>()
    for (const call of source.matchAll(/(?:markFailed|cancelAndMark|providerFailure)\(\s*([\s\S]*?)\)/g)) {
      for (const literal of (call[1] ?? '').matchAll(/(?<!=== )'([a-z_]+)'/g)) codes.add(literal[1] ?? '')
    }
    // The fallbacks of a rendering or recovery failure (`code = … : 'render_failed'`).
    for (const fallback of source.matchAll(/: '([a-z_]+_failed)'\n/g)) codes.add(fallback[1] ?? '')
    codes.add('internal_error')
    expect(codes.size).toBeGreaterThanOrEqual(8)
    for (const code of codes) expect(isKnownSigningFailure(code), code).toBe(true)
  })

  it('the rendering codes (`PdfErrorCode`)', () => {
    const codes = unionMembers(read('pdf/model.ts'), 'PdfErrorCode')
    expect(codes.length).toBeGreaterThanOrEqual(5)
    for (const code of codes) expect(isKnownSigningFailure(code), code).toBe(true)
  })

  it('the reconcile (`failureCode` in `_shared/signing-events.ts`)', () => {
    const source = read('signing-events.ts')
    const body = /export function failureCode\(error: unknown\): string \{([\s\S]+?)\n\}/.exec(source)?.[1] ?? ''
    const codes = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '').filter((code) => code.startsWith('provider_') || code === 'internal')
    expect(codes).toContain('provider_not_found')
    for (const code of codes) expect(isKnownSigningFailure(code), code).toBe(true)
    expect(isKnownSigningFailure('signing_foreign_document')).toBe(true)
  })
})
