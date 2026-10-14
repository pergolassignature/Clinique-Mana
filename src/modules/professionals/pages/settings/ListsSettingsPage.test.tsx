import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { accessForRole } from '@/test/role-fixtures'
import { renderInSettingsSection } from '@/test/settings-section'
import { CATALOG } from '../../test/fixtures-domain'
import { setupQueryClient } from '../../test/query-client'
import { professionalsManifest } from '../../manifest'
import { ListsSettingsPage } from './ListsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchProfessionalsCatalog: vi.fn(),
    fetchReferenceUsage: vi.fn(),
  },
}))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.api }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const L = 'modules.professionals.settings.lists'
const section = professionalsManifest.settingsSections.find((s) => s.id === 'lists')!

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.search}</p>
}

function renderPage(path = '/parametres/listes', readOnly = false) {
  const client = setupQueryClient()
  render(
    <QueryClientProvider client={client.queryClient}>
      {renderInSettingsSection(
        <>
          <ListsSettingsPage />
          <Where />
        </>,
        { readOnly, section, access: { access: accessForRole(readOnly ? 'admin_assistant' : 'admin') }, path },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.api.fetchReferenceUsage.mockResolvedValue(new Map())
})
afterEach(() => vi.clearAllMocks())

describe('« Listes » (NAV-3)', () => {
  it('one h1, five real tabs in the lists\' order, « Professions et ordres » first; its panel titled by an h2', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t(`${L}.title`) })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      t('modules.professionals.settings.professions.title'),
      t('modules.professionals.settings.clienteles.title'),
      t('modules.professionals.settings.motifs.title'),
      t('modules.professionals.settings.languages.title'),
      t('modules.professionals.settings.deactivationReasons.title'),
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist', { name: t(`${L}.tabs`) })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: t('modules.professionals.settings.professions.title') })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('opens the tab named in the address, and a tab change writes it (none for the first)', async () => {
    renderPage('/parametres/listes?onglet=langues')
    expect(screen.getByRole('tab', { name: t('modules.professionals.settings.languages.title') })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { level: 2, name: t('modules.professionals.settings.languages.title') })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: t('modules.professionals.settings.motifs.title') }))
    expect(screen.getByTestId('where')).toHaveTextContent('?onglet=motifs')
    await userEvent.click(screen.getByRole('tab', { name: t('modules.professionals.settings.professions.title') }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/)
  })

  it('an unknown tab word opens the first tab', () => {
    renderPage('/parametres/listes?onglet=nimporte')
    expect(screen.getByRole('tab', { name: t('modules.professionals.settings.professions.title') })).toHaveAttribute('aria-selected', 'true')
  })

  it('read-only: the « Lecture seule » notice once, above the tabs', async () => {
    renderPage('/parametres/listes?onglet=motifs', true)
    await screen.findByRole('heading', { level: 2, name: t('modules.professionals.settings.motifs.title') })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
  })
})
