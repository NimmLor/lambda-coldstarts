import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { track } from './analytics'
import { Architectures } from './Architectures'
import { ColdStarts } from './ColdStarts'
import {
  figuresFor,
  isEvent,
  isWindow,
  ORDER,
  type Run,
  type RunPoints,
  STACK_REGION,
  toPoints,
  type View,
  WINDOW_NAMES,
  WINDOWS,
} from './data'
import { Deployment } from './Deployment'
import { findings as findingsOf } from './findings'
import { Functions } from './Functions'
import { Glance } from './Glance'
import lambdaIcon from './icons/lambda.svg'
import { REPO, SiteLinks, WRAP } from './layout'
import { MemoryCost } from './MemoryCost'
import { MicroVms } from './MicroVms'
import { placeholderHistory } from './placeholder'
import { Results } from './Results'
import { isNumber, isString, useStored } from './stored'
import { FILTERS, TABS, type TabId, type TabProps, tabOf } from './tabs'
import { Segmented } from './ui'
import { WarmStarts } from './WarmStarts'
import { WebFunction } from './WebFunction'

/** PerfApi, behind the same CloudFront distribution; see infra/perf.ts and dev.ts. */
const API = '/api'

const fetchJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return (await response.json()) as T
}

/** Each tab's panel, from the props every tab gets. */
const PANELS: Record<TabId, (props: TabProps & { onPick: (mb: number) => void }) => ReactNode> = {
  cold: (p) => <ColdStarts {...p} />,
  warm: (p) => <WarmStarts {...p} />,
  arch: (p) => (
    <Architectures
      view={p.view}
      functions={p.functions.filter(isEvent)}
      memories={p.memories}
      onPick={p.onPick}
    />
  ),
  memory: (p) => <MemoryCost {...p} />,
  deployment: (p) => <Deployment {...p} />,
  'web-function': (p) => <WebFunction {...p} />,
  microvms: (p) => <MicroVms {...p} />,
  results: (p) => <Results {...p} />,
}

const Header = () => (
  <header
    className={`${WRAP} flex flex-wrap items-end justify-between gap-x-12 gap-y-5 pt-10 pb-10 sm:pt-16`}
  >
    <div className="flex flex-col gap-4">
      <p className="m-0 inline-flex items-center gap-2.5 text-sm font-medium text-ink-2">
        <img src={lambdaIcon} alt="" width={22} height={22} className="block shrink-0" />
        AWS Lambda benchmark
      </p>
      <h1 className="text-3xl text-balance">Bun vs LLRT vs Node.js cold starts on AWS Lambda</h1>
    </div>
    <nav aria-label="About" className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm">
      <a href="#method">How it’s measured</a>
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

/**
 * `now` is when the placeholder's runs lead up to: the build's, for the dashboard build.ts
 * prerenders into index.html, which hydrating it has to render again to the letter.
 */
export const App = ({ now }: { now: number }) => {
  /** The newest run, from /runs/latest, which the page paints first; null when there's none. */
  const [latest, setLatest] = useState<RunPoints | null>()
  /** Every run /runs/history holds, oldest first, once it has arrived. */
  const [past, setPast] = useState<RunPoints[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [pastError, setPastError] = useState<string>()
  // 256 MB on arm64, like the glance, until the visitor picks another, which is kept.
  const [arch, setArch] = useStored('arch', 'arm64', isString)
  const [memory, setMemory] = useStored('memory', 256, isNumber)
  const [period, setPeriod] = useStored('window', 'current', isWindow)
  const [tab, setTab] = useState<TabId>('cold')
  /** The run under the pointer on a chart over time, by its finishedAt. */
  const [hoverAt, setHoverAt] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [hidden, setHidden] = useState(new Set<string>())
  /** What the dashboard is laid out on until the first load. */
  const [placeholderRuns] = useState(() => placeholderHistory(now))
  /** Just above the toolbar, where switching tabs scrolls back to once it's stuck. */
  const top = useRef<HTMLDivElement>(null)

  const loadPast = useCallback(async () => {
    setPastError(undefined)
    try {
      const { runs } = await fetchJson<{ runs: Run[] }>('/runs/history')
      setPast(runs.map(toPoints).reverse())
    } catch (e) {
      setPastError(String(e))
    }
  }, [])
  // The latest run first, which is small and paints the page; the history after it, so the two
  // don't share the connection while the page waits.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { run } = await fetchJson<{ run: Run | null }>('/runs/latest')
      setLatest(run ? toPoints(run) : null)
      setError(undefined)
      setLoading(false)
      if (run) await loadPast()
    } catch (e) {
      setError(String(e))
      setLoading(false)
    }
  }, [loadPast])
  useEffect(() => void load(), [load])

  // A tab named in the URL opens it, on arrival and whenever the fragment changes.
  useEffect(() => {
    const read = () => {
      const named = tabOf(location.hash)
      if (named) setTab(named)
    }
    read()
    addEventListener('hashchange', read)
    return () => removeEventListener('hashchange', read)
  }, [])

  // Until the latest run arrives, the dashboard lays out the placeholder runs as it will the real
  // ones, its readings veiled by `.pending` in index.css, so nothing moves when they arrive.
  const placeholder = latest === undefined && loading && !error
  const runs = useMemo(() => {
    if (placeholder) return placeholderRuns
    if (!latest) return []
    if (!past?.length) return [latest]
    // CloudFront can hold a history from before the latest run.
    return past.at(-1)!.date < latest.date ? [...past, latest] : past
  }, [placeholder, placeholderRuns, latest, past])
  // Until the history arrives or fails, when the toolbar says so and the charts show the latest run.
  const waiting = !placeholder && !!latest && past === undefined && !pastError
  const figures = useMemo(() => figuresFor(runs, period), [runs, period])
  const current = useMemo(
    () => (period === 'current' ? figures : figuresFor(runs, 'current')),
    [runs, period, figures]
  )
  const findings = useMemo(() => findingsOf(runs.at(-1)?.functions ?? [], current), [runs, current])

  const open = (next: TabId, from: 'tab' | 'finding') => {
    track('tab_opened', { tab: next, from })
    setTab(next)
    setHoverAt(undefined)
    history.replaceState(null, '', `#${next}`)
    // A finding scrolls to its tab; a tab opened from the stuck toolbar starts under it.
    const bar = top.current
    if (bar && (from === 'finding' || bar.getBoundingClientRect().top < 0)) {
      bar.scrollIntoView({ behavior: from === 'finding' ? 'smooth' : 'instant' })
    }
  }
  // Arrow keys move along the tabs, as a tab list's should.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.id === tab)
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : undefined
    if (to === undefined) return
    e.preventDefault()
    open(TABS[to]!.id, 'tab')
    document.getElementById(`tab-${TABS[to]!.id}`)?.focus()
  }

  const dashboard = (latestRun: RunPoints) => {
    const events = latestRun.functions.filter((f) => !f.web && !f.microvm)
    const archs = [...new Set(events.map((f) => f.arch))].sort()
    const shownArch = archs.includes(arch) ? arch : archs[0]!
    const memories = [...new Set(events.filter(isEvent).map((f) => f.memoryMb))].sort(
      (a, b) => a - b
    )
    const shownMemory = memories.includes(memory) ? memory : (memories.at(-1) ?? 0)
    const fns = events
      .filter((f) => f.arch === shownArch && f.memoryMb === shownMemory)
      .sort((a, b) => (ORDER.indexOf(a.base) >>> 0) - (ORDER.indexOf(b.base) >>> 0))
    const visible = fns.filter((f) => !hidden.has(f.base))
    const shown = visible.length ? visible : fns
    const shownBases = new Set(shown.map((f) => f.base))
    const hovered = runs.findIndex((r) => r.finishedAt === hoverAt)
    const hover = hovered >= 0 ? hovered : undefined
    const view: View = {
      runs,
      latest: latestRun,
      memoryMb: shownMemory,
      fns,
      shown,
      // The axes scale to every architecture and size, so they hold still when either changes.
      scaled: latestRun.functions.filter((f) => shownBases.has(f.base)),
      hidden,
      hover,
      focus,
      baseline: fns.find((f) => f.base === 'Node24'),
      agg: (f, key) =>
        hover !== undefined ? runs[hover]!.points.get(f.id)?.[key] : figures.get(f.id)?.[key],
      setHover: (i) => setHoverAt(i === undefined ? undefined : runs[i]?.finishedAt),
      setFocus,
      toggle: (base) => {
        const next = new Set(hidden)
        if (!next.delete(base)) next.add(base)
        setHidden(next)
      },
    }
    const pickMemory = (mb: number) => {
      track('memory_picked', { memory_mb: mb })
      setMemory(mb)
      setHoverAt(undefined)
    }
    const filters = FILTERS[tab]
    const props = {
      view,
      figures,
      functions: latestRun.functions,
      arch: shownArch,
      memoryMb: shownMemory,
      memories,
      period,
      waiting,
      onMemory: pickMemory,
      onPick: pickMemory,
    }

    return (
      <>
        <section className={WRAP}>
          <Glance
            runs={runs}
            figures={current}
            findings={findings}
            now={now}
            onOpen={(t) => open(t, 'finding')}
          />
        </section>

        <div ref={top} className="mt-12" />
        <div className="sticky top-0 z-(--z-sticky) border-y border-rule bg-paper/90 backdrop-blur-md">
          <div className={WRAP}>
            <div
              role="tablist"
              aria-label="Benchmarks"
              onKeyDown={onTabKey}
              className="flex gap-1 overflow-x-auto border-b border-rule [scrollbar-width:none]"
            >
              {TABS.map((t) => {
                const on = t.id === tab
                return (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls="panel"
                    tabIndex={on ? 0 : -1}
                    onClick={() => open(t.id, 'tab')}
                    className={`-mb-px min-h-12 shrink-0 cursor-pointer border-b-2 px-3.5 font-medium whitespace-nowrap transition-colors duration-(--dur-short) focus-visible:-outline-offset-2 ${on ? 'border-cool text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
            {/* One line however narrow: the choices scroll sideways rather than stack. Functions
                stays outside the scroller, which would clip its panel. */}
            <div className="flex items-center gap-x-5 py-2">
              {filters.functions && <Functions view={view} setHidden={setHidden} />}
              <div className="-my-1 flex min-w-0 flex-auto items-center gap-x-6 overflow-x-auto py-1 [scrollbar-width:none]">
                {filters.arch && (
                  <Segmented
                    label="Arch"
                    options={archs}
                    value={shownArch}
                    onPick={(a) => {
                      track('arch_picked', { arch: a })
                      setArch(a)
                      setHoverAt(undefined)
                    }}
                  />
                )}
                {filters.memory && (
                  <Segmented
                    label="Memory, MB"
                    options={memories}
                    value={shownMemory}
                    unit="MB"
                    onPick={pickMemory}
                  />
                )}
                <Segmented
                  label="Runs"
                  options={WINDOWS}
                  value={period}
                  text={(w) => WINDOW_NAMES[w]}
                  onPick={(w) => {
                    track('window_picked', { window: w })
                    setPeriod(w)
                    setHoverAt(undefined)
                  }}
                />
                {filters.note && (
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted">
                    {filters.note}
                  </span>
                )}
                {waiting && (
                  <span role="status" className="shrink-0 text-xs whitespace-nowrap text-muted">
                    Loading history…
                  </span>
                )}
                {pastError && (
                  <span
                    role="alert"
                    className="inline-flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-bad"
                  >
                    Couldn’t load the history; figures are the latest run’s.
                    <button type="button" onClick={loadPast} className="btn min-h-7 px-2 text-xs">
                      Retry
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          id="panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className={`${WRAP} scroll-mt-28 pt-10`}
          onMouseLeave={() => setHoverAt(undefined)}
        >
          {PANELS[tab](props)}
        </div>
      </>
    )
  }

  /** What stands in for the dashboard when the load failed or found no run. */
  const noRuns = () => (
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

  const latestRun = runs.at(-1)
  return (
    <main className={placeholder ? 'pending' : undefined} aria-busy={placeholder}>
      <Header />
      {placeholder ? (
        <>
          <p role="status" className="sr-only">
            Loading runs
          </p>
          {/* Contents, so the toolbar stays sticky across the page; inert, as nothing in it is real,
              and no snippet, so a search result never quotes the prerendered page's made-up figures. */}
          <div inert data-nosnippet className="contents">
            {dashboard(latestRun!)}
          </div>
        </>
      ) : latestRun ? (
        dashboard(latestRun)
      ) : (
        noRuns()
      )}
      <footer
        id="method"
        className={`${WRAP} flex scroll-mt-8 flex-col gap-6 pt-16 pb-16 text-sm text-muted ${latestRun ? '' : 'mt-16'}`}
      >
        <h2 className="text-lg">How it’s measured</h2>
        <p className="max-w-prose">
          Every function runs the same tiny handler,{' '}
          <a href={`${REPO}/blob/main/src/report.ts`}>src/report.ts</a>, which returns its own
          startup time and memory use as JSON. No packages, no network calls: the numbers are the
          runtime’s, not the code’s. Every 4 hours each one is cold started
          {latestRun ? ` ${latestRun.rounds} times` : ''} in {STACK_REGION}, Frankfurt
          {latestRun?.warmInvocations === undefined
            ? ''
            : `, with ${latestRun.warmInvocations} warm calls after each`}
          . <a href={`${REPO}#-scheduled-runs`}>How the runs work</a>
        </p>
        <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium text-ink">Current builds</dt>
          <dd className="m-0">
            each function’s runs since its version last changed, so a mean never mixes two builds;
            the toolbar picks 7 or 14 days instead
          </dd>
          <dt className="font-medium text-ink">Cold start</dt>
          <dd className="m-0">
            Lambda’s init duration, from starting the runtime until it asks for its first event; for
            the Web Function, its environment’s initialization until the server listens
          </dd>
          <dt className="font-medium text-ink">Slowest 1%, p99</dt>
          <dd className="m-0">
            the 99th percentile over every cold start in view, not a mean of each run’s
          </dd>
          <dt className="font-medium text-ink">First answer</dt>
          <dd className="m-0">
            from calling Invoke on a cold function until its response, as the measuring function in
            the same region sees it; for a MicroVM, from calling RunMicrovm until its first response
          </dd>
          <dt className="font-medium text-ink">First invocation</dt>
          <dd className="m-0">handler time of the cold invocation: the first call after init</dd>
          <dt className="font-medium text-ink">Loading & API</dt>
          <dd className="m-0">
            the first answer less init and the first invocation: fetching the code, placing the
            environment and the Invoke API itself
          </dd>
          <dt className="font-medium text-ink">Warm start</dt>
          <dd className="m-0">
            handler time on an instance that’s already up, the mean of the calls after each cold
            start
          </dd>
          <dt className="font-medium text-ink">Memory used</dt>
          <dd className="m-0">
            peak memory, as Lambda reports it; for the Web Function, the whole environment’s; for a
            MicroVM, the server process’s, by its own account
          </dd>
          <dt className="font-medium text-ink">Cost</dt>
          <dd className="m-0">
            init and the first invocation billed as duration, plus the request, at first-tier prices
            in {STACK_REGION}
          </dd>
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
