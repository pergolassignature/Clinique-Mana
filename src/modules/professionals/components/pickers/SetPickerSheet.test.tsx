import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import type { PickerGroup, PickerItem, PickerSelection } from '../../lib/set-picker'
import { SetPickerSheet, type PickerDraft } from './SetPickerSheet'

const P = 'modules.professionals.record.matching.picker'

const item = (id: string, label: string, extra: Partial<PickerItem> = {}): PickerItem => ({ id, label, archived: false, ...extra })
const sel = (...entries: (string | [string, boolean])[]): PickerSelection =>
  new Map(entries.map((e) => (typeof e === 'string' ? [e, { specialized: false }] : [e[0], { specialized: e[1] }])))

/** 8 categories of 9 motifs, as the legacy list: `m-<c>-<m>`, « Motif c.m », « Catégorie c ». */
const seventyTwo: PickerGroup[] = Array.from({ length: 8 }, (_, c) => ({
  key: `cat-${c}`,
  label: `Catégorie ${c + 1}`,
  items: Array.from({ length: 9 }, (_, m) => item(`m-${c}-${m}`, `Motif ${c + 1}.${m + 1}`)),
}))
const everyMotif = sel(...seventyTwo.flatMap((g) => g.items.map((i) => i.id)))

const twoGroups: PickerGroup[] = [
  {
    key: 'inner',
    label: 'Vie intérieure',
    items: [
      item('anx', 'Anxiété'),
      item('psy', 'Psychose', { restricted: true, blockedReason: 'Réservé aux titres d’un ordre.' }),
      item('old', 'Ancien motif', { archived: true }),
    ],
  },
  { key: 'family', label: 'Relations et famille', items: [item('cpl', 'Couple'), item('adopt', 'Adoption')] },
]

function renderPicker({
  groups = twoGroups,
  selected = sel(),
  withStars = false,
  requiredMessage,
  onSave = vi.fn<(next: PickerDraft) => Promise<string | null>>().mockResolvedValue(null),
}: {
  groups?: PickerGroup[]
  selected?: PickerSelection
  withStars?: boolean
  requiredMessage?: string
  onSave?: (next: PickerDraft) => Promise<string | null>
} = {}) {
  render(
    <SetPickerSheet
      trigger={<Button>Modifier</Button>}
      title="Motifs"
      subject="Marie Tremblay"
      groups={groups}
      selected={selected}
      withStars={withStars}
      searchPlaceholder="Rechercher un motif…"
      requiredMessage={requiredMessage}
      onSave={onSave}
    />,
  )
  return { onSave }
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Modifier' }))
  return screen.getByRole('dialog', { name: 'Motifs' })
}
const save = () => userEvent.click(screen.getByRole('button', { name: t('common.save') }))
/** The visible rows' labels, in order. */
const rowLabels = (dialog: HTMLElement) => within(dialog).getAllByRole('checkbox').map((box) => dialog.querySelector(`label[for="${box.id}"]`)?.textContent)
const groupToggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('SetPickerSheet — draft and save', () => {
  it('ticks into a local draft only, then saves the whole set once and closes, focus back on « Modifier »', async () => {
    const { onSave } = renderPicker({ selected: sel('anx') })
    await open()
    expect(screen.getByRole('searchbox', { name: t(`${P}.searchLabel`) })).toHaveFocus()
    await userEvent.click(groupToggle('Relations et famille'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Couple' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(t(`${P}.count`, { selected: '2', total: '4' }))).toBeInTheDocument()
    await save()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect([...(vi.mocked(onSave).mock.calls[0]?.[0].keys() ?? [])]).toEqual(['anx', 'cpl'])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Modifier' })).toHaveFocus()
  })

  it('keeps the sheet and the draft open with the refusal', async () => {
    const onSave = vi.fn<(next: PickerDraft) => Promise<string | null>>().mockResolvedValue('Le motif « Couple » est archivé.')
    renderPicker({ onSave })
    const dialog = await open()
    await userEvent.click(groupToggle('Relations et famille'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Couple' }))
    await save()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Le motif « Couple » est archivé.')
    expect(within(dialog).getByRole('checkbox', { name: 'Couple' })).toBeChecked()
  })

  it('never saves an unchanged draft, nor from Enter in the search field', async () => {
    const { onSave } = renderPicker()
    await open()
    await userEvent.type(screen.getByRole('searchbox'), 'anx{Enter}')
    await save()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('applies two ticks made before a re-render (fast clicks)', async () => {
    renderPicker()
    const dialog = await open()
    await userEvent.click(groupToggle('Relations et famille'))
    act(() => {
      within(dialog).getByRole('checkbox', { name: 'Couple' }).click()
      within(dialog).getByRole('checkbox', { name: 'Adoption' }).click()
    })
    expect(within(dialog).getByRole('checkbox', { name: 'Couple' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Adoption' })).toBeChecked()
  })
})

describe('SetPickerSheet — closing', () => {
  it('closes at once when nothing changed', async () => {
    renderPicker()
    await open()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks before dropping changes on Escape; « Continuer » keeps them, « Abandonner » closes', async () => {
    renderPicker()
    const dialog = await open()
    await userEvent.click(groupToggle('Vie intérieure'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anxiété' }))
    await userEvent.keyboard('{Escape}')
    const confirm = await screen.findByRole('alertdialog', { name: t(`${P}.discard.title`) })
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${P}.discard.keep`) }))
    expect(within(dialog).getByRole('checkbox', { name: 'Anxiété' })).toBeChecked()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: t(`${P}.discard.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('« Annuler » discards without asking; the next opening starts from the saved set', async () => {
    renderPicker()
    let dialog = await open()
    await userEvent.click(groupToggle('Vie intérieure'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anxiété' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    dialog = await open()
    await userEvent.click(groupToggle('Vie intérieure'))
    expect(within(dialog).getByRole('checkbox', { name: 'Anxiété' })).not.toBeChecked()
  })

  it('keeps the close button out of the tab order', async () => {
    renderPicker()
    const dialog = await open()
    expect(within(dialog).getByRole('button', { name: t('common.close') })).toHaveAttribute('tabindex', '-1')
  })
})

describe('SetPickerSheet — categories', () => {
  it('folds categories to one line with their count, and « Tout sélectionner » ticks the addable ones of that category', async () => {
    renderPicker()
    const dialog = await open()
    const inner = groupToggle('Vie intérieure')
    expect(inner).toHaveAttribute('aria-expanded', 'false')
    expect(inner).toHaveTextContent(t(`${P}.groupCount`, { selected: '0', total: '2' }))
    expect(within(dialog).queryByRole('checkbox', { name: 'Anxiété' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: `${t(`${P}.selectAll`)} ${t(`${P}.inGroup`, { group: 'Vie intérieure' })}` }))
    // The restricted motif is blocked: « Tout » means everything that can be added.
    expect(inner).toHaveTextContent(t(`${P}.groupCount`, { selected: '1', total: '2' }))
    const deselect = within(dialog).getByRole('button', { name: `${t(`${P}.deselectAll`)} ${t(`${P}.inGroup`, { group: 'Vie intérieure' })}` })
    await userEvent.click(deselect)
    expect(inner).toHaveTextContent(t(`${P}.groupCount`, { selected: '0', total: '2' }))
  })

  it('unfolds and folds every category at once', async () => {
    renderPicker()
    await open()
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.expandAll`) }))
    expect(groupToggle('Vie intérieure')).toHaveAttribute('aria-expanded', 'true')
    expect(groupToggle('Relations et famille')).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.collapseAll`) }))
    expect(groupToggle('Vie intérieure')).toHaveAttribute('aria-expanded', 'false')
  })

  it('searches accent-insensitively, marks the words and shows the matches unfolded', async () => {
    renderPicker()
    const dialog = await open()
    await userEvent.type(screen.getByRole('searchbox'), 'anxiete')
    const row = within(dialog).getByRole('checkbox', { name: 'Anxiété' })
    expect(row).toBeVisible()
    expect(within(dialog).getByText('Anxiété', { selector: 'mark' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Couple' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^Vie intérieure/ })).not.toBeInTheDocument()
    // The category still counts all its motifs, not the matches.
    expect(within(dialog).getByRole('heading', { level: 3, name: /Vie intérieure/ })).toHaveTextContent(t(`${P}.groupCount`, { selected: '0', total: '2' }))
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(within(dialog).getByText(t(`${P}.noResults.title`))).toBeInTheDocument()
  })

  it('« Sélectionnés seulement » keeps the held items in view, even once unticked', async () => {
    renderPicker({ selected: sel('cpl') })
    const dialog = await open()
    await userEvent.click(screen.getByRole('switch', { name: t(`${P}.selectedOnly`) }))
    const couple = within(dialog).getByRole('checkbox', { name: 'Couple' })
    expect(within(dialog).getAllByRole('checkbox')).toEqual([couple])
    await userEvent.click(couple)
    expect(within(dialog).getByRole('checkbox', { name: 'Couple' })).not.toBeChecked()
  })
})

describe('SetPickerSheet — restricted, archived, required, stars', () => {
  it('disables a restricted motif with its reason, and lists a held archived one to be removed', async () => {
    renderPicker({ selected: sel('old') })
    const dialog = await open()
    await userEvent.click(groupToggle('Vie intérieure'))
    const psy = within(dialog).getByRole('checkbox', { name: /Psychose/ })
    expect(psy).toBeDisabled()
    expect(psy).toHaveAccessibleDescription('Réservé aux titres d’un ordre.')
    expect(within(dialog).getByText(t(`${P}.restricted`))).toBeInTheDocument()
    const old = within(dialog).getByRole('checkbox', { name: /Ancien motif/ })
    expect(within(dialog).getByText(t(`${P}.archived`))).toBeInTheDocument()
    await userEvent.click(old)
    expect(old).not.toBeChecked()
  })

  it('lets a held blocked item be removed (P4-55)', async () => {
    renderPicker({ selected: sel('psy') })
    const dialog = await open()
    await userEvent.click(groupToggle('Vie intérieure'))
    const psy = within(dialog).getByRole('checkbox', { name: /Psychose/ })
    expect(psy).toBeEnabled()
    await userEvent.click(psy)
    expect(psy).not.toBeChecked()
    expect(psy).toBeDisabled()
  })

  it('locks the last item of a required list, saying why', async () => {
    const flat: PickerGroup[] = [{ key: 'all', label: '', items: [item('fr', 'Français'), item('en', 'Anglais')] }]
    renderPicker({ groups: flat, selected: sel('fr'), requiredMessage: 'Au moins une langue est requise.' })
    const dialog = await open()
    expect(within(dialog).queryByRole('searchbox')).not.toBeInTheDocument()
    // Focus starts on the first row that can change (no search field in a short list).
    expect(within(dialog).getByRole('checkbox', { name: 'Anglais' })).toHaveFocus()
    const fr = within(dialog).getByRole('checkbox', { name: 'Français' })
    expect(fr).toBeDisabled()
    expect(fr).toHaveAccessibleDescription('Au moins une langue est requise.')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anglais' }))
    expect(fr).toBeEnabled()
  })

  it('lists ★ then held first, toggles stars from the keyboard and saves them', async () => {
    const flat: PickerGroup[] = [{ key: 'all', label: '', items: [item('kids', 'Enfants'), item('adults', 'Adultes'), item('couples', 'Couples')] }]
    const { onSave } = renderPicker({ groups: flat, selected: sel('adults', ['couples', true]), withStars: true })
    const dialog = await open()
    expect(rowLabels(dialog)).toEqual(['Couples', 'Adultes', 'Enfants'])
    const star = within(dialog).getByRole('button', { name: t('common.star.add'), description: 'Adultes' })
    star.focus()
    await userEvent.keyboard(' ')
    expect(within(dialog).getByRole('button', { name: t('common.star.remove'), description: 'Adultes' })).toBeInTheDocument()
    // No star on an item not held.
    expect(within(dialog).queryByRole('button', { description: 'Enfants' })).not.toBeInTheDocument()
    await save()
    expect([...(vi.mocked(onSave).mock.calls[0]?.[0] ?? [])]).toEqual([
      ['adults', { specialized: true }],
      ['couples', { specialized: true }],
    ])
  })
})

describe('SetPickerSheet — 72 motifs, all held', () => {
  it('stays calm: eight folded lines « 9 sur 9 », the running total, every name one click away', async () => {
    renderPicker({ groups: seventyTwo, selected: everyMotif })
    const dialog = await open()
    expect(within(dialog).getByText(t(`${P}.count`, { selected: '72', total: '72' }))).toBeInTheDocument()
    const lines = within(dialog).getAllByRole('button', { expanded: false })
    expect(lines).toHaveLength(8)
    for (const line of lines) expect(line).toHaveTextContent(t(`${P}.groupCount`, { selected: '9', total: '9' }))
    expect(within(dialog).queryAllByRole('checkbox')).toEqual([])
    expect(within(dialog).getAllByRole('button', { name: new RegExp(`^${t(`${P}.deselectAll`)}`) })).toHaveLength(8)
    await userEvent.click(groupToggle('Catégorie 3'))
    expect(rowLabels(dialog)).toEqual(Array.from({ length: 9 }, (_, m) => `Motif 3.${m + 1}`))
    await userEvent.click(screen.getByRole('switch', { name: t(`${P}.selectedOnly`) }))
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(72)
  })

  it('removes one category in a click and saves the 63 left', async () => {
    const { onSave } = renderPicker({ groups: seventyTwo, selected: everyMotif })
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: `${t(`${P}.deselectAll`)} ${t(`${P}.inGroup`, { group: 'Catégorie 8' })}` }))
    expect(within(dialog).getByText(t(`${P}.count`, { selected: '63', total: '72' }))).toBeInTheDocument()
    await save()
    expect(vi.mocked(onSave).mock.calls[0]?.[0].size).toBe(63)
  })
})
