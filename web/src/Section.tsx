import type { ReactNode } from 'react'

/** Collapsed until asked: what a kind of Lambda is, how it differs, and how it's measured here. */
export const Explainer = ({
  title,
  onOpen,
  children,
}: {
  title: string
  onOpen: () => void
  children: ReactNode
}) => (
  <details
    className="group rounded-card border border-rule bg-paper-2"
    onToggle={(e) => e.currentTarget.open && onOpen()}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-ink sm:px-6 [&::-webkit-details-marker]:hidden">
      {title}
      <svg
        aria-hidden="true"
        viewBox="0 0 10 6"
        className="size-3 shrink-0 text-muted transition-transform duration-(--dur-short) group-open:rotate-180"
      >
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </summary>
    <div className="flex flex-col gap-5 border-t border-rule px-5 pt-4 pb-6 text-sm text-ink-2 sm:px-6">
      {children}
    </div>
  </details>
)

const ROW = 'grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]'

/**
 * Each aspect of `kind` beside `other`'s, an Event Function's unless it says: three columns once
 * there's room; on a phone each aspect stacks, the two sides labelled.
 */
export const Differences = ({
  kind,
  other = 'Event Function',
  rows,
}: {
  kind: string
  other?: string
  rows: readonly (readonly [aspect: string, kind: string, other: string])[]
}) => (
  <div role="table" aria-label={`${kind} and ${other}`} className="flex flex-col">
    <div role="row" className={`${ROW} text-xs text-muted max-sm:hidden`}>
      <span role="columnheader" />
      <span role="columnheader">{kind}</span>
      <span role="columnheader">{other}</span>
    </div>
    {rows.map(([aspect, theirs, event]) => (
      <div key={aspect} role="row" className={`${ROW} border-t border-rule py-2`}>
        <span role="rowheader" className="font-medium text-ink">
          {aspect}
        </span>
        <span role="cell">
          <span className="text-xs text-muted sm:hidden">{kind}: </span>
          {theirs}
        </span>
        <span role="cell" className="text-muted">
          <span className="text-xs sm:hidden">{other}: </span>
          {event}
        </span>
      </div>
    ))}
  </div>
)
