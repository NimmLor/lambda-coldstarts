import type { ReactNode } from 'react'
import { track } from './analytics'
import { type Figures, type Fn, niceMax, ORDER, VARIANTS } from './data'
import { REPO } from './layout'
import { Differences, Explainer } from './Section'
import type { TabProps } from './tabs'
import { Badges, Card, FamilyIcon, Figure, Swatch, TabHead } from './ui'

const SECTIONS = [
  { id: 'custom-runtimes', label: 'Custom runtimes' },
  { id: 'web-function', label: 'Web Function' },
  { id: 'microvms', label: 'MicroVMs' },
] as const

/** `a` against `b` as a multiple, and which way: "2.2× as long", "1.6× faster". */
const times = (a: number, b: number, more: string, less: string) =>
  a >= b ? `${(a / b).toFixed(1)}× ${more}` : `${(b / a).toFixed(1)}× ${less}`

/** A difference from the first row of a group, green when it's lower. */
const Delta = ({ value, base }: { value?: number; base?: number }) => {
  if (value === undefined || base === undefined) return null
  const d = Math.round(value - base)
  return (
    <dd
      className={`measured m-0 self-start rounded-chip px-1 text-xs ${d <= 0 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}
    >
      {d < 0 ? `−${Math.abs(d)}` : d > 0 ? `+${d}` : '±0'}
    </dd>
  )
}

const CMR_DIFFERENCES = [
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

const WEB_DIFFERENCES = [
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

const MICROVM_DIFFERENCES = [
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

/** A section of the tab: its heading, what it shows in the instrument face, and its finding. */
const SectionHead = ({
  id,
  title,
  meta,
  children,
}: {
  id: string
  title: string
  meta: string
  children?: ReactNode
}) => (
  <div className="flex flex-col gap-2">
    <h3 id={`${id}-title`} className="text-xl">
      {title}
    </h3>
    <p className="measured m-0 text-sm text-muted">{meta}</p>
    {children && <p className="datum m-0 max-w-prose text-pretty text-ink-2">{children}</p>}
  </div>
)

type Stat = { label: string; value?: number; digits: number; base?: number }

/** One runtime of a group: its name and first-answer bar, then five figures, wrapped on a phone. */
const RuntimeRow = ({
  f,
  name,
  x,
  base,
  max,
}: {
  f?: Fn
  name: string
  x?: Figures
  base?: Figures
  max: number
}) => {
  const stats: Stat[] = [
    { label: 'Init', value: x?.cold, digits: 1, base: base?.cold },
    { label: '1st answer', value: x?.trip, digits: 0, base: base?.trip },
    { label: 'p99', value: x?.p99, digits: 0 },
    { label: 'Warm', value: x?.warm, digits: 2 },
    { label: 'Memory', value: x?.mem, digits: 1 },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule py-2.5">
      <div className="flex min-w-0 flex-[1_1_15rem] flex-col gap-1.5">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
          <span
            aria-hidden="true"
            className="mark size-2 shrink-0 rounded-full"
            style={{ background: f?.color ?? 'var(--color-line-other)' }}
          />
          {name}
          {f && <Badges f={f} />}
        </span>
        {x?.trip !== undefined && f && (
          <span aria-hidden="true" className="block h-1.5 rounded-full bg-paper-3">
            <span
              className="mark block h-full rounded-full"
              style={{ width: `${(x.trip / max) * 100}%`, background: f.color }}
            />
          </span>
        )}
      </div>
      {x ? (
        <dl className="m-0 grid min-w-0 flex-[999_1_22rem] grid-cols-5 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs whitespace-nowrap text-muted">{s.label}</dt>
              <dd className="measured m-0 text-sm text-ink">
                {s.value === undefined ? '—' : s.value.toFixed(s.digits)}
              </dd>
              {base && <Delta value={s.value} base={s.base} />}
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 flex flex-[999_1_22rem] items-center gap-2.5 rounded-pill border border-dashed border-rule-2 px-3 py-1.5 text-sm text-bad">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 4.5v4M8 11v.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          No data: the latest run has no cold start of it.
        </p>
      )}
    </div>
  )
}

/** Each customer-managed runtime beside the variant it repackages, at the picked size. */
const CustomRuntimes = ({ figures, functions, arch, memoryMb }: TabProps) => {
  if (!functions.some((f) => f.cmr)) return null
  const at = (base: string) =>
    functions.find((f) => f.base === base && f.arch === arch && f.memoryMb === memoryMb)
  const counterparts = [
    ...new Set(Object.values(VARIANTS).flatMap((v) => (v.cmr ? [v.cmr.counterpart] : []))),
  ].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  const groups = counterparts.flatMap((base) => {
    const against = at(base)
    const members = Object.entries(VARIANTS)
      .filter(([, v]) => v.cmr?.counterpart === base)
      .map(([b, v]) => ({ base: b, name: v.name, f: at(b) }))
    return against || members.some((m) => m.f) ? [{ base, against, members }] : []
  })
  const max = niceMax(
    Math.max(
      0,
      ...groups.flatMap((g) =>
        [g.against, ...g.members.map((m) => m.f)].flatMap((f) =>
          f ? (figures.get(f.id)?.trip ?? []) : []
        )
      )
    )
  )
  // The repackaging that moved the first answer most.
  const moves = groups.flatMap((g) => {
    const before = g.against && figures.get(g.against.id)?.trip
    return g.members.flatMap((m) => {
      const after = m.f && figures.get(m.f.id)?.trip
      return before && after ? [{ g, m, before, after }] : []
    })
  })
  const most = moves.sort(
    (a, b) => Math.abs(Math.log(b.after / b.before)) - Math.abs(Math.log(a.after / a.before))
  )[0]
  return (
    <section
      id="custom-runtimes"
      aria-labelledby="custom-runtimes-title"
      className="flex scroll-mt-32 flex-col gap-4"
    >
      <SectionHead
        id="custom-runtimes"
        title="Custom runtimes"
        meta={`${arch} · ${memoryMb} MB · times in ms, memory in MB`}
      >
        {most && (
          <>
            On a customer-managed runtime, {most.m.name.replace(/, Custom Runtime.*$/, '')} answers
            a cold call in <Figure>{most.after.toFixed(0)} ms</Figure> against{' '}
            <Figure>{most.before.toFixed(0)} ms</Figure>{' '}
            {figures.get(most.g.against!.id)?.runtime === 'provided.al2023'
              ? 'with the runtime in its .zip'
              : 'on Lambda’s own runtime'}
            : {times(most.before, most.after, 'sooner', 'later')}.
          </>
        )}
      </SectionHead>
      <Explainer
        title="What is a customer-managed runtime?"
        onOpen={() => track('cmr_explainer_opened', {})}
      >
        <p className="max-w-prose text-pretty">
          A customer-managed runtime is a container image that a runtime publisher, such as a
          platform team, owns apart from the functions that run on it. Functions still deploy a .zip
          of their code, and name the runtime and an alias instead of a runtime like nodejs24.x.
          Lambda starts the image’s entry point, with the code in /var/task.
        </p>
        <Differences
          kind="Customer-managed"
          other="Lambda’s or in the .zip"
          rows={CMR_DIFFERENCES}
        />
        <p className="max-w-prose text-pretty">
          These are Event Functions measured like every other: each round retires the warm
          environments and starts a cold one. Lambda caches runtime images that many functions
          share; each image here serves only its own variant’s sizes.{' '}
          <a href={`${REPO}#-the-customer-managed-runtimes`}>How they’re built</a>
        </p>
      </Explainer>
      <div className="rounded-card border border-rule bg-paper-2 px-4 pt-1 pb-2.5 sm:px-6">
        {groups.map((g) => {
          const base = g.against && figures.get(g.against.id)
          return (
            <div key={g.base}>
              <h4 className="flex items-center gap-2 pt-4 pb-1 text-md font-medium">
                <FamilyIcon family={VARIANTS[g.base]!.family} />
                {VARIANTS[g.base]!.name}
              </h4>
              {g.against && (
                <RuntimeRow
                  f={g.against}
                  name={
                    base?.runtime === 'provided.al2023'
                      ? 'In the .zip, on provided.al2023'
                      : `On Lambda’s ${base?.runtime ?? 'runtime'}`
                  }
                  x={base}
                  max={max}
                />
              )}
              {g.members.map((m) => (
                <RuntimeRow
                  key={m.base}
                  f={m.f}
                  name={m.name}
                  x={m.f && figures.get(m.f.id)}
                  base={base}
                  max={max}
                />
              ))}
            </div>
          )
        })}
      </div>
      <p className="m-0 max-w-prose text-sm text-muted">
        1st answer is the cold call’s first answer, p99 the slowest 1% of its cold starts. Deltas
        are against the first row of each group.
      </p>
    </section>
  )
}

const TILES = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1 },
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0 },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 2 },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1 },
] as const

/** The Web Function against the same runtime as an Event Function at the nearest size. */
const WebFunction = ({ figures, functions }: TabProps) => {
  const web = functions.find((f) => f.web)
  const x = web && figures.get(web.id)
  if (!web || !x) return null
  const event = functions
    .filter((f) => f.base === web.web!.counterpart && f.arch === web.arch)
    .sort((a, b) => Math.abs(a.memoryMb - web.memoryMb) - Math.abs(b.memoryMb - web.memoryMb))[0]
  const y = event && figures.get(event.id)
  return (
    <section
      id="web-function"
      aria-labelledby="web-function-title"
      className="flex scroll-mt-32 flex-col gap-4"
    >
      <SectionHead
        id="web-function"
        title="Web Function"
        meta={`${VARIANTS[web.web!.counterpart]?.name ?? web.name} · ${web.arch} · ${web.memoryMb / 1024} GB${event ? `, against the Event Function at ${event.memoryMb} MB` : ''}`}
      >
        {y?.cold !== undefined && x.cold !== undefined && x.trip && y.trip && x.warm && y.warm && (
          <>
            As a Web Function, {VARIANTS[web.web!.counterpart]?.name} takes{' '}
            <Figure>{times(x.cold, y.cold, 'as long', 'less time')}</Figure> to start and{' '}
            <Figure>{times(x.trip, y.trip, 'as long', 'less time')}</Figure> to answer its first
            request, then serves warm requests{' '}
            <Figure>{times(y.warm, x.warm, 'faster', 'slower')}</Figure>.
          </>
        )}
      </SectionHead>
      <Explainer
        title="What is a Lambda Web Function?"
        onOpen={() => track('web_explainer_opened', {})}
      >
        <p className="max-w-prose text-pretty">
          A Web Function runs an ordinary HTTP server. Lambda gives it an HTTPS endpoint, starts
          environments as requests arrive and sends each of them many requests at once. Event
          Functions get one event at a time through a handler.
        </p>
        <Differences kind="Web Function" rows={WEB_DIFFERENCES} />
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
              <h4 className="flex items-baseline gap-2 text-md">
                {t.title} <span className="text-sm font-normal text-muted">{t.unit}</span>
              </h4>
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
    </section>
  )
}

/** A MicroVM size's vCPUs: one per 2 GB. */
const vcpus = (mb: number) => {
  const n = mb / 2048
  return n === 0.25 ? '¼ vCPU' : n === 0.5 ? '½ vCPU' : `${n} vCPU${n === 1 ? '' : 's'}`
}

/**
 * Each MicroVM's first answer, split into the API calls and its first request, beside an Event
 * Function's.
 */
const MicroVms = ({ figures, functions, memoryMb }: TabProps) => {
  const vms = functions
    .filter((f) => f.microvm && figures.get(f.id)?.trip !== undefined)
    .sort((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base) || a.memoryMb - b.memoryMb)
  if (!vms.length) return null
  const counterpart = vms[0]!.microvm!.counterpart
  const event = functions.find(
    (f) => f.base === counterpart && f.arch === 'arm64' && f.memoryMb === memoryMb
  )
  const eventTrip = event && figures.get(event.id)?.trip
  const trips = vms.map((f) => figures.get(f.id)!.trip!)
  const max = niceMax(Math.max(...trips, eventTrip ?? 0))
  const largest = vms.filter((f) => f.base === vms[0]!.base).at(-1)!
  const rows = [
    ...vms.map((f) => {
      const x = figures.get(f.id)!
      return {
        key: f.id,
        name: f.name.replace(/ · .*$/, ''),
        sub: `${f.memoryMb / 1024} GB · ${vcpus(f.memoryMb)}`,
        f,
        total: x.trip!,
        first: x.firstRequest ?? 0,
        api: x.trip! - (x.firstRequest ?? 0),
        apiColor: 'var(--color-rule-2)',
      }
    }),
    ...(event && eventTrip !== undefined
      ? [
          {
            key: event.id,
            name: event.name,
            sub: `Event Function at ${memoryMb} MB, for scale`,
            f: event,
            total: eventTrip,
            first: 0,
            api: eventTrip,
            apiColor: event.color,
          },
        ]
      : []),
  ]
  return (
    <section
      id="microvms"
      aria-labelledby="microvms-title"
      className="flex scroll-mt-32 flex-col gap-4"
    >
      <SectionHead
        id="microvms"
        title="MicroVMs"
        meta="arm64 · each size Lambda offers · resumed from a snapshot, so no init"
      >
        A MicroVM answers its first request in{' '}
        <Figure>
          {(Math.min(...trips) / 1000).toFixed(1)}–{(Math.max(...trips) / 1000).toFixed(1)} s
        </Figure>
        {eventTrip !== undefined && (
          <>
            ,{' '}
            <Figure>
              {(Math.min(...trips) / eventTrip).toFixed(0)}–
              {(Math.max(...trips) / eventTrip).toFixed(0)}×
            </Figure>{' '}
            an Event Function’s cold call
          </>
        )}
        {figures.get(largest.id)!.trip === Math.max(...trips) &&
          ', and the largest size is the slowest'}
        .
      </SectionHead>
      <Explainer
        title="What is a Lambda MicroVM?"
        onOpen={() => track('microvm_explainer_opened', {})}
      >
        <p className="max-w-prose text-pretty">
          A MicroVM is a Firecracker virtual machine of its own, for one user, session or job, meant
          for running code you don’t trust, such as an AI agent’s. Lambda builds an image from a
          Dockerfile, starts the program in it and snapshots it running. Every MicroVM resumes from
          that snapshot.
        </p>
        <Differences kind="MicroVM" rows={MICROVM_DIFFERENCES} />
        <p className="max-w-prose text-pretty">
          A MicroVM has no init to compare: its server started once, when the image was built. So
          each round times what a caller waits for instead, from PerfMeasure in the same region:
          from calling RunMicrovm, through getting a token, until its first response. The endpoint
          holds a request for about a second while the MicroVM resumes, then turns it away, and the
          round asks again. <a href={`${REPO}#-the-microvm`}>How it’s measured</a>
        </p>
      </Explainer>
      <Card
        title="First answer"
        caption="From calling RunMicrovm until the first response; 4 and 8 GB often outlast the endpoint’s first wait, so their answers come in two modes."
      >
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <Swatch color="var(--color-rule-2)">RunMicrovm and token</Swatch>
          <Swatch color="var(--color-line-Node24MicroVm)">
            First request, retried while it resumes
          </Swatch>
          {event && <Swatch color={event.color}>Event Function’s whole cold call</Swatch>}
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule py-2.5"
            >
              <span className="flex min-w-0 flex-[1_1_13rem] flex-col leading-tight">
                <span className="text-sm text-ink">{r.name}</span>
                <span className="text-xs text-muted">{r.sub}</span>
              </span>
              <span
                aria-hidden="true"
                className="flex h-3.5 min-w-0 flex-[999_1_8rem] overflow-hidden rounded-[3px] bg-paper-3"
              >
                <span
                  className="mark h-full"
                  style={{ width: `${(r.api / max) * 100}%`, background: r.apiColor }}
                />
                <span
                  className="mark h-full"
                  style={{
                    width: `${(r.first / max) * 100}%`,
                    background: 'var(--color-line-Node24MicroVm)',
                  }}
                />
              </span>
              <span className="measured flex-[0_0_5rem] text-right text-md text-ink">
                {r.total.toFixed(0)}
                <span className="ml-0.5 text-xs text-muted">ms</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-sm text-muted">
          Server memory, by its own account:{' '}
          {vms
            .filter((f, i, all) => all.findIndex((g) => g.base === f.base) === i)
            .map(
              (f) =>
                `${VARIANTS[f.base]?.name.replace(/, MicroVM$/, '') ?? f.base} ${figures.get(f.id)?.mem?.toFixed(1)} MB`
            )
            .join(', ')}
          .
        </p>
      </Card>
    </section>
  )
}

export const Deployment = (props: TabProps) => (
  <div className="flex flex-col gap-12">
    <div className="flex flex-col gap-4">
      <TabHead title="Deployment options" meta="The same runtimes, packaged or run another way">
        Each against the Event Function it started from.
      </TabHead>
      <nav aria-label="On this tab" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              // Scrolls without replacing the fragment, which names the tab.
              e.preventDefault()
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="inline-flex min-h-10 items-center rounded-full border border-rule-2 px-4 text-sm text-ink no-underline hover:bg-paper-2"
          >
            {s.label}
          </a>
        ))}
      </nav>
    </div>
    <CustomRuntimes {...props} />
    <WebFunction {...props} />
    <MicroVms {...props} />
  </div>
)
