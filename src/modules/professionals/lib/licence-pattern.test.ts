import { describe, expect, it } from 'vitest'
import { hasPostgresOnlySyntax } from './licence-pattern'

describe('hasPostgresOnlySyntax', () => {
  it.each([
    '^[0-9]{5}$',
    '^[A-Z]{2}-[0-9]{4}$',
    '^[0-9]{3} [0-9]{2}$',
    '^[^a-z]+$',
    '^(A|B)[0-9]+$',
    '^\\d{5}$',
    '^[0-9.]+$',
    '^[.]$',
    '^a\\\\m$', // an escaped backslash, then a plain m
    '',
  ])('reads %s the same in both dialects', (pattern) => {
    expect(hasPostgresOnlySyntax(pattern)).toBe(false)
  })

  it.each([
    ['POSIX class', '^[[:digit:]]{5}$'],
    ['POSIX class after a range', '^[a-z[:digit:]]+$'],
    ['collating element', '^[[.a.]]$'],
    ['equivalence class', '^[[=e=]]$'],
    ['leading ] in a bracket', '^[]a]$'],
    ['leading ] in a negated bracket', '^[^]a]$'],
    ['embedded options', '(?i)^ab$'],
    ['non-capturing group', '^(?:ab)+$'],
    ['lookahead', '^(?=a)a$'],
    ['word start', '\\mab'],
    ['word end', 'ab\\M'],
    ['word bound', '\\yab\\y'],
    ['not a word bound', 'a\\Yb'],
    ['string start', '\\Aab'],
    ['string end', 'ab\\Z'],
    ['\\b', 'a\\b'],
    ['\\B', 'a\\B'],
    ['back-reference', '^([0-9])\\1$'],
    ['director prefix', '***=a.b'],
  ])('flags a %s', (_, pattern) => {
    expect(hasPostgresOnlySyntax(pattern)).toBe(true)
  })
})
