import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '@testing-library/react'
import { t } from '@/i18n'
import { CATALOG_VIEW, recordFixture } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import type { ProfessionalRecord } from '../../api/parse'
import { RecordHeader } from './RecordHeader'

const H = 'modules.professionals.record.header'

function renderHeader(change: (record: ProfessionalRecord) => ProfessionalRecord = (r) => r) {
  render(<RecordHeader record={change(recordFixture())} catalog={CATALOG_VIEW} />)
}

describe('RecordHeader', () => {
  it('shows the name as the page heading, the status, the title line and the languages', () => {
    renderHeader((r) => ({ ...r, languageIds: [IDS.en, IDS.fr] }))
    expect(screen.getByRole('heading', { level: 1, name: 'Marie Tremblay' })).toBeInTheDocument()
    expect(screen.getByText('MT')).toBeInTheDocument()
    expect(screen.getByText(t('modules.professionals.status.draft'))).toBeInTheDocument()
    expect(screen.getByText('Psychologue · OPQ 12345 · marie.t@exemple.ca')).toBeInTheDocument()
    const chips = screen.getAllByRole('listitem')
    expect(chips.map((chip) => chip.textContent)).toEqual([`${t(`${H}.languages`)} FR · EN`])
  })

  it('says when the professional takes no new clients', () => {
    renderHeader((r) => ({ ...r, matchingProfile: { ...r.matchingProfile, acceptingNewClients: false } }))
    expect(within(screen.getByRole('list')).getByText(t(`${H}.notAccepting`))).toBeInTheDocument()
  })

  it('ellipsises a chip on its text, inside a shrinkable chip (a flex item draws no ellipsis)', () => {
    renderHeader((r) => ({ ...r, matchingProfile: { ...r.matchingProfile, acceptingNewClients: false } }))
    const text = screen.getByText(t(`${H}.notAccepting`))
    expect(text.tagName).toBe('SPAN')
    expect(text).toHaveClass('truncate', 'min-w-0')
    expect(text.parentElement).toHaveClass('min-w-0', 'max-w-full')
  })

  it('shows the email alone without a title, and no chips without languages', () => {
    renderHeader((r) => ({ ...r, professions: [], languageIds: [] }))
    expect(screen.getByText('marie.t@exemple.ca')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
