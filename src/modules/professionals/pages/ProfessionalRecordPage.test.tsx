import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes, useNavigationType } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { ShellCrumbProvider, useShellCrumbLabel } from '@/shared/lib/shell-crumb'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { RECORD_TAB_DEFS } from '../components/record/record-tabs'
import { setupQueryClient } from '../test/query-client'
import { CATALOG, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { ProfessionalRecordPage } from './ProfessionalRecordPage'

const mocks = vi.hoisted(() => ({
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
}))
vi.mock('../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/catalog')>()), ...mocks.catalog }))
vi.mock('../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/record')>()), ...mocks.record }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.professionals.record'
const base = `/professionnels/${IDS.professional}`

/** The topbar's crumb and how the router got here (PUSH / REPLACE). */
function Probes() {
  return (
    <>
      <LocationProbe />
      <p data-testid="crumb">{useShellCrumbLabel()}</p>
      <p data-testid="navigation">{useNavigationType()}</p>
    </>
  )
}

/** A card of the open tab with unsaved edits. */
function DirtyForm() {
  useUnsavedChanges(true)
  return null
}

function renderPage({ path = `${base}/apercu`, role = 'counselor' as FixtureRole, dirty = false } = {}) {
  const client = setupQueryClient()
  render(
    <QueryClientProvider client={client.queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <ShellCrumbProvider>
            <Routes>
              <Route path="/professionnels/:id/:onglet?" element={<ProfessionalRecordPage />} />
            </Routes>
            <Probes />
            {dirty && <DirtyForm />}
          </ShellCrumbProvider>
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
  return client
}

const location = () => screen.getByTestId('location').textContent
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
const tab = (key: string) => screen.getByRole('tab', { name: t(`${R}.tabs.${key}` as Parameters<typeof t>[0]) })

beforeEach(() => {
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(recordFixture())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  document.title = ''
})

describe('ProfessionalRecordPage', () => {
  it('requests the record and the catalogue in the same tick', () => {
    mocks.record.fetchProfessionalRecord.mockReturnValue(new Promise(() => {}))
    mocks.catalog.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledWith(IDS.professional)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
  })

  it('shows the header and Aperçu, names the browser tab and the crumb', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(tab('apercu')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 3, name: t(`${R}.overview.matching.title`) })).toBeInTheDocument()
    expect(document.title).toBe(`Marie Tremblay · ${t('app.name')}`)
    expect(screen.getByTestId('crumb')).toHaveTextContent('Marie Tremblay')
  })

  it('opens the tab the URL names', async () => {
    renderPage({ path: `${base}/historique` })
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tab('historique')).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { level: 2, name: t(`${R}.tabs.historique`) })).toBeInTheDocument()
    expect(await screen.findByText(t(`${R}.tabInPreparation`))).toBeInTheDocument()
  })

  it('puts the chosen tab in the URL, replacing the history entry', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: t(`${R}.tabs.jumelage`) }))
    expect(location()).toBe(`${base}/jumelage`)
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE')
    expect(tab('jumelage')).toHaveAttribute('aria-selected', 'true')
  })

  it('switches tabs with the arrow keys (one tab stop)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    tab('apercu').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(location()).toBe(`${base}/jumelage`)
    expect(tab('jumelage')).toHaveFocus()
    expect(tab('profil-public')).toHaveAttribute('tabindex', '-1')
  })

  it('asks before leaving a tab with unsaved edits', async () => {
    renderPage({ dirty: true })
    await userEvent.click(await screen.findByRole('tab', { name: t(`${R}.tabs.identite`) }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
    expect(location()).toBe(`${base}/apercu`)
    await userEvent.click(screen.getByRole('button', { name: t('common.unsaved.leave') }))
    await waitFor(() => expect(location()).toBe(`${base}/identite`))
  })

  it('starts loading a tab’s code when the pointer rests on it', async () => {
    const jumelage = RECORD_TAB_DEFS.find((def) => def.tab === 'jumelage')?.panel
    const preload = vi.spyOn(jumelage as Required<NonNullable<typeof jumelage>>, 'preload')
    renderPage()
    await userEvent.hover(await screen.findByRole('tab', { name: t(`${R}.tabs.jumelage`) }))
    expect(preload).toHaveBeenCalled()
  })

  it('shows the counselor no compensation tab, and the admin one', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tabNames()).not.toContain(t(`${R}.tabs.remuneration`))
    expect(tabNames()).toEqual(['apercu', 'jumelage', 'profil-public', 'identite', 'historique'].map((k) => t(`${R}.tabs.${k}` as Parameters<typeof t>[0])))
    cleanup()
    renderPage({ role: 'admin' })
    await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })
    expect(tabNames()).toContain(t(`${R}.tabs.remuneration`))
  })

  it.each([
    ['a hidden tab', `${base}/remuneration`],
    ['an unknown tab', `${base}/inconnu`],
    ['no tab', base],
  ])('sends %s to Aperçu', async (_, path) => {
    renderPage({ path })
    await waitFor(() => expect(location()).toBe(`${base}/apercu`))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
  })

  it('says « introuvable » when the record cannot be read, with a way back', async () => {
    mocks.record.fetchProfessionalRecord.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${R}.notFound.title`) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${R}.notFound.back`) })).toHaveAttribute('href', '/professionnels')
    expect(document.title).toBe(`${t(`${R}.notFound.title`)} · ${t('app.name')}`)
    expect(screen.getByTestId('crumb')).toBeEmptyDOMElement()
  })

  it('does not ask the database about an id that is not one', async () => {
    renderPage({ path: '/professionnels/0b6c/apercu' })
    expect(await screen.findByRole('heading', { level: 1, name: t(`${R}.notFound.title`) })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).not.toHaveBeenCalled()
    expect(mocks.catalog.fetchProfessionalsCatalog).not.toHaveBeenCalled()
  })

  it('offers « Réessayer » when a load fails, and retries only what failed', async () => {
    mocks.record.fetchProfessionalRecord.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalledTimes(2)
    expect(mocks.catalog.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
  })
})
