import { createElement, type ReactElement } from 'react'
import { pdf, type DocumentProps } from '@react-pdf/renderer'
import type { ClientsReference } from '../api/clients'
import type { ClientExport } from '../api/parse'
import { buildPrivacyContent } from './privacy-content'
import { PrivacyDocument } from './PrivacyDocument'

/** Renders the export as a PDF Blob, in the browser. */
export async function renderPrivacyPdf(data: ClientExport, reference: ClientsReference | undefined, clinic: string): Promise<Blob> {
  const content = buildPrivacyContent(data, reference, clinic)
  // Let the menu's busy state paint before the render holds the main thread.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return pdf(createElement(PrivacyDocument, { content }) as ReactElement<DocumentProps>).toBlob()
}
