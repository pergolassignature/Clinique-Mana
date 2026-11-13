import { useEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useComposerLauncher } from '../../hooks/use-composer-launcher'
import { initialContent } from '../../lib/compose'
import { MAILBOX } from '../../test/fixtures'
import type { ComposerProps } from './Composer'
import { ComposerHost } from './ComposerHost'

const sent = vi.hoisted(() => ({ current: null as ((threadId: string | null) => void) | null }))
// The host's part only: a composer that takes the focus on opening, as the real one does, and closes
// or sends on demand (the real one is Composer.test's).
vi.mock('./Composer', () => ({
  Composer: ({ onClose, onSent }: ComposerProps) => {
    const field = useRef<HTMLInputElement>(null)
    useEffect(() => field.current?.focus(), [])
    sent.current = onSent
    return (
      <section role="dialog" aria-label="Composer">
        <input ref={field} aria-label="À" />
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </section>
    )
  },
}))

afterEach(() => {
  sent.current = null
})

function Openers() {
  const composer = useComposerLauncher()
  const [showReply, setShowReply] = useState(true)
  const open = () => composer?.open({ kind: 'content', personKnown: false, content: initialContent({ connectionId: MAILBOX.id, mode: 'new' }) })
  return (
    <>
      {showReply && (
        <button type="button" onClick={open}>
          Répondre
        </button>
      )}
      <button type="button" onClick={open}>
        Transférer
      </button>
      <button type="button" onClick={() => setShowReply(false)}>
        Cacher « Répondre »
      </button>
      <input aria-label="Rechercher" />
    </>
  )
}

function renderHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ComposerHost mailboxes={[MAILBOX]}>
        <Openers />
      </ComposerHost>
    </QueryClientProvider>,
  )
}

describe('ComposerHost: the focus once the composer closes', () => {
  it('goes back to what opened it, after « Fermer » and after the send', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.click(screen.getByRole('button', { name: 'Répondre' }))
    expect(screen.getByRole('textbox', { name: 'À' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Répondre' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Transférer' }))
    expect(screen.getByRole('textbox', { name: 'À' })).toHaveFocus()
    act(() => sent.current?.('t1'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transférer' })).toHaveFocus()
  })

  it('a composer replaced by another gives it back to the second opener', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.click(screen.getByRole('button', { name: 'Répondre' }))
    await user.click(screen.getByRole('button', { name: 'Transférer' }))
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.getByRole('button', { name: 'Transférer' })).toHaveFocus()
  })

  it('stays where the person put it meanwhile (a send ending while they type elsewhere)', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.click(screen.getByRole('button', { name: 'Répondre' }))
    await user.click(screen.getByRole('textbox', { name: 'Rechercher' }))
    act(() => sent.current?.('t1'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Rechercher' })).toHaveFocus()
  })

  it('goes nowhere when the opener is gone', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.click(screen.getByRole('button', { name: 'Répondre' }))
    await user.click(screen.getByRole('button', { name: 'Cacher « Répondre »' }))
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('button', { name: 'Répondre' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(document.body)
  })
})
