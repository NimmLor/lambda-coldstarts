import { track } from './analytics'
import type { Metric } from './Chart'
import type { View } from './data'
import { REPO, WRAP } from './layout'
import { Board, Differences, Explainer, SectionHead } from './Section'

const DOCS = 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html'
const CONCEPTS = 'https://docs.aws.amazon.com/lambda/latest/dg/microvms-how-it-works.html'
const PRICING = 'https://aws.amazon.com/lambda/pricing/'

/** What sets a MicroVM apart from the functions above, as of October 2026. */
const DIFFERENCES = [
  [
    'Code',
    'Any program in a container, built from a Dockerfile: here a node:http server',
    'A handler that gets one event per call',
  ],
  [
    'Start',
    'Resumes a snapshot Lambda took of the running program when it built the image',
    'Starts the runtime and loads the code, then waits for an event',
  ],
  [
    'Lifetime',
    'Runs until terminated, up to 8 hours; can suspend while idle and resume',
    'Lambda starts environments for events and retires them when idle',
  ],
  [
    'Endpoint',
    'Its own HTTPS endpoint, reached with a token from the API',
    'A Function URL, API Gateway or another service',
  ],
  [
    'Size',
    '0.5 to 8 GB, a vCPU per 2 GB, bursting to four times that; arm64 only',
    '128 MB to 10 GB on either architecture',
  ],
  [
    'Billing',
    'Per second while it runs, plus reading, writing and storing snapshots',
    'Requests, and duration times memory',
  ],
] as const

/** The round trips this section shows instead of the init, which a MicroVM doesn't have. */
const TRIPS: Metric[] = [
  {
    key: 'trip',
    digits: 0,
    title: 'First answer',
    unit: 'ms',
    height: 200,
    leader: 'Fastest',
    icon: 'cold',
  },
  // The part of the first answer spent waiting for the MicroVM; an Event Function has no such part.
  {
    key: 'firstRequest',
    digits: 0,
    title: 'First request',
    unit: 'ms',
    height: 200,
    leader: 'Fastest',
    icon: 'dur',
  },
]

/** What a MicroVM is, how it differs, and what's measured here instead of a cold start. */
const About = () => (
  <Explainer title="What is a Lambda MicroVM?" onOpen={() => track('microvm_explainer_opened', {})}>
    <p className="max-w-prose text-pretty">
      A MicroVM is a Firecracker virtual machine of its own, for one user, session or job, meant for
      running code you don’t trust, such as an AI agent’s. Lambda builds an image from a Dockerfile,
      starts the program in it and snapshots it running. Every MicroVM resumes from that snapshot.
    </p>
    <Differences kind="MicroVM" rows={DIFFERENCES} />
    <p className="max-w-prose text-pretty">
      A MicroVM has no init to compare: its server started once, when the image was built. So each
      round times what a caller waits for instead, from PerfMeasure in the same region. First answer
      runs from calling RunMicrovm, through getting a token to reach the MicroVM, until its first
      response. First request is the last part alone: the endpoint holds a request for about a
      second while the MicroVM resumes, then turns it away, and the round asks again. The Event
      Function’s first answer is its cold invocation, from calling Invoke until the response.
      Neither is the init duration above. <a href={`${REPO}#-the-microvm`}>How it’s measured</a>
    </p>
    <nav aria-label="About MicroVMs" className="flex flex-wrap gap-x-6 gap-y-2">
      <a href={DOCS}>MicroVMs in the Lambda docs</a>
      <a href={CONCEPTS}>How they work</a>
      <a href={PRICING}>Pricing</a>
    </nav>
  </Explainer>
)

/**
 * The Lambda MicroVMs, apart from everything above: a figure for each of the first answer, the
 * first request and memory at every size, and the first answer over time, against their
 * counterparts unless turned off: the same runtime as an Event Function on arm64 at the memory size
 * picked above. With no init, they're in neither the charts above nor the result list.
 */
export const MicroVms = ({
  view,
  metrics,
  compared,
  onCompare,
}: {
  /** The MicroVMs at every size, smallest first, and their counterparts when `compared`. */
  view: View
  /** The page's metrics; the section shows memory after its own round trips. */
  metrics: Metric[]
  compared: boolean
  onCompare: (on: boolean) => void
}) => (
  <section className={`${WRAP} flex flex-col gap-6 pt-16 sm:pt-20`}>
    <SectionHead title="Lambda MicroVMs" compared={compared} onCompare={onCompare}>
      Node.js 24 in a MicroVM, on arm64 at each baseline Lambda offers, from 0.5 GB and a quarter of
      a vCPU to 8 GB and 4 vCPUs. Timed by how long a caller waits for an answer, as it has no cold
      start in the sense above.
    </SectionHead>
    <About />
    <Board
      view={view}
      figures={[...TRIPS, ...metrics.filter((m) => m.key === 'mem')]}
      compared={compared}
    />
  </section>
)
