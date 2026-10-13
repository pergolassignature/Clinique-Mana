import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { CIDS } from '../../test/fixtures'
import { ReferrerField, type ReferrerValue } from './ReferrerField'
import type { ReferrerShown } from '../../lib/display'

const mocks = vi.hoisted(() => ({ api: { searchClients: vi.fn() } }))
vi.mock('../../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/clients')>()), ...mocks.api }))

const K = 'modules.clients.referrer'
const LABEL = 'Référé par'

beforeEach(() => {
  mocks.api.searchClients.mockResolvedValue([
    { id: CIDS.alice, clientNumber: 42, name: 'Alice Tremblay', birthday: null, email: 'alice@exemple.test', mobile: null, isArchived: false },
    { id: CIDS.marc, clientNumber: 3, name: 'Marc Tremblay', birthday: null, email: null, mobile: null, isArchived: false },
  ])
})
afterEach(() => vi.clearAllMocks())

function renderField(initial: ReferrerValue = { clientId: '', text: '' }, props: { known?: ReferrerShown | null; excludeId?: string } = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <ReferrerField
        label={LABEL}
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
        {...props}
      />
    )
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {renderWithContexts(<Harness />, { access: { access: accessForRole('counselor') } })}
    </QueryClientProvider>,
  )
  return onChange
}

describe('ReferrerField (« Référé par », CL-30)', () => {
  it('searches the clinic’s files and links the one chosen, clearing the typed name', async () => {
    const user = userEvent.setup()
    const onChange = renderField()
    await user.type(screen.getByRole('combobox', { name: LABEL }), 'trem')
    await user.click(await screen.findByRole('option', { name: /CLI-000042 · Alice Tremblay/ }))
    expect(onChange).toHaveBeenLastCalledWith({ clientId: CIDS.alice, text: '' })
    const link = screen.getByRole('link', { name: 'CLI-000042 · Alice Tremblay' })
    expect(link).toHaveAttribute('href', `/clients/${CIDS.alice}/apercu`)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('keeps the typed name as text (« Utiliser « … » comme texte »)', async () => {
    const user = userEvent.setup()
    const onChange = renderField()
    const input = screen.getByRole('combobox', { name: LABEL })
    await user.type(input, 'Une amie')
    await user.click(await screen.findByRole('option', { name: t(`${K}.useText`, { text: 'Une amie' }) }))
    expect(onChange).toHaveBeenLastCalledWith({ clientId: '', text: 'Une amie' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('Une amie')
  })

  it('chooses with the keyboard, and Échap closes the list', async () => {
    const user = userEvent.setup()
    const onChange = renderField()
    const input = screen.getByRole('combobox', { name: LABEL })
    await user.type(input, 'trem')
    await screen.findByRole('option', { name: /Marc Tremblay/ })
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ clientId: CIDS.marc, text: '' })
  })

  it('never offers the file being edited', async () => {
    const user = userEvent.setup()
    renderField({ clientId: '', text: '' }, { excludeId: CIDS.alice })
    await user.type(screen.getByRole('combobox', { name: LABEL }), 'trem')
    expect(await screen.findByRole('option', { name: /Marc Tremblay/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Alice Tremblay/ })).not.toBeInTheDocument()
  })

  it('shows the stored file, and « Retirer le dossier » empties the field', async () => {
    const user = userEvent.setup()
    const onChange = renderField({ clientId: CIDS.marc, text: '' }, { known: { id: CIDS.marc, clientNumber: 3, name: 'Marc Tremblay', anonymized: false } })
    expect(screen.getByRole('link', { name: 'CLI-000003 · Marc Tremblay' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${K}.clear`) }))
    expect(onChange).toHaveBeenLastCalledWith({ clientId: '', text: '' })
    expect(screen.getByRole('combobox', { name: LABEL })).toHaveValue('')
  })

  it('names an anonymised file « Dossier anonymisé », never by its old name', () => {
    renderField({ clientId: CIDS.marc, text: '' }, { known: { id: CIDS.marc, clientNumber: 3, name: null, anonymized: true } })
    expect(screen.getByRole('link', { name: `CLI-000003 · ${t(`${K}.anonymized`)}` })).toBeInTheDocument()
    expect(screen.queryByText(/Marc/)).not.toBeInTheDocument()
  })
})
