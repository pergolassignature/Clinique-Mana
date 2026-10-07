import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges classes and lets later Tailwind classes win', () => {
    const isHidden = false
    expect(cn('px-2 py-1', isHidden && 'hidden', 'px-4')).toBe('py-1 px-4')
  })

  it('knows the custom shadow scale (shadow-soft/medium/large) is a shadow size', () => {
    expect(cn('shadow-soft', 'shadow-none')).toBe('shadow-none')
    expect(cn('shadow-none', 'shadow-large')).toBe('shadow-large')
    expect(cn('hover:shadow-soft', 'hover:shadow-medium')).toBe('hover:shadow-medium')
  })

  it('keeps a shadow colour next to a custom shadow size', () => {
    expect(cn('shadow-soft', 'shadow-black/5')).toBe('shadow-soft shadow-black/5')
  })
})
