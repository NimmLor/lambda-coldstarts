import { track } from './analytics'
import { type Figures, type Fn, niceMax, ORDER, VARIANTS } from './data'
import { REPO } from './layout'
import { Differences, Explainer } from './Section'
import type { TabProps } from './tabs'
import { Badges, FamilyIcon, Figure, TabHead } from './ui'

/** `a` against `b` as a multiple, and which way: "2.2× as long", "1.6× faster". */
export const times = (a: number, b: number, more: string, less: string) =>
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
export const Deployment = ({ figures, functions, arch, memoryMb }: TabProps) => {
  if (!functions.some((f) => f.cmr)) {
    return (
      <TabHead title="Deployment" meta="Customer-managed runtimes">
        No function runs on a customer-managed runtime in the latest run.
      </TabHead>
    )
  }
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
    <div className="flex flex-col gap-6">
      <TabHead
        title="Deployment"
        meta={`Customer-managed runtimes · ${arch} · ${memoryMb} MB · times in ms, memory in MB`}
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
      </TabHead>
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
    </div>
  )
}
