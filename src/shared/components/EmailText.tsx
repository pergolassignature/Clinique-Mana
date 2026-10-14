import { Fragment } from 'react'

/**
 * An e-mail address that wraps at its natural points (after « @ », before a « . ») instead of
 * mid-word (« ines.fictive@e / xemple.test »). A part still too long for its column breaks as a
 * last resort.
 */
export function EmailText({ value, className }: { value: string; className?: string }) {
  const parts = value.split(/(?=\.)|(?<=@)/)
  return (
    <span className={className ? `break-words ${className}` : 'break-words'}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </span>
  )
}
