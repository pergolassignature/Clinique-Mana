import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { EMBED_READY_TIMEOUT_MS, EmbeddedSigning } from './EmbeddedSigning'

// A frame that never says it is ready (refused by frame-ancestors, a license gate, the network),
// with a button standing for Documenso's « document-completed ».
vi.mock('@documenso/embed-react', () => ({
  EmbedSignDocument: ({ language, onDocumentCompleted }: { language: string; onDocumentCompleted: () => void }) => (
    <>
      <iframe data-testid="frame" data-language={language} />
      <button type="button" onClick={onDocumentCompleted}>
        DONE
      </button>
    </>
  ),
}))

const FR = 'signing.embedded.fr'
const EN = 'signing.embedded.en'
const LINK = { token: 'tok_1', signingUrl: 'https://sign.test/sign/tok_1', host: 'https://sign.test' }

afterEach(() => vi.useRealTimers())

describe('EmbeddedSigning (P4-488, shared)', () => {
  it('names the frame, then falls back to the full signing page when the frame never says ready', async () => {
    vi.useFakeTimers()
    render(<EmbeddedSigning link={LINK} title="Signature du consentement" onCompleted={vi.fn()} onClose={vi.fn()} />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(screen.getByTestId('frame')).toHaveAttribute('title', 'Signature du consentement')
    expect(screen.getByText(t(`${FR}.loading`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${FR}.openInPage`) })).toHaveAttribute('href', LINK.signingUrl)
    await act(async () => {
      vi.advanceTimersByTime(EMBED_READY_TIMEOUT_MS + 1)
    })
    expect(screen.getByText(t(`${FR}.fallback`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${FR}.openPage`) })).toHaveAttribute('href', LINK.signingUrl)
    expect(screen.queryByTestId('frame')).not.toBeInTheDocument()
  })

  it('in English: Documenso and the texts; completion is passed on; no « Fermer » without onClose', async () => {
    const onCompleted = vi.fn()
    render(<EmbeddedSigning link={LINK} title="Consent signature" language="en" onCompleted={onCompleted} />)
    expect(await screen.findByTestId('frame')).toHaveAttribute('data-language', 'en')
    expect(screen.getByText(t(`${EN}.loading`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${EN}.close`) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'DONE' }))
    expect(onCompleted).toHaveBeenCalledOnce()
  })
})
