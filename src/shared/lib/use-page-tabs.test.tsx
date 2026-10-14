import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ROUTER_FUTURE } from './router-future'
import { usePageTabs } from './use-page-tabs'

const TABS = ['catalogue', 'prix', 'annulation'] as const

function Page({ tabs = TABS }: { tabs?: readonly string[] }) {
  const { tab, onValueChange, triggerProps } = usePageTabs(tabs)
  const location = useLocation()
  return (
    <>
      <p data-testid="search">{location.search}</p>
      <Tabs value={tab} onValueChange={onValueChange}>
        <TabsList>
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value} {...triggerProps(value)}>
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((value) => (
          <TabsContent key={value} value={value}>
            panel {value}
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}

function renderAt(path: string, tabs?: readonly string[]) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <Page tabs={tabs} />
    </MemoryRouter>,
  )
}

describe('usePageTabs', () => {
  it('opens the first tab by default, with a clean address', () => {
    renderAt('/parametres/services')
    expect(screen.getByRole('tab', { name: 'catalogue' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('panel catalogue')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent(/^$/)
  })

  it('opens the tab the address names (a link, a reload)', () => {
    renderAt('/parametres/services?onglet=prix')
    expect(screen.getByRole('tab', { name: 'prix' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('panel prix')).toBeInTheDocument()
  })

  it('an unknown or hidden tab opens the first one', () => {
    renderAt('/parametres/services?onglet=inconnu')
    expect(screen.getByRole('tab', { name: 'catalogue' })).toHaveAttribute('aria-selected', 'true')
    renderAt('/parametres/services?onglet=prix', ['catalogue', 'annulation'])
    expect(screen.getAllByRole('tab', { name: 'catalogue' }).at(-1)).toHaveAttribute('aria-selected', 'true')
  })

  it('a click or the arrow keys write the tab in the address; back to the first clears it', async () => {
    const user = userEvent.setup()
    renderAt('/parametres/services?vue=x')
    await user.click(screen.getByRole('tab', { name: 'annulation' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?vue=x&onglet=annulation')
    expect(screen.getByText('panel annulation')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('search')).toHaveTextContent('?vue=x&onglet=prix')
    await user.click(screen.getByRole('tab', { name: 'catalogue' }))
    expect(screen.getByTestId('search')).toHaveTextContent(/^\?vue=x$/)
  })
})
