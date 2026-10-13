import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FileCheck, UsersRound } from 'lucide-react'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { SidebarContent } from './SidebarContent'
import type { ShellNavItem } from './shell-pages'

const NAV: ShellNavItem[] = [
  { path: '/clients', labelKey: 'modules.clients.name', icon: UsersRound },
  { path: '/clients/consentements', labelKey: 'modules.clients.consents.nav', icon: FileCheck },
]

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      {renderWithContexts(<SidebarContent navItems={NAV} collapsed={false} variant="sidebar" signingOut={false} onSignOut={vi.fn()} />, {
        path,
        access: { access: accessForRole('admin') },
      })}
    </QueryClientProvider>,
  )
  return (name: string) => screen.getByRole('link', { name }).getAttribute('aria-current')
}

describe('SidebarContent: which item is current', () => {
  it('a record under « Clients » keeps « Clients » current', () => {
    const current = renderAt('/clients/00000000-0000-4000-8000-000000000a01/apercu')
    expect(current('Clients')).toBe('page')
    expect(current('Consentements')).toBeNull()
  })

  it('« Consentements » (/clients/consentements) is current alone, not « Clients » too', () => {
    const current = renderAt('/clients/consentements')
    expect(current('Consentements')).toBe('page')
    expect(current('Clients')).toBeNull()
  })
})

describe('SidebarContent: sections (decision NAV-1)', () => {
  const GROUPED: ShellNavItem[] = [
    { path: '/accueil', labelKey: 'nav.home', icon: UsersRound, group: 'main', order: 0 },
    { path: '/clients', labelKey: 'modules.clients.name', icon: UsersRound, group: 'followUp', order: 15 },
    { path: '/clients/consentements', labelKey: 'modules.clients.consents.nav', icon: FileCheck, group: 'followUp', order: 16 },
  ]
  const renderNav = (collapsed: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        {renderWithContexts(<SidebarContent navItems={GROUPED} collapsed={collapsed} variant="sidebar" signingOut={false} onSignOut={vi.fn()} />, {
          path: '/accueil',
          access: { access: accessForRole('admin') },
        })}
      </QueryClientProvider>,
    )

  it.each([false, true])('names each labelled section by its heading, never a tab stop (collapsed: %s)', (collapsed) => {
    renderNav(collapsed)
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Suivi' }).querySelectorAll('a')).toHaveLength(2)
    const heading = screen.getByText('Suivi')
    expect(heading).not.toHaveAttribute('tabindex')
    // Collapsed: read out, not shown (a rule separates the sections).
    expect(heading.className).toContain(collapsed ? 'sr-only' : 'uppercase')
  })
})
