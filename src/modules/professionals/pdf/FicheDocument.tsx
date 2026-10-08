import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import { t } from '@/i18n'
import { BRAND, MANA_LOGO_INK, MANA_WORDMARK } from './brand'
import type { FicheClosing, FicheContent, FicheItem, FicheMotifGroup } from './fiche-content'
import { FICHE_FONT_FAMILY } from './fonts'

/**
 * The fiche (Task 4c.5, A2.19): the clinic's public profile of a professional, a client-facing
 * document in Clinique MANA's brand (P4-214), laid out to Jonathan's v2 design handoff (P4-350 to
 * P4-357; « Fiche Genevieve Tremblay v2 », px on an 816 × 1056 page, × 0.75 here). On US Letter:
 * - page 1: the clinic's full logo alone (P4-351), over the brand rule (a 36 × 1.5 wine stroke,
 *   then a mint hairline);
 * - who: the photo (4c) in a round frame, else the initials in wine on mint, a pink disc offset
 *   behind it; the name, the title in wine, « Membre de l’OPQ · N° de permis … », and the public
 *   contact unless the clinic hides it (`showProContact`, P4-353);
 * - the facts on a mint band bleeding into the margins, three equal columns split by white
 *   hairlines: Langues, Honoraires (the title's client prices in force, « À confirmer » without
 *   a grid, P4-218), Clientèle (★ first, the client limits under the list, then the ★ legend);
 * - « À propos », then « Approche » (P4-350), each hidden when empty;
 * - « Motifs de consultation »: each category's name in wine, then every motif held in it, by
 *   name, down three columns behind teal dots, wrapped lines hung on the text (P4-211); a category
 *   is never split across pages;
 * - « Prochaine étape » (P4-352) after the last category, never alone atop a page;
 * - from page 2, a running header (« Nom · Titre » over the brand rule); on every page a footer:
 *   the « Mana » wordmark and the clinic's phone and website (`showClinicFooter`), « Fiche à jour
 *   le … · Page X de Y ».
 *
 * The grid: 53.25 pt side margins (a 505.5 pt measure), 36 pt at the top, the footer 24 pt from
 * the bottom edge; the facts in three 168.5 pt columns, the motifs in three 154.5 pt columns
 * with 21 pt gutters.
 */

const F = 'modules.professionals.fiche.pdf'

type Style = Exclude<ComponentProps<typeof View>['style'], undefined | readonly unknown[]>

/** The v2 design's px on an 816 px wide Letter page, in points. */
const px = (value: number) => value * 0.75

const PAGE_WIDTH = 612
const MARGIN = px(71)
const MEASURE = PAGE_WIDTH - 2 * MARGIN
const TOP = px(48)
const FOOTER_BOTTOM = px(32)
const COLUMNS = 3

/** The facts: three equal columns of the band, which bleeds into the margin by its own padding. */
const BAND_BLEED = px(24)
const FACT_COLUMN = MEASURE / COLUMNS
const FACT_INSET = px(12)
/** The ★ column before the clientèles' names, when one is starred (9 px icon + 6 px gap). */
const STAR_GUTTER = px(9) + px(6)

/** The motifs: three columns with 28 px gutters. */
const MOTIF_GUTTER = px(28)
const MOTIF_COLUMN = (MEASURE - (COLUMNS - 1) * MOTIF_GUTTER) / COLUMNS

/** The lockup: 228 px wide, its transparent margins measured (`MANA_LOGO_INK`). */
const LOGO_WIDTH = px(228)
const LOGO_HEIGHT = (LOGO_WIDTH * MANA_LOGO_INK.height) / MANA_LOGO_INK.width
const LOGO_SCALE = LOGO_WIDTH / MANA_LOGO_INK.width

/** The running header from page 2: « Nom · Titre » (12 px), 12 px, the brand rule, then 28 px. */
const RUNNING_TEXT = px(12)
const RUNNING_HEIGHT = RUNNING_TEXT * 1.2 + px(12) + px(2)
/** Where the flow starts on every page: under the running header (page 1's logo rises into it). */
const CONTENT_TOP = TOP + RUNNING_HEIGHT + px(28)

/** The footer: a 1 px hairline, 14 px, the wordmark's row (40 px wide, 20 px high). */
const WORDMARK_WIDTH = px(40)
const FOOTER_HEIGHT = px(1) + px(14) + px(20)
/** The flow ends 12 px above the footer at the least; « Prochaine étape » keeps 28 px. */
const FLOW_GAP = px(12)
const CONTENT_BOTTOM = FOOTER_BOTTOM + FOOTER_HEIGHT + FLOW_GAP

const PORTRAIT = px(133)
const PORTRAIT_OFFSET = px(11)

/** The section titles' bar, under each title. */
const ACCENT = { width: px(37), height: px(3) }

const styles = StyleSheet.create({
  page: {
    fontFamily: FICHE_FONT_FAMILY,
    // No lineHeight here: inherited by the absolute footer, react-pdf places it off the page.
    fontSize: px(14),
    color: BRAND.charcoal,
    paddingTop: CONTENT_TOP,
    paddingBottom: CONTENT_BOTTOM,
    paddingHorizontal: MARGIN,
  },

  // Page 1: the logo alone, then the brand rule.
  band: { marginTop: TOP - CONTENT_TOP },
  // The bundled lockup is drawn so that its ink, not its transparent margin, sits on the grid; the
  // box keeps the design's place (the image's top at 48 px, the rule 10 px under the image).
  brandLogoBox: {
    width: (MANA_LOGO_INK.right - MANA_LOGO_INK.left) * LOGO_SCALE,
    height: (MANA_LOGO_INK.bottom - MANA_LOGO_INK.top) * LOGO_SCALE,
    marginTop: MANA_LOGO_INK.top * LOGO_SCALE,
    marginBottom: (MANA_LOGO_INK.height - MANA_LOGO_INK.bottom) * LOGO_SCALE,
    overflow: 'hidden',
  },
  brandLogo: {
    position: 'absolute',
    left: -MANA_LOGO_INK.left * LOGO_SCALE,
    top: -MANA_LOGO_INK.top * LOGO_SCALE,
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  clinicLogo: { maxHeight: px(76), maxWidth: px(260), objectFit: 'contain', alignSelf: 'flex-start' },
  rule: { flexDirection: 'row', alignItems: 'center' },
  bandRule: { marginTop: px(10) },
  ruleAccent: { width: px(48), height: px(2), backgroundColor: BRAND.wine },
  ruleLine: { flexGrow: 1, height: px(1), backgroundColor: BRAND.mintLine },

  // Who.
  who: { flexDirection: 'row', alignItems: 'center', marginTop: px(26) },
  portrait: { width: PORTRAIT + PORTRAIT_OFFSET, height: PORTRAIT + PORTRAIT_OFFSET, marginRight: px(34) },
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
  monogramText: { fontSize: px(46), fontWeight: 400, color: BRAND.wine, letterSpacing: px(46) * 0.01, lineHeight: 1, paddingTop: 1 },
  photo: { objectFit: 'cover' },
  identity: { flex: 1 },
  name: { fontSize: px(37), fontWeight: 600, lineHeight: 1.15, letterSpacing: px(37) * -0.005, color: BRAND.charcoal },
  title: { fontSize: px(20), fontWeight: 500, lineHeight: 1.25, color: BRAND.wine, marginTop: px(4) },
  detail: { fontSize: px(13), lineHeight: 18 / 13, color: BRAND.meta },
  detailFirst: { marginTop: px(16) },

  // The facts.
  facts: {
    flexDirection: 'row',
    marginTop: px(26),
    marginHorizontal: -BAND_BLEED,
    paddingHorizontal: BAND_BLEED,
    paddingVertical: px(20),
    borderRadius: px(20),
    backgroundColor: BRAND.mint,
  },
  fact: { width: FACT_COLUMN },
  // Columns 2 and 3 open with a white hairline, 12 px of air on each side of it.
  factAfter: { borderLeftWidth: px(1), borderLeftColor: BRAND.white, paddingLeft: FACT_INSET },
  factBefore: { paddingRight: FACT_INSET },
  overline: { fontSize: px(10.5), fontWeight: 700, color: BRAND.wine, textTransform: 'uppercase', letterSpacing: px(10.5) * 0.16, marginBottom: px(9) },
  factLine: { fontSize: px(14), fontWeight: 500, lineHeight: 19 / 14 },
  factPending: { fontSize: px(14), fontWeight: 500, lineHeight: 19 / 14, color: BRAND.meta },
  // Every item of a list with a ★ keeps the same gutter, so the names line up and wrap within the column.
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  starGutter: { width: STAR_GUTTER, paddingTop: 3.6 },
  limitStarred: { marginLeft: STAR_GUTTER },
  itemText: { flex: 1, fontSize: px(14), fontWeight: 500, lineHeight: 19 / 14 },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: px(9) + px(2) },
  legendStar: { width: STAR_GUTTER },
  legendText: { fontSize: px(11), lineHeight: 1.35, color: BRAND.meta },

  // Sections (« À propos », « Approche », « Motifs de consultation »): 26 px under the band, 22 px apart.
  firstSection: { marginTop: px(26) },
  section: { marginTop: px(22) },
  sectionTitle: { fontSize: px(21), fontWeight: 600, lineHeight: 1.2, color: BRAND.charcoal },
  sectionAccent: { ...ACCENT, borderRadius: px(2), backgroundColor: BRAND.wine, marginTop: px(10), marginBottom: px(12) },
  // A lineHeight needs its fontSize on the same style: react-pdf would scale an inherited one from 18.
  paragraph: { fontSize: px(14.5), lineHeight: 22 / 14.5 },
  nextParagraph: { marginTop: px(11) },
  categories: { rowGap: px(22) },
  categoryName: { fontSize: px(13.5), fontWeight: 600, lineHeight: 1.25, color: BRAND.wine, marginBottom: px(7) },
  columns: { flexDirection: 'row' },
  column: { width: MOTIF_COLUMN },
  columnGap: { width: MOTIF_GUTTER },
  motif: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: px(0.5) },
  // A 4 px teal dot 7 px from the top, 8 px before the text: wrapped lines hang on the text.
  bullet: { width: px(4) + px(8), paddingTop: px(7) },
  dot: { width: px(4), height: px(4), borderRadius: px(2), backgroundColor: BRAND.tealLight },
  motifName: { flex: 1, fontSize: px(13), lineHeight: 17 / 13 },

  // « Prochaine étape »: the band's mint and bleed, after the last category.
  last: { flexGrow: 1 },
  closingSpacer: { flexGrow: 1, minHeight: px(22) },
  closing: {
    marginHorizontal: -BAND_BLEED,
    paddingHorizontal: BAND_BLEED,
    paddingVertical: px(22),
    borderRadius: px(20),
    backgroundColor: BRAND.mint,
    marginBottom: px(28) - FLOW_GAP,
  },
  closingLead: { fontSize: px(18), fontWeight: 600, lineHeight: 1.3, color: BRAND.charcoal, marginTop: px(1) },
  closingBody: { fontSize: px(14), lineHeight: 20 / 14, marginTop: px(10) },
  closingContact: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(10) + px(2) - px(6) },
  closingItem: { fontSize: px(14), lineHeight: 20 / 14, fontWeight: 600, color: BRAND.wine, marginTop: px(6), marginRight: px(20) },

  // Running header (page 2 on) and footer.
  running: { position: 'absolute', top: TOP, left: MARGIN, right: MARGIN },
  runningText: { fontSize: RUNNING_TEXT, lineHeight: 1.2, fontWeight: 600, color: BRAND.meta, marginBottom: px(12) },
  footer: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    bottom: FOOTER_BOTTOM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: px(14),
    borderTopWidth: px(1),
    borderTopColor: BRAND.mintLine,
  },
  footerBrand: { flexDirection: 'row', alignItems: 'center' },
  footerText: { fontSize: px(10.5), color: BRAND.meta },
  footerContact: { marginLeft: px(14) },
})

function Star({ size = 7 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill={BRAND.wine} />
    </Svg>
  )
}

/** The « Mana » wordmark in wine (logo-header.svg's paths, `fill="#9B1B3C"`), sized by the SVG's full 300-unit width. */
function Wordmark({ width }: { width: number }) {
  const [, , w, h] = MANA_WORDMARK.viewBox.split(' ').map(Number)
  const scale = width / 300
  return (
    <Svg viewBox={MANA_WORDMARK.viewBox} width={(w ?? 0) * scale} height={(h ?? 0) * scale}>
      {MANA_WORDMARK.paths.map((d) => (
        <Path key={d} d={d} fill={BRAND.wine} />
      ))}
    </Svg>
  )
}

/** The brand rule: a 48 × 2 px wine stroke, then a 1 px mint hairline across the measure. */
function BrandRule({ style }: { style?: Style }) {
  return (
    <View style={style ? [styles.rule, style] : styles.rule}>
      <View style={styles.ruleAccent} />
      <View style={styles.ruleLine} />
    </View>
  )
}

function Band({ logo }: { logo: FicheContent['clinic']['logo'] }) {
  return (
    <View style={styles.band}>
      {logo.brand ? (
        <View style={styles.brandLogoBox}>
          <Image src={logo.src} style={styles.brandLogo} />
        </View>
      ) : (
        <Image src={logo.src} style={styles.clinicLogo} />
      )}
      <BrandRule style={styles.bandRule} />
    </View>
  )
}

function Portrait({ photo, initials }: { photo: string | null; initials: string }) {
  return (
    <View style={styles.portrait}>
      <View style={[styles.portraitBack, { backgroundColor: BRAND.pink }]} />
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

function Facts({ content }: { content: FicheContent }) {
  const starred = content.clienteles.some((item) => item.specialized)
  const facts: { key: string; label: string; node: ReactNode }[] = []
  if (content.languages.length > 0) {
    facts.push({
      key: 'languages',
      label: t(`${F}.languages`),
      node: content.languages.map((line) => (
        <Text key={line} style={styles.factLine}>
          {line}
        </Text>
      )),
    })
  }
  facts.push({
    key: 'fees',
    label: t(`${F}.fees`),
    node: content.fees ? (
      content.fees.map((line) => (
        <Text key={line} style={styles.factLine}>
          {line}
        </Text>
      ))
    ) : (
      <Text style={styles.factPending}>{t(`${F}.feesPending`)}</Text>
    ),
  })
  if (content.clienteles.length > 0 || content.clientLimits.length > 0) {
    facts.push({
      key: 'clienteles',
      label: t(`${F}.clienteles`),
      node: (
        <>
          <ItemList items={content.clienteles} starred={starred} />
          {content.clientLimits.map((line) => (
            // On the names' line when a ★ gutter is drawn.
            <Text key={line} style={starred ? [styles.factLine, styles.limitStarred] : styles.factLine}>
              {line}
            </Text>
          ))}
          {/* A legend, shown only when a clientèle is starred. */}
          {starred && (
            <View style={styles.legend}>
              <View style={styles.legendStar}>
                <Star size={px(8)} />
              </View>
              <Text style={styles.legendText}>{t(`${F}.specialized`)}</Text>
            </View>
          )}
        </>
      ),
    })
  }
  return (
    // One band, never split: the facts read together.
    <View style={styles.facts} wrap={false}>
      {facts.map((fact, i) => (
        <View
          key={fact.key}
          style={[styles.fact, ...(i > 0 ? [styles.factAfter] : []), ...(i < facts.length - 1 ? [styles.factBefore] : [])]}
        >
          <Text style={styles.overline}>{fact.label}</Text>
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

/**
 * The fiche's end: its last block (the last category, else the last paragraph) and « Prochaine
 * étape » move together (never the block alone atop a page, P4-352); the group fills what is
 * left of the last page, so the closing band sits 28 px above the footer, as in the design.
 */
function Ending({ children, closing, style }: { children?: ReactNode; closing: FicheClosing; style?: Style }) {
  return (
    <View style={style ? [styles.last, style] : styles.last} wrap={false}>
      {children}
      <View style={styles.closingSpacer} />
      <Closing closing={closing} />
    </View>
  )
}

function Closing({ closing }: { closing: FicheClosing }) {
  return (
    <View style={styles.closing}>
      <Text style={[styles.overline, { marginBottom: 0 }]}>{t(`${F}.closing.kicker`)}</Text>
      <Text style={[styles.closingLead, { marginTop: px(10) }]}>{t(`${F}.closing.lead`)}</Text>
      <Text style={styles.closingBody}>{closing.body}</Text>
      {closing.contact.length > 0 && (
        <View style={styles.closingContact}>
          {closing.contact.map((line) => (
            <Text key={line} style={styles.closingItem}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

function Paragraphs({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <>
      {paragraphs.map((paragraph, i) => (
        <Text key={i} style={i > 0 ? [styles.paragraph, styles.nextParagraph] : styles.paragraph}>
          {paragraph}
        </Text>
      ))}
    </>
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
    <View wrap={false}>
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
  const { clinic, closing } = content
  const running = [content.name, content.title].filter(Boolean).join(' · ')
  const texts = [
    { key: 'about', title: t(`${F}.about`), paragraphs: content.about },
    { key: 'approach', title: t(`${F}.approach`), paragraphs: content.approach },
  ].filter((section) => section.paragraphs.length > 0)
  const hasMotifs = content.motifs.length > 0
  let sectionIndex = 0
  const sectionStyle = () => (sectionIndex++ === 0 ? styles.firstSection : styles.section)

  return (
    <Document title={t(`${F}.documentTitle`, { name: content.name })} author={clinic.name} creator={clinic.name} producer={clinic.name} language="fr-CA">
      <Page size="LETTER" style={styles.page}>
        {/* From page 2, whose fiche it is, over the brand rule (page 1 has the logo). */}
        <View
          style={styles.running}
          fixed
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <>
                <Text style={styles.runningText}>{running}</Text>
                <BrandRule />
              </>
            ) : null
          }
        />

        <Band logo={clinic.logo} />

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

        {texts.map((section, s) => {
          const last = !hasMotifs && s === texts.length - 1 && closing
          const style = sectionStyle()
          if (!last) {
            return (
              <View key={section.key} style={style}>
                <SectionTitle minPresenceAhead={48}>{section.title}</SectionTitle>
                <Paragraphs paragraphs={section.paragraphs} />
              </View>
            )
          }
          // The fiche ends with this text: its last paragraph travels with « Prochaine étape ».
          const lead = section.paragraphs.slice(0, -1)
          return (
            <Fragment key={section.key}>
              {lead.length > 0 && (
                <View style={style}>
                  <SectionTitle minPresenceAhead={48}>{section.title}</SectionTitle>
                  <Paragraphs paragraphs={lead} />
                </View>
              )}
              <Ending closing={closing} style={lead.length > 0 ? undefined : style}>
                {lead.length === 0 && <SectionTitle>{section.title}</SectionTitle>}
                <Text style={lead.length > 0 ? [styles.paragraph, styles.nextParagraph] : styles.paragraph}>{section.paragraphs.at(-1)}</Text>
              </Ending>
            </Fragment>
          )
        })}

        {hasMotifs && (
          // One column of blocks 22 px apart (a gap, not margins: a block that starts a page has no
          // space above it). With « Prochaine étape », the last category travels with it and the
          // section fills the last page, so the closing band sits above the footer.
          <View style={[sectionStyle(), styles.categories, ...(closing ? [styles.last] : [])]}>
            {content.motifs.map((group, i) => {
              const category = <MotifCategory key={group.name} group={group} heading={i === 0 ? <SectionTitle>{t(`${F}.motifs`)}</SectionTitle> : undefined} />
              return closing && i === content.motifs.length - 1 ? (
                <Ending key={group.name} closing={closing}>
                  {category}
                </Ending>
              ) : (
                category
              )
            })}
          </View>
        )}

        {texts.length === 0 && !hasMotifs && closing && <Ending closing={closing} style={styles.firstSection} />}

        <View style={styles.footer} fixed>
          <View style={styles.footerBrand}>
            <Wordmark width={WORDMARK_WIDTH} />
            {content.footerContact && <Text style={[styles.footerText, styles.footerContact]}>{content.footerContact}</Text>}
          </View>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              t(`${F}.footer`, { date: content.generatedOn, page: String(pageNumber), total: String(totalPages) })
            }
          />
        </View>
      </Page>
    </Document>
  )
}
