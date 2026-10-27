/**
 * What the browser does with a PDF we put in a frame.
 *
 * A frame whose source the browser will not draw reports nothing: no `error` event, no empty
 * state, just a blank box where the document should be. A preview that frames a PDF therefore
 * asks first, and offers the file itself when the answer is no.
 */

/**
 * Whether the browser draws PDFs in the page. False when it is set to download them instead
 * (Chrome's « Download PDFs instead of automatically opening them », or the same by policy).
 * Unknown (an older browser, a test environment) counts as yes: the frame, as before.
 */
export function browserShowsPdfInline(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
}
