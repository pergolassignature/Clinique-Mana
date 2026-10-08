import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import { t } from '@/i18n'
import type { FicheContent, FicheItem, FicheMotifGroup } from './fiche-content'
import { FICHE_FONT_FAMILY } from './fonts'

/**
 * The fiche (Task 4c.5, A2.19), one Letter page or more, laid out like PS Hub's react-pdf pages:
 * - the clinic band: logo (or the clinic's name) and its contact details, a hairline under it;
 * - who: photo slot (4c; no box without a photo, P4-202), name, title, order and licence, public
 *   contact;
 * - the facts in one bordered row: Clientèles (★ first), Approches thérapeutiques, Langues,
 *   Honoraires (« À confirmer » until Services et tarifs, P4-204);
 * - Présentation and Approche, then the motifs by category (P4-201): each category's name on its
 *   own line, then « Tous » or its names (in three columns when more than three), two short
 *   categories to a row, a row never split across pages;
 * - a footer on every page: the clinic, the date the fiche was made, « Page 1 de 2 ».
 * Colours are the design system's: ink text, grey secondary, hairline borders, teal for the
 * title and the ★ only.
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
/** Columns the motif names of one category spread over; up to this many names stay on one line. */
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
  rule: { borderBottomWidth: 1, borderBottomColor: COLOR.border, marginTop: 14, marginBottom: 24 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  photo: { width: 76, height: 76, borderRadius: 38, objectFit: 'cover' },
  name: { fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
  title: { fontSize: 12.5, fontWeight: 600, color: COLOR.teal, marginTop: 4 },
  detail: { fontSize: 9, color: COLOR.secondary, marginTop: 3 },
  facts: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLOR.border,
    borderRadius: 6,
  },
  // The lists get the room (an approach such as « cognitivo-comportementale » never breaks); the
  // short columns, less.
  factWide: { flex: 1.35 },
  factNarrow: { flex: 0.8 },
  overline: { fontSize: 7.5, fontWeight: 600, color: COLOR.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  factLine: { fontSize: 9.5, lineHeight: 1.4 },
  // Every item of a list with a ★ keeps the same gutter, so the names line up and wrap within the column.
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  gutter: { width: 10, paddingTop: 3 },
  itemText: { flex: 1, fontSize: 9.5, lineHeight: 1.4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  legendText: { fontSize: 8, color: COLOR.muted },
  section: { marginTop: 22 },
  sectionTitle: { fontSize: 11.5, fontWeight: 600, marginBottom: 6 },
  // A lineHeight needs its fontSize on the same style: react-pdf would scale an inherited one from 18.
  paragraph: { fontSize: 10, lineHeight: 1.45, marginBottom: 6 },
  categoryRow: { flexDirection: 'row', gap: 24, paddingTop: 7, paddingBottom: 7, borderTopWidth: 1, borderTopColor: COLOR.borderLight },
  category: { flex: 1 },
  categoryName: { fontSize: 9.5, fontWeight: 600 },
  categorySummary: { fontSize: 9, color: COLOR.secondary, marginTop: 1 },
  columns: { flexDirection: 'row', gap: 12, marginTop: 2 },
  column: { flex: 1 },
  motif: { fontSize: 9, lineHeight: 1.4 },
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

function LinesFact({ label, lines }: { label: string; lines: readonly string[] }) {
  return (
    <View style={styles.factNarrow}>
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

/** « Tous » or up to three names: a short category, laid out two to a row. */
const isShort = (group: FicheMotifGroup) => group.all || group.names.length <= MOTIF_COLUMNS

/**
 * The categories in rows, in the catalogue's order: two short ones side by side, a category with
 * more names alone across the page (its names in columns). Halves the height when most read
 * « Tous » (72 motifs: four rows).
 */
function motifRows(groups: readonly FicheMotifGroup[]): FicheMotifGroup[][] {
  const rows: FicheMotifGroup[][] = []
  for (const group of groups) {
    const last = rows.at(-1)
    if (isShort(group) && last?.length === 1 && last[0] && isShort(last[0])) last.push(group)
    else rows.push([group])
  }
  return rows
}

function MotifCategory({ group }: { group: FicheMotifGroup }) {
  return (
    <View style={styles.category}>
      <Text style={styles.categoryName}>{group.name}</Text>
      {group.all ? (
        <Text style={styles.categorySummary}>{t(`${F}.all`)}</Text>
      ) : isShort(group) ? (
        <Text style={styles.categorySummary}>{group.names.join(' · ')}</Text>
      ) : (
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
      )}
    </View>
  )
}

export function FicheDocument({ content }: { content: FicheContent }) {
  const { clinic } = content
  const starred = [...content.clienteles, ...content.approaches].some((item) => item.specialized)
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
            {content.clienteles.length > 0 && <ItemsFact label={t(`${F}.clienteles`)} items={content.clienteles} />}
            {content.approaches.length > 0 && <ItemsFact label={t(`${F}.approaches`)} items={content.approaches} />}
            {content.languages.length > 0 && <LinesFact label={t(`${F}.languages`)} lines={content.languages} />}
            <LinesFact label={t(`${F}.fees`)} lines={content.fees ?? [t(`${F}.feesPending`)]} />
          </View>
          {starred && (
            <View style={styles.legend}>
              <Star />
              <Text style={styles.legendText}>{t(`${F}.specialized`)}</Text>
            </View>
          )}
        </View>

        {content.presentation.length > 0 && <TextSection title={t(`${F}.presentation`)} paragraphs={content.presentation} />}
        {content.approach.length > 0 && <TextSection title={t(`${F}.approach`)} paragraphs={content.approach} />}

        {content.motifs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={48}>
              {t(`${F}.motifs`)}
            </Text>
            {motifRows(content.motifs).map((row) => (
              // A row is never split across pages: a category's name always heads its names.
              <View key={row.map((group) => group.name).join('|')} style={styles.categoryRow} wrap={false}>
                {row.map((group) => (
                  <MotifCategory key={group.name} group={group} />
                ))}
                {/* A short category alone keeps half the width, like its neighbours above. */}
                {row.length === 1 && row[0] && isShort(row[0]) && <View style={styles.category} />}
              </View>
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
