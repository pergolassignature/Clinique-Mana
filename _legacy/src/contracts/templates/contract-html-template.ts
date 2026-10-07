// src/contracts/templates/contract-html-template.ts
// HTML template for DocuSeal contract generation

import type { ProfessionalSnapshot, PricingSnapshot } from '../types'
import {
  CLINIC_INFO,
  CONTRACT_CLAUSES,
  ATTENDU_CLAUSE,
  CONSEQUENCE_HEADER,
  PAYMENT_TERMS_TABLE,
  DEFAULT_AUTRES_FRAIS,
} from '../constants/contract-text-fr'
import { formatPhoneForDisplay } from '@/shared/lib/client-validation'

// =============================================================================
// HELPERS
// =============================================================================

function formatAddress(address: ProfessionalSnapshot['address']): string {
  const parts: string[] = []

  if (address.streetNumber || address.streetName) {
    const street = [address.streetNumber, address.streetName].filter(Boolean).join(' ')
    if (address.apartment) {
      parts.push(`${street}, app. ${address.apartment}`)
    } else {
      parts.push(street)
    }
  }

  if (address.city) {
    const cityLine = [address.city, address.province, address.postalCode].filter(Boolean).join(', ')
    parts.push(cityLine)
  }

  return parts.join('<br>') || 'N/A'
}

function formatCents(cents: number | null): string {
  if (cents === null) return '-'
  return `${(cents / 100).toFixed(0)}$`
}

function formatPortion(min: number | null, max: number | null): string {
  if (min === null || max === null) return ''
  return `(${(min / 100).toFixed(0)}$-${(max / 100).toFixed(0)}$)`
}

function getProfessionLabel(professions: ProfessionalSnapshot['professions']): string {
  if (!professions.length) return 'professionnel(le) de la santé'
  return professions.map((p) => p.titleLabel || p.categoryLabel).join(' et ')
}

// DocuSeal field tags are embedded in the signature section HTML.
// The Edge Function sends this to /submissions/html which parses the tags.
// Initials are added via html_header to appear on every page.

// =============================================================================
// STYLES
// =============================================================================

const STYLES = `
<style>
  @page {
    size: letter;
    margin: 2.5cm 2cm;
  }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #000;
    margin: 0;
    padding: 0;
  }

  .page-break {
    page-break-before: always;
  }

  .header {
    text-align: center;
    margin-bottom: 30px;
  }

  .header h1 {
    font-size: 16pt;
    font-weight: bold;
    text-transform: uppercase;
    margin: 0;
  }

  .parties-section {
    margin-bottom: 25px;
  }

  .party-block {
    margin-bottom: 20px;
  }

  .party-label {
    font-weight: bold;
    margin-bottom: 10px;
  }

  .party-info {
    margin-left: 20px;
  }

  .party-info p {
    margin: 5px 0;
  }

  .designation {
    font-style: italic;
    margin-top: 10px;
  }

  .attendu {
    margin: 25px 0;
    font-style: italic;
  }

  .consequence {
    font-weight: bold;
    text-align: center;
    margin: 30px 0;
    text-transform: uppercase;
  }

  .clause {
    margin-bottom: 20px;
  }

  .clause-title {
    font-weight: bold;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .clause-content {
    margin-left: 0;
  }

  .clause-content p {
    margin: 8px 0;
    text-align: justify;
  }

  .clause-content .sub-item {
    margin-left: 20px;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 15px 0;
    font-size: 10pt;
  }

  th, td {
    border: 1px solid #000;
    padding: 8px 10px;
    text-align: left;
  }

  th {
    background-color: #f5f5f5;
    font-weight: bold;
  }

  .table-payment-terms {
    margin: 15px 0;
  }

  /* Signature section */
  .signature-section {
    margin-top: 40px;
  }

  .signature-header {
    font-weight: bold;
    margin-bottom: 30px;
  }

  .signature-grid {
    display: flex;
    justify-content: space-between;
    margin-top: 30px;
  }

  .signature-block {
    width: 45%;
  }

  .signature-field {
    border-bottom: 1px solid #000;
    height: 60px;
    margin-bottom: 5px;
  }

  .signature-label {
    font-size: 10pt;
    color: #666;
  }

  .date-city-line {
    display: flex;
    gap: 40px;
    margin-bottom: 30px;
  }

  .date-field, .city-field {
    flex: 1;
  }

  .field-line {
    border-bottom: 1px solid #000;
    min-width: 200px;
    display: inline-block;
  }

  /* Annexe A */
  .annexe-header {
    text-align: center;
    margin-bottom: 30px;
  }

  .annexe-header h2 {
    font-size: 14pt;
    margin: 0 0 5px 0;
  }

  .annexe-header h3 {
    font-size: 12pt;
    font-weight: normal;
    text-transform: uppercase;
    margin: 0;
  }

  .pricing-table th,
  .pricing-table td {
    text-align: center;
    font-size: 9pt;
  }

  .pricing-table th:first-child,
  .pricing-table td:first-child {
    text-align: left;
  }

  .portion-text {
    font-size: 8pt;
    color: #666;
  }

  /* Footer with initials - runs on every page */
  @page {
    @bottom-right {
      content: element(page-initials);
    }
  }

  .page-initials-container {
    position: running(page-initials);
    text-align: right;
    font-size: 9pt;
  }

  /* Single initials field container - placed once in document */
  .initials-field-container {
    margin: 20px 0;
    text-align: right;
    page-break-inside: avoid;
  }

  /* DocuSeal field markers - these are recognized by DocuSeal */
  .docuseal-field {
    display: inline-block;
    min-width: 150px;
    min-height: 30px;
    border-bottom: 1px solid #ccc;
    background-color: #fffde7;
  }

  .docuseal-signature {
    display: block;
    width: 200px;
    height: 60px;
    border: 1px dashed #999;
    background-color: #fffde7;
  }

  .docuseal-initials {
    display: inline-block;
    width: 60px;
    height: 30px;
    border: 1px dashed #999;
    background-color: #fffde7;
  }
</style>
`

// =============================================================================
// TEMPLATE SECTIONS
// =============================================================================

function renderHeader(): string {
  return `
    <div class="header">
      <h1>Convention de prestation de service</h1>
    </div>
  `
}

function renderParties(professional: ProfessionalSnapshot): string {
  return `
    <div class="parties-section">
      <div class="party-block">
        <div class="party-label">ENTRE :</div>
        <div class="party-info">
          <p><strong>${CLINIC_INFO.name}</strong>, ${CLINIC_INFO.legalForm}, représentée aux présentes par ${CLINIC_INFO.representative}, ${CLINIC_INFO.representativeTitle},</p>
          <p>Ayant son siège social au : ${CLINIC_INFO.address}</p>
          <p class="designation">(ci-après désignée comme « Clinique MANA »)</p>
        </div>
      </div>

      <div class="party-block">
        <div class="party-label">ET</div>
        <div class="party-info">
          <p><strong>Nom :</strong> ${professional.displayName}</p>
          <p><strong>Adresse :</strong> ${formatAddress(professional.address)}</p>
          <p><strong>Téléphone :</strong> ${formatPhoneForDisplay(professional.phoneNumber) || 'N/A'}</p>
          <p class="designation">(ci-après désigné(e) comme le « Professionnel »)</p>
        </div>
      </div>
    </div>
  `
}

function renderAttendu(professionLabel: string): string {
  return `
    <div class="attendu">
      <p>${ATTENDU_CLAUSE(professionLabel)}</p>
    </div>
    <div class="consequence">
      <p>${CONSEQUENCE_HEADER}</p>
    </div>
  `
}

function renderClause(clause: typeof CONTRACT_CLAUSES[0]): string {
  const contentHtml = clause.content
    .map((item) => {
      // Special handling for the payment terms table placeholder
      if (item === 'TABLE_PAYMENT_TERMS') {
        return renderPaymentTermsTable()
      }

      // Check if it's a sub-item (starts with a number followed by a decimal)
      const isSubItem = /^\d+\.\d+\.\d+/.test(item)
      return `<p class="${isSubItem ? 'sub-item' : ''}">${item}</p>`
    })
    .join('')

  return `
    <div class="clause">
      <div class="clause-title">${clause.number}. ${clause.title}</div>
      <div class="clause-content">
        ${contentHtml}
      </div>
    </div>
  `
}

function renderPaymentTermsTable(): string {
  const rows = PAYMENT_TERMS_TABLE.map(
    (row) => `
      <tr>
        <td>${row.service}</td>
        <td style="text-align: center;">${row.percent}</td>
      </tr>
    `
  ).join('')

  return `
    <table class="table-payment-terms">
      <thead>
        <tr>
          <th>Type de service</th>
          <th style="width: 100px;">Pourcentage</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `
}

function renderSignatureSection(professionalName: string): string {
  // DocuSeal field tags: text-field, signature-field, date-field
  // role="First Party" must match the submitter role in the API call
  const today = new Date().toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return `
    <div class="signature-section">
      <div class="signature-header">EN FOI DE QUOI, LES PARTIES ONT SIGNÉ :</div>

      <div class="date-city-line">
        <div class="city-field">
          <span>À </span>
          <text-field name="city" role="First Party" required="true"
            style="width: 150px; height: 24px; display: inline-block; border-bottom: 1px solid #000;">
          </text-field>
        </div>
      </div>

      <div class="signature-grid">
        <div class="signature-block">
          <signature-field name="professional_signature" role="First Party" required="true"
            style="width: 200px; height: 60px; display: inline-block;">
          </signature-field>
          <div class="signature-label">${professionalName}</div>
          <div style="margin-top: 5px;">
            <span style="font-size: 9pt;">Date: </span>
            <date-field name="date_professionnel" role="First Party" required="true"
              style="width: 100px; height: 20px; display: inline-block;">
            </date-field>
          </div>
        </div>
        <div class="signature-block">
          <!-- Christine's signature is static (pre-signed by clinic) -->
          <div style="font-family: 'Brush Script MT', 'Segoe Script', cursive;
                      font-size: 20pt; color: #1a237e; padding: 10px 0;">
            Christine Sirois
          </div>
          <div class="signature-label">Christine Sirois, Clinique MANA inc.</div>
          <div style="margin-top: 5px;">
            <span style="font-size: 9pt;">Date: ${today}</span>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderAnnexeA(pricing: PricingSnapshot): string {
  const pricingRows = pricing.rows
    .map((row) => {
      const d60 = row.duration60Couple
        ? `${formatCents(row.duration60Couple)} <span class="portion-text">${formatPortion(row.profPortion60Min, row.profPortion60Max)}</span>`
        : '-'
      const d50 = row.duration50
        ? `${formatCents(row.duration50)} <span class="portion-text">${formatPortion(row.profPortion50Min, row.profPortion50Max)}</span>`
        : '-'
      const d30 = row.duration30
        ? `${formatCents(row.duration30)} <span class="portion-text">${formatPortion(row.profPortion30Min, row.profPortion30Max)}</span>`
        : '-'
      const evalInit = row.evaluationInitiale
        ? `${formatCents(row.evaluationInitiale)} <span class="portion-text">${formatPortion(row.profPortionEvalMin, row.profPortionEvalMax)}</span>`
        : '-'

      return `
        <tr>
          <td>${row.categoryLabel}</td>
          <td>${d60}</td>
          <td>${d50}</td>
          <td>${d30}</td>
          <td>${evalInit}</td>
        </tr>
      `
    })
    .join('')

  const autresFraisRows = DEFAULT_AUTRES_FRAIS.map(
    (row) => `
      <tr>
        <td>${row.description}</td>
        <td style="text-align: center;">${row.fraisFixe}</td>
        <td style="text-align: center;">${row.fraisVariable}</td>
      </tr>
    `
  ).join('')

  return `
    <div class="page-break"></div>
    <div class="annexe-header">
      <h2>Annexe A</h2>
      <h3>Honoraires et autres frais</h3>
    </div>

    <table class="pricing-table">
      <thead>
        <tr>
          <th>Type de services</th>
          <th>Rencontre 60 min couple</th>
          <th>Rencontre 50 min.</th>
          <th>Rencontre 30 min</th>
          <th>Évaluation initiale</th>
        </tr>
      </thead>
      <tbody>
        ${pricingRows}
      </tbody>
    </table>

    <p style="font-size: 9pt; color: #666; margin-top: 10px;">
      * Les montants entre parenthèses représentent la portion du professionnel (${100 - pricing.marginMaxPercent}% à ${100 - pricing.marginMinPercent}% des honoraires)<br>
      ** Les montants incluent les taxes si applicables
    </p>

    <h4 style="margin-top: 30px;">Autres frais</h4>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="width: 100px;">Frais fixe</th>
          <th style="width: 150px;">Frais variable</th>
        </tr>
      </thead>
      <tbody>
        ${autresFraisRows}
      </tbody>
    </table>

  `
}

// =============================================================================
// MAIN TEMPLATE GENERATOR
// =============================================================================

export interface ContractHtmlData {
  professional: ProfessionalSnapshot
  pricing: PricingSnapshot
  generatedAt: string
}

/**
 * Result of generating contract HTML - split into two documents
 * to allow different footer behavior (initials on body, no initials on signature)
 */
export interface ContractHtmlParts {
  /** Main contract body (header, parties, clauses) - will have initials footer */
  bodyHtml: string
  /** Signature section + Annexe A - NO initials footer */
  signatureHtml: string
}

/**
 * @deprecated Use generateContractHtml instead - keeping as single document
 */
export function generateContractHtmlParts(data: ContractHtmlData): ContractHtmlParts {
  // Now just wraps the single document approach
  const html = generateContractHtml(data)
  return { bodyHtml: html, signatureHtml: '' }
}

/**
 * Legacy function - generates complete HTML as single document
 * @deprecated Use generateContractHtmlParts for proper footer handling
 */
export function generateContractHtml(data: ContractHtmlData): string {
  const { professional, pricing } = data
  const professionLabel = getProfessionLabel(professional.professions)

  // Render all clauses
  const clausesHtml = CONTRACT_CLAUSES.map(renderClause).join('')

  // Document structure:
  // 1. Header + Parties + Clauses
  // 2. Signature section (with DocuSeal field tags: city, signature, date)
  // 3. Annexe A
  // Initials are added via html_header in the Edge Function to appear on all pages

  return `
<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convention de prestation de service - ${professional.displayName}</title>
  ${STYLES}
</head>
<body>
  ${renderHeader()}
  ${renderParties(professional)}
  ${renderAttendu(professionLabel)}
  ${clausesHtml}
  ${renderSignatureSection(professional.displayName)}
  ${renderAnnexeA(pricing)}
</body>
</html>
  `.trim()
}

export default generateContractHtml
