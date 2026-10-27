import { afterEach, describe, expect, it } from 'vitest'
import { browserShowsPdfInline } from './pdf-viewer'

/** `undefined` is an older browser (or the test environment): the frame is used, as before. */
function setPdfViewerEnabled(value: boolean | undefined) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true })
}

afterEach(() => setPdfViewerEnabled(undefined))

describe('browserShowsPdfInline', () => {
  it('is false only when the browser says it will not draw PDFs', () => {
    setPdfViewerEnabled(false)
    expect(browserShowsPdfInline()).toBe(false)
    setPdfViewerEnabled(true)
    expect(browserShowsPdfInline()).toBe(true)
    setPdfViewerEnabled(undefined)
    expect(browserShowsPdfInline()).toBe(true)
  })
})
