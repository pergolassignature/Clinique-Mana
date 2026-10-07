// @vitest-environment node
// DESIGN_TOKENS_ALLOWED: this file holds the guard's fixtures.
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.resolve(__dirname, '../../scripts/check-design-tokens.sh')
let dir: string | undefined

function check(source: string) {
  dir = mkdtempSync(path.join(tmpdir(), 'design-tokens-'))
  writeFileSync(path.join(dir, 'Sample.tsx'), source)
  const run = spawnSync('bash', [script, dir], { encoding: 'utf8' })
  return { status: run.status, out: run.stdout + run.stderr }
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('scripts/check-design-tokens.sh', () => {
  it.each([
    'text-muted',
    'hover:text-muted',
    'placeholder:text-muted',
    'text-muted/60',
    'fill-muted',
    'stroke-muted',
    'text-secondary',
    'bg-secondary',
    'border-secondary',
  ])('fails on %s and names the right token', (cls) => {
    const { status, out } = check(`export const c = 'px-2 ${cls} py-1'\n`)
    expect(status).toBe(1)
    expect(out).toContain('Sample.tsx:1')
    expect(out).toContain('text-muted-foreground')
  })

  it('passes on the real tokens and on CSS variable names', () => {
    const { status, out } = check(
      [
        "export const a = 'text-muted-foreground bg-muted bg-muted-strong text-subtle placeholder:text-subtle'",
        "export const b = 'text-[rgb(var(--text-muted))] shadow-[0_0_0_1px_var(--text-secondary)]'",
        "export const c = { variant: 'secondary' }",
      ].join('\n'),
    )
    expect(out).toContain('OK')
    expect(status).toBe(0)
  })

  it('passes on the app sources', () => {
    const run = spawnSync('bash', [script, path.resolve(__dirname, '..')], { encoding: 'utf8' })
    expect(run.stdout).toContain('OK')
    expect(run.status).toBe(0)
  })
})
