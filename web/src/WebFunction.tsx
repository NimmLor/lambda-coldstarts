import { track } from './analytics'
import { VARIANTS } from './data'
import { times } from './Deployment'
import { REPO } from './layout'
import { Differences, Explainer } from './Section'
import type { TabProps } from './tabs'
import { Figure, TabHead } from './ui'

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
    '2 GB and 2 vCPUs on arm64, Node.js 24 only',
    '128 MB to 10 GB on either architecture, any runtime',
  ],
  [
    'Billing',
    'Requests, CPU time while busy, memory while the environment lives',
    'Requests, and duration times memory',
  ],
  ['Regions', 'Some so far, eu-central-1 among them', 'All of them'],
] as const

const TILES = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1 },
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0 },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 2 },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1 },
] as const

/** The Web Function against the same runtime as an Event Function at the nearest size. */
export const WebFunction = ({ figures, functions }: TabProps) => {
  const web = functions.find((f) => f.web)
  const x = web && figures.get(web.id)
  if (!web || !x) {
    return (
      <TabHead title="Web Function" meta="Lambda Web Functions">
        No Web Function in the latest run.
      </TabHead>
    )
  }
  const runtime = VARIANTS[web.web!.counterpart]?.name ?? web.name
  const event = functions
    .filter((f) => f.base === web.web!.counterpart && f.arch === web.arch)
    .sort((a, b) => Math.abs(a.memoryMb - web.memoryMb) - Math.abs(b.memoryMb - web.memoryMb))[0]
  const y = event && figures.get(event.id)
  return (
    <div className="flex flex-col gap-6">
      <TabHead
        title="Web Function"
        meta={`${runtime} · ${web.arch} · ${web.memoryMb / 1024} GB${event ? `, against the Event Function at ${event.memoryMb} MB` : ''}`}
      >
        {y?.cold !== undefined && x.cold !== undefined && x.trip && y.trip && x.warm && y.warm && (
          <>
            As a Web Function, {runtime} takes{' '}
            <Figure>{times(x.cold, y.cold, 'as long', 'less time')}</Figure> to start and{' '}
            <Figure>{times(x.trip, y.trip, 'as long', 'less time')}</Figure> to answer its first
            request, then serves warm requests{' '}
            <Figure>{times(y.warm, x.warm, 'faster', 'slower')}</Figure>.
          </>
        )}
      </TabHead>
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
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
        {TILES.map((t) => {
          const a = x[t.key]
          const b = y?.[t.key]
          const max = Math.max(a ?? 0, b ?? 0) || 1
          return (
            <article key={t.key} className="flex min-w-0 flex-col gap-3 bg-paper-2 p-5">
              <h3 className="flex items-baseline gap-2 text-md">
                {t.title} <span className="text-sm font-normal text-muted">{t.unit}</span>
              </h3>
              <dl className="m-0 flex flex-col gap-2.5">
                {[
                  { name: 'Web Function', value: a, color: web.color },
                  { name: 'Event Function', value: b, color: event?.color },
                ].map((r) => (
                  <div key={r.name} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <dt className="text-muted">{r.name}</dt>
                      <dd className="measured m-0 text-ink">
                        {r.value === undefined ? '—' : r.value.toFixed(t.digits)}
                      </dd>
                    </div>
                    <div aria-hidden="true" className="h-1.5 rounded-full bg-paper-3">
                      <div
                        className="mark h-full rounded-full"
                        style={{ width: `${((r.value ?? 0) / max) * 100}%`, background: r.color }}
                      />
                    </div>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>
      <p className="m-0 max-w-prose text-sm text-muted">
        A Web Function’s memory is its whole environment’s, which holds the server and up to 128
        requests at once, so it doesn’t compare one to one.
      </p>
    </div>
  )
}
