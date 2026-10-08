import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import { t } from '@/i18n'
import type { FicheContent, FicheItem, FicheMotifGroup } from './fiche-content'
import { FICHE_FONT_FAMILY } from './fonts'

/**
 * The fiche (Task 4c.5, A2.19): the clinic's public profile of a professional (P4-212, the
 * site's content in its order), on one Letter page or more, laid out like PS Hub's react-pdf pages:
 * - the clinic band: logo (or the clinic's name) and its contact details, a hairline under it;
 * - who: photo slot (4c; no box without a photo, P4-202), name, title in teal, « Membre de l’OPQ ·
 *   N° de permis … », public contact;
 * - the facts in one bordered row, the site's order: Langues, Honoraires (« À confirmer » until a
 *   price grid exists, P4-204), Clientèle (★ first, P4-201);
 * - « À propos » (presentation, then approach);
 * - « Motifs de consultation »: each category's name in bold on its own line, then every motif
 *   held in it, by name, down three columns (P4-211); a category is never split across pages, so
 *   a name never ends a page alone;
 * - a footer on every page: the clinic, the date the fiche was made, « Page 1 de 2 ».
 * Colours are the design system's: ink text, grey secondary, hairline borders, teal for the title
 * and the ★ only.
 */

const COLOR = {
  ink: '#1F1F20',
  secondary: '#6B6B6E',
  muted: '#8E8E92',
  border: '#E4E4E7',
  borderLight: '#EFEFF1',
  teal: '#1E837C',
} as const

const F = 'modules.professionals.fiche.pdf'
/** Columns the motif names of one category run down. */
const MOTIF_COLUMNS = 3

const styles = StyleSheet.create({
  page: {
    fontFamily: FICHE_FONT_FAMILY,
    // No lineHeight here: inherited by the absolute footer, react-pdf places it off the page.
    fontSize: 10,
    color: COLOR.ink,
    paddingTop: 40,
    paddingBottom: 64,
    paddingHorizontal: 48,
  },
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 24 },
  logo: { maxHeight: 40, maxWidth: 180, objectFit: 'contain' },
  clinicName: { fontSize: 14, fontWeight: 700 },
  clinicContact: { fontSize: 8.5, color: COLOR.secondary, textAlign: 'right', lineHeight: 1.4 },
  rule: { borderBottomWidth: 1, borderBottomColor: COLOR.border, marginTop: 14, marginBottom: 26 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  photo: { width: 76, height: 76, borderRadius: 38, objectFit: 'cover' },
  name: { fontSize: 24, fontWeight: 700, lineHeight: 1.2 },
  title: { fontSize: 13, fontWeight: 600, color: COLOR.teal, marginTop: 4 },
  detail: { fontSize: 9.5, color: COLOR.secondary, marginTop: 4 },
  facts: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLOR.border,
    borderRadius: 6,
  },
  // Clientèle gets the room (« Adultes (18 à 64 ans) »); languages and fees are short.
  factNarrow: { flex: 0.8 },
  factMedium: { flex: 1 },
  factWide: { flex: 1.5 },
  overline: { fontSize: 7.5, fontWeight: 600, color: COLOR.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  factLine: { fontSize: 9.5, lineHeight: 1.45 },
  // Every item of a list with a ★ keeps the same gutter, so the names line up and wrap within the column.
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  gutter: { width: 10, paddingTop: 3.5 },
  itemText: { flex: 1, fontSize: 9.5, lineHeight: 1.45 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  legendText: { fontSize: 8, color: COLOR.muted },
  section: { marginTop: 26 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    paddingBottom: 6,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.borderLight,
  },
  // A lineHeight needs its fontSize on the same style: react-pdf would scale an inherited one from 18.
  paragraph: { fontSize: 10, lineHeight: 1.55, marginBottom: 7 },
  category: { marginBottom: 12 },
  categoryName: { fontSize: 9.5, fontWeight: 700, marginBottom: 3 },
  columns: { flexDirection: 'row', gap: 16 },
  column: { flex: 1 },
  motif: { fontSize: 9, lineHeight: 1.45, color: COLOR.ink },
  footer: {
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLOR.borderLight,
    fontSize: 8,
    color: COLOR.muted,
  },
})

function Star() {
  return (
    <Svg viewBox="0 0 24 24" width={7} height={7}>
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill={COLOR.teal} />
    </Svg>
  )
}

function ItemsFact({ label, items }: { label: string; items: readonly FicheItem[] }) {
  const starred = items.some((item) => item.specialized)
  return (
    <View style={styles.factWide}>
      <Text style={styles.overline}>{label}</Text>
      {items.map((item) =>
        starred ? (
          <View key={item.label} style={styles.item}>
            <View style={styles.gutter}>{item.specialized && <Star />}</View>
            <Text style={styles.itemText}>{item.label}</Text>
          </View>
        ) : (
          <Text key={item.label} style={styles.factLine}>
            {item.label}
          </Text>
        ),
      )}
    </View>
  )
}

function LinesFact({ label, lines, wide = false }: { label: string; lines: readonly string[]; wide?: boolean }) {
  return (
    <View style={wide ? styles.factMedium : styles.factNarrow}>
      <Text style={styles.overline}>{label}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.factLine}>
          {line}
        </Text>
      ))}
    </View>
  )
}

function TextSection({ title, paragraphs }: { title: string; paragraphs: readonly string[] }) {
  return (
    <View style={styles.section}>
      {/* The title never ends a page alone: some text follows it. */}
      <Text style={styles.sectionTitle} minPresenceAhead={36}>
        {title}
      </Text>
      {paragraphs.map((paragraph, i) => (
        <Text key={i} style={styles.paragraph}>
          {paragraph}
        </Text>
      ))}
    </View>
  )
}

/** Names down `MOTIF_COLUMNS` columns, read top to bottom, then left to right. */
function inColumns(names: readonly string[]): string[][] {
  const perColumn = Math.ceil(names.length / MOTIF_COLUMNS)
  return Array.from({ length: MOTIF_COLUMNS }, (_, c) => names.slice(c * perColumn, (c + 1) * perColumn))
}

function MotifCategory({ group }: { group: FicheMotifGroup }) {
  return (
    // Never split across pages: the category's name always heads its motifs.
    <View style={styles.category} wrap={false}>
      <Text style={styles.categoryName}>{group.name}</Text>
      <View style={styles.columns}>
        {inColumns(group.names).map((column, c) => (
          <View key={c} style={styles.column}>
            {column.map((name) => (
              <Text key={name} style={styles.motif}>
                {name}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

export function FicheDocument({ content }: { content: FicheContent }) {
  const { clinic } = content
  const starred = content.clienteles.some((item) => item.specialized)
  return (
    <Document title={t(`${F}.documentTitle`, { name: content.name })} author={clinic.name} creator={clinic.name} producer={clinic.name} language="fr-CA">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.band}>
          {clinic.logo ? <Image src={clinic.logo} style={styles.logo} /> : <Text style={styles.clinicName}>{clinic.name}</Text>}
          {clinic.contact.length > 0 && (
            <View>
              {clinic.contact.map((line) => (
                <Text key={line} style={styles.clinicContact}>
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>
        <View style={styles.rule} />

        <View style={styles.who}>
          {content.photo && <Image src={content.photo} style={styles.photo} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{content.name}</Text>
            {content.title && <Text style={styles.title}>{content.title}</Text>}
            {content.credential && <Text style={styles.detail}>{content.credential}</Text>}
            {content.publicContact && <Text style={styles.detail}>{content.publicContact}</Text>}
          </View>
        </View>

        <View wrap={false}>
          <View style={styles.facts}>
            {content.languages.length > 0 && <LinesFact label={t(`${F}.languages`)} lines={content.languages} />}
            <LinesFact label={t(`${F}.fees`)} lines={content.fees ?? [t(`${F}.feesPending`)]} wide />
            {content.clienteles.length > 0 && <ItemsFact label={t(`${F}.clienteles`)} items={content.clienteles} />}
          </View>
          {starred && (
            <View style={styles.legend}>
              <Star />
              <Text style={styles.legendText}>{t(`${F}.specialized`)}</Text>
            </View>
          )}
        </View>

        {content.about.length > 0 && <TextSection title={t(`${F}.about`)} paragraphs={content.about} />}

        {content.motifs.length > 0 && (
          <View style={styles.section}>
            {/* The title never ends a page alone: the first category follows it. */}
            <Text style={styles.sectionTitle} minPresenceAhead={60}>
              {t(`${F}.motifs`)}
            </Text>
            {content.motifs.map((group) => (
              <MotifCategory key={group.name} group={group} />
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{[clinic.name, clinic.website].filter(Boolean).join(' · ')}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              t(`${F}.footer`, { date: content.generatedOn, page: String(pageNumber), total: String(totalPages) })
            }
          />
        </View>
      </Page>
    </Document>
  )
}
