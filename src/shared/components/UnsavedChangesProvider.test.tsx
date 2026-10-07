import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

function CloseButton({ onClose }: { onClose: () => void }) {
  const confirmLeave = useConfirmLeave()
  return <button onClick={() => confirmLeave(onClose)}>Fermer le panneau</button>
}

function App({ forms = [true], provider = true, onClose = () => {} }: { forms?: boolean[]; provider?: boolean; onClose?: () => void }) {
  const content = (
    <>
      <GuardedNavLink to="/b">Aller à B</GuardedNavLink>
      <CloseButton onClose={onClose} />
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
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a dirty form asks first: « Rester » keeps the page, « Quitter » navigates', async () => {
    render(<App forms={[true]} />)

    await userEvent.click(link())
    const dialog = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
    expect(dialog).toHaveTextContent(t('common.unsaved.body'))
    expect(screen.getByRole('button', { name: t('common.unsaved.stay') })).toHaveFocus() // the safe default
    await userEvent.click(screen.getByRole('button', { name: t('common.unsaved.stay') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('PAGE A')).toBeInTheDocument()

    await userEvent.click(link())
    await userEvent.click(await screen.findByRole('button', { name: t('common.unsaved.leave') }))
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('leaves modified and middle clicks to the browser', () => {
    render(<App forms={[true]} />)
    fireEvent.click(link(), { ctrlKey: true })
    fireEvent.click(link(), { metaKey: true })
    fireEvent.click(link(), { shiftKey: true })
    fireEvent.click(link(), { button: 1 })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('PAGE A')).toBeInTheDocument()
  })

  it('unmounting the dirty form clears the guard', async () => {
    const { rerender } = render(<App forms={[true]} />)
    rerender(<App forms={[]} />)
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('stays armed while another form is still dirty', async () => {
    const { rerender } = render(<App forms={[true, true]} />)
    rerender(<App forms={[true, false]} />)
    await userEvent.click(link())
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('guards other ways of leaving through useConfirmLeave', async () => {
    const onClose = vi.fn()
    render(<App forms={[true]} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: t('common.unsaved.leave') }))
    expect(onClose).toHaveBeenCalledOnce()
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

  it('does nothing outside a provider', async () => {
    const onClose = vi.fn()
    render(<App forms={[true]} provider={false} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
    expect(onClose).toHaveBeenCalledOnce()
    await userEvent.click(link())
    expect(await screen.findByText('PAGE B')).toBeInTheDocument()
  })
})
