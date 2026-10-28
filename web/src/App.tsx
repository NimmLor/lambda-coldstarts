import { useCallback, useEffect, useState } from 'react'
import { Chart, type Metric } from './Chart'
import {
  DASHES,
  type Family,
  ORDER,
  type Run,
  type RunPoints,
  type Stat,
  VARIANTS,
  type View,
  mean,
  toPoints,
  when,
} from './data'
import { Functions } from './Functions'
import { Glance } from './Glance'
import lambdaIcon from './icons/lambda.svg'
import { REPO, SiteLinks, WRAP } from './layout'
import { MemoryChart } from './MemoryChart'
import { Table } from './Table'

/** PerfApi, behind the same CloudFront distribution; see infra/perf.ts and dev.ts. */
const API = '/api'
const DAY_MS = 864e5
const RANGES = [14, 30, 90]

const METRICS: Metric[] = [
  {
    key: 'cold',
    digits: 1,
    title: 'Cold start',
    unit: 'ms',
    height: 300,
    leader: 'Fastest',
    icon: 'cold',
  },
  {
    key: 'warm',
    digits: 2,
    title: 'Warm start',
    unit: 'ms',
    height: 180,
    leader: 'Fastest',
    icon: 'warm',
  },
  {
    key: 'mem',
    digits: 1,
    title: 'Memory used',
    unit: 'MB',
    height: 180,
    leader: 'Lowest',
    icon: 'mem',
  },
  {
    key: 'dur',
    digits: 2,
    title: 'Duration',
    unit: 'ms',
    height: 180,
    leader: 'Fastest',
    icon: 'dur',
  },
]

const Segmented = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  text = String,
  unit,
}: {
  label: string
  options: readonly T[]
  value: T | undefined
  onPick: (v: T) => void
  text?: (v: T) => string
  /** After each option in the phone's picker, which has no label to carry it. */
  unit?: string
}) => (
  <>
    <div className="flex shrink-0 items-center gap-2.5 max-sm:hidden">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="cells" role="group" aria-label={label}>
        {options.map((v) => (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>
            {text(v)}
          </button>
        ))}
      </div>
    </div>
    {/* A phone has no room for every cell: the system picker, its value saying what it is. */}
    <span className="select sm:hidden">
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onPick(options.find((o) => String(o) === e.target.value)!)}
      >
        {options.map((o) => (
          <option key={o} value={String(o)}>
            {unit ? `${text(o)} ${unit}` : text(o)}
          </option>
        ))}
      </select>
      <svg aria-hidden="true" viewBox="0 0 10 6" className="select__caret">
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  </>
)

/** A choice inside running text: the word it shows, over a transparent native select. */
const InlinePick = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  text = String,
  group,
}: {
  label: string
  options: readonly T[]
  value: T
  onPick: (v: T) => void
  text?: (v: T) => string
  /** Labels the options into optgroups, consecutive ones with the same label together. */
  group?: (v: T) => string
}) => {
  const option = (o: T) => (
    <option key={o} value={String(o)}>
      {text(o)}
    </option>
  )
  const groups: { label: string; options: T[] }[] = []
  for (const o of options) {
    const label = group?.(o) ?? ''
    if (groups.at(-1)?.label === label) groups.at(-1)!.options.push(o)
    else groups.push({ label, options: [o] })
  }
  return (
    <span className="pick">
      {/* The select announces the same value. */}
      <span aria-hidden="true">{text(value)}</span>
      <svg aria-hidden="true" viewBox="0 0 10 6" className="pick__caret">
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onPick(options.find((o) => String(o) === e.target.value)!)}
      >
        {group
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(option)}
              </optgroup>
            ))
          : options.map(option)}
      </select>
    </span>
  )
}

const Header = ({ latest }: { latest?: RunPoints }) => {
  const variants = new Set(latest?.functions.map((f) => f.base))
  const count = (family: Family) =>
    [...variants].filter((b) => VARIANTS[b]?.family === family).length
  return (
    <header
      className={`${WRAP} grid gap-x-8 gap-y-6 pt-10 pb-10 sm:pt-16 lg:grid-cols-12 lg:items-end`}
    >
      <div className="flex flex-col gap-4 lg:col-span-12">
        <p className="m-0 inline-flex items-center gap-2.5 text-sm font-medium text-ink-2">
          <img src={lambdaIcon} alt="" width={22} height={22} className="block shrink-0" />
          AWS Lambda benchmark
        </p>
        <h1 className="text-3xl text-balance">Bun vs Node.js cold starts on AWS Lambda</h1>
      </div>
      <p className="max-w-prose text-lg/normal text-pretty text-ink-2 lg:col-span-8">
        {latest
          ? `${count('Bun')} Bun builds, LLRT and ${count('Node')} Node.js versions, each cold started ${latest.rounds} times an hour. `
          : 'Every runtime gets cold started once an hour. '}
        Each point on the charts is one run. The table averages the range you pick.
      </p>
      <nav className="flex flex-col gap-1.5 text-sm lg:col-span-4 lg:items-end">
        <a href={`${REPO}#scheduled-runs-like-lambda-perf`}>How it works</a>
        <a href={REPO}>Source on GitHub</a>
        <span className="text-muted">
          Inspired by{' '}
          <a className="whitespace-nowrap" href="https://github.com/maxday/lambda-perf">
            maxday/lambda-perf
          </a>
        </span>
      </nav>
    </header>
  )
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
  ['second', 1e3],
] as const

/** When the latest run finished, as how long ago, kept current; the dot turns once an hourly run is missed. */
const LastRun = ({ run }: { run: RunPoints }) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1e3)
    return () => clearInterval(id)
  }, [])
  const ms = run.date.getTime() - now
  const [unit, size] = UNITS.find(([, size]) => Math.abs(ms) >= size) ?? UNITS.at(-1)!
  const iso = run.finishedAt.replace(/\.\d+Z$/, 'Z')
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" title={iso}>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${-ms > 2 * 36e5 ? 'bg-bad' : 'bg-ok'}`}
      />
      <span>
        Last run{' '}
        <time dateTime={run.finishedAt}>{RELATIVE.format(Math.trunc(ms / size), unit)}</time>
      </span>
    </span>
  )
}

/** The first load, in the shape of the toolbar, the cold start chart and the board. */
const Skeleton = () => (
  <div aria-busy="true" aria-label="Loading runs" className={`${WRAP} flex flex-col gap-6`}>
    <div className="skeleton h-12" />
    <div className="skeleton h-96" />
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  </div>
)

export const App = () => {
  /** Oldest first. */
  const [history, setHistory] = useState<RunPoints[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [arch, setArch] = useState('arm64')
  // One full vCPU, and the only size before there were more.
  const [memory, setMemory] = useState(1769)
  const [range, setRange] = useState(30)
  const [hover, setHover] = useState<number>()
  /** The run picked over the mean, by its finishedAt; it stays across ranges and sizes it is in. */
  const [pinned, setPinned] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [hidden, setHidden] = useState(new Set<string>())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API}/runs/history?limit=${Math.max(...RANGES)}`)
      if (!response.ok) throw new Error(`/runs/history: ${response.status}`)
      const { runs } = (await response.json()) as { runs: Run[] }
      setHistory(runs.map(toPoints).reverse())
      setError(undefined)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  const latest = history.at(-1)

  const toggle = (base: string) => {
    const next = new Set(hidden)
    if (!next.delete(base)) next.add(base)
    setHidden(next)
  }

  const dashboard = (latest: RunPoints) => {
    const archs = [...new Set(latest.functions.map((f) => f.arch))].sort()
    const shownArch = archs.includes(arch) ? arch : archs[0]!
    const memories = [...new Set(latest.functions.map((f) => f.memoryMb))].sort((a, b) => a - b)
    const shownMemory = memories.includes(memory) ? memory : memories.at(-1)!
    // A range is offered once there are runs older than the next shorter one shows.
    const span = latest.date.getTime() - history[0]!.date.getTime()
    const ranges = RANGES.filter((_, i) => i === 0 || span >= RANGES[i - 1]! * DAY_MS)
    const shownRange = ranges.includes(range) ? range : ranges.at(-1)!
    const since = latest.date.getTime() - shownRange * DAY_MS
    const runs = history.filter((r) => r.date.getTime() > since)
    const pinnedAt = runs.findIndex((r) => r.finishedAt === pinned)
    // A hover shows its run over the picked one, which comes back once the pointer leaves.
    const hovered =
      hover !== undefined && hover < runs.length ? hover : pinnedAt >= 0 ? pinnedAt : undefined
    const sized = latest.functions.filter((f) => f.arch === shownArch)
    const fns = sized
      .filter((f) => f.memoryMb === shownMemory)
      .sort((a, b) => (ORDER.indexOf(a.base) >>> 0) - (ORDER.indexOf(b.base) >>> 0))
    const visible = fns.filter((f) => !hidden.has(f.base))
    const view: View = {
      runs,
      latest,
      memoryMb: shownMemory,
      fns,
      shown: visible.length ? visible : fns,
      hidden,
      hover: hovered,
      focus,
      agg: (f, key: Stat) =>
        hovered !== undefined
          ? runs[hovered]!.points.get(f.id)?.[key]
          : mean(runs.map((r) => r.points.get(f.id)?.[key])),
      setHover,
      setFocus,
      toggle,
    }
    const pickMemory = (mb: number) => {
      setMemory(mb)
      setHover(undefined)
    }
    const pickRange = (r: number) => {
      setRange(r)
      setHover(undefined)
    }
    // The mean over each range, then every run in the shown one, newest first.
    const means = ranges.map((r) => `mean:${r}`)
    const picks = [...means, ...runs.map((r) => r.finishedAt).reverse()]
    const pickText = (key: string) => {
      if (!key.startsWith('mean:')) return `Run of ${when(new Date(key))} UTC`
      return ranges.length > 1 ? `${key.slice(5)}-day mean` : 'Mean'
    }
    const pick = (key: string) => {
      setHover(undefined)
      if (!key.startsWith('mean:')) return setPinned(key)
      setPinned(undefined)
      setRange(Number(key.slice(5)))
    }
    const [cold, ...small] = METRICS

    return (
      <>
        <section className={WRAP}>
          <Glance history={history} />
        </section>

        {/* Across the page and over the charts and the board below, which both follow it. */}
        <div className="sticky top-0 z-(--z-sticky) mt-12 border-y border-rule bg-paper/85 backdrop-blur-md">
          <div className={`${WRAP} flex flex-wrap items-center gap-x-8 gap-y-1 py-2`}>
            <div className="flex min-w-0 flex-auto flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-x-6">
              {/* Outside the scroller, which would clip its panel. */}
              <Functions view={view} setHidden={setHidden} />
              {/* One line however narrow: the choices scroll sideways instead of stacking. A phone's
                  pickers are small enough to wrap beside Functions instead, so none hides off the edge. */}
              <div className="-my-1 flex min-w-0 flex-auto items-center gap-x-6 overflow-x-auto py-2 [scrollbar-width:none] max-sm:contents">
                <Segmented
                  label="Arch"
                  options={archs}
                  value={shownArch}
                  onPick={(a) => {
                    setArch(a)
                    setHover(undefined)
                  }}
                />
                <Segmented
                  label="Memory, MB"
                  options={memories}
                  value={shownMemory}
                  unit="MB"
                  onPick={pickMemory}
                />
                {ranges.length > 1 && (
                  <Segmented
                    label="Range"
                    options={ranges}
                    value={shownRange}
                    text={(r) => `${r}d`}
                    onPick={pickRange}
                  />
                )}
              </div>
            </div>
            <p className="measured m-0 flex shrink-0 items-center gap-x-4 text-xs text-muted">
              <LastRun run={latest} />
              <span>{latest.rounds} rounds</span>
              <span className="hidden sm:inline">
                {new Set(latest.functions.map((f) => f.base)).size} fns × {archs.length} archs ×{' '}
                {memories.length} sizes
              </span>
            </p>
          </div>
        </div>

        <section className={`${WRAP} mt-6 flex flex-col gap-6`}>
          <div className="flex justify-end gap-5 text-sm text-muted">
            {(
              [
                ['Bun', 'Bun'],
                ['LLRT', 'LLRT'],
                ['Node', 'Node.js'],
              ] as const
            ).map(([family, name]) => (
              <span key={family} className="inline-flex items-center gap-2">
                <svg aria-hidden="true" width="24" height="4" className="stroke-ink-2">
                  <line
                    x1="1"
                    x2="23"
                    y1="2"
                    y2="2"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={DASHES[family]}
                  />
                </svg>
                {name}
              </span>
            ))}
          </div>

          <div
            onMouseLeave={() => setHover(undefined)}
            className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3"
          >
            <Chart
              metric={cold!}
              wide
              view={view}
              className={memories.length > 1 ? 'col-span-full lg:col-span-2' : 'col-span-full'}
            />
            {memories.length > 1 && (
              <MemoryChart
                view={view}
                sized={sized}
                memories={memories}
                onPick={pickMemory}
                className="col-span-full lg:col-span-1"
              />
            )}
            {small.map((m) => (
              <Chart key={m.key} metric={m} wide={false} view={view} />
            ))}
          </div>
        </section>

        <section className="band mt-16 py-12 sm:py-16">
          <div className={`${WRAP} flex flex-col gap-8`}>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <h2 className="text-2xl">
                <InlinePick
                  label="Mean or run"
                  options={picks}
                  value={hovered !== undefined ? runs[hovered]!.finishedAt : `mean:${shownRange}`}
                  text={pickText}
                  group={(key) => (key.startsWith('mean:') ? 'Mean' : 'Runs')}
                  onPick={pick}
                />{' '}
                at{' '}
                <InlinePick
                  label="Memory"
                  options={memories}
                  value={shownMemory}
                  text={(mb) => `${mb} MB`}
                  onPick={pickMemory}
                />
              </h2>
              <p className="max-w-prose text-sm text-pretty text-muted">
                Ticks are {hovered !== undefined ? 'that' : 'the latest'} run’s{' '}
                {(hovered !== undefined ? runs[hovered]! : latest).rounds} cold starts.
                {latest.warmInvocations !== undefined &&
                  ` Warm start is the mean of the ${latest.warmInvocations} calls after each.`}{' '}
                Click a row to hide it.
              </p>
            </div>
            <Table view={view} />
          </div>
        </section>
      </>
    )
  }

  /** What stands in for the dashboard until there is a run to show. */
  const pending = () => {
    if (loading && !error) return <Skeleton />
    return (
      <div className={WRAP}>
        <div
          role={error ? 'alert' : undefined}
          className="flex flex-col items-start gap-4 rounded-card border border-rule bg-paper-2 p-6"
        >
          <h2 className="text-lg">{error ? 'Couldn’t load the runs' : 'No runs yet'}</h2>
          {error && <p className="measured text-sm text-bad">{error}</p>}
          <button
            type="button"
            onClick={load}
            aria-busy={loading}
            className="btn btn--primary hit relative"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <main>
      <Header latest={latest} />
      {latest ? dashboard(latest) : pending()}
      <footer
        className={`${WRAP} flex flex-col gap-6 pt-12 pb-16 text-sm text-muted ${latest ? '' : 'mt-16'}`}
      >
        <p className="max-w-prose">
          Every function runs the same tiny handler,{' '}
          <a href={`${REPO}/blob/main/src/report.ts`}>src/report.ts</a>, which returns its own
          startup time and memory use as JSON. No packages, no network calls: the numbers are the
          runtime’s, not the code’s.
        </p>
        <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium text-ink">Cold start</dt>
          <dd className="m-0">Lambda init duration</dd>
          <dt className="font-medium text-ink">To handler</dt>
          <dd className="m-0">
            the part of the cold start inside the process: from process start until the handler is
            loaded, by the process’s own clock. The rest is Lambda starting the process and the
            runtime asking for its first event
          </dd>
          <dt className="font-medium text-ink">Warm start</dt>
          <dd className="m-0">handler time on an instance that’s already up</dd>
          <dt className="font-medium text-ink">Duration</dt>
          <dd className="m-0">handler time of the cold invocation</dd>
          <dt className="font-medium text-ink">Memory used</dt>
          <dd className="m-0">peak memory, as Lambda reports it</dd>
          <dt className="font-medium text-ink">Size</dt>
          <dd className="m-0">size of the deployed code</dd>
        </dl>
        <p className="max-w-prose">
          Compiled builds also pass <code>--target=bun-linux-{'<arch>'}</code>,{' '}
          <code>--no-compile-autoload-dotenv</code> and <code>--no-compile-autoload-bunfig</code>.{' '}
          <code>--trim</code> and <code>--aot</code> only exist in canary Bun, hence the badge.
        </p>
        <p className="m-0">
          by <a href="https://nimmervoll.work">Lorenz Nimmervoll</a>
        </p>
        <SiteLinks />
      </footer>
    </main>
  )
}
