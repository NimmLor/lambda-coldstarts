import { track } from './analytics'
import { type Figures, type Fn, ORDER, versionName } from './data'
import { REPO } from './layout'
import { Differences, Explainer } from './Section'
import type { TabProps } from './tabs'
import { Dot, TabHead } from './ui'

const DIFFERENCES = [
  [
    'Code',
    'A server listening on a port: node:http, Express, Hono',
    'A handler that gets one event per call',
  ],
  ['Requests', 'Many at once per environment, up to 128', 'One at a time per environment'],
  [
    'Endpoint',
    'Its own HTTPS endpoint, signed with IAM or open',
    'A Function URL, API Gateway or another service',
  ],
  [
    'Size',
    '2 GB and 2 vCPUs on arm64, Node.js 24 and 26 only',
    '128 MB to 10 GB on either architecture, any runtime',
  ],
  [
    'Billing',
    'Requests, CPU time while busy, memory while the environment lives',
    'Requests, and duration times memory',
  ],
  ['Regions', 'Some so far, eu-central-1 among them', 'All of them'],
] as const

const MEASURES = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1 },
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0 },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 2 },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1 },
] as const

type Row = { f: Fn; x: Figures; web: boolean }

/** The table's columns from `lg`; below it a row stacks, each reading under its measure's name. */
const COLUMNS = 'lg:grid-cols-[minmax(0,16rem)_repeat(4,minmax(0,1fr))]'

/**
 * Every Web Function and, under each, the same runtime as an Event Function, on one table: a row
 * per function, a column per measure, each bar against the longest of its column.
 */
const Table = ({ rows }: { rows: Row[] }) => {
  const max = Object.fromEntries(
    MEASURES.map((m) => [m.key, Math.max(0, ...rows.map((r) => r.x[m.key] ?? 0)) || 1])
  ) as Record<(typeof MEASURES)[number]['key'], number>
  return (
    <div
      role="table"
      aria-label="Web Functions and Event Functions"
      className="rounded-card border border-rule bg-paper-2"
    >
      <div
        role="row"
        className={`hidden items-baseline gap-x-6 border-b border-rule px-6 pt-4 pb-3 lg:grid ${COLUMNS}`}
      >
        <span role="columnheader" className="text-sm font-medium text-ink-2">
          Function
        </span>
        {MEASURES.map((m) => (
          <span key={m.key} role="columnheader" className="font-medium text-ink-2">
            {m.title} <span className="text-sm font-normal text-muted">{m.unit}</span>
          </span>
        ))}
      </div>
      {rows.map(({ f, x, web }) => (
        <div
          key={f.id}
          role="row"
          className={`grid grid-cols-2 items-center gap-x-6 gap-y-3 border-b border-rule px-5 py-3.5 last:border-b-0 sm:px-6 ${COLUMNS}`}
        >
          <div
            role="rowheader"
            className="col-span-full flex min-w-0 items-center gap-3 lg:col-span-1"
          >
            <Dot color={f.color} />
            <span className="flex min-w-0 flex-col leading-snug">
              <span className="font-medium text-ink">{runtimeOf(f, x)}</span>
              <span className="text-sm text-muted">
                <span aria-hidden="true">{web ? '🌐' : '⚡'}</span>{' '}
                {web ? 'Web Function' : 'Event Function'}
              </span>
            </span>
          </div>
          {MEASURES.map((m) => {
            const value = x[m.key]
            return (
              <div key={m.key} role="cell" className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs text-muted lg:hidden">
                  {m.title}, {m.unit}
                </span>
                <span className="measured text-ink">
                  {value === undefined ? '—' : value.toFixed(m.digits)}
                </span>
                <div aria-hidden="true" className="h-1.5 rounded-full bg-paper-3">
                  <div
                    className="mark h-full rounded-full"
                    style={{ width: `${((value ?? 0) / max[m.key]) * 100}%`, background: f.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * The release a function ran, e.g. `Node.js 24.22.3`, or its runtime's name before any run said.
 */
const runtimeOf = (f: Fn, x: Figures) =>
  x.version ? versionName(x.version) : f.name.replace(/, Web Function$/, '')

/** Each Web Function, against the same runtime as an Event Function at the nearest size. */
export const WebFunction = ({ figures, functions }: TabProps) => {
  const webs = functions
    .filter((f) => f.web && figures.has(f.id))
    .sort((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base))
  if (!webs.length) {
    return <TabHead title="Web Function">No Web Function in the latest run.</TabHead>
  }
  const rows = webs.flatMap((web): Row[] => {
    // The same runtime as an Event Function, on the Web Function's architecture at the nearest size.
    const event = functions
      .filter((f) => f.base === web.web!.counterpart && f.arch === web.arch)
      .sort((a, b) => Math.abs(a.memoryMb - web.memoryMb) - Math.abs(b.memoryMb - web.memoryMb))[0]
    const y = event && figures.get(event.id)
    return [
      { f: web, x: figures.get(web.id)!, web: true },
      ...(event && y ? [{ f: event, x: y, web: false }] : []),
    ]
  })
  return (
    <div className="flex flex-col gap-6">
      <TabHead title="Web Function" />
      <Explainer
        title="What is a Lambda Web Function?"
        onOpen={() => track('web_explainer_opened', {})}
      >
        <p className="max-w-prose text-pretty">
          A Web Function runs an ordinary HTTP server. Lambda gives it an HTTPS endpoint, starts
          environments as requests arrive and sends each of them many requests at once. Event
          Functions get one event at a time through a handler.
        </p>
        <Differences kind="Web Function" rows={DIFFERENCES} />
        <p className="max-w-prose text-pretty">
          Each round deploys a new revision, which retires the warm environments, and sends requests
          until a fresh server answers. The cold start is that environment’s initialization, from
          starting the runtime until the server listens, as Lambda logs it.{' '}
          <a href={`${REPO}#-the-web-function`}>How it’s measured</a>
        </p>
      </Explainer>
      <Table rows={rows} />
      <p className="m-0 max-w-prose text-sm text-muted">
        A Web Function’s memory is its whole environment’s, which holds the server and up to 128
        requests at once, so it doesn’t compare one to one.
      </p>
    </div>
  )
}
