import { useState } from 'react'
import { Y_LABEL } from './Chart'
import {
  balanceOf,
  bestOfFamilies,
  efficiency,
  FAMILY_NAMES,
  type Fn,
  CALLS,
  type Call,
  type Figures,
  invocationCost,
  isEvent,
  type SizePoint,
  STACK_REGION,
  WORKLOADS,
  type WorkloadKind,
} from './data'
import type { TabProps } from './tabs'
import { Card, FnLabel, Segmented } from './ui'
import { variantsOf } from './WarmStarts'

/** Steps of 1, 2 and 5 across `[min, max]`, or only powers of ten where those would crowd. */
const logTicks = (min: number, max: number) => {
  const ticks: number[] = []
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const t = m * 10 ** e
      if (t >= min && t <= max) ticks.push(t)
    }
  }
  if (ticks.length > 6) return ticks.filter((t) => Number.isInteger(Math.log10(t)))
  if (ticks.length >= 3) return ticks
  // A spread too narrow for those, like the workload's costs: even steps of 1, 2, 2.5 or 5.
  const raw = (max - min) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw)! * magnitude
  const even: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) even.push(t)
  return even
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`
const ms = (n: number) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)} ms`
const label = (n: number) => String(Number(n.toPrecision(3)))

type Row = { f: Fn; points: SizePoint[]; best: NonNullable<ReturnType<typeof efficiency>> }

/**
 * Cost against time at every size, on log scales: each variant a line from its smallest size to
 * its largest, its best balance ringed. Down is faster, left is cheaper.
 */
const Scatter = ({ rows }: { rows: Row[] }) => {
  const all = rows.flatMap((r) => r.points)
  const [cMin, cMax] = [Math.min(...all.map((p) => p.cost)), Math.max(...all.map((p) => p.cost))]
  const [tMin, tMax] = [Math.min(...all.map((p) => p.ms)), Math.max(...all.map((p) => p.ms))]
  // A little room at either end, and at least a doubling, so a narrow spread doesn't fill the plot.
  const span = (lo: number, hi: number) => {
    const pad = Math.max(1.15, Math.sqrt(2 / (hi / lo)))
    return [Math.log10(lo / pad), Math.log10(hi * pad)] as const
  }
  const [x0, x1] = span(cMin, cMax)
  const [y0, y1] = span(tMin, tMax)
  const x = (cost: number) => ((Math.log10(cost) - x0) / (x1 - x0)) * 100
  const y = (time: number) => 100 - ((Math.log10(time) - y0) / (y1 - y0)) * 100
  const xTicks = logTicks(10 ** x0, 10 ** x1)
  const yTicks = logTicks(10 ** y0, 10 ** y1)
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-72"
        role="img"
        aria-label={`Cost against time at every memory size: ${rows.map((r) => `${r.f.name} best balanced at ${r.best.balanced.memoryMb} MB, ${ms(r.best.balanced.ms)} for ${usd(r.best.balanced.cost)} per million`).join('; ')}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {yTicks.map((t) => (
            <line
              key={`y${t}`}
              x1={0}
              x2={100}
              y1={y(t)}
              y2={y(t)}
              className="stroke-rule"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {xTicks.map((t) => (
            <line
              key={`x${t}`}
              x1={x(t)}
              x2={x(t)}
              y1={0}
              y2={100}
              className="stroke-rule"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {rows.map((r) => (
            <polyline
              key={r.f.base}
              fill="none"
              style={{ stroke: r.f.color }}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={r.points.map((p) => `${x(p.cost)},${y(p.ms)}`).join(' ')}
            />
          ))}
        </svg>
        {rows.flatMap((r) =>
          r.points.map((p) => {
            const best = p === r.best.balanced
            return (
              <span
                key={`${r.f.base}:${p.memoryMb}`}
                title={`${r.f.name} at ${p.memoryMb} MB: ${ms(p.ms)}, ${usd(p.cost)} per million${best ? ' · best balance' : ''}`}
                className={`mark absolute -translate-1/2 rounded-full ${best ? 'size-3 border-2 border-paper-2 outline-2' : 'size-1.5'}`}
                style={{
                  left: `${x(p.cost)}%`,
                  top: `${y(p.ms)}%`,
                  background: r.f.color,
                  outlineColor: best ? r.f.color : undefined,
                }}
              />
            )
          })
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {yTicks.map((t) => (
            <span key={t} className={Y_LABEL} style={{ top: `${y(t)}%` }}>
              {label(t)} ms
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative h-5">
        {xTicks.map((t) => (
          <span
            key={t}
            className="measured absolute -translate-x-1/2 text-xs whitespace-nowrap text-muted"
            style={{ left: `${x(t)}%` }}
          >
            ${label(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** One pick of a row: a size, what a call there takes and what a million cost. */
const Pick = ({ p, onMemory }: { p: SizePoint; onMemory: (mb: number) => void }) => (
  <button
    type="button"
    onClick={() => onMemory(p.memoryMb)}
    title={`Show ${p.memoryMb} MB`}
    className="measured flex cursor-pointer flex-col items-end text-right hover:text-cool"
  >
    <span className="text-ink">{p.memoryMb} MB</span>
    <span className="text-xs whitespace-nowrap text-muted">
      {usd(p.cost)} · {ms(p.ms)}
    </span>
  </button>
)

/**
 * One workload's comparison: the best balance among `rows`, cost against time at every size, and
 * each function's cheapest, best balanced and fastest size.
 */
const Panel = ({
  kind,
  call,
  rows,
  every,
  builds,
  onMemory,
}: {
  kind: WorkloadKind
  call: Call
  rows: Row[]
  every: boolean
  /** How many builds of `f`'s family the rows were picked from. */
  builds: (r: Row) => number
  onMemory: (mb: number) => void
}) => {
  const lead = rows[0]
  return (
    <section
      aria-labelledby={`cost-efficiency-${kind}`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-rule p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h4 id={`cost-efficiency-${kind}`} className="text-md">
          {WORKLOADS[kind].name}
        </h4>
        <p className="m-0 text-sm text-pretty text-muted">
          {kind === 'hello'
            ? 'The handler answers at once: what a call costs when the runtime is all there is.'
            : call === 'warm'
              ? 'The handler builds, ranks and serializes 2,000 orders ten times over first: Lambda’s Duration of that call.'
              : 'The handler builds, ranks and serializes 2,000 orders ten times over first. Not measured as one call: the hello world’s cold start plus the workload’s first run.'}
        </p>
      </div>
      {lead ? (
        <>
          <p className="datum m-0 text-ink-2">
            Best balance: <span className="text-ink">{lead.f.name}</span> at{' '}
            {lead.best.balanced.memoryMb} MB,{' '}
            <span className="measured text-ink">{usd(lead.best.balanced.cost)}</span> per million of{' '}
            <span className="measured text-ink">{ms(lead.best.balanced.ms)}</span>.
          </p>
          <Scatter rows={rows} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule-2 text-muted">
                  <th scope="col" className="px-1.5 py-2 text-left font-medium">
                    Function
                  </th>
                  <th scope="col" className="px-1.5 py-2 text-right font-medium">
                    Cheapest
                  </th>
                  <th scope="col" className="px-1.5 py-2 text-right font-medium">
                    Best balance
                  </th>
                  <th scope="col" className="px-1.5 py-2 text-right font-medium">
                    Fastest
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.f.base} className="border-b border-rule">
                    <th scope="row" className="px-1.5 py-2 text-left font-normal">
                      <FnLabel f={r.f} className="text-sm" />
                      {!every && r.f.family !== 'Node' && builds(r) > 1 && (
                        <span className="block pl-4 text-xs text-muted">
                          best of {builds(r)} {FAMILY_NAMES[r.f.family]} builds
                        </span>
                      )}
                    </th>
                    {[r.best.cheapest, r.best.balanced, r.best.fastest].map((p, i) => (
                      <td key={i} className="px-1.5 py-2">
                        <div className="flex justify-end">
                          <Pick p={p} onMemory={onMemory} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="m-0 text-sm text-muted">
          Not measured yet: it shows here from the first run that does.
        </p>
      )}
    </section>
  )
}

/**
 * Which memory size pays off, for a handler that answers at once and for one with work to do:
 * cost and time at every size, and each function's cheapest, fastest and best balanced size.
 */
export const CostEfficiency = ({
  view,
  figures,
  functions,
  arch,
  memories,
  onMemory,
}: TabProps) => {
  const [call, setCall] = useState<Call>('cold')
  // Every build of Bun and LLRT, rather than the best of each beside every Node.js version.
  const [every, setEvery] = useState(false)
  const shown = new Set(view.shown.map((f) => f.base))
  const variants = variantsOf(
    functions.filter((f) => isEvent(f) && f.arch === arch && shown.has(f.base))
  )
  const rowsFor = (time: (x: Figures) => number | undefined) =>
    variants
      .flatMap((v): Row[] => {
        const points = memories.flatMap((mb): SizePoint[] => {
          const f = functions.find((g) => g.id === `${v.base}/${arch}/${mb}`)
          const x = figures.get(`${v.base}/${arch}/${mb}`)
          const t = x && time(x)
          const cost = f && t !== undefined ? invocationCost(f, t) : undefined
          return t === undefined || cost === undefined ? [] : [{ memoryMb: mb, ms: t, cost }]
        })
        const best = efficiency(points)
        return best ? [{ f: v, points, best }] : []
      })
      .sort((a, b) => balanceOf(a.best) - balanceOf(b.best))
  const panels = (Object.keys(WORKLOADS) as WorkloadKind[]).map((kind) => {
    const all = rowsFor((x) => WORKLOADS[kind].ms(x, call))
    return {
      kind,
      all,
      rows: every ? all : bestOfFamilies(all, (r) => balanceOf(r.best)),
      builds: (r: Row) => all.filter((o) => o.f.family === r.f.family).length,
    }
  })
  if (panels.every((p) => !p.all.length)) return null
  const most = Math.max(...panels.map((p) => p.all.length))

  return (
    <Card
      id="cost-efficiency"
      title="Cost efficiency"
      caption={`What a million calls cost on ${arch} at each size, and how long one takes. Lambda bills the duration rounded up to the millisecond, times memory, at first-tier prices in ${STACK_REGION}, plus the request. Below 1769 MB a function gets its share of a vCPU, so work that keeps the CPU busy gets faster as it gets bigger, at about the same cost.`}
      aside={
        <Segmented
          label="Calls"
          options={Object.keys(CALLS) as Call[]}
          value={call}
          onPick={setCall}
          text={(c) => CALLS[c]}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {panels.map((p) => (
          <Panel
            key={p.kind}
            kind={p.kind}
            call={call}
            rows={p.rows}
            every={every}
            builds={p.builds}
            onMemory={onMemory}
          />
        ))}
      </div>
      <p className="m-0 text-xs text-muted">
        Cost per million against time per call, both on log scales: left is cheaper, down is faster.
        Each line runs through a function’s sizes, and its best balance, the least cost × time, is
        ringed: a size that halves the time is worth up to twice the cost.{' '}
        {most > panels[0]!.rows.length || every ? (
          <button
            type="button"
            onClick={() => setEvery(!every)}
            aria-pressed={every}
            className="cursor-pointer text-ink-2 underline decoration-rule-2 underline-offset-2 hover:text-ink"
          >
            {every ? 'Show the best Bun and LLRT build only' : `Show all ${most} builds`}
          </button>
        ) : null}
      </p>
    </Card>
  )
}
