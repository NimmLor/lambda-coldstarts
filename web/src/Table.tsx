import type { ReactNode } from 'react'
import { type Fn, fixed, niceMax, type View } from './data'

/** Seven columns from `lg`; below it each row restacks as the name over labelled figures. */
const ROW =
  'grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 gap-y-4 py-4 lg:grid-cols-[2rem_minmax(0,1fr)_11rem_7rem_6rem_6rem_5.5rem] lg:items-center'

const Unit = ({ children }: { children: string }) => <span className="ml-1 text-xs text-muted">{children}</span>

/** What the run measured, in the instrument face; the words around it stay in the body face. */
const Reading = ({ children, className = '' }: { children: string; className?: string }) => (
  <span className={`font-mono slashed-zero ${className}`}>{children}</span>
)

const Badge = ({ children }: { children: string }) => (
  <span className="rounded-chip border border-rule bg-cool-soft px-1.5 text-xs font-medium text-cool">{children}</span>
)

/** One figure: its label shows only once the head row is gone. */
const Cell = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => (
  <div className={`flex min-w-0 flex-col items-start gap-1.5 lg:items-end lg:text-right ${className}`}>
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

/** Every function on the architecture, fastest cold start first. */
export const Table = ({ view }: { view: View }) => {
  const { runs, latest, fns, shown, hidden, hover, focus, agg } = view
  const tickRun = hover !== undefined ? runs[hover]! : latest
  const tickMax = niceMax(Math.max(0, ...fns.flatMap((f) => tickRun.points.get(f.id)?.initDurations ?? [])))
  const mins = Object.fromEntries(
    (['cold', 'warm', 'mem', 'dur'] as const).map((k) => [k, Math.min(...shown.map((f) => agg(f, k) ?? Infinity))])
  )
  const rows = fns.toSorted((a, b) => (agg(a, 'cold') ?? Infinity) - (agg(b, 'cold') ?? Infinity))

  const row = (f: Fn, i: number) => {
    const on = !hidden.has(f.base)
    const [cold, p50, p90, startup, warm, warmP90, mem, dur] = (
      ['cold', 'p50', 'p90', 'startup', 'warm', 'warmP90', 'mem', 'dur'] as const
    ).map((k) => agg(f, k))
    const isBest = (k: keyof typeof mins, v: number | undefined) => on && v !== undefined && v === mins[k]
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
        <span className="measured pt-0.5 text-xs text-muted lg:pt-0">{String(i + 1).padStart(2, '0')}</span>
        <div className="flex min-w-0 flex-col gap-2" title={[f.base, point.runtime, f.about].filter(Boolean).join('\n')}>
          <div className="flex flex-wrap items-center gap-2 text-md font-medium">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
            <img
              src={`https://cdn.simpleicons.org/${f.family === 'Bun' ? 'bun/f3d9a4' : 'nodedotjs/7fd35b'}`}
              alt=""
              width={18}
              height={18}
              className="block shrink-0"
            />
            {f.name}
            {f.canary && <Badge>canary Bun</Badge>}
            {f.preview && <Badge>preview</Badge>}
          </div>
          <Command build={f.build} />
        </div>
        <div className="col-start-2 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:contents">
          <Cell label="Cold start" className="col-span-2 sm:col-span-4 lg:col-span-1">
            <span className={`text-xl font-medium tracking-tight ${best('cold', cold)}`}>
              <Reading>{fixed(cold, 1)}</Reading>
              <Unit>ms</Unit>
            </span>
            <div
              className="relative h-3 w-full max-w-64 before:absolute before:inset-x-0 before:top-[5px] before:h-0.5 before:bg-rule"
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
            <span className="flex gap-3 text-xs text-muted">
              <span>
                p50 <Reading>{fixed(p50, 1)}</Reading>
              </span>
              <span>
                p90{' '}
                <Reading className={cold !== undefined && p90 !== undefined && p90 > cold * 1.6 ? 'text-bad' : ''}>
                  {fixed(p90, 1)}
                </Reading>
              </span>
            </span>
            {startup !== undefined && (
              <span className="text-xs text-muted" title="Of the cold start, the time spent inside the process">
                in-process <Reading>{fixed(startup, 1)}</Reading>
              </span>
            )}
          </Cell>
          <Cell label="Warm start">
            <span className={`text-md ${best('warm', warm)}`}>
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
        <span>Memory</span>
        <span>Duration</span>
        <span>Size</span>
      </div>
      {rows.map(row)}
    </div>
  )
}
