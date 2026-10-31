import { track } from './analytics'
import { Chart, type Metric, Versus } from './Chart'
import { ChartIcon } from './ChartIcon'
import { fixed, type View } from './data'
import { REPO, WRAP } from './layout'

const DOCS = 'https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html'
const LAUNCH =
  'https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/'
const PRICING = 'https://aws.amazon.com/lambda/pricing/'

/** What sets a Web Function apart from the functions above, as of its launch in October 2026. */
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

const ROW = 'grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]'

/** Collapsed until asked: what a Web Function is, how it differs, and how it's measured here. */
const Explainer = () => (
  <details
    className="group rounded-card border border-rule bg-paper-2"
    onToggle={(e) => e.currentTarget.open && track('web_explainer_opened', {})}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-ink sm:px-6 [&::-webkit-details-marker]:hidden">
      What is a Lambda Web Function?
      <svg
        aria-hidden="true"
        viewBox="0 0 10 6"
        className="size-3 shrink-0 text-muted transition-transform duration-(--dur-short) group-open:rotate-180"
      >
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </summary>
    <div className="flex flex-col gap-5 border-t border-rule px-5 pt-4 pb-6 text-sm text-ink-2 sm:px-6">
      <p className="max-w-prose text-pretty">
        A Web Function runs an ordinary HTTP server. Lambda gives it an HTTPS endpoint, starts
        environments as requests arrive and sends each of them many requests at once. The functions
        above, which AWS now calls Event Functions, get one event at a time through a handler.
      </p>
      {/* Three columns once there's room; on a phone each aspect stacks, the two sides labelled. */}
      <div role="table" aria-label="Web Function and Event Function" className="flex flex-col">
        <div role="row" className={`${ROW} text-xs text-muted max-sm:hidden`}>
          <span role="columnheader" />
          <span role="columnheader">Web Function</span>
          <span role="columnheader">Event Function</span>
        </div>
        {DIFFERENCES.map(([aspect, web, event]) => (
          <div key={aspect} role="row" className={`${ROW} border-t border-rule py-2`}>
            <span role="rowheader" className="font-medium text-ink">
              {aspect}
            </span>
            <span role="cell">
              <span className="text-xs text-muted sm:hidden">Web Function: </span>
              {web}
            </span>
            <span role="cell" className="text-muted">
              <span className="text-xs sm:hidden">Event Function: </span>
              {event}
            </span>
          </div>
        ))}
      </div>
      <p className="max-w-prose text-pretty">
        Here, each round deploys a new revision, which retires the warm environments, and sends
        requests until a fresh server answers. The cold start is that environment’s initialization,
        from starting the runtime until the server listens, as Lambda logs it.{' '}
        <a href={`${REPO}#-the-web-function`}>How it’s measured</a>
      </p>
      <nav aria-label="About Web Functions" className="flex flex-wrap gap-x-6 gap-y-2">
        <a href={DOCS}>Web Functions in the Lambda docs</a>
        <a href={LAUNCH}>Launch announcement</a>
        <a href={PRICING}>Pricing</a>
      </nav>
    </div>
  </details>
)

/** One figure for each function in the section, each against the counterpart's. */
const Figure = ({ metric: m, view }: { metric: Metric; view: View }) => {
  const { fns, baseline, agg } = view
  const against = baseline && agg(baseline, m.key)
  return (
    <article className="flex min-w-0 flex-col gap-4 bg-paper-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <h3 className="flex items-baseline gap-2 text-lg text-ink">
          <ChartIcon name={m.icon} className="size-[1.125rem]" />
          {m.title}
        </h3>
        {m.unit}
      </div>
      <dl className="m-0 flex flex-col gap-2.5">
        {fns.map((f) => {
          const value = agg(f, m.key)
          return (
            <div key={f.id} className="flex items-baseline justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: f.color }}
                />
                <span className="truncate">
                  {f.name}
                  {!f.web && <span className="text-muted"> · {f.memoryMb} MB</span>}
                </span>
              </dt>
              <dd className="m-0 flex items-baseline gap-2 whitespace-nowrap">
                {f !== baseline && <Versus value={value} baseline={against} />}
                <span className="measured text-md text-ink">{fixed(value, m.digits)}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </article>
  )
}

/**
 * The Lambda Web Functions, apart from the functions above: a figure for each of the cold start,
 * warm start and memory, and the cold start over time, against their counterparts unless turned
 * off: the same runtime as an Event Function on arm64 at the picked memory size. The result list
 * below ranks them with the functions.
 */
export const WebFunctions = ({
  view,
  metrics,
  compared,
  onCompare,
}: {
  /** The Web Functions, and their counterparts when `compared`. */
  view: View
  /** The page's metrics; the section shows the cold start, warm start and memory. */
  metrics: Metric[]
  compared: boolean
  onCompare: (on: boolean) => void
}) => {
  const figures = metrics.filter((m) => m.key === 'cold' || m.key === 'warm' || m.key === 'mem')
  const cold = figures.find((m) => m.key === 'cold')!
  return (
    <section className={`${WRAP} flex flex-col gap-6 pt-16 sm:pt-20`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <h2 className="text-2xl">Lambda Web Functions</h2>
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={compared}
              onChange={(e) => onCompare(e.currentTarget.checked)}
              className="size-4 cursor-pointer accent-cool"
            />
            Compare with Event Function
          </label>
        </div>
        <p className="max-w-prose text-pretty text-ink-2">
          Node.js 24 as a Web Function, at the 2 GB every one gets.
        </p>
      </div>
      <Explainer />
      <div
        onMouseLeave={() => view.setHover(undefined)}
        className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3"
      >
        {figures.map((m) => (
          <Figure key={m.key} metric={m} view={view} />
        ))}
        <Chart
          // Under the cold start's figure, which has its plain title.
          metric={{ ...cold, title: 'Cold start over time', height: 200 }}
          wide
          view={view}
          caption={
            compared
              ? `${cold.unit}, mean per run · Event Function at ${view.memoryMb} MB`
              : `${cold.unit}, mean per run`
          }
          className="col-span-full"
        />
      </div>
    </section>
  )
}
