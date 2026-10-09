import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Home, Users } from 'lucide-react'
import { t } from '@/i18n'
import type { ModuleSearchFn, ModuleSearchProvider, ModuleSearchResult } from '@/core/modules/types'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { CommandPalette, type PalettePage } from './CommandPalette'
import { PALETTE_SEARCH_DEBOUNCE_MS, paletteSearchKeys } from './use-palette-search'

const pages: PalettePage[] = [
  { path: '/accueil', labelKey: 'nav.home', icon: Home },
  { path: '/professionnels', labelKey: 'modules.professionals.name', icon: Users },
]

const GENEVIEVE: ModuleSearchResult = {
  id: 'p1',
  title: 'Geneviève Tremblay',
  subtitle: 'Psychologue · OPQ 12345',
  href: '/professionnels/p1/apercu',
  badge: { label: 'Actif', tone: 'success' },
}

const provider = (search: ModuleSearchFn, extra: Partial<ModuleSearchProvider> = {}): ModuleSearchProvider => ({
  id: 'professionals',
  labelKey: 'modules.professionals.name',
  icon: Users,
  permission: 'professionals.view',
  load: async () => search,
  ...extra,
})

function renderPalette(providers: ModuleSearchProvider[], { client = new QueryClient(), userId = testAccess.user_id } = {}) {
  const onSelect = vi.fn()
  render(
    <QueryClientProvider client={client}>
      {renderWithContexts(
        <CommandPalette
          open
          onOpenChange={() => {}}
          pages={pages}
          searchProviders={providers}
          onSelect={onSelect}
          onCloseAutoFocus={() => {}}
          contentRef={createRef()}
        />,
        { access: { access: { ...testAccess, user_id: userId } } },
      )}
    </QueryClientProvider>,
  )
  const dialog = screen.getByRole('dialog', { name: t('nav.palette.title') })
  return { dialog, input: within(dialog).getByRole('combobox'), onSelect, client }
}

/** Text as Testing Library reads it: its normalizer turns the no-break spaces into plain ones. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ')

const optionNames = (dialog: HTMLElement) => within(dialog).queryAllByRole('option').map((o) => o.textContent)

afterEach(() => vi.useRealTimers())

describe('CommandPalette — record search', () => {
  it('shows the pages and the module group under their headings; choosing a record opens it', async () => {
    const search = vi.fn<ModuleSearchFn>(async () => [GENEVIEVE])
    const { dialog, input, onSelect } = renderPalette([provider(search)])
    expect(input).toHaveAttribute('placeholder', t('nav.palette.placeholderRecords'))
    await userEvent.type(input, 'profes')
    const group = await within(dialog).findByRole('group', { name: t('modules.professionals.name') })
    expect(within(dialog).getByRole('group', { name: t('nav.palette.pages') })).toBeInTheDocument()
    expect(within(group).getByRole('option')).toHaveTextContent('Geneviève Tremblay')
    expect(within(group).getByRole('option')).toHaveTextContent('Psychologue · OPQ 12345')
    expect(within(group).getByRole('option')).toHaveTextContent('Actif')
    expect(search).toHaveBeenCalledWith('profes', expect.any(AbortSignal))
    await userEvent.click(within(group).getByRole('option'))
    expect(onSelect).toHaveBeenCalledWith('/professionnels/p1/apercu')
  })

  it('reaches the records with the arrow keys after the pages', async () => {
    const { dialog, input, onSelect } = renderPalette([provider(async () => [GENEVIEVE])])
    await userEvent.type(input, 'acc')
    expect(await within(dialog).findByRole('option', { name: /Geneviève/ })).toBeInTheDocument()
    expect(optionNames(dialog)[0]).toBe(t('nav.home'))
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('/professionnels/p1/apercu')
  })

  it('asks once the typing pauses, not on every keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const search = vi.fn<ModuleSearchFn>(async () => [])
    const { input } = renderPalette([provider(search)])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(input, 'genev')
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PALETTE_SEARCH_DEBOUNCE_MS)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    expect(search).toHaveBeenCalledWith('genev', expect.any(AbortSignal))
  })

  it('cancels the previous request when the query changes', async () => {
    const signals: AbortSignal[] = []
    const search = vi.fn<ModuleSearchFn>((query, signal) => {
      signals.push(signal)
      return query === 'gen' ? new Promise(() => {}) : Promise.resolve([GENEVIEVE])
    })
    const { dialog, input } = renderPalette([provider(search)])
    await userEvent.type(input, 'gen')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    await userEvent.type(input, 'e')
    expect(await within(dialog).findByRole('option', { name: /Geneviève/ })).toBeInTheDocument()
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('says « Recherche… » while asking, and « Aucun résultat » only once every group is empty', async () => {
    let answer: (results: ModuleSearchResult[]) => void = () => {}
    const search = vi.fn<ModuleSearchFn>(() => new Promise((resolve) => (answer = resolve)))
    const { dialog, input } = renderPalette([provider(search)])
    await userEvent.type(input, 'zzz')
    expect(within(dialog).getByText(t('nav.palette.searching'))).toBeInTheDocument()
    expect(within(dialog).queryByText(plain(t('nav.palette.empty', { query: 'zzz' })))).not.toBeInTheDocument()
    await waitFor(() => expect(search).toHaveBeenCalled())
    answer([])
    expect(await within(dialog).findByText(plain(t('nav.palette.empty', { query: 'zzz' })))).toBeInTheDocument()
    expect(within(dialog).queryByText(t('nav.palette.searching'))).not.toBeInTheDocument()
    expect(optionNames(dialog)).toEqual([])
  })

  it('keeps the matching pages without « Aucun résultat » when the records group is empty', async () => {
    const { dialog, input } = renderPalette([provider(async () => [])])
    await userEvent.type(input, 'accueil')
    await waitFor(() => expect(within(dialog).queryByText(t('nav.palette.searching'))).not.toBeInTheDocument())
    expect(optionNames(dialog)).toEqual([t('nav.home')])
    expect(within(dialog).queryByRole('group', { name: t('modules.professionals.name') })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Aucun résultat/)).not.toBeInTheDocument()
  })

  it('does not ask below the provider’s minimum', async () => {
    const search = vi.fn<ModuleSearchFn>(async () => [])
    const { dialog, input } = renderPalette([provider(search, { minChars: 3 })])
    await userEvent.type(input, 'ge')
    await new Promise((r) => setTimeout(r, PALETTE_SEARCH_DEBOUNCE_MS + 50))
    expect(search).not.toHaveBeenCalled()
    expect(within(dialog).queryByText(t('nav.palette.searching'))).not.toBeInTheDocument()
    expect(within(dialog).getByText(plain(t('nav.palette.empty', { query: 'ge' })))).toBeInTheDocument()
  })

  it('says when a group could not search, without « Aucun résultat »', async () => {
    const { dialog, input } = renderPalette([provider(async () => Promise.reject(new Error('down')))])
    await userEvent.type(input, 'zzz')
    expect(await within(dialog).findByText(plain(t('nav.palette.searchFailed', { group: t('modules.professionals.name') })))).toBeInTheDocument()
    expect(within(dialog).queryByText(/Aucun résultat/)).not.toBeInTheDocument()
  })

  it('without a provider: pages only, the page placeholder, nothing asked', async () => {
    const { dialog, input } = renderPalette([])
    expect(input).toHaveAttribute('placeholder', t('nav.palette.placeholder'))
    await userEvent.type(input, 'zz')
    expect(within(dialog).getByText(plain(t('nav.palette.empty', { query: 'zz' })))).toBeInTheDocument()
  })

  it('keys the results per user, so another account never reads them from the cache', async () => {
    const { input, client } = renderPalette([provider(async () => [GENEVIEVE])], { userId: 'user-a' })
    await userEvent.type(input, 'gen')
    await waitFor(() => expect(client.getQueryData(paletteSearchKeys.results('user-a', 'professionals', 'gen'))).toEqual([GENEVIEVE]))
    expect(client.getQueryData(paletteSearchKeys.results('user-b', 'professionals', 'gen'))).toBeUndefined()
  })
})
