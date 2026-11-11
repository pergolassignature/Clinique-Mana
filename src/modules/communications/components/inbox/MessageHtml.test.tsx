// @vitest-environment jsdom
// The package's sanitizer runs here (in the frame's srcdoc): DOMPurify needs jsdom, not happy-dom.
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SafeEmailHtmlProps } from '@pergolas-signature/email-render'
import { t } from '@/i18n'
import { MessageHtml } from './MessageHtml'

// The real frame, its props recorded on the way in.
const seen = vi.hoisted(() => ({ props: [] as SafeEmailHtmlProps[] }))
vi.mock('@pergolas-signature/email-render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pergolas-signature/email-render')>()
  return {
    ...actual,
    SafeEmailHtml: (props: SafeEmailHtmlProps) => {
      seen.props.push(props)
      return createElement(actual.SafeEmailHtml, props)
    },
  }
})

const V = 'modules.communications.inbox.thread'
const RAW = '<p>Bonjour</p><img src="cid:logo@clinique" alt="logo"><img src="https://images.test/banner.png" alt="bannière">'
const SIGNED = 'https://storage.test/signed/logo.png?token=1'
const inlineImages = new Map([['logo@clinique', SIGNED]])

const frame = () => screen.getByTitle(t('modules.communications.inbox.messageFrame'))
const srcdoc = () => frame().getAttribute('srcdoc') ?? ''

describe('MessageHtml (the package frame, with the clinic options)', () => {
  it('hands the frame the raw HTML and stable options, its French title and the inline images resolved', () => {
    seen.props = []
    const { rerender } = render(<MessageHtml html={RAW} inlineImages={inlineImages} />)
    rerender(<MessageHtml html={RAW} inlineImages={inlineImages} />)

    const [first, last] = [seen.props[0], seen.props.at(-1)]
    expect(first?.html).toBe(RAW)
    expect(first?.title).toBe(t('modules.communications.inbox.messageFrame'))
    expect(first?.sanitizeOptions).toMatchObject({ remoteImages: 'hold', styleFetch: 'block', maxInlineWidthPx: 800 })
    // In the tab order (links reachable by keyboard), and no referrer for the images it loads.
    expect(first?.tabbable).toBe(true)
    expect(frame()).not.toHaveAttribute('tabindex')
    expect(frame()).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(srcdoc()).toContain('<meta name="referrer" content="no-referrer"')
    // Same options object on a re-render: the frame does not sanitize again.
    expect(last?.sanitizeOptions).toBe(first?.sanitizeOptions)

    // Sanitized once, in the frame: the logo shows from its signed URL, the remote image is held.
    expect(srcdoc()).toContain(`src="${SIGNED.replace('&', '&amp;')}"`)
    expect(srcdoc()).not.toContain('images.test')
    expect(srcdoc()).toContain('data-blocked')
  })

  it('« Afficher les images »: the bar shows while images are held, then they show, the inline logo still there', async () => {
    const user = userEvent.setup()
    seen.props = []
    render(<MessageHtml html={RAW} inlineImages={inlineImages} />)
    expect(screen.getByText(t(`${V}.imagesHeld`))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t(`${V}.showImages`) }))

    expect(screen.queryByText(t(`${V}.imagesHeld`))).not.toBeInTheDocument()
    expect(seen.props.at(-1)?.html).toBe(RAW)
    expect(seen.props.at(-1)?.sanitizeOptions?.remoteImages).toBe('show')
    expect(srcdoc()).toContain('src="https://images.test/banner.png"')
    expect(srcdoc()).toContain(`src="${SIGNED.replace('&', '&amp;')}"`)
  })

  it('no bar when nothing is held (an inline image is never held)', () => {
    render(<MessageHtml html={'<p>x</p><img src="cid:logo@clinique">'} inlineImages={inlineImages} />)
    expect(screen.queryByRole('button', { name: t(`${V}.showImages`) })).not.toBeInTheDocument()
    expect(srcdoc()).toContain(SIGNED.split('?')[0])
  })
})
