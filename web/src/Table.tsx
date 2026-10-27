import { type Fn, fixed, niceMax, type View } from './data'

const ROW =
  'grid grid-cols-[28px_minmax(0,1fr)_170px_100px_72px_72px_64px] items-center gap-4 px-5 py-3.5 text-right [&>:nth-child(-n+2)]:text-left'

const Unit = ({ children, big }: { children: string; big?: boolean }) => (
  <span className={`ml-[3px] text-muted ${big ? 'text-xs' : 'text-[11px]'}`}>{children}</span>
)

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
    const point = latest.points.get(f.id)!
    return (
      <div
        key={f.id}
        className={`${ROW} cursor-pointer border-b border-white/5 font-mono text-sm text-value ${on ? '' : 'opacity-40'} ${focus === f.base ? 'bg-white/4' : ''}`}
        onMouseEnter={() => view.setFocus(f.base)}
        onMouseLeave={() => view.setFocus(undefined)}
        onClick={() => view.toggle(f.base)}
      >
        <span className="text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="min-h-7 w-1 shrink-0 self-stretch rounded-xs" style={{ background: f.color }} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 font-medium wrap-anywhere text-ink">
              <img
                src={`https://cdn.simpleicons.org/${f.family === 'Bun' ? 'bun/f3d9a4' : 'nodedotjs/7fd35b'}`}
                alt=""
                width={18}
                height={18}
                className="block shrink-0"
              />
              {f.base}
              {f.preview && (
                <span className="rounded-full border border-white/16 px-[7px] py-0.5 font-sans text-[11px] font-normal text-soft">
                  preview
                </span>
              )}
            </div>
            <span className="font-sans text-[13px]/[1.45] text-pretty text-muted">
              <span className="font-mono text-xs text-soft">{point.runtime}</span>
              {f.ships && ` · ${f.ships}`}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-lg tracking-[-0.02em]" style={isBest('cold', cold) ? { color: f.color } : undefined}>
            {fixed(cold, 1)}
            <Unit big>ms</Unit>
          </span>
          <div
            className="relative h-3 before:absolute before:inset-x-0 before:top-[5px] before:h-0.5 before:rounded-[1px] before:bg-white/6"
            title={`${tickRun.rounds} cold starts`}
          >
            {(tickRun.points.get(f.id)?.initDurations ?? []).map((v, k) => (
              <span
                key={k}
                className="absolute top-0 h-3 w-0.5 -translate-x-px rounded-[1px] opacity-75"
                style={{ left: `${(v / tickMax) * 100}%`, background: f.color }}
                title={`${v.toFixed(2)} ms`}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted">
            p50 {fixed(p50, 1)} · p90{' '}
            <span className={cold !== undefined && p90 !== undefined && p90 > cold * 1.6 ? 'text-warn' : ''}>
              {fixed(p90, 1)}
            </span>
          </span>
          {startup !== undefined && (
            <span className="text-[11px] text-muted" title="Of the cold start, the time spent inside the process">
              in-process {fixed(startup, 1)}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-base tracking-[-0.02em]" style={isBest('warm', warm) ? { color: f.color } : undefined}>
            {fixed(warm, 2)}
            <Unit>ms</Unit>
          </span>
          <span className="text-[11px] text-muted">p90 {fixed(warmP90, 2)}</span>
        </div>
        <span className={isBest('mem', mem) ? 'text-white' : ''}>
          {fixed(mem, 1)}
          <Unit>MB</Unit>
        </span>
        <span className={isBest('dur', dur) ? 'text-white' : ''}>
          {fixed(dur, 2)}
          <Unit>ms</Unit>
        </span>
        <span>
          {point.size ? point.size.toFixed(1) : '—'}
          <Unit>MB</Unit>
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 bg-panel">
      <div className="min-w-[760px]">
        <div className={`${ROW} border-b border-white/8 text-[11px] tracking-[0.06em] text-muted uppercase`}>
          <span>#</span>
          <span>Function · what ships</span>
          <span>Cold start</span>
          <span>Warm start</span>
          <span>Memory</span>
          <span>Duration</span>
          <span>Size</span>
        </div>
        {rows.map(row)}
      </div>
    </div>
  )
}
