import { track } from './analytics'
import type { Metric } from './Chart'
import type { View } from './data'
import { REPO, WRAP } from './layout'
import { Board, Differences, Explainer, SectionHead } from './Section'

const DOCS = 'https://docs.aws.amazon.com/lambda/latest/dg/runtimes-customer-managed.html'
const LAUNCH =
  'https://aws.amazon.com/blogs/compute/control-your-aws-lambda-runtimes-with-customer-managed-runtimes/'
const IMAGES = 'https://docs.aws.amazon.com/lambda/latest/dg/cmr-building-images.html'

/**
 * What sets a customer-managed runtime apart from the runtimes the functions above run on, as of
 * its launch in November 2026: Lambda's own, or one in the function's .zip on provided.al2023,
 * which AWS now calls bring your own language.
 */
const DIFFERENCES = [
  [
    'Runtime',
    'A container image in ECR, published as a runtime with versions and aliases',
    'Lambda’s own, or a bootstrap in the function’s .zip or a layer',
  ],
  [
    'Code',
    'A .zip of the handler alone, as on Lambda’s runtimes',
    'The same, plus the runtime itself in the .zip on provided.al2023',
  ],
  [
    'Updates',
    'Its publisher moves an alias; each function takes it at its next cold start',
    'Lambda patches its own; a runtime in the .zip changes with a deploy',
  ],
  ['OS', 'Any Linux: here Amazon Linux 2023, and Alpine', 'Amazon Linux 2023'],
  ['Size', 'Up to 10 GB of image, besides the .zip', 'Up to 250 MB unzipped, layers included'],
  ['Limits', 'No SnapStart, Lambda@Edge or Web Functions', 'SnapStart on Java, Python and .NET'],
  ['Billing', 'As any function, plus ECR for the images', 'Requests, and duration times memory'],
] as const

/** What a customer-managed runtime is, how it differs, and how it's measured here. */
const About = () => (
  <Explainer
    title="What is a customer-managed runtime?"
    onOpen={() => track('cmr_explainer_opened', {})}
  >
    <p className="max-w-prose text-pretty">
      A customer-managed runtime is a container image that a runtime publisher, such as a platform
      team, owns apart from the functions that run on it. Functions still deploy a .zip of their
      code, and name the runtime and an alias instead of a runtime like nodejs24.x. Lambda starts
      the image’s entry point, with the code in /var/task.
    </p>
    <Differences kind="Customer-managed" other="Lambda’s or in the .zip" rows={DIFFERENCES} />
    <p className="max-w-prose text-pretty">
      These are Event Functions like those above, measured the same way: each round retires the warm
      environments and starts a cold one. The cold start is Lambda’s init duration, from starting
      the runtime until it asks for the first event, and the first answer the cold invocation, from
      calling Invoke until the response. Lambda caches runtime images that many functions share;
      each image here serves only its own variant’s five memory sizes.{' '}
      <a href={`${REPO}#-the-customer-managed-runtimes`}>How they’re built</a>
    </p>
    <nav aria-label="About customer-managed runtimes" className="flex flex-wrap gap-x-6 gap-y-2">
      <a href={DOCS}>Customer-managed runtimes in the Lambda docs</a>
      <a href={LAUNCH}>Launch post</a>
      <a href={IMAGES}>Building runtime images</a>
    </nav>
  </Explainer>
)

/**
 * The functions on customer-managed runtimes, apart from the functions above: a figure for each of
 * the cold start, the first answer and memory, and the cold start over time, at the architecture
 * and memory size picked above, each against the variant it repackages unless turned off. The
 * result list below ranks them with the functions.
 */
export const CustomerManagedRuntimes = ({
  view,
  metrics,
  arch,
  compared,
  onCompare,
}: {
  /** The functions on customer-managed runtimes, and their counterparts when `compared`. */
  view: View
  /** The cold start, the first answer and memory, which the section shows in that order. */
  metrics: Metric[]
  arch: string
  compared: boolean
  onCompare: (on: boolean) => void
}) => (
  <section className={`${WRAP} flex flex-col gap-6 pt-16 sm:pt-20`}>
    <SectionHead
      title="Customer-managed runtimes"
      compared={compared}
      onCompare={onCompare}
      compareLabel="Compare with the same runtime above"
    >
      Node.js 24, the Bun runtime and LLRT again, each on a customer-managed runtime, labelled
      Custom Runtime: Lambda’s Node.js 24 image as it is, and the same bun executable and LLRT build
      on Lambda’s OS-only image. Then that Node.js image with the Node.js 27 alpha, which no Lambda
      runtime has yet, and Bun on Alpine instead.
    </SectionHead>
    <About />
    <Board
      view={view}
      figures={metrics}
      compared={compared}
      caption={`${arch} at ${view.memoryMb} MB`}
    />
  </section>
)
