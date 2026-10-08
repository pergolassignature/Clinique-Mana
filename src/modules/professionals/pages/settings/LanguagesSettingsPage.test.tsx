import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { LanguagesSettingsPage } from './LanguagesSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchProfessionalsCatalog: vi.fn(),
    fetchReferenceUsage: vi.fn(),
    saveReference: vi.fn(),
    setReferenceActive: vi.fn(),
    reorderReference: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const L = 'modules.professionals.settings.languages'
const USAGE = new Map([[usageKey('languages', IDS.en), 4]])

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.api.fetchReferenceUsage.mockResolvedValue(USAGE)
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  const client = renderProfessionalsSettingsPage(<LanguagesSettingsPage />, { sectionId: 'languages', readOnly })
  await screen.findByRole('table')
  return client
}

const dialog = () => screen.getByRole('dialog')
const field = (name: RegExp) => within(dialog()).getByRole('textbox', { name })
const rowOf = (name: string) => {
  const row = screen.getAllByRole('row').find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}

describe('LanguagesSettingsPage', () => {
  it('lists the languages with their code and usage, French locked', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t(`${L}.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${L}.description`))).toBeInTheDocument()
    expect(within(rowOf('Français')).getByText('fr')).toBeInTheDocument()
    expect(within(rowOf('Français')).getByRole('img', { name: t(`${L}.system`) })).toBeInTheDocument()
    expect(within(rowOf('Anglais')).getByText('en')).toBeInTheDocument()
    expect(within(rowOf('Anglais')).getByText('4 professionnels')).toBeInTheDocument()
    // One list on the page: « Ajouter une langue » is its teal action.
    expect(screen.getByRole('button', { name: t(`${L}.add`) })).toHaveClass('bg-primary')
  })

  it('loads the catalogue and the usage counts in parallel', () => {
    mocks.api.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    mocks.api.fetchReferenceUsage.mockReturnValue(new Promise(() => {}))
    renderProfessionalsSettingsPage(<LanguagesSettingsPage />, { sectionId: 'languages' })
    expect(screen.getByRole('status')).toHaveTextContent(t('common.loading'))
    expect(mocks.api.fetchProfessionalsCatalog).toHaveBeenCalledTimes(1)
    expect(mocks.api.fetchReferenceUsage).toHaveBeenCalledTimes(1)
  })

  it('shows a load error with « Réessayer »', async () => {
    mocks.api.fetchReferenceUsage.mockRejectedValueOnce(new Error('network'))
    renderProfessionalsSettingsPage(<LanguagesSettingsPage />, { sectionId: 'languages' })
    expect(await screen.findByText(t('modules.professionals.settings.list.loadError'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('searches on the code too', async () => {
    await renderPage()
    await userEvent.type(screen.getByRole('searchbox'), 'EN')
    expect(screen.queryByText('Français')).not.toBeInTheDocument()
    expect(rowOf('Anglais').querySelector('mark')?.textContent).toBe('en')
  })

  it('adds a language with its code lower-cased', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue('00000000-0000-4000-8000-000000000203')
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.add`) }))
    expect(screen.getByRole('dialog', { name: t(`${L}.createTitle`) })).toBeInTheDocument()
    expect(field(/^Nom/)).toHaveFocus()
    await userEvent.type(field(/^Nom/), 'Portugais')
    const code = field(new RegExp(`^${t(`${L}.code`)}`))
    expect(code).toHaveAccessibleDescription(t(`${L}.codeHelp`))
    expect(code).toHaveAttribute('maxlength', '2')
    await userEvent.type(code, 'PT')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('languages', { id: null, name: 'Portugais', code: 'pt' })
  })

  it('refuses a code that is not two letters', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: t(`${L}.add`) }))
    await userEvent.type(field(/^Nom/), 'Portugais')
    await userEvent.type(field(new RegExp(`^${t(`${L}.code`)}`)), 'p1')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.languageCode'))).toBeInTheDocument()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('edits a language with its code read-only, and sends the code unchanged', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.en)
    await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.menu', { name: 'Anglais' }) }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t('modules.professionals.settings.list.actions.edit') }))
    expect(screen.getByRole('dialog', { name: t(`${L}.editTitle`) })).toBeInTheDocument()
    const code = field(new RegExp(`^${t(`${L}.code`)}`))
    expect(code).toHaveValue('en')
    expect(code).toHaveAttribute('readonly')
    expect(code).toHaveAccessibleDescription(t(`${L}.codeLocked`))
    await userEvent.type(field(/^Nom/), ' (Canada)')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('languages', { id: IDS.en, name: 'Anglais (Canada)', code: 'en' }))
  })

  it('read-only for the adjointe: the notice once, no « Ajouter », no actions', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: t(`${L}.add`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(screen.getByText('Anglais')).toBeInTheDocument()
  })
})
