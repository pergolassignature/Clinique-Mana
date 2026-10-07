import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { toast, Toaster } from './sonner'

async function show(fire: () => void, text: string) {
  render(<Toaster />)
  act(fire)
  const title = await screen.findByText(text)
  return title.closest('[data-sonner-toast]') as HTMLElement
}

describe('Toaster (design system Toast)', () => {
  it('is an ink toast with white text, bottom-right, through sonner variables', async () => {
    const node = await show(() => toast('Modules mis à jour.'), 'Modules mis à jour.')
    const toaster = node.closest('[data-sonner-toaster]') as HTMLElement
    expect(toaster).toHaveAttribute('data-y-position', 'bottom')
    expect(toaster).toHaveAttribute('data-x-position', 'right')
    expect(toaster.style.getPropertyValue('--normal-bg')).toBe('rgb(var(--ink))')
    expect(toaster.style.getPropertyValue('--normal-text')).toBe('rgb(var(--text-inverse))')
    expect(toaster.style.getPropertyValue('--border-radius')).toBe('var(--radius-lg)')
    expect(node.style.padding).toBe('10px 12px')
    expect(node.style.boxShadow).toBe('var(--shadow-large)')
    // One look for every type: no rich colours.
    expect(node).not.toHaveAttribute('data-rich-colors', 'true')
  })

  it.each([
    ['success', () => toast.success('Enregistré.'), 'Enregistré.', 'rgb(var(--teal-300))'],
    ['error', () => toast.error('Impossible.'), 'Impossible.', 'rgb(var(--pink-300))'],
    ['warning', () => toast.warning('Attention.'), 'Attention.', 'rgb(var(--yellow-300))'],
  ])('%s: only the (decorative) icon carries the tone', async (_type, fire, text, color) => {
    const node = await show(fire, text)
    const icon = node.querySelector('[data-icon] svg') as SVGElement
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon.style.color).toBe(color)
  })

  it('keeps a close button for keyboard users', async () => {
    const node = await show(() => toast('Bonjour'), 'Bonjour')
    expect(node.querySelector('[data-close-button]')).toBeInTheDocument()
  })
})
