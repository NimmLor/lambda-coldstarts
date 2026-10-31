import type { ReactNode } from 'react'
import { type Fn, fixed, niceMax, type Point, type View } from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'

const ICONS = { Bun: bunIcon, LLRT: llrtIcon, Node: nodeIcon }

/**
 * Seven columns from `lg`; below it each row is a card: the rank and logo over the name, beside
 * them the cold start, then the build, the ticks, the percentiles and one line of the other
 * figures under it.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 py-4 lg:grid-cols-[2rem_minmax(0,1fr)_13rem_7rem_6rem_6rem_5.5rem] lg:items-center lg:gap-4'

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
    className={`flex min-w-0 flex-col items-start gap-1.5 lg:items-end lg:text-right ${className}`}
  >
    <span className="font-body text-xs font-medium text-muted lg:hidden">{label}</span>
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

/** Every function on the architecture, fastest cold start first. */
export const Table = ({ view }: { view: View }) => {
  const { runs, latest, fns, shown, hidden, hover, focus, agg } = view
  const tickRun = hover !== undefined ? runs[hover]! : latest
  const tickMax = niceMax(
    // Every function's, hidden ones included as their rows stay, on every architecture and size.
    Math.max(0, ...latest.functions.flatMap((f) => tickRun.points.get(f.id)?.initDurations ?? []))
  )
  const mins = Object.fromEntries(
    (['cold', 'warm', 'mem', 'dur'] as const).map((k) => [
      k,
      Math.min(...shown.map((f) => agg(f, k) ?? Infinity)),
    ])
  )
  const rows = fns.toSorted((a, b) => (agg(a, 'cold') ?? Infinity) - (agg(b, 'cold') ?? Infinity))

  const row = (f: Fn, i: number) => {
    const on = !hidden.has(f.base)
    const rank = String(i + 1).padStart(2, '0')
    const [cold, p50, p90, startup, warm, warmP90, mem, dur] = (
      ['cold', 'p50', 'p90', 'startup', 'warm', 'warmP90', 'mem', 'dur'] as const
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
        <span className="measured text-xs text-muted max-lg:hidden">{rank}</span>
        {/* Its own column from `lg`; below it, its parts sit in the card's grid. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-2">
          {/* On a card the logo heads the name, which has the line to itself and its badges. */}
          <div
            className="flex min-w-0 flex-col items-start gap-1.5 text-md font-medium lg:flex-row lg:items-center lg:gap-2"
            title={[f.base, f.about].filter(Boolean).join('\n')}
          >
            <span className="flex items-center gap-2">
              {/* The card has no column for the rank, so it leads the logo. */}
              <span className="measured text-xs font-normal text-muted lg:hidden">{rank}</span>
              <img src={ICONS[f.family]} alt="" width={18} height={18} className="block shrink-0" />
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {f.name}
              {f.canary && <Badge tone="outline">canary Bun</Badge>}
              {f.preview && <Badge tone="amber">preview</Badge>}
              {f.region && <Badge tone="outline">{f.region}</Badge>}
            </span>
          </div>
          <div className="col-span-full flex flex-col gap-1 text-xs/normal">
            <Command build={f.build} />
            {tickRun.points.has(f.id) && <Versions point={tickRun.points.get(f.id)!} />}
          </div>
        </div>
        {/* Its own column from `lg`; below it, its parts sit in the card's grid. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:items-end lg:gap-1.5 lg:text-right">
          <div className="col-start-2 row-start-1 flex flex-col items-end gap-0.5 lg:block">
            <span className="text-xs font-medium text-muted lg:hidden">Cold start</span>
            <span className={`text-xl font-medium tracking-tight ${best('cold', cold)}`}>
              <Reading>{fixed(cold, 1)}</Reading>
              <Unit>ms</Unit>
            </span>
          </div>
          <div
            className="relative col-span-full h-3 w-full before:absolute before:inset-x-0 before:top-[5px] before:h-0.5 before:bg-rule lg:max-w-64"
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
          <dl className="col-span-full grid w-full grid-cols-3 gap-x-3 lg:max-w-64">
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
        {/* One line of four on a phone, their labels short to fit; two by two on the narrowest. */}
        <div className="col-span-full grid grid-cols-2 gap-3 min-[22rem]:grid-cols-4 lg:contents">
          <Cell label="Warm">
            <span className={`lg:text-md ${best('warm', warm)}`}>
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
      <div
        className={`${ROW} hidden border-b border-rule-2 px-2 text-sm font-medium whitespace-nowrap text-muted sm:px-4 lg:grid [&>:nth-child(n+3)]:text-right`}
      >
        <span>#</span>
        <span>Function and build</span>
        <span>Cold start</span>
        <span>Warm start</span>
        <span>Memory used</span>
        <span>Duration</span>
        <span>Size</span>
      </div>
      {rows.map(row)}
    </div>
  )
}
