import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import { hyphenateSync } from 'hyphen/fr'

// Register proper French hyphenation - required for text justification to work in react-pdf
Font.registerHyphenationCallback((word) => {
  const hyphenated = hyphenateSync(word)
  return hyphenated.split('\u00AD')
})

// =============================================================================
// TYPES
// =============================================================================

export interface MotifGroup {
  categoryLabel: string
  motifs: string[]
}

export interface FichePdfData {
  displayName: string
  professionTitle: string
  licenseNumber: string
  photoBase64?: string
  initials: string
  bio?: string
  approach?: string
  motifGroups: MotifGroup[]
  clientele: string[]
  honoraires: Array<{
    priceCents: number
    durationMinutes: number
  }>
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CLINIC_ABOUT = `MANA est un centre de consultation multidisciplinaire en santé mentale qui propose une alternative aux employeurs, aux familles et aux individus. Spécialisé en téléconsultation, notre environnement est flexible, accessible et sans délai interminable.`

const CLINIC_CONTACT_URL = 'cliniquemana.com'
const CLINIC_CONTACT_PHONE = '418 907-9754'

// Design tokens
const BRAND_COLOR = '#7B2D3E'
const TEXT_COLOR = '#333333'
const TEXT_MUTED = '#666666'
const SIDEBAR_BG = '#F5F3F1'
const TAG_BG = '#F0EDEB'
const BORDER_COLOR = '#E5E2DF'

// Layout
const SIDEBAR_WIDTH = '32%'
const MAIN_WIDTH = '68%'

// =============================================================================
// STYLES - Two-column sidebar layout
// =============================================================================

const styles = StyleSheet.create({
  page: {
    flexDirection: 'row',
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TEXT_COLOR,
    backgroundColor: '#FFFFFF',
  },

  // ===== LEFT SIDEBAR =====
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: SIDEBAR_BG,
    paddingVertical: 25,
    paddingHorizontal: 18,
    justifyContent: 'space-between',
  },
  sidebarTop: {
    alignItems: 'center',
  },
  sidebarMiddle: {
    marginTop: 20,
  },
  sidebarBottom: {
    marginTop: 'auto',
  },

  // Logo in sidebar
  logoText: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_COLOR,
    textAlign: 'center',
    letterSpacing: 1,
  },
  logoTagline: {
    fontSize: 6,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 15,
  },

  // Profile photo (circular)
  photoWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    marginBottom: 12,
  },
  photo: {
    width: 120,
    height: 120,
    objectFit: 'cover',
  },
  initialsPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E8E4E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_COLOR,
  },

  // Sidebar sections
  sidebarSection: {
    marginBottom: 20,
  },
  sidebarSectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_COLOR,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sidebarText: {
    fontSize: 8.5,
    color: TEXT_COLOR,
    lineHeight: 1.5,
  },
  sidebarTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sidebarTag: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 4,
    marginBottom: 4,
  },
  sidebarTagText: {
    fontSize: 7.5,
    color: TEXT_COLOR,
  },

  // About section in sidebar
  aboutSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER_COLOR,
  },
  aboutTitle: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: TEXT_MUTED,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  aboutText: {
    fontSize: 6.5,
    lineHeight: 1.35,
    color: TEXT_MUTED,
    textAlign: 'justify',
  },

  // Contact in sidebar
  contactSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: BORDER_COLOR,
  },
  contactText: {
    fontSize: 7,
    color: BRAND_COLOR,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 2,
  },

  // ===== MAIN CONTENT AREA =====
  main: {
    width: MAIN_WIDTH,
    padding: 25,
    paddingLeft: 22,
  },

  // Header in main
  mainHeader: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
  },
  professionTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_COLOR,
    marginBottom: 6,
  },
  nameCredentials: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: TEXT_COLOR,
    marginBottom: 2,
  },
  licenseInfo: {
    fontSize: 8,
    color: TEXT_MUTED,
  },

  // Bio section
  bioSection: {
    marginBottom: 12,
  },
  bioText: {
    fontSize: 8.5,
    lineHeight: 1.5,
    marginBottom: 6,
    textAlign: 'justify',
    color: TEXT_COLOR,
  },

  // Motifs section - compact tags
  motifsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_COLOR,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  motifsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  motifTag: {
    backgroundColor: TAG_BG,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 5,
    marginRight: 3,
    marginBottom: 3,
  },
  motifTagText: {
    fontSize: 6.5,
    color: TEXT_COLOR,
  },
  motifCategoryGroup: {
    marginBottom: 5,
  },
  motifCategoryLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: TEXT_MUTED,
    marginBottom: 2,
  },
})

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatPrice(priceCents: number): string {
  return `${Math.round(priceCents / 100)}$`
}

function formatHonoraires(honoraires: FichePdfData['honoraires']): string {
  if (!honoraires || honoraires.length === 0) {
    return 'À confirmer'
  }
  const sorted = [...honoraires].sort((a, b) => b.durationMinutes - a.durationMinutes)
  return sorted
    .map(h => `${formatPrice(h.priceCents)}/${h.durationMinutes} min`)
    .join('\n')
}

function normalizeParagraphs(text?: string): string[] {
  if (!text) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return []
  return normalized
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
}

// =============================================================================
// PDF DOCUMENT COMPONENT
// =============================================================================

interface FichePdfDocumentProps {
  data: FichePdfData
  logoBase64?: string
}

export function FichePdfDocument({ data, logoBase64 }: FichePdfDocumentProps) {
  const bioParagraphs = normalizeParagraphs(data.bio)
  const approachParagraphs = normalizeParagraphs(data.approach)
  const allParagraphs = [...bioParagraphs, ...approachParagraphs]

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ===== LEFT SIDEBAR ===== */}
        <View style={styles.sidebar}>
          <View style={styles.sidebarTop}>
            {/* Logo */}
            {logoBase64 ? (
              <Image src={logoBase64} style={{ width: 70, height: 'auto', marginBottom: 2 }} />
            ) : (
              <Text style={styles.logoText}>MANA</Text>
            )}
            <Text style={styles.logoTagline}>Ressources en santé mentale et bien-être</Text>

            {/* Profile Photo (Circular) */}
            {data.photoBase64 ? (
              <View style={styles.photoWrapper}>
                <Image src={data.photoBase64} style={styles.photo} />
              </View>
            ) : (
              <View style={styles.initialsPlaceholder}>
                <Text style={styles.initialsText}>{data.initials}</Text>
              </View>
            )}
          </View>

          {/* Middle: Clientèle & Honoraires */}
          <View style={styles.sidebarMiddle}>
            <View style={styles.sidebarSection}>
              <Text style={styles.sidebarSectionTitle}>Clientèle</Text>
              {data.clientele && data.clientele.length > 0 ? (
                <View style={styles.sidebarTagsContainer}>
                  {data.clientele.map((item, index) => (
                    <View key={index} style={styles.sidebarTag}>
                      <Text style={styles.sidebarTagText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sidebarText}>Tous types de clientèles</Text>
              )}
            </View>

            <View style={styles.sidebarSection}>
              <Text style={styles.sidebarSectionTitle}>Honoraires</Text>
              <Text style={styles.sidebarText}>{formatHonoraires(data.honoraires)}</Text>
            </View>
          </View>

          {/* Bottom: About & Contact */}
          <View style={styles.sidebarBottom}>
            <View style={styles.aboutSection}>
              <Text style={styles.aboutTitle}>À propos de Clinique MANA</Text>
              <Text style={styles.aboutText}>{CLINIC_ABOUT}</Text>
            </View>

            <View style={styles.contactSection}>
              <Text style={styles.contactText}>{CLINIC_CONTACT_URL}</Text>
              <Text style={styles.contactText}>{CLINIC_CONTACT_PHONE}</Text>
            </View>
          </View>
        </View>

        {/* ===== MAIN CONTENT AREA ===== */}
        <View style={styles.main}>
          {/* Header */}
          <View style={styles.mainHeader}>
            <Text style={styles.professionTitle}>{data.professionTitle}</Text>
            <Text style={styles.nameCredentials}>
              {data.displayName}, {data.professionTitle.toLowerCase()}
            </Text>
            <Text style={styles.licenseInfo}>Permis : {data.licenseNumber}</Text>
          </View>

          {/* Biography */}
          <View style={styles.bioSection}>
            {allParagraphs.length > 0 ? (
              allParagraphs.map((paragraph, index) => (
                <Text key={index} style={styles.bioText}>
                  {paragraph}
                </Text>
              ))
            ) : (
              <Text style={styles.bioText}>Information à venir.</Text>
            )}
          </View>

          {/* Motifs de consultation - Grouped by Category */}
          {data.motifGroups.length > 0 && (
            <View style={styles.motifsSection}>
              <Text style={styles.sectionTitle}>Motifs de consultation</Text>
              {data.motifGroups.map((group, groupIndex) => (
                <View key={groupIndex} style={styles.motifCategoryGroup}>
                  <Text style={styles.motifCategoryLabel}>{group.categoryLabel}</Text>
                  <View style={styles.motifsContainer}>
                    {group.motifs.map((motif, motifIndex) => (
                      <View key={motifIndex} style={styles.motifTag}>
                        <Text style={styles.motifTagText}>{motif}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </Page>
    </Document>
  )
}
