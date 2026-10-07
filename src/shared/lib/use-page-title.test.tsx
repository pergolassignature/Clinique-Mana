import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { usePageTitle } from './use-page-title'

function Page({ title }: { title: string }) {
  usePageTitle(title)
  return null
}

describe('usePageTitle', () => {
  it('sets « <page> · Clinique MANA » and follows changes', () => {
    const { rerender } = render(<Page title="Accueil" />)
    expect(document.title).toBe('Accueil · Clinique MANA')
    rerender(<Page title="Paramètres" />)
    expect(document.title).toBe('Paramètres · Clinique MANA')
  })
})
