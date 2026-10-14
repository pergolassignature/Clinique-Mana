import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Lock, Search, X } from 'lucide-react'
import { t } from '@/i18n'
import type { SettingsSection } from '@/core/modules/types'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { foldSearch } from '@/shared/lib/list-search'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { useMediaQuery } from '@/shared/lib/use-media-query'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { settingsSectionPath } from './paths'
import { isSectionReadOnly } from './section-context'
import { settingsMenuGroups } from './visible-sections'

/** From `xl`, the menu is a column beside the page, in view under the top bar: its headings fold. */
const WIDE_QUERY = '(min-width: 1280px)'
const STORAGE_KEY = 'settings.menu.open'

/** The headings a viewer opened (a per-viewer convenience: nothing breaks without storage). */
function readOpened(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeOpened(opened: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...opened]))
  } catch {
    // Storage blocked: the headings fold back at the next visit.
  }
}

interface SettingsMenuProps {
  id: string
  /** The compact disclosure's state (below `xl`); the column is always shown. */
  open: boolean
  /** The sections the user can open, in menu order (`visibleSettingsSections`). */
  sections: SettingsSection[]
  current: SettingsSection | undefined
  basePath: string
  can: (permission: string) => boolean
  onChoose: (section: SettingsSection) => void
}

/**
 * The settings menu (NAV-3): « Rechercher un réglage », then Clinique, Plateforme and one heading per
 * module area (« Professionnels », « Facturation »…). In the column (from `xl`) about 35 sections
 * do not fit a 1366 × 768 window, so each heading folds; the one holding the current page is always
 * open and others stay as the viewer left them. A search shows every match, headings open. In the
 * compact disclosure (below `xl`) nothing folds: it scrolls with the page. Labels wrap, never cut.
 */
export function SettingsMenu({ id, open, sections, current, basePath, can, onChoose }: SettingsMenuProps) {
  const wide = useMediaQuery(WIDE_QUERY)
  const navigate = useNavigate()
  const confirmLeave = useConfirmLeave()
  const searchId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<Set<string>>(readOpened)

  const folded = foldSearch(query.trim())
  const groups = useMemo(() => {
    const all = settingsMenuGroups(sections)
    if (!folded) return all
    return all
      .map((g) => (foldSearch(t(g.labelKey)).includes(folded) ? g : { ...g, sections: g.sections.filter((s) => foldSearch(t(s.labelKey)).includes(folded)) }))
      .filter((g) => g.sections.length > 0)
  }, [sections, folded])
  const matches = groups.flatMap((g) => g.sections)
  const currentGroup = current ? settingsMenuGroups(sections).find((g) => g.sections.includes(current))?.key : undefined

  const toggle = (key: string) =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeOpened(next)
      return next
    })

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault()
      setQuery('')
    } else if (event.key === 'Enter' && folded && matches[0]) {
      event.preventDefault()
      const first = matches[0]
      confirmLeave(() => {
        onChoose(first)
        setQuery('')
        navigate(settingsSectionPath(first, basePath))
      })
    } else if (event.key === 'ArrowDown') {
      const link = listRef.current?.querySelector<HTMLElement>('a')
      if (link) {
        event.preventDefault()
        link.focus()
      }
    }
  }

  return (
    <nav id={id} aria-label={t('settings.navLabel')} data-state={open ? 'open' : 'closed'} className="max-xl:mt-2 max-xl:data-[state=closed]:hidden">
      <div className="relative mb-3">
        <label htmlFor={searchId} className="sr-only">
          {t('settings.search.label')}
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('settings.search.label')}
          autoComplete="off"
          className={`h-8 w-full rounded-md border border-border bg-card pl-8 pr-7 text-sm text-foreground placeholder:text-muted-foreground max-xl:h-11 [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
        />
        {query && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('settings.search.clear')}
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-subtle hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <p role="status" className="sr-only">
          {folded ? (matches.length === 0 ? t('settings.search.none') : t(matches.length === 1 ? 'settings.search.one' : 'settings.search.other', { count: String(matches.length) })) : ''}
        </p>
      </div>
      {folded && matches.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t('settings.search.none')}</p>}
      <div ref={listRef} className="sm:max-xl:columns-2 sm:max-xl:gap-6">
        {groups.map((group) => {
          const headingId = `${id}-group-${group.key.replace(/[^a-z0-9_-]/gi, '-')}`
          const listId = `${headingId}-items`
          // Folds only in the column, never the current page's heading, never while searching.
          const foldable = wide && !folded && group.key !== currentGroup
          const expanded = !foldable || opened.has(group.key)
          return (
            <div key={group.key} role="group" aria-labelledby={headingId} className="mb-3 break-inside-avoid">
              {foldable ? (
                <button
                  type="button"
                  id={headingId}
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => toggle(group.key)}
                  className={`flex w-full items-center gap-1 rounded-md px-2 py-0.5 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground ${focusRing}`}
                >
                  <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform duration-120', expanded && 'rotate-90')} aria-hidden />
                  <span className="min-w-0 break-words">{t(group.labelKey)}</span>
                </button>
              ) : (
                <p id={headingId} className="mb-0.5 px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(group.labelKey)}
                </p>
              )}
              <div id={listId} hidden={!expanded}>
                {group.sections.map((s) => (
                  <GuardedNavLink
                    key={s.id}
                    to={settingsSectionPath(s, basePath)}
                    onClick={() => {
                      onChoose(s)
                      setQuery('')
                    }}
                    className={({ isActive }) =>
                      cn(
                        `flex min-h-11 items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors duration-120 xl:min-h-0 xl:py-[5px] ${focusRing}`,
                        isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <s.icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1 break-words">{t(s.labelKey)}</span>
                    {isSectionReadOnly(s, can) && (
                      <>
                        <Lock className="ml-auto h-3 w-3 shrink-0 text-subtle" aria-hidden />
                        <span className="sr-only"> {t('settings.navReadOnlyHint')}</span>
                      </>
                    )}
                  </GuardedNavLink>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
