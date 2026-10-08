import type { ReactNode } from 'react'
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import { t } from '@/i18n'
import { BRAND, MANA_LOGO_INK, MANA_WORDMARK } from './brand'
import type { FicheContent, FicheItem, FicheMotifGroup } from './fiche-content'
import { FICHE_FONT_FAMILY } from './fonts'

/**
 * The fiche (Task 4c.5, A2.19): the clinic's public profile of a professional, a client-facing
 * document in Clinique MANA's brand, as on cliniquemana.com (P4-214): Raleway, charcoal text, the
 * wine signature, soft mint surfaces, round shapes and generous white space. On US Letter:
 * - the band: the clinic's full logo (the lockup with its baseline) and its contact details, over
 *   a mint hairline that starts with a short wine stroke;
 * - who: the photo (4c) in a round frame, else the initials in wine on mint, a soft pink disc
 *   offset behind it (the site's portraits sit on such a shape); the name, the title in wine,
 *   « Membre de l’OPQ · N° de permis … », the public contact;
 * - the facts on a mint card, the site's order: Langues, Honoraires (the title's client prices in
 *   force, « À confirmer » without a grid, P4-218), Clientèle (★ first, the client limits under the
 *   list, then the ★ legend);
 * - « À propos »: the presentation (no approach text, P4-216);
 * - « Motifs de consultation »: each category's name in wine, then every motif held in it, by name,
 *   down three columns (P4-211); a category is never split across pages;
 * - from page 2, a running header (the person's name and title, the « Mana » wordmark); on every
 *   page a footer: the clinic's website, the date the fiche was made, « Page 1 de 2 ».
 *
 * One grid throughout: 54 pt margins, a 504 pt measure in three 156 pt columns with 18 pt gutters
 * (the facts and the motifs share it), and a 4 pt spacing scale.
 */

const F = 'modules.professionals.fiche.pdf'

const MARGIN = 54
const GUTTER = 18
const COLUMNS = 3
/** 504 pt of text on a 612 pt page, in three 156 pt columns. */
const COLUMN = (612 - 2 * MARGIN - (COLUMNS - 1) * GUTTER) / COLUMNS
/** The ★ column before the clientèles' names, when one is starred. */
const STAR_GUTTER = 11
/** The card's padding: it bleeds into the margin by as much, so its text sits on the grid. */
const CARD_PAD = 18

const LOGO_WIDTH = 172
const LOGO_HEIGHT = (LOGO_WIDTH * MANA_LOGO_INK.height) / MANA_LOGO_INK.width
const LOGO_SCALE = LOGO_WIDTH / MANA_LOGO_INK.width

const PORTRAIT = 100
const PORTRAIT_OFFSET = 8

const styles = StyleSheet.create({
  page: {
    fontFamily: FICHE_FONT_FAMILY,
    // No lineHeight here: inherited by the absolute footer, react-pdf places it off the page.
    fontSize: 10,
    color: BRAND.charcoal,
    // Room for the running header from page 2; page 1's band rises into it.
    paddingTop: 76,
    paddingBottom: 72,
    paddingHorizontal: MARGIN,
  },

  // The band.
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: -36 },
  // The bundled lockup is drawn so that its ink, not its transparent margin, sits on the grid.
  brandLogoBox: {
    width: (MANA_LOGO_INK.right - MANA_LOGO_INK.left) * LOGO_SCALE,
    height: (MANA_LOGO_INK.bottom - MANA_LOGO_INK.top) * LOGO_SCALE,
    overflow: 'hidden',
  },
  brandLogo: {
    position: 'absolute',
    left: -MANA_LOGO_INK.left * LOGO_SCALE,
    top: -MANA_LOGO_INK.top * LOGO_SCALE,
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  clinicLogo: { maxHeight: 56, maxWidth: 200, objectFit: 'contain' },
  contact: { alignItems: 'flex-end', marginBottom: -2 },
  contactLine: { fontSize: 8.5, lineHeight: 1.55, color: BRAND.charcoal, textAlign: 'right' },
  contactLead: { fontSize: 8.5, lineHeight: 1.55, fontWeight: 600, color: BRAND.wine, textAlign: 'right' },
  rule: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  ruleAccent: { width: 36, height: 2, borderRadius: 1, backgroundColor: BRAND.wine },
  ruleLine: { flexGrow: 1, height: 0.75, backgroundColor: BRAND.mintLine },

  // Who.
  who: { flexDirection: 'row', alignItems: 'center', marginTop: 28 },
  portrait: { width: PORTRAIT + PORTRAIT_OFFSET, height: PORTRAIT + PORTRAIT_OFFSET, marginRight: 26 },
  portraitBack: {
    position: 'absolute',
    left: PORTRAIT_OFFSET,
    top: PORTRAIT_OFFSET,
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: PORTRAIT / 2,
  },
  portraitFront: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: PORTRAIT / 2,
  },
  monogram: { backgroundColor: BRAND.mint, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontSize: 34, fontWeight: 500, color: BRAND.wine, letterSpacing: 1.5, lineHeight: 1, paddingTop: 1 },
  photo: { objectFit: 'cover' },
  identity: { flex: 1 },
  name: { fontSize: 26, fontWeight: 600, lineHeight: 1.15, color: BRAND.charcoal },
  title: { fontSize: 14, fontWeight: 500, lineHeight: 1.3, color: BRAND.wine, marginTop: 4 },
  detail: { fontSize: 9, lineHeight: 1.5, color: BRAND.charcoalSoft },
  detailFirst: { marginTop: 10 },

  // The facts.
  facts: {
    flexDirection: 'row',
    marginTop: 28,
    marginHorizontal: -CARD_PAD,
    paddingHorizontal: CARD_PAD,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: BRAND.mint,
  },
  fact: { width: COLUMN },
  divider: { width: GUTTER, alignItems: 'center' },
  dividerLine: { width: 1, flexGrow: 1, backgroundColor: BRAND.white },
  overline: { fontSize: 7.5, fontWeight: 700, color: BRAND.wine, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 6 },
  factLine: { fontSize: 9.5, fontWeight: 500, lineHeight: 1.5 },
  factPending: { fontSize: 9.5, fontWeight: 500, lineHeight: 1.5, color: BRAND.charcoalSoft },
  // Every item of a list with a ★ keeps the same gutter, so the names line up and wrap within the column.
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  starGutter: { width: STAR_GUTTER, paddingTop: 3.6 },
  limitStarred: { marginLeft: STAR_GUTTER },
  itemText: { flex: 1, fontSize: 9.5, fontWeight: 500, lineHeight: 1.5 },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  legendText: { fontSize: 7.5, lineHeight: 1.4, color: BRAND.charcoalSoft, marginLeft: 4 },

  // Sections.
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 15, fontWeight: 600, lineHeight: 1.25, color: BRAND.charcoal },
  sectionAccent: { width: 28, height: 2, borderRadius: 1, backgroundColor: BRAND.wine, marginTop: 7, marginBottom: 14 },
  // A lineHeight needs its fontSize on the same style: react-pdf would scale an inherited one from 18.
  paragraph: { fontSize: 11, lineHeight: 1.6, marginBottom: 8 },
  category: { marginBottom: 12 },
  categoryName: { fontSize: 9.5, fontWeight: 700, lineHeight: 1.3, color: BRAND.wine, marginBottom: 5 },
  columns: { flexDirection: 'row' },
  column: { width: COLUMN },
  columnGap: { width: GUTTER },
  motif: { flexDirection: 'row', alignItems: 'flex-start' },
  bullet: { width: 9, paddingTop: 4.4 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: BRAND.tealLight },
  motifName: { flex: 1, fontSize: 9, lineHeight: 1.45 },

  // Running header (page 2 on) and footer.
  running: { position: 'absolute', top: 36, left: MARGIN, right: MARGIN, fontSize: 8, color: BRAND.charcoalSoft },
  footer: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    bottom: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 9,
    borderTopWidth: 0.75,
    borderTopColor: BRAND.mintLine,
  },
  footerBrand: { flexDirection: 'row', alignItems: 'center' },
  footerSite: { fontSize: 8, fontWeight: 600, color: BRAND.wine, letterSpacing: 0.3, marginLeft: 8 },
  footerMeta: { fontSize: 7.5, color: BRAND.charcoalSoft },
})

function Star({ size = 7 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill={BRAND.wine} />
    </Svg>
  )
}

function Wordmark({ height }: { height: number }) {
  const [, , w, h] = MANA_WORDMARK.viewBox.split(' ').map(Number)
  return (
    <Svg viewBox={MANA_WORDMARK.viewBox} width={(height * (w ?? 1)) / (h ?? 1)} height={height}>
      {MANA_WORDMARK.paths.map((d) => (
        <Path key={d} d={d} fill={BRAND.wine} />
      ))}
    </Svg>
  )
}

function Band({ clinic }: { clinic: FicheContent['clinic'] }) {
  const [lead, ...rest] = clinic.contact
  return (
    <View>
      <View style={styles.band}>
        {clinic.logo.brand ? (
          <View style={styles.brandLogoBox}>
            <Image src={clinic.logo.src} style={styles.brandLogo} />
          </View>
        ) : (
          <Image src={clinic.logo.src} style={styles.clinicLogo} />
        )}
        {lead && (
          <View style={styles.contact}>
            <Text style={styles.contactLead}>{lead}</Text>
            {rest.map((line) => (
              <Text key={line} style={styles.contactLine}>
                {line}
              </Text>
            ))}
          </View>
        )}
      </View>
      <View style={styles.rule}>
        <View style={styles.ruleAccent} />
        <View style={styles.ruleLine} />
      </View>
    </View>
  )
}

function Portrait({ photo, initials }: { photo: string | null; initials: string }) {
  return (
    <View style={styles.portrait}>
      <View style={[styles.portraitBack, { backgroundColor: photo ? BRAND.mint : BRAND.pink }]} />
      {photo ? (
        <Image src={photo} style={[styles.portraitFront, styles.photo]} />
      ) : (
        <View style={[styles.portraitFront, styles.monogram]}>
          <Text style={styles.monogramText}>{initials}</Text>
        </View>
      )}
    </View>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.overline}>{label}</Text>
      {children}
    </View>
  )
}

function Facts({ content }: { content: FicheContent }) {
  const starred = content.clienteles.some((item) => item.specialized)
  const facts: { key: string; node: ReactNode }[] = []
  if (content.languages.length > 0) {
    facts.push({
      key: 'languages',
      node: (
        <Fact label={t(`${F}.languages`)}>
          {content.languages.map((line) => (
            <Text key={line} style={styles.factLine}>
              {line}
            </Text>
          ))}
        </Fact>
      ),
    })
  }
  facts.push({
    key: 'fees',
    node: (
      <Fact label={t(`${F}.fees`)}>
        {content.fees ? (
          content.fees.map((line) => (
            <Text key={line} style={styles.factLine}>
              {line}
            </Text>
          ))
        ) : (
          <Text style={styles.factPending}>{t(`${F}.feesPending`)}</Text>
        )}
      </Fact>
    ),
  })
  if (content.clienteles.length > 0 || content.clientLimits.length > 0) {
    facts.push({
      key: 'clienteles',
      node: (
        <Fact label={t(`${F}.clienteles`)}>
          <ItemList items={content.clienteles} starred={starred} />
          {content.clientLimits.map((line) => (
            // On the names' line when a ★ gutter is drawn.
            <Text key={line} style={starred ? [styles.factLine, styles.limitStarred] : styles.factLine}>
              {line}
            </Text>
          ))}
          {starred && (
            <View style={styles.legend}>
              <Star size={6} />
              <Text style={styles.legendText}>{t(`${F}.specialized`)}</Text>
            </View>
          )}
        </Fact>
      ),
    })
  }
  return (
    // One card, never split: the facts read together.
    <View style={styles.facts} wrap={false}>
      {facts.map((fact, i) => (
        <View key={fact.key} style={{ flexDirection: 'row' }}>
          {i > 0 && (
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
            </View>
          )}
          {fact.node}
        </View>
      ))}
    </View>
  )
}

function ItemList({ items, starred }: { items: readonly FicheItem[]; starred: boolean }) {
  return (
    <>
      {items.map((item) =>
        starred ? (
          <View key={item.label} style={styles.item}>
            <View style={styles.starGutter}>{item.specialized && <Star />}</View>
            <Text style={styles.itemText}>{item.label}</Text>
          </View>
        ) : (
          <Text key={item.label} style={styles.factLine}>
            {item.label}
          </Text>
        ),
      )}
    </>
  )
}

function SectionTitle({ children, minPresenceAhead }: { children: string; minPresenceAhead?: number }) {
  // The title never ends a page alone: what follows it needs room on the same page.
  return (
    <View minPresenceAhead={minPresenceAhead}>
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={styles.sectionAccent} />
    </View>
  )
}

/** Names down `COLUMNS` columns, read top to bottom, then left to right. */
function inColumns(names: readonly string[]): string[][] {
  const perColumn = Math.ceil(names.length / COLUMNS)
  return Array.from({ length: COLUMNS }, (_, c) => names.slice(c * perColumn, (c + 1) * perColumn))
}

function MotifCategory({ group, heading }: { group: FicheMotifGroup; heading?: ReactNode }) {
  return (
    // Never split across pages: the category's name always heads its motifs, and the section's
    // title travels with the first category (never alone at the foot of a page).
    <View style={styles.category} wrap={false}>
      {heading}
      <Text style={styles.categoryName}>{group.name}</Text>
      <View style={styles.columns}>
        {inColumns(group.names).map((column, c) => (
          <View key={c} style={{ flexDirection: 'row' }}>
            {c > 0 && <View style={styles.columnGap} />}
            <View style={styles.column}>
              {column.map((name) => (
                <View key={name} style={styles.motif}>
                  <View style={styles.bullet}>
                    <View style={styles.dot} />
                  </View>
                  <Text style={styles.motifName}>{name}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export function FicheDocument({ content }: { content: FicheContent }) {
  const { clinic } = content
  const running = [content.name, content.title].filter(Boolean).join(' · ')
  return (
    <Document title={t(`${F}.documentTitle`, { name: content.name })} author={clinic.name} creator={clinic.name} producer={clinic.name} language="fr-CA">
      <Page size="LETTER" style={styles.page}>
        {/* From page 2, whose fiche it is (page 1 has the band). Only a Text can be told its page:
            a View's render prop is laid out apart from the page. */}
        <Text style={styles.running} fixed render={({ pageNumber }) => (pageNumber > 1 ? running : '')} />

        <Band clinic={clinic} />

        <View style={styles.who} wrap={false}>
          <Portrait photo={content.photo} initials={content.initials} />
          <View style={styles.identity}>
            <Text style={styles.name}>{content.name}</Text>
            {content.title && <Text style={styles.title}>{content.title}</Text>}
            {content.credential && <Text style={[styles.detail, styles.detailFirst]}>{content.credential}</Text>}
            {content.publicContact && <Text style={[styles.detail, content.credential ? {} : styles.detailFirst]}>{content.publicContact}</Text>}
          </View>
        </View>

        <Facts content={content} />

        {content.about.length > 0 && (
          <View style={styles.section}>
            <SectionTitle minPresenceAhead={48}>{t(`${F}.about`)}</SectionTitle>
            {content.about.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        )}

        {content.motifs.length > 0 && (
          <View style={styles.section}>
            {content.motifs.map((group, i) => (
              <MotifCategory key={group.name} group={group} heading={i === 0 ? <SectionTitle>{t(`${F}.motifs`)}</SectionTitle> : undefined} />
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <View style={styles.footerBrand}>
            <Wordmark height={14} />
            {clinic.website && <Text style={styles.footerSite}>{clinic.website}</Text>}
          </View>
          <Text
            style={styles.footerMeta}
            render={({ pageNumber, totalPages }) =>
              t(`${F}.footer`, { date: content.generatedOn, page: String(pageNumber), total: String(totalPages) })
            }
          />
        </View>
      </Page>
    </Document>
  )
}
