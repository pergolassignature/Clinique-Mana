import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordRule } from '../../../supabase/functions/_shared/password'
import { newPasswordRule } from './password-schema'

/**
 * One password rule for the three places that hold it: GoTrue's settings (supabase/config.toml),
 * the browser (« Choisir un nouveau mot de passe », « Mon compte », the invitation page) and
 * accept-invite, which creates accounts outside the dashboard's own checks.
 */
const config = readFileSync(path.resolve(__dirname, '../../../supabase/config.toml'), 'utf8')
const auth = /^\[auth\]\n([\s\S]*?)^\[/m.exec(config)?.[1] ?? ''

const CASES: [string, string][] = [
  ['the minimum length minus one', 'a'.repeat(MIN_PASSWORD_LENGTH - 1)],
  ['the minimum length', 'a'.repeat(MIN_PASSWORD_LENGTH)],
  ['72 ASCII bytes', 'a'.repeat(72)],
  ['73 ASCII bytes', 'a'.repeat(73)],
  ['36 accented letters (72 bytes)', 'é'.repeat(36)],
  ['37 accented letters (74 bytes)', 'é'.repeat(37)],
  ['18 emoji (72 bytes, 36 UTF-16 units)', '🔒'.repeat(18)],
  ['19 emoji (76 bytes)', '🔒'.repeat(19)],
  ['spaces only, long enough', ' '.repeat(12)],
  ['a usual passphrase', 'Une phrase de passe assez longue'],
]

describe('password rule: config.toml, the browser and accept-invite', () => {
  it("accept-invite's minimum is config.toml's minimum_password_length; no other GoTrue rule is set locally", () => {
    expect(auth).not.toBe('')
    expect(Number(/^minimum_password_length = (\d+)$/m.exec(auth)?.[1])).toBe(MIN_PASSWORD_LENGTH)
    // Character classes would have to be mirrored in both rules (Mise en service 16d).
    expect(auth).not.toMatch(/^password_requirements = "[^"]+"/m)
    expect(MAX_PASSWORD_BYTES).toBe(72)
  })

  it.each(CASES)('%s: the browser and accept-invite agree', (_case, password) => {
    const bytes = new TextEncoder().encode(password).length
    // Length as zod counts it (UTF-16 units), bytes as bcrypt does.
    const expected = password.length >= MIN_PASSWORD_LENGTH && bytes <= MAX_PASSWORD_BYTES
    expect(newPasswordRule.safeParse(password).success).toBe(expected)
    expect(passwordRule.safeParse(password).success).toBe(expected)
  })
})
