import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { AddressSuggestion, PlaceAddress } from '../api'
import { addressAutofill } from '../autofill'
import { resetSuggestionsPause, suggestionsPaused } from '../availability'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet'
import { AddressAutocomplete } from './AddressAutocomplete'

const mocks = vi.hoisted(() => ({
  fetchAddressSuggestions: vi.fn(),
  fetchPlaceAddress: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  fetchAddressSuggestions: mocks.fetchAddressSuggestions,
  fetchPlaceAddress: mocks.fetchPlaceAddress,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

const SUGGESTIONS: AddressSuggestion[] = [
  { placeId: 'ChIJfakePlateau000001', mainText: '1234 Rue Saint-Denis', secondaryText: 'Montréal, QC, Canada' },
  { placeId: 'ChIJfakeVerdun0000002', mainText: '4100 Rue Wellington', secondaryText: 'Verdun, Montréal, QC, Canada' },
]
const PLATEAU: PlaceAddress = {
  line1: '1234, rue Saint-Denis',
  line2: null,
  city: 'Montréal',
  province: 'QC',
  postalCode: 'H2X 3J6',
  country: 'CA',
}

interface Values {
  line1: string
  line2: string
  city: string
  province: string
  postal: string
}
const NAMES = { line1: 'line1', line2: 'line2', city: 'city', province: 'province', postalCode: 'postal' } as const
const EMPTY: Values = { line1: '', line2: '', city: '', province: '', postal: '' }

function Harness({ defaults = {}, readOnly = false, onSubmit = () => {} }: { defaults?: Partial<Values>; readOnly?: boolean; onSubmit?: (v: Values) => void }) {
  const form = useForm<Values>({ defaultValues: { ...EMPTY, ...defaults } })
  return (
    <form aria-label="Adresse du test" onSubmit={form.handleSubmit(onSubmit)}>
      <label htmlFor="line1">Adresse</label>
      <AddressAutocomplete id="line1" readOnly={readOnly} {...form.register('line1')} autofill={addressAutofill(form, NAMES)} />
      <label htmlFor="line2">Appartement ou bureau</label>
      <input id="line2" {...form.register('line2')} />
      <label htmlFor="city">Ville</label>
      <input id="city" {...form.register('city')} />
      <label htmlFor="province">Province</label>
      <input id="province" {...form.register('province')} />
      <label htmlFor="postal">Code postal</label>
      <input id="postal" {...form.register('postal')} />
      <button type="submit">Enregistrer</button>
      <button type="button" onClick={() => form.reset()}>
        Annuler
      </button>
    </form>
  )
}

/** The harness in a real Sheet, Dialog or AlertDialog (the shared ones), open until dismissed. */
function InModal({ kind }: { kind: 'Sheet' | 'Dialog' | 'AlertDialog' }) {
  const [open, setOpen] = useState(true)
  if (kind === 'Sheet') {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle>Coordonnées</SheetTitle>
          <SheetDescription>Adresse du domicile</SheetDescription>
          <Harness />
        </SheetContent>
      </Sheet>
    )
  }
  if (kind === 'Dialog') {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Coordonnées</DialogTitle>
          <DialogDescription>Adresse du domicile</DialogDescription>
          <Harness />
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogTitle>Coordonnées</AlertDialogTitle>
        <AlertDialogDescription>Adresse du domicile</AlertDialogDescription>
        <Harness />
      </AlertDialogContent>
    </AlertDialog>
  )
}

const combobox = () => screen.getByRole('combobox', { name: 'Adresse' })
/** The polite live region that speaks the list's size and the outcome of a choice. */
const liveRegion = () => document.querySelector('[aria-live="polite"]') as HTMLElement
const box = (name: string) => screen.getByRole('textbox', { name })
/** Longer than the debounce: what was going to be asked has been. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 350))

beforeEach(() => {
  resetSuggestionsPause()
  mocks.fetchAddressSuggestions.mockResolvedValue(SUGGESTIONS)
  mocks.fetchPlaceAddress.mockResolvedValue(PLATEAU)
})
afterEach(() => vi.clearAllMocks())

describe('AddressAutocomplete', () => {
  it('is a collapsed combobox, with the browser autofill off, until suggestions arrive', () => {
    render(<Harness />)
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(combobox()).toHaveAttribute('aria-autocomplete', 'list')
    expect(combobox()).toHaveAttribute('autocomplete', 'off')
    expect(combobox()).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('asks once typing pauses, from 3 characters, with the trimmed text and one session token', async () => {
    render(<Harness />)
    await userEvent.type(combobox(), 'ab')
    await settle()
    expect(mocks.fetchAddressSuggestions).not.toHaveBeenCalled()

    await userEvent.type(combobox(), 'c saint ')
    const list = await screen.findByRole('listbox', { name: t('address.suggestions.label') })
    expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce()
    expect(mocks.fetchAddressSuggestions).toHaveBeenCalledWith('abc saint', expect.stringMatching(/^[0-9a-f-]{36}$/), expect.any(AbortSignal))
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    expect(combobox()).toHaveAttribute('aria-controls', list.id)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '1234 Rue Saint-DenisMontréal, QC, Canada',
      '4100 Rue WellingtonVerdun, Montréal, QC, Canada',
      t('address.suggestions.manual'),
    ])
    expect(liveRegion().textContent).toBe(t('address.suggestions.countMany', { count: '2' }))
    // Google's attribution, under the list.
    expect(screen.getByText(t('address.suggestions.attribution'))).toBeInTheDocument()

    await userEvent.type(combobox(), 'd')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledTimes(2))
    const [first, second] = mocks.fetchAddressSuggestions.mock.calls
    expect(second?.[1]).toBe(first?.[1])
  })

  it('moves with ↓/↑ (wrapping, « Saisir manuellement » last), chooses with Entrée and fills the form', async () => {
    render(<Harness defaults={{ city: 'Laval', province: 'QC', postal: 'H7N 1A1' }} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await screen.findByRole('listbox')
    const options = () => screen.getAllByRole('option')

    await userEvent.keyboard('{ArrowUp}')
    expect(options()[2]).toHaveAttribute('aria-selected', 'true')
    expect(combobox()).toHaveAttribute('aria-activedescendant', options()[2]?.id ?? '')
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(combobox()).toHaveValue('1234, rue Saint-Denis'))
    expect(mocks.fetchPlaceAddress).toHaveBeenCalledWith('ChIJfakePlateau000001', mocks.fetchAddressSuggestions.mock.calls[0]?.[1], expect.any(AbortSignal))
    expect(box('Ville')).toHaveValue('Montréal')
    expect(box('Province')).toHaveValue('QC')
    expect(box('Code postal')).toHaveValue('H2X 3J6')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(combobox()).toHaveFocus()
    expect(liveRegion().textContent).toBe(t('address.suggestions.filled'))
  })

  it('starts a new session token after a choice', async () => {
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Ville')).toHaveValue('Montréal'))
    await userEvent.type(combobox(), ' app')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledTimes(2))
    const [first, second] = mocks.fetchAddressSuggestions.mock.calls
    expect(second?.[1]).not.toBe(first?.[1])
  })

  it('never overwrites « Appartement ou bureau »: Google’s unit goes there only when it is empty', async () => {
    mocks.fetchPlaceAddress.mockResolvedValue({ ...PLATEAU, line2: '402' })
    const { unmount } = render(<Harness defaults={{ line2: 'Bureau 210' }} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Ville')).toHaveValue('Montréal'))
    expect(box('Appartement ou bureau')).toHaveValue('Bureau 210')
    unmount()

    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Appartement ou bureau')).toHaveValue('402'))
  })

  it('keeps a field the person edits while the choice is resolving; a value Google lacks leaves its field alone', async () => {
    let answer: (a: PlaceAddress) => void = () => {}
    mocks.fetchPlaceAddress.mockReturnValue(new Promise<PlaceAddress>((resolve) => (answer = resolve)))
    render(<Harness defaults={{ postal: 'H2X 1Y4' }} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    expect(combobox()).toHaveAttribute('aria-busy', 'true')
    await userEvent.type(box('Ville'), 'Outremont')
    answer({ ...PLATEAU, postalCode: null })

    await waitFor(() => expect(combobox()).toHaveValue('1234, rue Saint-Denis'))
    expect(box('Ville')).toHaveValue('Outremont')
    expect(box('Province')).toHaveValue('QC')
    expect(box('Code postal')).toHaveValue('H2X 1Y4')
    expect(combobox()).not.toHaveAttribute('aria-busy')
  })

  it('typing again in « Adresse » while a choice resolves cancels it: nothing is filled', async () => {
    let answer: (a: PlaceAddress) => void = () => {}
    mocks.fetchPlaceAddress.mockReturnValue(new Promise<PlaceAddress>((resolve) => (answer = resolve)))
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await userEvent.type(combobox(), ' est')
    answer(PLATEAU)
    await settle()
    expect(combobox()).toHaveValue('1234 saint-denis est')
    expect(box('Ville')).toHaveValue('')
    expect(mocks.fetchPlaceAddress.mock.calls[0]?.[2]).toHaveProperty('aborted', true)
  })

  it.each(['Sheet', 'Dialog', 'AlertDialog'] as const)(
    'in a real %s: the first Échap closes the list and the modal stays open; the second closes the modal',
    async (kind) => {
      render(<InModal kind={kind} />)
      const modal = () => screen.queryByRole(kind === 'AlertDialog' ? 'alertdialog' : 'dialog', { name: 'Coordonnées' })
      await userEvent.type(combobox(), '1234 saint-denis')
      await screen.findByRole('listbox')

      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(combobox()).toHaveAttribute('aria-expanded', 'false')
      expect(modal()).toBeInTheDocument()
      expect(combobox()).toHaveFocus()
      expect(combobox()).toHaveValue('1234 saint-denis')

      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(modal()).not.toBeInTheDocument())
      expect(mocks.fetchPlaceAddress).not.toHaveBeenCalled()
    },
  )

  it('lets the person ignore the list: Échap closes it, Entrée then submits, the text stays as typed', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.type(combobox(), '99 rue inconnue')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ line1: '99 rue inconnue', city: '' })
    expect(mocks.fetchPlaceAddress).not.toHaveBeenCalled()
  })

  it('closes the list when the field is left, without choosing', async () => {
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await screen.findByRole('listbox')
    await userEvent.tab()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box('Appartement ou bureau')).toHaveFocus()
    expect(mocks.fetchPlaceAddress).not.toHaveBeenCalled()
  })

  it('« Saisir manuellement » stops the suggestions in this field until it is emptied', async () => {
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: t('address.suggestions.manual') }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(liveRegion().textContent).toBe(t('address.suggestions.manualOn'))
    expect(combobox()).toHaveFocus()

    await userEvent.type(combobox(), ' app 4')
    await settle()
    expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce()
    expect(combobox()).toHaveValue('1234 saint-denis app 4')
    expect(mocks.fetchPlaceAddress).not.toHaveBeenCalled()

    await userEvent.clear(combobox())
    await userEvent.type(combobox(), '4100 wellington')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledTimes(2))
  })

  it('« Saisir manuellement » ends when the form puts another value in the field (« Annuler »)', async () => {
    render(<Harness defaults={{ line1: '123, rue Saint-Denis' }} />)
    await userEvent.clear(combobox())
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: t('address.suggestions.manual') }))
    await userEvent.type(combobox(), ' app 4')
    await settle()
    expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(combobox()).toHaveValue('123, rue Saint-Denis')
    await userEvent.click(combobox())
    await userEvent.type(combobox(), ' est')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledTimes(2))
    expect(mocks.fetchAddressSuggestions.mock.calls[1]?.[0]).toBe('123, rue Saint-Denis est')
  })

  it('« Annuler » while the choice resolves: nothing is filled', async () => {
    let answer: (a: PlaceAddress) => void = () => {}
    mocks.fetchPlaceAddress.mockReturnValue(new Promise<PlaceAddress>((resolve) => (answer = resolve)))
    render(<Harness defaults={{ line1: '123, rue Saint-Denis', city: 'Laval' }} />)
    await userEvent.clear(combobox())
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    answer(PLATEAU)
    await settle()
    expect(combobox()).toHaveValue('123, rue Saint-Denis')
    expect(box('Ville')).toHaveValue('Laval')
    expect(box('Code postal')).toHaveValue('')
    expect(liveRegion().textContent).not.toBe(t('address.suggestions.filled'))
    expect(combobox()).not.toHaveAttribute('aria-busy')
  })

  it('leaving the form while the choice resolves (unmount) stops it', async () => {
    let answer: (a: PlaceAddress) => void = () => {}
    mocks.fetchPlaceAddress.mockReturnValue(new Promise<PlaceAddress>((resolve) => (answer = resolve)))
    const errors = vi.spyOn(console, 'error')
    const { unmount } = render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    unmount()
    answer(PLATEAU)
    await settle()
    expect(mocks.fetchPlaceAddress.mock.calls[0]?.[2]).toHaveProperty('aborted', true)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('a second choice clears what the first left and nobody touched (postal code, unit)', async () => {
    mocks.fetchPlaceAddress.mockResolvedValueOnce({ ...PLATEAU, line1: '3450, rue Drummond', line2: '402', postalCode: 'H3G 1Y2' })
    mocks.fetchPlaceAddress.mockResolvedValueOnce({ ...PLATEAU, postalCode: null })
    render(<Harness />)
    await userEvent.type(combobox(), '3450 drummond')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Code postal')).toHaveValue('H3G 1Y2'))
    expect(box('Appartement ou bureau')).toHaveValue('402')

    await userEvent.clear(combobox())
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(combobox()).toHaveValue('1234, rue Saint-Denis'))
    expect(box('Code postal')).toHaveValue('')
    expect(box('Appartement ou bureau')).toHaveValue('')
    expect(box('Ville')).toHaveValue('Montréal')
  })

  it('sends the typed text normalised: control characters (a pasted tab) become spaces', async () => {
    render(<Harness />)
    await userEvent.click(combobox())
    await userEvent.paste('1234\tsaint-denis\u0085 est')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce())
    expect(mocks.fetchAddressSuggestions.mock.calls[0]?.[0]).toBe('1234 saint-denis est')
  })

  it('a refused request (invalid_request) does not pause the suggestions', async () => {
    mocks.fetchAddressSuggestions.mockRejectedValueOnce(new FunctionCallError('invalid_request', 400, 'Invalid body'))
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce())
    await settle()
    expect(suggestionsPaused()).toBe(false)
    await userEvent.type(combobox(), ' est')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledTimes(2))
  })

  it('when the service is not configured: a plain field, quietly (no toast, no report), and no request per keystroke', async () => {
    mocks.fetchAddressSuggestions.mockRejectedValue(new FunctionCallError('not_configured', 503, 'Address suggestions are not configured'))
    render(<Harness />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await waitFor(() => expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce())
    await userEvent.type(combobox(), ' est')
    await settle()
    expect(mocks.fetchAddressSuggestions).toHaveBeenCalledOnce()
    expect(combobox()).toHaveValue('1234 saint-denis est')
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('when the chosen place cannot be read: only the street is filled, in the Québec form, the rest is left to the person', async () => {
    mocks.fetchPlaceAddress.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Address suggestions are unavailable'))
    render(<Harness defaults={{ city: 'Laval' }} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(combobox()).toHaveValue('1234, rue Saint-Denis'))
    expect(box('Ville')).toHaveValue('Laval')
    expect(liveRegion().textContent).toBe(t('address.suggestions.partial'))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('when a chosen place that is no street cannot be read: line 1 stays as typed', async () => {
    mocks.fetchAddressSuggestions.mockResolvedValue([{ placeId: 'ChIJfakeArea00000009', mainText: 'Le Plateau-Mont-Royal', secondaryText: 'Montréal, QC, Canada' }])
    mocks.fetchPlaceAddress.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Address suggestions are unavailable'))
    render(<Harness />)
    await userEvent.type(combobox(), 'plateau mont')
    await userEvent.click(await screen.findByRole('option', { name: /Le Plateau-Mont-Royal/ }))
    await waitFor(() => expect(liveRegion().textContent).toBe(t('address.suggestions.unreadable')))
    expect(combobox()).toHaveValue('plateau mont')
  })

  it('ignores a province that is not one of the 13 codes', async () => {
    mocks.fetchPlaceAddress.mockResolvedValue({ ...PLATEAU, province: 'NY', postalCode: null })
    render(<Harness defaults={{ province: 'QC' }} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Ville')).toHaveValue('Montréal'))
    expect(box('Province')).toHaveValue('QC')
  })

  it('marks the filled fields dirty, so the card can save them', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.type(combobox(), '1234 saint-denis')
    await userEvent.click(await screen.findByRole('option', { name: /1234 Rue Saint-Denis/ }))
    await waitFor(() => expect(box('Code postal')).toHaveValue('H2X 3J6'))
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() =>
      expect(onSubmit.mock.calls[0]?.[0]).toEqual({ line1: '1234, rue Saint-Denis', line2: '', city: 'Montréal', province: 'QC', postal: 'H2X 3J6' }),
    )
  })

  it('read-only: a plain text box that asks nothing', async () => {
    render(<Harness readOnly defaults={{ line1: '123, rue Saint-Denis' }} />)
    const input = screen.getByRole('textbox', { name: 'Adresse' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('123, rue Saint-Denis')
    expect(screen.queryByRole('combobox', { name: 'Adresse' })).not.toBeInTheDocument()
    await userEvent.type(input, 'abc')
    await settle()
    expect(mocks.fetchAddressSuggestions).not.toHaveBeenCalled()
  })
})
