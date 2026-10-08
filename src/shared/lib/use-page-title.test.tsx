import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShellCrumbProvider, useShellCrumbLabel } from './shell-crumb'
import { usePageTitle } from './use-page-title'

function Page({ title, crumb }: { title: string; crumb?: boolean }) {
  usePageTitle(title, { crumb })
  return null
}

function Crumb() {
  return <p data-testid="crumb">{useShellCrumbLabel() ?? '—'}</p>
}

describe('usePageTitle', () => {
  it('sets « <page> · Clinique MANA » and follows changes', () => {
    const { rerender } = render(<Page title="Accueil" />)
    expect(document.title).toBe('Accueil · Clinique MANA')
    rerender(<Page title="Paramètres" />)
    expect(document.title).toBe('Paramètres · Clinique MANA')
  })

  it('sets the shell crumb only when asked, and clears it on unmount', () => {
    const { rerender } = render(
      <ShellCrumbProvider>
        <Page title="Marie Tremblay" />
        <Crumb />
      </ShellCrumbProvider>,
    )
    expect(screen.getByTestId('crumb')).toHaveTextContent('—')
    rerender(
      <ShellCrumbProvider>
        <Page title="Marie Tremblay" crumb />
        <Crumb />
      </ShellCrumbProvider>,
    )
    expect(screen.getByTestId('crumb')).toHaveTextContent('Marie Tremblay')
    expect(document.title).toBe('Marie Tremblay · Clinique MANA')
    rerender(
      <ShellCrumbProvider>
        <Crumb />
      </ShellCrumbProvider>,
    )
    expect(screen.getByTestId('crumb')).toHaveTextContent('—')
  })

  it('works outside the shell (no provider)', () => {
    render(<Page title="Marie Tremblay" crumb />)
    expect(document.title).toBe('Marie Tremblay · Clinique MANA')
  })
})
