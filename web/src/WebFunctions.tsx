import { track } from './analytics'
import type { Metric } from './Chart'
import type { View } from './data'
import { REPO, WRAP } from './layout'
import { Board, Differences, Explainer, SectionHead } from './Section'

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

/** What a Web Function is, how it differs, and how it's measured here. */
const About = () => (
  <Explainer
    title="What is a Lambda Web Function?"
    onOpen={() => track('web_explainer_opened', {})}
  >
    <p className="max-w-prose text-pretty">
      A Web Function runs an ordinary HTTP server. Lambda gives it an HTTPS endpoint, starts
      environments as requests arrive and sends each of them many requests at once. The functions
      above, which AWS now calls Event Functions, get one event at a time through a handler.
    </p>
    <Differences kind="Web Function" rows={DIFFERENCES} />
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
  </Explainer>
)

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
  return (
    <section className={`${WRAP} flex flex-col gap-6 pt-16 sm:pt-20`}>
      <SectionHead title="Lambda Web Functions" compared={compared} onCompare={onCompare}>
        Node.js 24 as a Web Function, on arm64 with the 2 GB and 2 vCPUs every environment gets.
      </SectionHead>
      <About />
      <Board view={view} figures={figures} compared={compared} />
    </section>
  )
}
