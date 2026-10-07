import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { Home, Users } from 'lucide-react'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { AppShell, type ShellNavItem } from './AppShell'
import type { CommandPalette } from './shell/CommandPalette'

// A stand-in palette whose close event fires only when the test says so: it lets a close event
// go missing, which the real Radix dialog never does in jsdom.
vi.mock('./shell/CommandPalette', () => ({
  CommandPalette: ({ open, onSelect, onCloseAutoFocus, contentRef }: Parameters<typeof CommandPalette>[0]) => (
    <>
      {open && (
        <div ref={contentRef} role="dialog" aria-label="Palette factice">
          <button type="button" onClick={() => onSelect('/professionnels')}>
            Choisir Professionnels
          </button>
        </div>
      )}
      <button type="button" onClick={() => onCloseAutoFocus(new Event('focusout', { cancelable: true }))}>
        Fin de fermeture
      </button>
    </>
  ),
}))

const navItems: ShellNavItem[] = [
  { path: '/accueil', labelKey: 'nav.home', icon: Home },
  { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users },
]

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

const shell = () =>
  renderWithContexts(
    <UnsavedChangesProvider>
      <AppShell navItems={navItems}>
        <Location />
      </AppShell>
    </UnsavedChangesProvider>,
    { path: '/accueil' },
  )

describe('AppShell — palette choice', () => {
  it('navigates once the palette has closed', async () => {
    render(shell())
    await userEvent.click(screen.getByRole('button', { name: t('nav.searchLabel') }))
    await userEvent.click(screen.getByRole('button', { name: 'Choisir Professionnels' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/accueil')
    await userEvent.click(screen.getByRole('button', { name: 'Fin de fermeture' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/professionnels')
  })

  it('forgets a choice whose close event never came when the palette opens again', async () => {
    render(shell())
    await userEvent.click(screen.getByRole('button', { name: t('nav.searchLabel') }))
    await userEvent.click(screen.getByRole('button', { name: 'Choisir Professionnels' }))
    // No close event: the palette is reopened, then closed without a choice.
    await userEvent.click(screen.getByRole('button', { name: t('nav.searchLabel') }))
    await userEvent.click(screen.getByRole('button', { name: 'Fin de fermeture' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/accueil')
  })
})
