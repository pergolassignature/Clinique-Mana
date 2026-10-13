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
