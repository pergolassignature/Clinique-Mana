import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { EmbeddedSigning, READY_TIMEOUT_MS } from './EmbeddedSigning'

// A frame that never says it is ready (refused by frame-ancestors, a license gate, the network).
vi.mock('@documenso/embed-react', () => ({ EmbedSignDocument: () => <iframe data-testid="frame" /> }))

const S = 'modules.professionals.consentSign'
const LINK = { requestId: 'r1', token: 'tok_1', signingUrl: 'https://sign.test/sign/tok_1', host: 'https://sign.test' }

afterEach(() => vi.useRealTimers())

describe('EmbeddedSigning (P4-488)', () => {
  it('falls back to the full signing page when the frame never says ready', async () => {
    vi.useFakeTimers()
    render(<EmbeddedSigning link={LINK} onCompleted={vi.fn()} onClose={vi.fn()} />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(screen.getByTestId('frame')).toHaveAttribute('title', t(`${S}.frameTitle`))
    expect(screen.getByText(t(`${S}.loading`))).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(READY_TIMEOUT_MS + 1)
    })
    expect(screen.getByText(t(`${S}.fallback`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${S}.openPage`) })).toHaveAttribute('href', LINK.signingUrl)
    expect(screen.queryByTestId('frame')).not.toBeInTheDocument()
  })
})
