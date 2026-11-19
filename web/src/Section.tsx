import type { ReactNode } from 'react'
import { Chart, type Metric, Versus } from './Chart'
import { ChartIcon } from './ChartIcon'
import { type Fn, fixed, type View } from './data'

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

/**
 * One figure for each function in a section, each against the counterpart's: the view's baseline,
 * or for a customer-managed runtime the variant it repackages, when that's shown.
 */
export const Figure = ({ metric: m, view }: { metric: Metric; view: View }) => {
  const { fns, baseline, agg } = view
  const counterpart = (f: Fn) => (f.cmr ? fns.find((c) => c.base === f.cmr!.counterpart) : baseline)
  // When every row has the same size, the chart's caption names it.
  const oneSize = new Set(fns.map((f) => f.memoryMb)).size === 1
  return (
    <article className="flex min-w-0 flex-col gap-4 bg-paper-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <h3 className="flex items-baseline gap-2 text-lg text-ink">
          <ChartIcon name={m.icon} className="size-[1.125rem]" />
          {m.title}
        </h3>
        {m.unit}
      </div>
      <dl className="m-0 flex flex-col gap-2.5">
        {fns.map((f) => {
          const value = agg(f, m.key)
          const against = counterpart(f)
          return (
            <div key={f.id} className="flex items-baseline justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: f.color }}
                />
                <span className="truncate">
                  {f.name}
                  {/* A Web Function has one size, which the introduction names, and a MicroVM's name has its own. */}
                  {!f.web && !f.microvm && !oneSize && (
                    <span className="text-muted"> · {f.memoryMb} MB</span>
                  )}
                </span>
              </dt>
              <dd className="m-0 flex items-baseline gap-2 whitespace-nowrap">
                {against && f !== against && (
                  <Versus value={value} baseline={agg(against, m.key)} />
                )}
                <span className="measured text-md text-ink">{fixed(value, m.digits)}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </article>
  )
}

/** A section's heading, with the checkbox that shows the counterparts beside it. */
export const SectionHead = ({
  title,
  compared,
  onCompare,
  compareLabel = 'Compare with Event Function',
  children,
}: {
  title: string
  compared: boolean
  onCompare: (on: boolean) => void
  /** What the checkbox says it shows. */
  compareLabel?: string
  /** The introduction under the heading. */
  children: ReactNode
}) => (
  <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <h2 className="text-2xl">{title}</h2>
      <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={compared}
          onChange={(e) => onCompare(e.currentTarget.checked)}
          className="size-4 cursor-pointer accent-cool"
        />
        {compareLabel}
      </label>
    </div>
    <p className="max-w-prose text-pretty text-ink-2">{children}</p>
  </div>
)

/**
 * A figure for each of `figures`, and under them the first one over time, against the
 * counterparts in `view` when `compared`.
 */
export const Board = ({
  view,
  figures,
  compared,
  caption,
}: {
  view: View
  figures: Metric[]
  compared: boolean
  /** What the chart's caption says after its unit, instead of the counterparts' size. */
  caption?: string
}) => {
  const [first] = figures
  return (
    <div
      onMouseLeave={() => view.setHover(undefined)}
      className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3"
    >
      {figures.map((m) => (
        <Figure key={m.key} metric={m} view={view} />
      ))}
      <Chart
        // Under the first figure, which has its plain title.
        metric={{ ...first!, title: `${first!.title} over time`, height: 200 }}
        wide
        view={view}
        caption={
          caption
            ? `${first!.unit}, mean per run · ${caption}`
            : compared
              ? `${first!.unit}, mean per run · Event Function at ${view.memoryMb} MB`
              : `${first!.unit}, mean per run`
        }
        className="col-span-full"
      />
    </div>
  )
}
