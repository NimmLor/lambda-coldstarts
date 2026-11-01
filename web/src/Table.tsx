import { type ReactNode, useState } from 'react'
import { track } from './analytics'
import { type Fn, fixed, niceMax, type Point, type View } from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'

const ICONS = { Bun: bunIcon, LLRT: llrtIcon, Node: nodeIcon }

/**
 * Eight columns from `xl`, where the name still has room beside them; below it each row is a card: the rank and logo over the name, beside
 * them the cold start, then the build, the ticks, the percentiles and the other figures under it.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 py-4 xl:grid-cols-[2rem_minmax(0,1fr)_13rem_6.5rem_7rem_6rem_6rem_5.5rem] xl:items-center xl:gap-4'

/** The columns the list can be sorted by, in their order; every one is better lower. */
const COLUMNS = [
  { key: 'cold', title: 'Cold start' },
  { key: 'trip', title: 'First answer' },
  { key: 'warm', title: 'Warm start' },
  { key: 'mem', title: 'Memory used' },
  { key: 'dur', title: 'Duration' },
  { key: 'size', title: 'Size' },
] as const
type SortKey = (typeof COLUMNS)[number]['key']
type Sort = { key: SortKey; reversed: boolean }

/** The caret beside the sorted column's heading: up when the lowest comes first. */
const Caret = ({ on, up }: { on: boolean; up: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 10 6"
    className={`w-2 shrink-0 ${on ? '' : 'opacity-0'} ${up ? 'rotate-180' : ''}`}
  >
    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const Unit = ({ children }: { children: string }) => (
  <span className="ml-1 text-xs text-muted">{children}</span>
)

/** What the run measured, in the instrument face; the words around it stay in the body face. */
const Reading = ({ children, className = '' }: { children: string; className?: string }) => (
  <span className={`font-mono slashed-zero ${className}`}>{children}</span>
)

/** A cold start's breakdown: its label over the reading, so the readings line up down the table. */
const Figure = ({
  label,
  children,
  className = '',
  title,
}: {
  label: string
  children: string
  className?: string
  title?: string
}) => (
  <div className="flex flex-col" title={title}>
    <dt className="text-xs text-muted">{label}</dt>
    <dd>
      <Reading className={`text-sm ${className || 'text-ink-2'}`}>{children}</Reading>
    </dd>
  </div>
)

/**
 * A dashed outline for how a build was made or where it runs; a filled amber chip for a runtime
 * AWS hasn't released yet.
 */
const TONES = {
  outline: 'border-dashed border-rule-2 text-ink-2',
  amber: 'border-rule bg-accent-soft text-accent',
}

const Badge = ({ children, tone }: { children: string; tone: keyof typeof TONES }) => (
  <span className={`rounded-chip border px-1.5 text-xs font-medium ${TONES[tone]}`}>
    {children}
  </span>
)

/** One figure: its label shows only once the head row is gone. */
const Cell = ({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) => (
  <div
    className={`flex min-w-0 flex-col items-start gap-1.5 xl:items-end xl:text-right ${className}`}
  >
    <span className="font-body text-xs font-medium text-muted xl:hidden">{label}</span>
    {children}
  </div>
)

/** `bun build --compile --aot`: the tool dim, each flag a token that wraps as a whole. */
const Command = ({ build }: { build: string }) => {
  const [tool, ...flags] = build.split(/ (?=--)/)
  return (
    <code className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs/normal text-muted">
      <span>{tool}</span>
      {flags.map((flag) => (
        <span key={flag} className="whitespace-nowrap text-ink-2">
          {flag}
        </span>
      ))}
    </code>
  )
}

/**
 * `bun 1.4.4+38afee6c8` or `llrt-lambda-arm64-no-sdk@v0.9.0-beta`: the SDK flavor of an LLRT
 * build, the release, the build after it.
 */
const VERSION = /^(?:.+?-(\w+-sdk)|.+?)[ @]v?(\d[^+]*)(\+.+)?$/

/**
 * The release it ran on, brightest, with which of its builds, then Lambda's runtime; the row's
 * name already says what ran.
 */
const Versions = ({ point }: { point: Point }) => {
  const [, sdk, release, build] = point.version?.match(VERSION) ?? []
  return (
    <span className="flex flex-wrap gap-x-[2.5ch] overflow-hidden font-mono text-muted slashed-zero">
      {point.version && (
        <span title={point.version}>
          {release ? (
            <>
              <span className="text-ink-2">{release}</span>
              {build && <span className="opacity-60">{build}</span>}
              {sdk && <span className="ml-[1ch]">{sdk}</span>}
            </>
          ) : (
            <span className="text-ink-2">{point.version}</span>
          )}
        </span>
      )}
      {/* The dot sits in the gap, so it's clipped away when the runtime wraps to a line of its own. */}
      <span
        title="Lambda runtime"
        className={
          point.version
            ? "relative before:absolute before:right-full before:mr-[0.75ch] before:content-['·']"
            : ''
        }
      >
        {point.runtime}
      </span>
    </span>
  )
}

/**
 * Every function on the architecture, ranked by a column, lowest first: the cold start unless
 * another heading, or below `xl` the sort picker, says otherwise. Picking it again reverses it.
 */
export const Table = ({ view }: { view: View }) => {
  const { runs, latest, fns, shown, hidden, hover, focus, agg } = view
  const [sort, setSort] = useState<Sort>({ key: 'cold', reversed: false })
  const pickSort = (key: SortKey) => {
    const next = { key, reversed: sort.key === key && !sort.reversed }
    track('list_sorted', { column: next.reversed ? `${key}:reversed` : key })
    setSort(next)
  }
  const tickRun = hover !== undefined ? runs[hover]! : latest
  const tickMax = niceMax(
    // Every function's, hidden ones included as their rows stay, on every architecture and size.
    Math.max(0, ...latest.functions.flatMap((f) => tickRun.points.get(f.id)?.initDurations ?? []))
  )
  const mins = Object.fromEntries(
    (['cold', 'trip', 'warm', 'mem', 'dur'] as const).map((k) => [
      k,
      Math.min(...shown.map((f) => agg(f, k) ?? Infinity)),
    ])
  )
  /** A function's value in the sorted column; the size is the deployed code's, which every run shares. */
  const value = (f: Fn, key: SortKey) =>
    key === 'size' ? latest.points.get(f.id)?.size || undefined : agg(f, key)
  const rows = fns.toSorted((a, b) => {
    const va = value(a, sort.key)
    const vb = value(b, sort.key)
    // Functions without the value go last, whichever way: older runs lack the first answer.
    if (va === undefined || vb === undefined)
      return Number(va === undefined) - Number(vb === undefined)
    return sort.reversed ? vb - va : va - vb
  })

  const row = (f: Fn, i: number) => {
    const on = !hidden.has(f.base)
    const rank = String(i + 1).padStart(2, '0')
    const [cold, p50, p90, startup, trip, warm, warmP90, mem, dur] = (
      ['cold', 'p50', 'p90', 'startup', 'trip', 'warm', 'warmP90', 'mem', 'dur'] as const
    ).map((k) => agg(f, k))
    const isBest = (k: keyof typeof mins, v: number | undefined) =>
      on && v !== undefined && v === mins[k]
    // The leader in a column is a reading, so it takes the instrument's cool tint.
    const best = (k: keyof typeof mins, v: number | undefined) =>
      isBest(k, v) ? 'rounded-chip bg-cool-soft px-1 text-cool [&>span]:text-cool' : ''
    const point = latest.points.get(f.id)!
    return (
      <div
        key={f.id}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        className={`${ROW} cursor-pointer border-b border-rule px-2 text-sm text-ink focus-visible:-outline-offset-2 sm:px-4 ${on ? '' : 'opacity-50'} ${focus === f.base ? 'bg-paper-2' : ''}`}
        onMouseEnter={() => view.setFocus(f.base)}
        onMouseLeave={() => view.setFocus(undefined)}
        onClick={() => view.toggle(f.base)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          view.toggle(f.base)
        }}
      >
        <span className="measured text-xs text-muted max-xl:hidden">{rank}</span>
        {/* Its own column from `xl`; below it, its parts sit in the card's grid. */}
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-2">
          {/* On a card the logo heads the name, which has the line to itself and its badges. */}
          <div
            className="flex min-w-0 flex-col items-start gap-1.5 text-md font-medium xl:flex-row xl:items-center xl:gap-2"
            title={[f.base, f.about].filter(Boolean).join('\n')}
          >
            <span className="flex items-center gap-2">
              {/* The card has no column for the rank, so it leads the logo. */}
              <span className="measured text-xs font-normal text-muted xl:hidden">{rank}</span>
              <img src={ICONS[f.family]} alt="" width={18} height={18} className="block shrink-0" />
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {f.name}
              {f.canary && <Badge tone="outline">canary Bun</Badge>}
              {f.preview && <Badge tone="amber">preview</Badge>}
              {/* Every row but this has the size the heading names. */}
              {f.web && <Badge tone="outline">{`${f.memoryMb / 1024} GB`}</Badge>}
            </span>
          </div>
          <div className="col-span-full flex flex-col gap-1 text-xs/normal">
            <Command build={f.build} />
            {tickRun.points.has(f.id) && <Versions point={tickRun.points.get(f.id)!} />}
          </div>
        </div>
        {/* Its own column from `xl`; below it, its parts sit in the card's grid. */}
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:items-end xl:gap-1.5 xl:text-right">
          <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 xl:block">
            <span className="text-xs font-medium text-muted xl:hidden">Cold start</span>
            <span className={`text-xl font-medium tracking-tight ${best('cold', cold)}`}>
              <Reading>{fixed(cold, 1)}</Reading>
              <Unit>ms</Unit>
            </span>
          </div>
          <div
            className="relative col-span-full h-3 w-full before:absolute before:inset-x-0 before:top-[5px] before:h-0.5 before:bg-rule xl:max-w-64"
            title={`${tickRun.rounds} cold starts`}
          >
            {(tickRun.points.get(f.id)?.initDurations ?? []).map((v, k) => (
              <span
                key={k}
                className="absolute top-0 h-3 w-0.5 -translate-x-px"
                style={{ left: `${(v / tickMax) * 100}%`, background: f.color }}
                title={`${v.toFixed(2)} ms`}
              />
            ))}
          </div>
          <dl className="col-span-full grid w-full grid-cols-3 gap-x-3 xl:max-w-64">
            <Figure label="p50">{fixed(p50, 1)}</Figure>
            <Figure
              label="p90"
              className={
                cold !== undefined && p90 !== undefined && p90 > cold * 1.6 ? 'text-bad' : ''
              }
            >
              {fixed(p90, 1)}
            </Figure>
            {startup !== undefined && (
              <Figure
                label="to handler"
                title="From process start until the handler was loaded, timed by the process itself"
              >
                {fixed(startup, 1)}
              </Figure>
            )}
          </dl>
        </div>
        {/* One line of five from `sm`, their labels short to fit; three and two on a phone, two by
            two on the narrowest. */}
        <div className="col-span-full grid grid-cols-2 gap-3 min-[22rem]:grid-cols-3 sm:grid-cols-5 xl:contents">
          <Cell label="First answer">
            <span className={`xl:text-md ${best('trip', trip)}`}>
              <Reading>{fixed(trip, 0)}</Reading>
              <Unit>ms</Unit>
            </span>
          </Cell>
          <Cell label="Warm">
            <span className={`xl:text-md ${best('warm', warm)}`}>
              <Reading>{fixed(warm, 2)}</Reading>
              <Unit>ms</Unit>
            </span>
            <span className="text-xs text-muted">
              p90 <Reading>{fixed(warmP90, 2)}</Reading>
            </span>
          </Cell>
          <Cell label="Memory">
            <span className={best('mem', mem)}>
              <Reading>{fixed(mem, 1)}</Reading>
              <Unit>MB</Unit>
            </span>
          </Cell>
          <Cell label="Duration">
            <span className={best('dur', dur)}>
              <Reading>{fixed(dur, 2)}</Reading>
              <Unit>ms</Unit>
            </span>
          </Cell>
          <Cell label="Size">
            <span>
              <Reading>{point.size ? point.size.toFixed(1) : '—'}</Reading>
              <Unit>MB</Unit>
            </span>
          </Cell>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Below `xl` there's no heading row to click, so the sort has a picker of its own. */}
      <label className="flex items-center justify-end gap-2.5 pb-3 xl:hidden">
        <span className="text-xs font-medium text-muted">Sort by</span>
        <span className="select">
          <select
            value={sort.key}
            onChange={(e) => pickSort(e.target.value as SortKey)}
            className="field-sizing-content"
          >
            {COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.title}
              </option>
            ))}
          </select>
          <svg aria-hidden="true" viewBox="0 0 10 6" className="select__caret">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
        <button
          type="button"
          onClick={() => pickSort(sort.key)}
          aria-label={sort.reversed ? 'Show lowest first' : 'Show highest first'}
          className="btn px-2"
        >
          <Caret on up={!sort.reversed} />
        </button>
      </label>
      <div
        className={`${ROW} hidden border-b border-rule-2 px-2 text-sm font-medium whitespace-nowrap text-muted sm:px-4 xl:grid`}
      >
        <span>#</span>
        <span>Function and build</span>
        {COLUMNS.map((c) => {
          const on = sort.key === c.key
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => pickSort(c.key)}
              aria-label={`Sort by ${c.title.toLowerCase()}${on ? (sort.reversed ? ', highest first' : ', lowest first') : ''}`}
              className={`inline-flex cursor-pointer items-center justify-end gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}
            >
              {c.title}
              <Caret on={on} up={!sort.reversed} />
            </button>
          )
        })}
      </div>
      {rows.map(row)}
    </div>
  )
}
