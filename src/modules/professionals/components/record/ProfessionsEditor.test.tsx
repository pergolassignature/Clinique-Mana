import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../api/parse'
import type { ProfessionInput } from '../../api/record'
import { buildCatalogView } from '../../lib/catalog-view'
import { CATALOG, recordFixture } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderRecordTab } from '../../test/record-tab'
import { ProfessionsEditor } from './ProfessionsEditor'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn(), setProfessions: vi.fn() },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.professionals.record.identity.professions'
let stored: ProfessionalRecord

beforeEach(() => {
  stored = recordFixture()
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.setProfessions.mockImplementation(async (_id: string, items: ProfessionInput[]) => {
    const professions = items.map((i, n) => ({ id: `row-${n}`, titleId: i.titleId, licenceNumber: i.licenceNumber, isPrimary: i.isPrimary }))
    stored = { ...stored, professions }
    return professions
  })
})
afterEach(() => vi.clearAllMocks())

const twoTitles = (r: ProfessionalRecord): ProfessionalRecord => ({
  ...r,
  professions: [
    { id: 'row-a', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
    { id: 'row-b', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
  ],
})
const editor = () => screen.getByRole('form', { name: t(`${P}.title`) })
const titles = () => within(editor()).getAllByRole('combobox', { name: `${t(`${P}.titleField`)} ${t('common.form.required')}` })
/** The title select of row `i`. */
const title = (i: number) => {
  const select = titles()[i]
  if (!select) throw new Error(`no title row ${i}`)
  return select
}
/** Row `i` (from 0): a group named « Titre 1 : Psychologue ». */
const row = (i: number, name: string) => within(editor()).getByRole('group', { name: t(`${P}.row`, { n: String(i + 1), name }) })
/** The « Titre principal » radio of the title `name`. */
const radio = (name: string) => within(editor()).getByRole('radio', { name: t(`${P}.primaryLabel`, { name }) })
const licence = () => within(editor()).queryByRole('textbox', { name: `N° de permis ${t('common.form.required')}` })
const addButton = () => within(editor()).getByRole('button', { name: t(`${P}.add`) })
const save = () => userEvent.click(within(editor()).getByRole('button', { name: t('common.save') }))

describe('ProfessionsEditor', () => {
  it('shows the licence for a title with an order only, and drops it with the title', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: stored })
    expect(titles()).toHaveLength(1)
    expect(licence()).toHaveValue('12345')
    expect(licence()).toHaveAccessibleDescription(t(`${P}.licenceHelp`, { order: 'OPQ' }))
    await userEvent.selectOptions(title(0), IDS.naturopathe)
    expect(licence()).not.toBeInTheDocument()
    await save()
    await waitFor(() =>
      expect(mocks.record.setProfessions).toHaveBeenCalledExactlyOnceWith(IDS.professional, [{ titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true }]),
    )
  })

  it('adds a second title (focused), then stops at two', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: stored })
    await userEvent.click(addButton())
    expect(titles()).toHaveLength(2)
    expect(title(1)).toHaveFocus()
    // A row with no title yet is « Titre 2 », and so is its radio.
    expect(within(editor()).getByRole('group', { name: t(`${P}.rowEmpty`, { n: '2' }) })).toContainElement(title(1))
    expect(radio(t(`${P}.rowEmpty`, { n: '2' }))).not.toBeChecked()
    // The other row's title is not offered again.
    expect(within(title(1)).queryByRole('option', { name: 'Psychologue' })).not.toBeInTheDocument()
    expect(addButton()).toHaveAttribute('aria-disabled', 'true')
    expect(addButton()).toHaveAccessibleDescription(t(`${P}.max`))
    await userEvent.click(addButton())
    expect(titles()).toHaveLength(2)
  })

  it('« Titre principal » changes the draft only; one call sends the whole list', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    // Each radio names its title, inside its row's group.
    expect(within(row(0, 'Psychologue')).getByRole('radio')).toBe(radio('Psychologue'))
    expect(within(row(1, 'Naturopathe')).getByRole('radio')).toBe(radio('Naturopathe'))
    expect(radio('Psychologue')).toBeChecked()
    expect(radio('Naturopathe')).not.toBeChecked()
    await userEvent.click(radio('Naturopathe'))
    expect(radio('Psychologue')).not.toBeChecked()
    expect(mocks.record.setProfessions).not.toHaveBeenCalled()
    await save()
    await waitFor(() =>
      expect(mocks.record.setProfessions).toHaveBeenCalledExactlyOnceWith(IDS.professional, [
        { titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: false },
        { titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true },
      ]),
    )
    await waitFor(() => expect(within(editor()).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument())
  })

  it('removing the primary promotes the other title (A2.9) and moves focus to « Ajouter »', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    await userEvent.click(within(editor()).getByRole('button', { name: t(`${P}.removeLabel`, { name: 'Psychologue' }) }))
    expect(titles()).toHaveLength(1)
    expect(title(0)).toHaveValue(IDS.naturopathe)
    expect(addButton()).toHaveFocus()
    await save()
    await waitFor(() =>
      expect(mocks.record.setProfessions).toHaveBeenCalledExactlyOnceWith(IDS.professional, [{ titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true }]),
    )
  })

  it('checks the licence before saving (required, the order’s format)', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: stored })
    await userEvent.clear(licence() as HTMLElement)
    await save()
    expect(await screen.findByText(t('modules.professionals.validation.licenceRequired'))).toBeInTheDocument()
    await userEvent.type(licence() as HTMLElement, '12a')
    await save()
    expect(await screen.findByText(t('modules.professionals.validation.licenceOrderFormat', { title: 'Psychologue' }))).toBeInTheDocument()
    expect(mocks.record.setProfessions).not.toHaveBeenCalled()
  })

  it('puts a refusal under the row its DETAIL names, and refetches the catalogue', async () => {
    const message = 'Le numéro de permis pour Psychologue n’a pas le bon format.'
    mocks.record.setProfessions.mockRejectedValue({ code: 'P0001', message, hint: 'licence', details: IDS.psychologue })
    mocks.catalog.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    const { queryClient } = renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.clear(licence() as HTMLElement)
    await userEvent.type(licence() as HTMLElement, '54321')
    await save()
    await waitFor(() => expect(licence()).toHaveAccessibleDescription(`${t(`${P}.licenceHelp`, { order: 'OPQ' })} ${message}`))
    expect(licence()).toHaveFocus()
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['professionals-catalog', 'catalog'] })
  })

  it('says so above the buttons when a title gained an order since the catalogue was read (licence refused, no field)', async () => {
    const message = 'Un numéro de permis est requis pour Naturopathe.'
    mocks.record.setProfessions.mockRejectedValue({ code: 'P0001', message, hint: 'licence', details: IDS.naturopathe })
    mocks.catalog.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    const { queryClient } = renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(radio('Naturopathe'))
    await save()
    expect(await within(editor()).findByRole('alert')).toHaveTextContent(t(`${P}.licenceNowRequired`))
    expect(within(editor()).queryByText(message)).not.toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['professionals-catalog', 'catalog'] })
  })

  it('drops a stored licence whose title no longer has an order: nothing hidden is sent (P4-65)', async () => {
    const unlinked = buildCatalogView({ ...CATALOG, titles: CATALOG.titles.map((title) => (title.id === IDS.psychologue ? { ...title, orderId: null } : title)) })
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)), catalog: unlinked })
    expect(licence()).not.toBeInTheDocument()
    // Clean: no « Enregistrer » (decision UI-2).
    expect(within(editor()).queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    await userEvent.click(radio('Naturopathe'))
    await save()
    await waitFor(() =>
      expect(mocks.record.setProfessions).toHaveBeenCalledExactlyOnceWith(IDS.professional, [
        { titleId: IDS.psychologue, licenceNumber: null, isPrimary: false },
        { titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true },
      ]),
    )
  })

  it('keeps every control inactive while saving, so no edit is lost', async () => {
    let finish: () => void = () => {}
    mocks.record.setProfessions.mockImplementation(
      (_id: string, items: ProfessionInput[]) =>
        new Promise((resolve) => {
          finish = () => {
            const professions = items.map((i, n) => ({ id: `row-${n}`, titleId: i.titleId, licenceNumber: i.licenceNumber, isPrimary: i.isPrimary }))
            stored = { ...stored, professions }
            resolve(professions)
          }
        }),
    )
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    await userEvent.click(radio('Naturopathe'))
    await save()

    expect(title(0)).toHaveAttribute('aria-disabled', 'true')
    expect(licence()).toHaveAttribute('readonly')
    expect(radio('Psychologue')).toHaveAttribute('aria-disabled', 'true')
    expect(addButton()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(radio('Psychologue'))
    await userEvent.click(within(editor()).getByRole('button', { name: t(`${P}.removeLabel`, { name: 'Psychologue' }) }))
    expect(titles()).toHaveLength(2)
    expect(title(1)).toHaveValue(IDS.naturopathe)
    expect(radio('Naturopathe')).toBeChecked()

    await act(async () => finish())
    await waitFor(() => expect(title(0)).not.toHaveAttribute('aria-disabled'))
    expect(mocks.record.setProfessions).toHaveBeenCalledOnce()
    expect(radio('Naturopathe')).toBeChecked()
    expect(radio('Psychologue')).not.toHaveAttribute('aria-disabled')
  })

  it('ignores a title or licence change while saving', async () => {
    let finish: () => void = () => {}
    mocks.record.setProfessions.mockImplementation(
      (_id: string, items: ProfessionInput[]) =>
        new Promise((resolve) => {
          finish = () => {
            const professions = items.map((i, n) => ({ id: `row-${n}`, titleId: i.titleId, licenceNumber: i.licenceNumber, isPrimary: i.isPrimary }))
            stored = { ...stored, professions }
            resolve(professions)
          }
        }),
    )
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: stored })
    await userEvent.clear(licence() as HTMLElement)
    await userEvent.type(licence() as HTMLElement, '54321')
    await save()

    await userEvent.selectOptions(title(0), IDS.naturopathe)
    expect(title(0)).toHaveValue(IDS.psychologue)
    await userEvent.type(licence() as HTMLElement, '9')
    expect(licence()).toHaveValue('54321')

    await act(async () => finish())
    await waitFor(() => expect(title(0)).not.toHaveAttribute('aria-disabled'))
    expect(mocks.record.setProfessions).toHaveBeenCalledExactlyOnceWith(IDS.professional, [{ titleId: IDS.psychologue, licenceNumber: '54321', isPrimary: true }])
    expect(licence()).toHaveValue('54321')
  })

  it('puts a refusal about the whole list above the buttons', async () => {
    const message = 'Retirez d’abord les motifs réservés aux professions réglementées : Psychose.'
    mocks.record.setProfessions.mockRejectedValue({ code: 'P0001', message, hint: '', details: '' })
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: stored })
    await userEvent.clear(licence() as HTMLElement)
    await userEvent.type(licence() as HTMLElement, '54321')
    await save()
    expect(await within(editor()).findByRole('alert')).toHaveTextContent(message)
  })

  it('refuses to drop the last regulated title while a restricted motif is held', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = { ...stored, motifIds: [IDS.psychose] }) })
    await userEvent.selectOptions(title(0), IDS.naturopathe)
    await save()
    expect(await within(editor()).findByRole('alert')).toHaveTextContent(t('modules.professionals.validation.restrictedMotifsHeld', { names: 'Psychose' }))
    expect(mocks.record.setProfessions).not.toHaveBeenCalled()
  })

  it('« Annuler » restores the stored titles', async () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = twoTitles(stored)) })
    await userEvent.click(within(editor()).getByRole('button', { name: t(`${P}.removeLabel`, { name: 'Naturopathe' }) }))
    await userEvent.click(within(editor()).getByRole('button', { name: t('common.cancel') }))
    expect(titles()).toHaveLength(2)
    expect(title(0)).toHaveFocus()
  })

  it('read-only: the titles and licences, the primary named, no controls', () => {
    renderRecordTab(<ProfessionsEditor readOnly />, { record: (stored = twoTitles(stored)), role: 'counselor' })
    expect(within(editor()).queryByRole('button')).not.toBeInTheDocument()
    expect(within(editor()).queryByRole('radio')).not.toBeInTheDocument()
    const values = within(editor()).getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)
    expect(values).toEqual(['Psychologue', '12345', 'Naturopathe'])
    expect(within(editor()).getByText(t(`${P}.primary`))).toBeInTheDocument()
  })

  it('says so when there is no title', () => {
    renderRecordTab(<ProfessionsEditor readOnly={false} />, { record: (stored = { ...stored, professions: [] }) })
    expect(within(editor()).getByText(t(`${P}.empty`))).toBeInTheDocument()
  })
})
