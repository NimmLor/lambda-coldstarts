import { track } from './analytics'
import { type Fn, niceMax, ORDER, VARIANTS } from './data'
import { REPO } from './layout'
import { Differences, Explainer } from './Section'
import type { TabProps } from './tabs'
import { Card, Swatch, TabHead } from './ui'

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

/** Lambda's default MicroVM size, which each is compared at: the Event Function nearest it. */
const COMPARE_AT_MB = 2048

/** A MicroVM size's vCPUs: one per 2 GB. */
const vcpus = (mb: number) => {
  const n = mb / 2048
  return n === 0.25 ? '¼ vCPU' : n === 0.5 ? '½ vCPU' : `${n} vCPU${n === 1 ? '' : 's'}`
}

type Row = {
  key: string
  name: string
  sub: string
  total: number
  api: number
  first: number
  color: string
}

/**
 * Each MicroVM's first answer, split into the API calls and its first request, and after each
 * runtime's MicroVMs its cold call as an Event Function on arm64 at the size nearest 2 GB.
 */
export const MicroVms = ({ figures, functions }: TabProps) => {
  const vms = functions
    .filter((f) => f.microvm && figures.get(f.id)?.trip !== undefined)
    .sort((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base) || a.memoryMb - b.memoryMb)
  if (!vms.length) {
    return <TabHead title="MicroVMs">No MicroVM in the latest run.</TabHead>
  }
  /** The runtime a MicroVM runs, as an Event Function on arm64 at the size nearest 2 GB. */
  const eventOf = (vm: Fn) =>
    functions
      .filter(
        (f) =>
          f.base === vm.microvm!.counterpart &&
          f.arch === 'arm64' &&
          figures.get(f.id)?.trip !== undefined
      )
      .sort(
        (a, b) => Math.abs(a.memoryMb - COMPARE_AT_MB) - Math.abs(b.memoryMb - COMPARE_AT_MB)
      )[0]
  const groups = [...new Set(vms.map((f) => f.base))].map((base) => {
    const members = vms.filter((f) => f.base === base)
    return { base, members, event: eventOf(members[0]!) }
  })
  const trip = (f: Fn) => figures.get(f.id)!.trip!
  const trips = vms.map(trip)
  const max = niceMax(
    Math.max(...trips, ...groups.flatMap((g) => (g.event ? [trip(g.event)] : [])))
  )
  const rows: Row[] = groups.flatMap((g) => [
    ...g.members.map((f) => {
      const x = figures.get(f.id)!
      const first = x.firstRequest ?? 0
      return {
        key: f.id,
        name: f.name.replace(/ · .*$/, ''),
        sub: `${f.memoryMb / 1024} GB · ${vcpus(f.memoryMb)}`,
        total: x.trip!,
        api: x.trip! - first,
        first,
        color: 'var(--color-rule-2)',
      }
    }),
    ...(g.event
      ? [
          {
            key: g.event.id,
            name: g.event.name,
            sub: `Event Function at ${g.event.memoryMb} MB, for scale`,
            total: trip(g.event),
            api: trip(g.event),
            first: 0,
            color: g.event.color,
          },
        ]
      : []),
  ])
  return (
    <div className="flex flex-col gap-6">
      <TabHead title="MicroVMs" />
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
        <Differences kind="MicroVM" rows={DIFFERENCES} />
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
        caption="From calling RunMicrovm until the first response; 4 and 8 GB often outlast the endpoint’s first wait, so their answers come in two modes. After each runtime, its cold call as an Event Function, from calling Invoke."
      >
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <Swatch color="var(--color-rule-2)">RunMicrovm and token</Swatch>
          <Swatch color="var(--color-line-Node24MicroVm)">
            First request, retried while it resumes
          </Swatch>
          <Swatch color="var(--color-ink-2)">
            Event Function’s whole cold call, in its colour
          </Swatch>
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
                  style={{ width: `${(r.api / max) * 100}%`, background: r.color }}
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
          {groups
            .map(
              (g) =>
                `${VARIANTS[g.base]?.name.replace(/, MicroVM$/, '') ?? g.base} ${figures.get(g.members[0]!.id)?.mem?.toFixed(1) ?? '—'} MB`
            )
            .join(', ')}
          .
        </p>
      </Card>
    </div>
  )
}
