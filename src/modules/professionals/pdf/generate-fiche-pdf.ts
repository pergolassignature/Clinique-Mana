import { createElement, type ReactElement } from 'react'
import { pdf, type DocumentProps } from '@react-pdf/renderer'
import type { Organization } from '@/core/settings/organization/api'
import { formatInClinicTimezone } from '@/shared/lib/timezone'
import type { ProfessionalRecord } from '../api/parse'
import type { CatalogView } from '../lib/catalog-view'
import { buildFicheContent } from './fiche-content'
import { FicheDocument } from './FicheDocument'
import { loadFicheFonts } from './fonts'
import { storedImageDataUrl } from './load-images'

/**
 * The fiche's generator (PS Hub's `generateReactPDF.ts`: load images → build props →
 * `pdf().toBlob()`). This module and everything it imports (react-pdf, the fonts) is a chunk of
 * its own, loaded by the « Fiche PDF » menu on demand (`hooks/use-fiche.ts`), never with the
 * record page (P4-58).
 */

export interface FicheRequest {
  record: ProfessionalRecord
  catalog: CatalogView
  /** The title the fiche is for (two titles: the person's choice); null → the primary one. */
  titleId: string | null
  /** The clinic identity and logo from Settings (no hard-coded phone or URL). */
  organization: Pick<Organization, 'name' | 'phone' | 'email' | 'website' | 'logo_file_id'>
}

/** Renders the fiche as a PDF Blob, in the browser. */
export async function renderFichePdf({ record, catalog, titleId, organization }: FicheRequest): Promise<Blob> {
  const [canDraw, logo] = await Promise.all([loadFicheFonts(), storedImageDataUrl(organization.logo_file_id)])
  const content = buildFicheContent({
    record,
    catalog,
    titleId,
    clinic: { name: organization.name, phone: organization.phone, email: organization.email, website: organization.website },
    logo,
    // The photo comes with 4c's documents (P4-202).
    photo: null,
    // Services et tarifs is not built: « À confirmer » (P4-204).
    fees: null,
    generatedOn: formatInClinicTimezone(new Date(), 'd MMMM yyyy'),
    canDraw,
  })
  // Let the menu's busy state paint before the render holds the main thread.
  await new Promise((resolve) => setTimeout(resolve, 0))
  // FicheDocument renders a <Document>: what pdf() takes, which its typing cannot see through.
  return pdf(createElement(FicheDocument, { content }) as ReactElement<DocumentProps>).toBlob()
}

