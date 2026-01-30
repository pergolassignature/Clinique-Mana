import { supabase } from '@/lib/supabaseClient'
import type { ProfessionalWithRelations, ProfessionalProfession } from '../types'
import type { FichePdfData, MotifGroup } from '../components/fiche-pdf-document'

// =============================================================================
// TYPES
// =============================================================================

export interface FicheDataParams {
  professional: ProfessionalWithRelations
  professionTitleKey: string
}

export interface ServicePriceForFiche {
  priceCents: number
  durationMinutes: number
}

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Fetch service prices for a professional's assigned services for a specific profession.
 * Returns prices filtered by the profession's category.
 */
export async function fetchProfessionalServicePrices(
  professionalId: string,
  professionTitleKey: string,
  professionCategoryKey: string
): Promise<ServicePriceForFiche[]> {
  // First, get the professional's assigned services for this profession title
  const { data: assignedServices, error: servicesError } = await supabase
    .from('professional_services')
    .select('service_id')
    .eq('professional_id', professionalId)
    .eq('profession_title_key', professionTitleKey)
    .eq('is_active', true)

  if (servicesError) throw servicesError

  if (!assignedServices || assignedServices.length === 0) {
    return []
  }

  const serviceIds = assignedServices.map(s => s.service_id)

  // Fetch prices for these services filtered by the profession category
  // Get both category-specific prices and global prices (for fixed-price services)
  const { data: prices, error: pricesError } = await supabase
    .from('service_prices')
    .select(`
      price_cents,
      duration_minutes,
      profession_category_key,
      service:services!inner(
        id,
        default_duration_minutes
      )
    `)
    .in('service_id', serviceIds)
    .eq('is_active', true)
    .or(`profession_category_key.eq.${professionCategoryKey},profession_category_key.is.null`)

  if (pricesError) throw pricesError

  // Map to FicheServicePrice format
  // Use duration_minutes from price if set, otherwise fall back to service default
  return (prices || []).map(p => {
    // Supabase !inner join returns a single object but typed as unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serviceData = p.service as any
    const defaultDuration = serviceData?.default_duration_minutes ?? 60
    return {
      priceCents: p.price_cents,
      durationMinutes: p.duration_minutes || defaultDuration,
    }
  })
}

/**
 * Fetch the professional's photo and convert it to base64 for PDF embedding.
 * Returns the base64 data URL of the verified photo, or undefined if not found.
 */
export async function fetchProfessionalPhotoBase64(
  professionalId: string
): Promise<string | undefined> {
  // Find the verified photo document (or any photo if none verified)
  const { data: photoDoc, error } = await supabase
    .from('professional_documents')
    .select('file_path')
    .eq('professional_id', professionalId)
    .eq('document_type', 'photo')
    .order('verified_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !photoDoc?.file_path) {
    return undefined
  }

  try {
    // Download the file from Supabase storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('professional-documents')
      .download(photoDoc.file_path)

    if (downloadError || !fileData) {
      console.warn('Failed to download photo:', downloadError)
      return undefined
    }

    // Convert blob to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(fileData)
    })
  } catch (err) {
    console.warn('Failed to convert photo to base64:', err)
    return undefined
  }
}

/**
 * Fetch motif categories from the database.
 */
export async function fetchMotifCategories(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('motif_categories')
    .select('id, label_fr')
    .eq('is_active', true)
    .order('display_order')

  if (error) {
    console.warn('Failed to fetch motif categories:', error)
    return new Map()
  }

  return new Map((data || []).map(cat => [cat.id, cat.label_fr]))
}

// =============================================================================
// DATA TRANSFORMATION
// =============================================================================

/**
 * Get initials from a display name.
 */
export function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * Get the profession for the fiche from the professional's professions array.
 */
export function getProfessionForFiche(
  professional: ProfessionalWithRelations,
  professionTitleKey: string
): ProfessionalProfession | undefined {
  return professional.professions?.find(p => p.profession_title_key === professionTitleKey)
}

/**
 * Get clientele specialties (category = 'clientele') from the professional.
 * Sorted by the database sort_order field.
 */
export function getClienteleFromSpecialties(
  professional: ProfessionalWithRelations
): string[] {
  return (professional.specialties || [])
    .filter(ps => ps.specialty?.category === 'clientele')
    .sort((a, b) => (a.specialty?.sort_order ?? 0) - (b.specialty?.sort_order ?? 0))
    .map(ps => ps.specialty?.name_fr || '')
    .filter(Boolean)
}

/**
 * Get motifs grouped by category from the professional.
 */
export function getMotifsGroupedByCategory(
  professional: ProfessionalWithRelations,
  categoryLabels: Map<string, string>
): MotifGroup[] {
  const motifs = professional.motifs || []

  // Group motifs by category_id
  const groupedMap = new Map<string | null, string[]>()

  for (const pm of motifs) {
    const motif = pm.motif
    if (!motif?.label) continue

    const categoryId = motif.category_id || null
    const existing = groupedMap.get(categoryId) || []
    existing.push(motif.label)
    groupedMap.set(categoryId, existing)
  }

  // Convert to MotifGroup array
  const groups: MotifGroup[] = []

  for (const [categoryId, labels] of groupedMap) {
    const categoryLabel = categoryId ? categoryLabels.get(categoryId) : null
    groups.push({
      categoryLabel: categoryLabel || 'Autres',
      motifs: labels,
    })
  }

  // Sort: named categories first, "Autres" last
  groups.sort((a, b) => {
    if (a.categoryLabel === 'Autres') return 1
    if (b.categoryLabel === 'Autres') return -1
    return a.categoryLabel.localeCompare(b.categoryLabel, 'fr')
  })

  return groups
}

/**
 * Get motifs labels from the professional (flat list for backwards compatibility).
 */
export function getMotifsLabels(
  professional: ProfessionalWithRelations
): string[] {
  return (professional.motifs || [])
    .map(pm => pm.motif?.label || '')
    .filter(Boolean)
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Prepare all data needed for generating a professional's fiche PDF.
 */
export async function prepareFicheData(
  params: FicheDataParams
): Promise<FichePdfData> {
  const { professional, professionTitleKey } = params

  // Get the specific profession
  const profession = getProfessionForFiche(professional, professionTitleKey)
  if (!profession) {
    throw new Error(`Profession ${professionTitleKey} not found for professional`)
  }

  // Get profession category key for price lookup
  const professionCategoryKey = profession.profession_title?.profession_category_key
  if (!professionCategoryKey) {
    throw new Error(`Profession category not found for ${professionTitleKey}`)
  }

  // Fetch prices, photo, and motif categories in parallel
  const [prices, photoBase64, motifCategories] = await Promise.all([
    fetchProfessionalServicePrices(
      professional.id,
      professionTitleKey,
      professionCategoryKey
    ),
    fetchProfessionalPhotoBase64(professional.id),
    fetchMotifCategories(),
  ])

  // Build the fiche data
  const displayName = professional.profile?.display_name || 'Professionnel'
  const professionTitle = profession.profession_title?.label_fr || professionTitleKey

  return {
    displayName,
    professionTitle,
    licenseNumber: profession.license_number || 'N/A',
    photoBase64,
    initials: getInitials(displayName),
    bio: professional.portrait_bio || undefined,
    approach: professional.portrait_approach || undefined,
    motifGroups: getMotifsGroupedByCategory(professional, motifCategories),
    clientele: getClienteleFromSpecialties(professional),
    honoraires: prices,
  }
}

// =============================================================================
// LOGO LOADING
// =============================================================================

/**
 * Load the MANA logo as base64 for embedding in PDF.
 * This fetches the logo from the assets folder.
 */
export async function loadLogoAsBase64(): Promise<string | undefined> {
  try {
    // Import the logo dynamically
    const logoModule = await import('@/assets/mana-logo-nouveau.png')
    const logoUrl = logoModule.default

    // If it's already a data URL or base64, return as-is
    if (logoUrl.startsWith('data:')) {
      return logoUrl
    }

    // Otherwise, fetch and convert to base64
    const response = await fetch(logoUrl)
    const blob = await response.blob()

    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.warn('Failed to load logo for PDF:', error)
    return undefined
  }
}
