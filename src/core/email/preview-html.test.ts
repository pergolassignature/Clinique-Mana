import { describe, expect, it } from 'vitest'
import { withInertLinks } from './preview-html'

describe('withInertLinks', () => {
  it('puts <base target="_blank"> first in the head', () => {
    expect(withInertLinks('<!doctype html><html><head><meta charset="utf-8"><base href="https://x.test/"></head><body><a href="/a">a</a></body></html>')).toBe(
      '<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><base href="https://x.test/"></head><body><a href="/a">a</a></body></html>',
    )
  })

  it('keeps the head’s attributes and does not mistake <header> for it', () => {
    expect(withInertLinks('<HEAD lang="fr"></HEAD>')).toBe('<HEAD lang="fr"><base target="_blank"></HEAD>')
    expect(withInertLinks('<header>x</header>')).toBe('<base target="_blank"><header>x</header>')
  })
})
