import { createElement, type ReactElement } from 'react'
import { pdf, type DocumentProps } from '@react-pdf/renderer'
import type { Organization } from '@/core/settings/organization/api'
import { formatInClinicTimezone } from '@/shared/lib/timezone'
import type { PublicFee } from '../api/fiche'
import type { ProfessionalRecord } from '../api/parse'
import type { CatalogView } from '../lib/catalog-view'
import { MANA_LOGO_URL } from './brand'
import { buildFicheContent, type FicheOptions } from './fiche-content'
import { FicheDocument } from './FicheDocument'
import { loadFicheFonts } from './fonts'
import { bundledImageDataUrl, storedImageDataUrl } from './load-images'

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
  /** The clinic identity and logo from Settings (no hard-coded phone or URL; Clinique MANA's lockup without a logo). */
  organization: Pick<Organization, 'name' | 'phone' | 'email' | 'website' | 'logo_file_id'>
  /** The title's client prices in force today (`fetchPublicFees`); empty → « À confirmer ». */
  fees: readonly PublicFee[]
  /** The clinic's render options (Paramètres → Fiche PDF, P4-353). */
  options: FicheOptions
  /** The professional's photo (the newest verified one, P4-202); null or unreadable → the initials. */
  photoFileId?: string | null
}

/** Renders the fiche as a PDF Blob, in the browser. */
export async function renderFichePdf({ record, catalog, titleId, organization, fees, options, photoFileId = null }: FicheRequest): Promise<Blob> {
  const [canDraw, logo, brandLogo, photo] = await Promise.all([
    loadFicheFonts(),
    storedImageDataUrl(organization.logo_file_id),
    bundledImageDataUrl(MANA_LOGO_URL),
    storedImageDataUrl(photoFileId, { variant: 'print' }),
  ])
  const content = buildFicheContent({
    record,
    catalog,
    titleId,
    clinic: { name: organization.name, phone: organization.phone, email: organization.email, website: organization.website },
    logo,
    brandLogo,
    photo,
    fees,
    generatedOn: formatInClinicTimezone(new Date(), 'd MMMM yyyy'),
    options,
    canDraw,
  })
  // Let the menu's busy state paint before the render holds the main thread.
  await new Promise((resolve) => setTimeout(resolve, 0))
  // FicheDocument renders a <Document>: what pdf() takes, which its typing cannot see through.
  return pdf(createElement(FicheDocument, { content }) as ReactElement<DocumentProps>).toBlob()
}

