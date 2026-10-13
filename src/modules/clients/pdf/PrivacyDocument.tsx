import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { t } from '@/i18n'
import { toWinAnsi, type PrivacyContent, type PrivacySection } from './privacy-content'

/**
 * The Loi 25 export as a PDF (plan C4.2), made in the browser: an administrative document, not a
 * branded one, so react-pdf's built-in Helvetica (no font to fetch) on US Letter, one section after
 * another, the files merged into this one after it, « Exporté le … · Page X de Y » on every page.
 * This module (and react-pdf) is its own chunk, loaded by « Exporter le dossier (PDF) » only.
 */

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 9.5, color: '#222222' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 11, marginBottom: 2 },
  meta: { fontSize: 8.5, color: '#666666', marginBottom: 14 },
  heading: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 4 },
  section: { marginTop: 10 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4, paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: '#BBBBBB' },
  group: { marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 1.5 },
  label: { width: 200, paddingRight: 8, color: '#555555' },
  value: { flex: 1 },
  none: { color: '#666666' },
  footer: { position: 'absolute', bottom: 22, left: 48, right: 48, fontSize: 8, color: '#666666', flexDirection: 'row', justifyContent: 'space-between' },
})

const P = 'modules.clients.privacy.pdf'

function Section({ section }: { section: PrivacySection }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} minPresenceAhead={40}>
        {toWinAnsi(section.title)}
      </Text>
      {section.groups.length === 0 ? (
        <Text style={styles.none}>{toWinAnsi(t(`${P}.none`))}</Text>
      ) : (
        section.groups.map((group, g) => (
          <View key={g} style={styles.group} wrap={false}>
            {group.map((line, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>{toWinAnsi(line.label)}</Text>
                <Text style={styles.value}>{toWinAnsi(line.value)}</Text>
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  )
}

export function PrivacyDocument({ content }: { content: PrivacyContent }) {
  return (
    <Document title={toWinAnsi(content.title)} author={toWinAnsi(content.clinic)} language="fr-CA">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{toWinAnsi(content.title)}</Text>
        <Text style={styles.subtitle}>{toWinAnsi(content.subtitle)}</Text>
        <Text style={styles.meta}>{toWinAnsi(t(`${P}.meta`, { clinic: content.clinic, date: content.exportedOn }))}</Text>
        {content.sections.map((section) => (
          <Section key={section.title} section={section} />
        ))}
        {content.merged.map((file) => (
          <View key={file.heading}>
            <Text style={styles.heading} minPresenceAhead={60}>
              {toWinAnsi(file.heading)}
            </Text>
            {file.sections.map((section) => (
              <Section key={section.title} section={section} />
            ))}
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>{toWinAnsi(t(`${P}.footer`, { date: content.exportedOn }))}</Text>
          <Text render={({ pageNumber, totalPages }) => toWinAnsi(t(`${P}.page`, { page: String(pageNumber), pages: String(totalPages) }))} />
        </View>
      </Page>
    </Document>
  )
}
