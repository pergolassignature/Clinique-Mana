import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { GuardedNavLink } from './GuardedNavLink'
import { UnsavedChangesProvider } from './UnsavedChangesProvider'

function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty)
  return <p>FORMULAIRE</p>
}

/** A part of the page that is left without the router (e.g. switching section in local state). */
function Section({ onLeave }: { onLeave: () => void }) {
  const confirmLeave = useConfirmLeave()
  const [open, setOpen] = useState(true)
  if (!open) return <p>SECTION QUITTÉE</p>
  return (
    <>
      <Form dirty />
      <button
        onClick={() =>
          confirmLeave(() => {
            setOpen(false)
            onLeave()
          })
        }
      >
        Changer de section
      </button>
    </>
  )
}

interface AppProps {
  forms?: boolean[]
  section?: boolean
  onLeave?: () => void
  provider?: boolean
}

function App({ forms = [true], section = false, onLeave = () => {}, provider = true }: AppProps) {
  const content = (
    <>
      <GuardedNavLink to="/b">Aller à B</GuardedNavLink>
      <GuardedNavLink to="/a">Page A</GuardedNavLink>
      <GuardedNavLink to="/b" target="_blank">
        B dans un nouvel onglet
      </GuardedNavLink>
      {section && <Section onLeave={onLeave} />}
      <Routes>
        <Route
          path="/a"
          element={
            <>
              {forms.map((dirty, i) => (
                <Form key={i} dirty={dirty} />
              ))}
              <p>PAGE A</p>
            </>
          }
        />
        <Route path="/b" element={<p>PAGE B</p>} />
      </Routes>
    </>
  )
  return (
    <MemoryRouter initialEntries={['/a']} future={ROUTER_FUTURE}>
      {provider ? <UnsavedChangesProvider>{content}</UnsavedChangesProvider> : content}
    </MemoryRouter>
  )
}

const link = () => screen.getByRole('link', { name: 'Aller à B' })
const dialog = () => screen.queryByRole('alertdialog')
const stay = () => screen.getByRole('button', { name: t('common.unsaved.stay') })
const leave = () => screen.findByRole('button', { name: t('common.unsaved.leave') })
/**
 * Clicks and reports whether our handlers left the browser's default action alone. A bubble-phase
 * listener on window (after React's root listener) records `defaultPrevented`, then prevents the
 * default itself so happy-dom does not actually follow the link (it would fetch localhost:3000).
 */
const clickLeavesDefault = (element: HTMLElement, init?: MouseEventInit) => {
  let prevented: boolean | undefined
  const record = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }
  window.addEventListener('click', record)
  try {
    fireEvent.click(element, init)
  } finally {
    window.removeEventListener('click', record)
  }
  return prevented === false
}
const fireBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('unsaved-changes guard', () => {
  it('a clean form lets the link navigate directly', async () => {
    render(<App forms={[false]} />)
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(dialog()).not.toBeInTheDocument()
  })

  it('a dirty form asks first: « Rester » keeps the page, « Quitter » navigates', async () => {
    render(<App forms={[true]} />)

    await userEvent.click(link())
    const alert = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    expect(alert).toHaveTextContent(t('common.unsaved.body'))
    expect(stay()).toHaveFocus() // the safe default
    await userEvent.click(stay())
    expect(dialog()).not.toBeInTheDocument()
    expect(screen.getByText('PAGE A')).toBeInTheDocument()

    await userEvent.click(link())
    await userEvent.click(await leave())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(dialog()).not.toBeInTheDocument()
  })

  it('returns focus to the link after « Rester » or Escape', async () => {
    render(<App forms={[true]} />)
    await userEvent.tab()
    expect(link()).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}') // on « Rester », focused by default
    await waitFor(() => expect(link()).toHaveFocus())
    expect(dialog()).not.toBeInTheDocument()

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(link()).toHaveFocus())
    expect(screen.getByText('PAGE A')).toBeInTheDocument()
  })

  it('after « Quitter », returns focus to the link when it is still on the page', async () => {
    render(<App forms={[true]} />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await leave())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    await waitFor(() => expect(link()).toHaveFocus()) // the link lives outside the routes, like a sidebar
  })

  it('after « Quitter », leaves focus alone when the element that opened the dialog is gone', async () => {
    render(<App forms={[true]} section />)
    const button = screen.getByRole('button', { name: 'Changer de section' })
    button.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await leave())
    expect(await screen.findByText('SECTION QUITTÉE')).toBeInTheDocument()
    expect(button).not.toBeInTheDocument()
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
  })

  it('leaves modified and middle clicks to the browser', () => {
    render(<App forms={[true]} />)
    expect(clickLeavesDefault(link(), { ctrlKey: true })).toBe(true)
    expect(clickLeavesDefault(link(), { metaKey: true })).toBe(true)
    expect(clickLeavesDefault(link(), { shiftKey: true })).toBe(true)
    expect(clickLeavesDefault(link(), { altKey: true })).toBe(true)
    expect(clickLeavesDefault(link(), { button: 1 })).toBe(true)
    expect(dialog()).not.toBeInTheDocument()
    expect(screen.getByText('PAGE A')).toBeInTheDocument()
  })

  it('does not intercept a link that opens another tab', () => {
    render(<App forms={[true]} />)
    // React Router itself leaves target="_blank" to the browser, so the default is not prevented.
    expect(clickLeavesDefault(screen.getByRole('link', { name: 'B dans un nouvel onglet' }))).toBe(true)
    expect(dialog()).not.toBeInTheDocument()
  })

  it('does not prompt for a link to the current page', async () => {
    render(<App forms={[true]} />)
    await userEvent.click(screen.getByRole('link', { name: 'Page A' }))
    expect(dialog()).not.toBeInTheDocument()
    expect(screen.getByText('PAGE A')).toBeInTheDocument()
  })

  it('unmounting the dirty form clears the guard', async () => {
    const { rerender } = render(<App forms={[true]} />)
    rerender(<App forms={[]} />)
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(dialog()).not.toBeInTheDocument()
  })

  it('stays armed while another form is still dirty', async () => {
    const { rerender } = render(<App forms={[true, true]} />)
    rerender(<App forms={[true, false]} />)
    await userEvent.click(link())
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('useConfirmLeave proceeds only after « Quitter », and the forms left behind stay guarded', async () => {
    const onLeave = vi.fn()
    render(<App forms={[true]} section onLeave={onLeave} />)

    await userEvent.click(screen.getByRole('button', { name: 'Changer de section' }))
    expect(onLeave).not.toHaveBeenCalled()
    await userEvent.click(await leave())
    expect(onLeave).toHaveBeenCalledOnce()
    expect(await screen.findByText('SECTION QUITTÉE')).toBeInTheDocument()

    // The page's own form is still dirty: confirming the section switch did not clear it.
    await userEvent.click(link())
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(fireBeforeUnload()).toBe(true)
  })

  it('prevents beforeunload only while a form is dirty', () => {
    const { rerender, unmount } = render(<App forms={[false]} />)
    expect(fireBeforeUnload()).toBe(false)
    rerender(<App forms={[true]} />)
    expect(fireBeforeUnload()).toBe(true)
    rerender(<App forms={[false]} />)
    expect(fireBeforeUnload()).toBe(false)
    rerender(<App forms={[true]} />)
    unmount()
    expect(fireBeforeUnload()).toBe(false)
  })

  it('after « Quitter », a full-page navigation does not ask a second time (once only)', async () => {
    let unloadPrevented: boolean | undefined
    function FullReload() {
      const confirmLeave = useConfirmLeave()
      // Stands for window.location.assign(…), which fires beforeunload.
      return <button onClick={() => confirmLeave(() => (unloadPrevented = fireBeforeUnload()))}>Recharger</button>
    }
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <UnsavedChangesProvider>
          <Form dirty />
          <FullReload />
        </UnsavedChangesProvider>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Recharger' }))
    await userEvent.click(await leave())
    expect(unloadPrevented).toBe(false)
    // One-shot: the form is still dirty, so the next unload is guarded again.
    expect(fireBeforeUnload()).toBe(true)
  })

  it('works under StrictMode (effects mounted twice)', async () => {
    const { rerender } = render(
      <StrictMode>
        <App forms={[true]} />
      </StrictMode>,
    )
    expect(fireBeforeUnload()).toBe(true)
    await userEvent.click(link())
    await userEvent.click(stay())
    expect(screen.getByText('PAGE A')).toBeInTheDocument()

    rerender(
      <StrictMode>
        <App forms={[false]} />
      </StrictMode>,
    )
    expect(fireBeforeUnload()).toBe(false)
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(dialog()).not.toBeInTheDocument()
  })

  it('does nothing outside a provider', async () => {
    const onLeave = vi.fn()
    render(<App forms={[true]} section onLeave={onLeave} provider={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Changer de section' }))
    expect(onLeave).toHaveBeenCalledOnce()
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
  })
})
