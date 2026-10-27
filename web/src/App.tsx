import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Chart, type Metric } from './Chart'
import {
  type Family,
  ORDER,
  type Run,
  type RunPoints,
  type Stat,
  VARIANTS,
  type View,
  day,
  mean,
  toPoints,
} from './data'
import { Table } from './Table'

const REPO = 'https://github.com/NimmLor/bun-aot-lambda'
/** PerfApi, behind the same CloudFront distribution; see infra/perf.ts and dev.ts. */
const API = '/api'
const DAY_MS = 864e5
const RANGES = [14, 30, 90]

const METRICS: Metric[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', height: 300, leader: 'Fastest' },
  { key: 'warm', title: 'Warm start', unit: 'ms', height: 180, leader: 'Fastest' },
  { key: 'mem', title: 'Memory', unit: 'MB', height: 180, leader: 'Lowest' },
  { key: 'dur', title: 'Duration', unit: 'ms', height: 180, leader: 'Fastest' },
]

const Segmented = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  text = String,
}: {
  label: string
  options: readonly T[]
  value: T | undefined
  onPick: (v: T) => void
  text?: (v: T) => string
}) => (
  <div className="flex items-center gap-2.5 text-xs tracking-[0.04em] text-muted uppercase">
    {label}
    <div className="flex gap-0.5 rounded-full border border-white/6 bg-page p-[3px]">
      {options.map((v) => (
        <button
          key={v}
          aria-pressed={v === value}
          onClick={() => onPick(v)}
          className="cursor-pointer rounded-full px-3.5 py-1.5 font-mono text-[13px] tracking-normal text-muted normal-case aria-pressed:bg-ink aria-pressed:text-page"
        >
          {text(v)}
        </button>
      ))}
    </div>
  </div>
)

const SectionHead = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 text-[13px] text-muted">
    {children}
  </div>
)

const Header = ({ latest }: { latest?: RunPoints }) => {
  const variants = new Set(latest?.functions.map((f) => f.base))
  const archs = new Set(latest?.functions.map((f) => f.arch))
  const count = (family: Family) => [...variants].filter((b) => VARIANTS[b]?.family === family).length
  return (
    <header className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-2.5 font-mono text-xs tracking-[0.08em] text-muted uppercase">
        <span className="size-[7px] rounded-full bg-[oklch(0.78_0.13_150)]" />
        AWS Lambda{latest && ` · ${variants.size} functions × ${archs.size} architectures`} · updated daily
      </div>
      <h1 className="max-w-[16ch] text-[clamp(40px,6vw,72px)]/[0.98] font-medium tracking-[-0.035em] text-balance">
        Bun vs Node.js cold start benchmark
      </h1>
      <p className="max-w-[58ch] text-lg/normal text-pretty text-soft">
        {latest &&
          `${count('Bun')} ways to ship Bun against ${count('Node')} Node.js runtimes, with ${latest.rounds} cold starts per function every day. `}
        The charts plot each run's mean. The table below shows the mean over the selected range.
      </p>
      <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
        <a href={`${REPO}#scheduled-runs-like-lambda-perf`}>How does it work →</a>
        <a href={REPO}>Source on GitHub →</a>
        <span className="text-muted">
          Inspired by{' '}
          <a className="font-mono text-sm" href="https://github.com/maxday/lambda-perf">
            maxday/lambda-perf
          </a>
        </span>
      </nav>
    </header>
  )
}

export const App = () => {
  /** Oldest first. */
  const [history, setHistory] = useState<RunPoints[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [family, setFamily] = useState<Family | 'All'>()
  const [arch, setArch] = useState('arm64')
  const [range, setRange] = useState(30)
  const [hover, setHover] = useState<number>()
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

  const showFamily = (f: Family | 'All') => {
    setFamily(f)
    setHidden(new Set(ORDER.filter((base) => f !== 'All' && VARIANTS[base]!.family !== f)))
  }
  const toggle = (base: string) => {
    const next = new Set(hidden)
    if (!next.delete(base)) next.add(base)
    setHidden(next)
    setFamily(undefined)
  }

  const dashboard = (latest: RunPoints) => {
    const archs = [...new Set(latest.functions.map((f) => f.arch))].sort()
    const shownArch = archs.includes(arch) ? arch : archs[0]!
    const since = latest.date.getTime() - range * DAY_MS
    const runs = history.filter((r) => r.date.getTime() > since)
    const hovered = hover !== undefined && hover < runs.length ? hover : undefined
    const fns = latest.functions
      .filter((f) => f.arch === shownArch)
      .sort((a, b) => (ORDER.indexOf(a.base) >>> 0) - (ORDER.indexOf(b.base) >>> 0))
    const visible = fns.filter((f) => !hidden.has(f.base))
    const view: View = {
      runs,
      latest,
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

    return (
      <>
        <section className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-panel p-5">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
            <Segmented label="Show" options={['All', 'Bun', 'Node'] as const} value={family} onPick={showFamily} />
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
              label="Range"
              options={RANGES}
              value={range}
              text={(r) => `${r}d`}
              onPick={(r) => {
                setRange(r)
                setHover(undefined)
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-3.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[13px] text-muted [&_b]:font-normal [&_b]:text-ink">
              <span>
                Last run <b>{latest.finishedAt.replace(/\.\d+Z$/, 'Z')}</b>
              </span>
              <span>
                Memory <b>{latest.memoryMb ?? '—'} MB</b>
              </span>
              <span>
                Rounds <b>{latest.rounds}</b>
              </span>
            </div>
            <button
              onClick={load}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/12 px-3.5 py-2 text-sm hover:border-white/40"
            >
              <span className="text-base/none">↻</span>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHead>
            <div className="flex flex-wrap gap-1.5">
              {fns.map((f) => {
                const on = !hidden.has(f.base)
                return (
                  <button
                    key={f.id}
                    aria-pressed={on}
                    onClick={() => toggle(f.base)}
                    onMouseEnter={() => on && setFocus(f.base)}
                    onMouseLeave={() => setFocus(undefined)}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/6 py-1.5 pr-3 pl-2 text-xs text-faint aria-pressed:border-white/12 aria-pressed:bg-white/4 aria-pressed:text-ink"
                  >
                    <span className="size-2.5 rounded-full" style={{ background: on ? f.color : 'transparent' }} />
                    {f.name}
                  </button>
                )
              })}
            </div>
            Solid = Bun · dashed = Node.js
          </SectionHead>
          <div
            onMouseLeave={() => setHover(undefined)}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3"
          >
            {METRICS.map((m, i) => (
              <Chart key={m.key} metric={m} wide={i === 0} view={view} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHead>
            <h2 className="text-2xl font-medium tracking-[-0.015em] text-ink">
              {hovered !== undefined ? `Run of ${day(runs[hovered]!.date)}` : `${range}-day mean`}
            </h2>
            Ticks = the {(hovered !== undefined ? runs[hovered]! : latest).rounds} cold starts of{' '}
            {hovered !== undefined ? 'that' : 'the latest'} run · warm = {latest.rounds} ×{' '}
            {latest.warmInvocations ?? '—'} invocations · click a row to hide it
          </SectionHead>
          <Table view={view} />
        </section>
      </>
    )
  }

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 *:min-w-0 pt-8 pb-16 sm:px-8 sm:pt-14 sm:pb-24">
      <Header latest={latest} />
      {latest ? dashboard(latest) : <p className="text-muted">{error ?? (loading ? 'Loading…' : 'No runs yet.')}</p>}
      <footer className="flex flex-wrap justify-between gap-x-5 gap-y-2 border-t border-white/8 pt-6 text-[13px] text-muted">
        <span>
          Cold start = Lambda init duration · warm start = handler duration on an already-initialised instance ·
          duration = handler duration of the cold invocation · memory = max memory used · size = deployed code size.
          Compiled builds also pass --target=bun-linux-{'<arch>'}, --no-compile-autoload-dotenv and
          --no-compile-autoload-bunfig; “canary Bun” is the Bun build that --trim and --aot need.
        </span>
        <a href={REPO}>NimmLor/bun-aot-lambda</a>
      </footer>
    </main>
  )
}
