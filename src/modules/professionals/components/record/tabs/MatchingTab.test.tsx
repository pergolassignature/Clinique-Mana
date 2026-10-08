import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { hasUnsavedChanges } from '@/shared/lib/unsaved-changes-registry'
import type { FixtureRole } from '@/test/role-fixtures'
import type { ProfessionalRecord, SpecializedRef } from '../../../api/parse'
import type { CatalogView } from '../../../lib/catalog-view'
import { CATALOG_VIEW, recordFixture, websiteSizedCatalog } from '../../../test/fixtures-domain'
import { IDS } from '../../../test/fixtures'
import { LEAVE_LINK, renderRecordTab } from '../../../test/record-tab'
import { MatchingTab } from './MatchingTab'

const mocks = vi.hoisted(() => ({
  api: {
    fetchProfessionalRecord: vi.fn(),
    setClienteles: vi.fn(),
    setMotifs: vi.fn(),
    setLanguages: vi.fn(),
    updateMatchingProfile: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/record')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

/** What the database holds; the set mocks write into it and the refetch reads it. */
let stored: ProfessionalRecord

beforeEach(() => {
  mocks.api.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.api.setMotifs.mockImplementation(async (_id: string, motifIds: string[]) => {
    stored = { ...stored, motifIds }
    return motifIds
  })
  mocks.api.setClienteles.mockImplementation(async (_id: string, clienteles: SpecializedRef[]) => {
    stored = { ...stored, clienteles }
    return clienteles
  })
})
afterEach(() => vi.clearAllMocks())

const M = 'modules.professionals.record.matching'
const P = `${M}.picker`

function renderTab({
  change = (r) => r,
  role = 'counselor',
  permissions,
  catalog = CATALOG_VIEW,
}: { change?: (r: ProfessionalRecord) => ProfessionalRecord; role?: FixtureRole; permissions?: string[]; catalog?: CatalogView } = {}) {
  stored = change(recordFixture())
  return renderRecordTab(<MatchingTab />, { record: stored, role, permissions, catalog })
}

const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('section, form') as HTMLElement
const openPicker = async (list: 'clienteles' | 'motifs' | 'languages') => {
  await userEvent.click(screen.getByRole('button', { name: t(`${M}.${list}.edit`) }))
  return screen.getByRole('dialog', { name: t(`${M}.${list}.title`) })
}
const unfold = (dialog: HTMLElement, group: string) => userEvent.click(within(dialog).getByRole('button', { name: new RegExp(`^${group}`) }))
const regulatedNo = (r: ProfessionalRecord): ProfessionalRecord => ({ ...r, professions: [{ ...r.professions[0]!, titleId: IDS.naturopathe, licenceNumber: null }] })

describe('MatchingTab — what is held', () => {
  it('shows the sets as chips (★ first), the motifs by name, and « Modifier » on each list; no approaches', () => {
    renderTab({ change: (r) => ({ ...r, clienteles: [{ id: IDS.children, specialized: false }, { id: IDS.couples, specialized: true }], languageIds: [IDS.fr, IDS.en] }) })
    const chips = within(card(t(`${M}.clienteles.title`))).getAllByRole('listitem').map((li) => li.textContent)
    expect(chips).toEqual([`★ Couples ${t(`${M}.specialized`)}`, 'Enfants (0 à 12 ans)'])
    expect(screen.queryByRole('heading', { level: 3, name: 'Approches' })).not.toBeInTheDocument()
    expect(within(card(t(`${M}.motifs.title`))).getByText('Anxiété', { selector: 'li' })).toBeInTheDocument()
    expect(within(card(t(`${M}.languages.title`))).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Français', 'Anglais'])
    for (const list of ['clienteles', 'motifs', 'languages'] as const) {
      expect(screen.getByRole('button', { name: t(`${M}.${list}.edit`) })).toBeInTheDocument()
    }
    expect(screen.queryByText(t(`${M}.readOnly`))).not.toBeInTheDocument()
  })

  it('writes out every held motif by category, never « Tous »; the picker keeps its folded categories', async () => {
    const big = websiteSizedCatalog()
    renderTab({ catalog: big, change: (r) => ({ ...r, motifIds: big.motifs.filter((m) => m.isActive).map((m) => m.id) }) })
    const motifs = card(t(`${M}.motifs.title`))
    for (const motif of big.motifs.filter((m) => m.isActive)) expect(within(motifs).getByText(motif.name, { selector: 'li' })).toBeVisible()
    expect(within(motifs).queryByText(/^Tous/)).not.toBeInTheDocument()
    expect(within(motifs).getAllByRole('button').map((b) => b.textContent)).toEqual([t(`${M}.edit`)])
    const dialog = await openPicker('motifs')
    expect(within(dialog).getByText(t(`${P}.count`, { selected: '124', total: '124' }))).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { expanded: false })).toHaveLength(13)
    expect(within(dialog).queryAllByRole('checkbox')).toEqual([])
  })

  it('edits the client limits on the matching profile and reads the age on the youngest group (P4-245)', async () => {
    mocks.api.updateMatchingProfile.mockImplementation(async (_id: string, patch: Partial<ProfessionalRecord['matchingProfile']>) => {
      stored = { ...stored, matchingProfile: { ...stored.matchingProfile, ...patch } }
    })
    renderTab({ change: (r) => ({ ...r, clienteles: [{ id: IDS.children, specialized: false }] }) })
    const limits = card(t(`${M}.limits.title`))
    await userEvent.type(within(limits).getByRole('textbox', { name: t(`${M}.limits.minAge`) }), '8')
    await userEvent.click(within(limits).getByRole('switch', { name: t(`${M}.limits.womenOnly`) }))
    await userEvent.click(within(limits).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.updateMatchingProfile).toHaveBeenCalledWith(IDS.professional, { minClientAge: 8, womenOnly: true }))
    await waitFor(() => expect(within(card(t(`${M}.clienteles.title`))).getByText('Enfants (8 ans et +)')).toBeInTheDocument())
  })

  it('is read-only without professionals.matching: no « Modifier », no footer, the notice', () => {
    renderTab({ permissions: ['professionals.view'] })
    expect(screen.getByText(t(`${M}.readOnly`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Modifier/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(within(card(t(`${M}.clienteles.title`))).getByText('Couples', { exact: false })).toBeInTheDocument()
  })
})

describe('MatchingTab — pickers', () => {
  it('saves the motifs once, the whole set, only on « Enregistrer »', async () => {
    renderTab()
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Vie intérieure')
    // Psychologue: the restricted motif can be added.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Psychose/ }))
    expect(mocks.api.setMotifs).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.setMotifs).toHaveBeenCalledTimes(1)
    expect(mocks.api.setMotifs).toHaveBeenCalledWith(IDS.professional, [IDS.anxiete, IDS.psychose])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved'))
  })

  it('disables a restricted motif with its reason without a regulated title', async () => {
    renderTab({ change: regulatedNo })
    const dialog = await openPicker('motifs')
    await unfold(dialog, 'Vie intérieure')
    const psychose = within(dialog).getByRole('checkbox', { name: /Psychose/ })
    expect(psychose).toBeDisabled()
    expect(psychose).toHaveAccessibleDescription(t(`${M}.motifs.blocked`))
  })

  it('refuses a held restricted motif without a regulated title before calling the database (P4-55)', async () => {
    renderTab({ change: (r) => ({ ...regulatedNo(r), motifIds: [IDS.psychose] }) })
    const dialog = await openPicker('motifs')
    await unfold(dialog, t('modules.professionals.otherCategory'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sans catégorie' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('modules.professionals.validation.motifRestricted', { name: 'Psychose' }))
    expect(mocks.api.setMotifs).not.toHaveBeenCalled()
  })

  it('shows the database’s refusal in the sheet, which stays open, without a toast', async () => {
    mocks.api.setMotifs.mockRejectedValue(Object.assign(new Error('Le motif « Sans catégorie » est archivé.'), { code: 'P0001' }))
    renderTab()
    const dialog = await openPicker('motifs')
    await unfold(dialog, t('modules.professionals.otherCategory'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sans catégorie' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Le motif « Sans catégorie » est archivé.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('saves clientèles with their stars', async () => {
    renderTab()
    const dialog = await openPicker('clienteles')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Enfants (0 à 12 ans)' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.star.add'), description: 'Enfants (0 à 12 ans)' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.setClienteles).toHaveBeenCalledTimes(1))
    expect(mocks.api.setClienteles).toHaveBeenCalledWith(IDS.professional, [
      { id: IDS.couples, specialized: true },
      { id: IDS.children, specialized: true },
    ])
  })

  it('keeps French while it is the only language', async () => {
    renderTab()
    const dialog = await openPicker('languages')
    const french = within(dialog).getByRole('checkbox', { name: 'Français' })
    expect(french).toBeDisabled()
    expect(french).toHaveAccessibleDescription(t('modules.professionals.validation.languagesRequired'))
  })

  it('arms the tab guard while a picker holds changes, and disarms it on « Annuler »', async () => {
    renderTab()
    const dialog = await openPicker('languages')
    expect(hasUnsavedChanges()).toBe(false)
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anglais' }))
    expect(hasUnsavedChanges()).toBe(true)
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('searches the motifs by a category’s name', async () => {
    renderTab()
    const dialog = await openPicker('motifs')
    await userEvent.type(within(dialog).getByRole('searchbox'), 'interieure')
    // Every motif of « Vie intérieure » is listed, though none of their names holds the word.
    expect(within(dialog).getByRole('checkbox', { name: 'Anxiété' })).toBeVisible()
    expect(within(dialog).getByRole('checkbox', { name: /Psychose/ })).toBeVisible()
    expect(within(dialog).queryByRole('checkbox', { name: 'Sans catégorie' })).not.toBeInTheDocument()
  })
})

describe('MatchingTab — availability', () => {
  it('asks before leaving with an unsaved availability edit', async () => {
    renderTab()
    await userEvent.click(screen.getByRole('checkbox', { name: t('modules.professionals.periods.weekend') }))
    await userEvent.click(screen.getByRole('link', { name: LEAVE_LINK }))
    expect(await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })).toBeInTheDocument()
  })
})
