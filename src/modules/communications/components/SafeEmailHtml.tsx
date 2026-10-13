import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@/i18n'

/** The widest layout kept as is (then scaled to the pane): wider is a rogue element, cut. */
const MAX_WIDTH = 960

/** The frame's own page: neutral type, links underlined, images within the frame. */
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #1f2933;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    font-size: 14px; line-height: 1.5; }
  body { padding: 4px 2px; overflow-wrap: break-word; }
  img, video { max-width: 100%; height: auto; }
  img[data-blocked] { display: inline-block; min-width: 16px; min-height: 16px; background: #f1f3f5; }
  a { color: #1d4ed8; text-decoration: underline; }
  blockquote { border-left: 2px solid #d9dee3; padding-left: 12px; margin: 8px 0; color: #52606d; }
  pre { white-space: pre-wrap; }
  pre, code { word-break: break-all; }
`

/**
 * A received email's HTML (already sanitized by `prepareEmailHtml`) in a sandboxed frame without
 * scripts: its styles cannot reach the app, and links open in a new tab. The frame takes the
 * message's height; a fixed-width layout wider than the pane (a signature table) is scaled down
 * to fit instead of scrolling sideways (PS Hub's renderer, simplified).
 */
export function SafeEmailHtml({ html }: { html: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ width: 0, height: 60, scale: 1 })

  const measure = useCallback(() => {
    const frame = frameRef.current
    const wrapper = wrapperRef.current
    const doc = frame?.contentDocument
    if (!frame || !wrapper || !doc?.body) return
    const container = wrapper.clientWidth
    if (container <= 0) return
    const natural = Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth, 1)
    const width = natural > container + 2 ? Math.min(natural, MAX_WIDTH) : container
    const scale = container < width ? container / width : 1
    const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 20)
    setSize((prev) => (prev.width === width && prev.height === height && prev.scale === scale ? prev : { width, height, scale }))
  }, [])

  // `no-referrer` here: the frame's own attribute covers its request only, not its images'.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${BASE_CSS}</style></head><body dir="auto">${html}</body></html>`

  useEffect(() => {
    const frame = frameRef.current
    const wrapper = wrapperRef.current
    if (!frame) return
    let content: ResizeObserver | null = null
    const onLoad = () => {
      measure()
      const doc = frame.contentDocument
      if (doc?.body && typeof ResizeObserver !== 'undefined') {
        content = new ResizeObserver(measure)
        content.observe(doc.body)
      }
      for (const img of Array.from(doc?.images ?? [])) {
        if (!img.complete) img.addEventListener('load', measure, { once: true })
      }
    }
    frame.addEventListener('load', onLoad)
    // The frame may have loaded before this effect ran: measure now, the listener would never fire.
    if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body?.childNodes.length) onLoad()
    const outer = typeof ResizeObserver !== 'undefined' && wrapper ? new ResizeObserver(measure) : null
    if (outer && wrapper) outer.observe(wrapper)
    return () => {
      frame.removeEventListener('load', onLoad)
      content?.disconnect()
      outer?.disconnect()
    }
  }, [srcDoc, measure])

  return (
    <div ref={wrapperRef} className="w-full overflow-hidden" style={{ height: Math.ceil(size.height * size.scale) + 4 }}>
      <iframe
        ref={frameRef}
        srcDoc={srcDoc}
        // No allow-scripts: the sanitizer drops them, the frame could not run them anyway. Same
        // origin only to measure the content; popups for the links (new tab).
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        title={t('modules.communications.inbox.messageFrame')}
        className="block border-0"
        style={{
          width: size.width > 0 ? size.width : '100%',
          height: size.height,
          transform: size.scale < 1 ? `scale(${size.scale})` : undefined,
          transformOrigin: 'top left',
          colorScheme: 'light',
        }}
      />
    </div>
  )
}
