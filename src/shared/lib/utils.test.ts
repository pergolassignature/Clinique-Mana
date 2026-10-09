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

  it('knows the focus shadows are shadow sizes too', () => {
    expect(cn('focus-visible:shadow-focus', 'focus-visible:shadow-focus-inset')).toBe('focus-visible:shadow-focus-inset')
    expect(cn('shadow-medium', 'shadow-focus')).toBe('shadow-focus')
    expect(cn('data-[highlighted]:shadow-none', 'data-[highlighted]:shadow-highlight')).toBe('data-[highlighted]:shadow-highlight')
  })

  it('keeps a shadow colour next to a custom shadow size', () => {
    expect(cn('shadow-soft', 'shadow-black/5')).toBe('shadow-soft shadow-black/5')
  })

  it('knows text-2xs is a font size, not a colour', () => {
    expect(cn('text-2xs', 'text-sm')).toBe('text-sm')
    expect(cn('text-sm', 'text-2xs')).toBe('text-2xs')
    expect(cn('text-2xs', 'text-muted-foreground')).toBe('text-2xs text-muted-foreground')
  })

  it('knows max-w-form and max-w-content are max widths', () => {
    expect(cn('max-w-form', 'max-w-sm')).toBe('max-w-sm')
    expect(cn('max-w-2xl', 'max-w-form')).toBe('max-w-form')
    expect(cn('max-w-content', 'max-w-form')).toBe('max-w-form')
  })

  it('knows the theme animations are animations', () => {
    expect(cn('animate-dialog-in', 'animate-dialog-in-top')).toBe('animate-dialog-in-top')
    expect(cn('animate-fade-in', 'animate-none')).toBe('animate-none')
    expect(cn('animate-slide-in-right', 'motion-reduce:animate-none')).toBe('animate-slide-in-right motion-reduce:animate-none')
  })

  it('treats the design-system colours as colours', () => {
    expect(cn('text-muted-foreground', 'text-subtle')).toBe('text-subtle')
    expect(cn('bg-primary', 'bg-ink')).toBe('bg-ink')
    expect(cn('border-input', 'border-border-strong')).toBe('border-border-strong')
  })
})
