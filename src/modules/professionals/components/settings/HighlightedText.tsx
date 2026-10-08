import { highlightRanges } from '../../lib/list-search'

/** `text` with the search's words marked (`<mark>`, soft teal), accents and case kept. */
export function HighlightedText({ text, words }: { text: string; words: readonly string[] }) {
  const ranges = highlightRanges(text, words)
  if (ranges.length === 0) return <>{text}</>
  const parts = []
  let from = 0
  for (const [start, end] of ranges) {
    if (start > from) parts.push(text.slice(from, start))
    parts.push(
      <mark key={start} className="rounded-sm bg-primary-soft text-foreground">
        {text.slice(start, end)}
      </mark>,
    )
    from = end
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
