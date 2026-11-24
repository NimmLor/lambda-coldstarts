import { useState } from 'react'
import { track } from './analytics'
import { type Figures, type Fn, fixed } from './data'
import type { TabProps } from './tabs'
import { Badge, Badges, FamilyIcon } from './ui'

/** The columns the table sorts by, in their order; every one is better lower. */
const COLUMNS = [
  { key: 'cold', title: 'Cold start', digits: 1 },
  { key: 'p99', title: 'Slowest 1%', digits: 0 },
  { key: 'trip', title: 'First answer', digits: 0 },
  { key: 'dur', title: 'First call', digits: 1 },
  { key: 'warm', title: 'Warm', digits: 2 },
  { key: 'mem', title: 'Memory', digits: 1 },
  { key: 'cost', title: 'Cost / 1M', digits: 2 },
  { key: 'size', title: 'Size', digits: 1 },
] as const satisfies readonly { key: keyof Figures; title: string; digits: number }[]
type SortKey = (typeof COLUMNS)[number]['key']

/** The columns whose lowest value is a reading worth marking. */
const LEADS: SortKey[] = ['cold', 'p99', 'trip', 'warm', 'mem']

/** `bun build --compile --aot`: the tool dim, each flag a token that wraps as a whole. */
const Command = ({ build }: { build: string }) => {
  const [tool, ...flags] = build.split(/ (?=--)/)
  return (
    <code className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs/normal text-muted">
      <span>{tool}</span>
      {flags.map((flag) => (
        <span key={flag} className="whitespace-nowrap text-ink-2">
          {flag}
        </span>
      ))}
    </code>
  )
}

/**
 * `bun 1.4.4+38afee6c8` or `llrt-lambda-arm64-no-sdk@v0.9.0-beta`: the SDK flavor of an LLRT
 * build, the release, the build after it.
 */
const VERSION = /^(?:.+?-(\w+-sdk)|.+?)[ @]v?(\d[^+]*)(\+.+)?$/

/** The release it ran on, brightest, with which of its builds, then Lambda's runtime. */
const Versions = ({ x }: { x: Figures }) => {
  const [, sdk, release, build] = x.version?.match(VERSION) ?? []
  return (
    <span className="flex flex-wrap gap-x-[2.5ch] font-mono text-xs text-muted slashed-zero">
      {x.version && (
        <span title={x.version}>
          {release ? (
            <>
              <span className="text-ink-2">{release}</span>
              {build && <span className="opacity-60">{build}</span>}
              {sdk && <span className="ml-[1ch]">{sdk}</span>}
            </>
          ) : (
            <span className="text-ink-2">{x.version}</span>
          )}
        </span>
      )}
      <span title="Lambda runtime">{x.runtime}</span>
    </span>
  )
}

/** A figure in its column: the leader's on the cool chip of a reading. */
const Cell = ({ value, digits, lead }: { value?: number; digits: number; lead: boolean }) => (
  <span
    className={`measured whitespace-nowrap ${lead ? 'rounded-chip bg-cool-soft px-1 text-cool' : 'text-ink-2'}`}
  >
    {fixed(value, digits)}
  </span>
)

/**
 * Every shown function on the picked architecture at the picked size, the customer-managed runtimes
 * and the Web Function included, ranked by a column, lowest first; picking it again reverses it.
 */
export const Results = ({ view, figures, functions, arch, memoryMb, period }: TabProps) => {
  const [sort, setSort] = useState<{ key: SortKey; reversed: boolean }>({
    key: 'cold',
    reversed: false,
  })
  const pick = (key: SortKey) => {
    const next = { key, reversed: sort.key === key && !sort.reversed }
    track('list_sorted', { column: next.reversed ? `${key}:reversed` : key })
    setSort(next)
  }
  const fns: Fn[] = [
    ...view.shown,
    // The Web Function has one size, on arm64.
    ...functions.filter((f) => f.web && f.arch === arch),
  ]
  const rows = fns.flatMap((f) => {
    const x = figures.get(f.id)
    return x ? [{ f, x }] : []
  })
  /** A row's value in a column; a size of 0 is a few KB, which sorts first. */
  const value = (x: Figures, key: SortKey) => x[key]
  const sorted = rows.toSorted((a, b) => {
    const va = value(a.x, sort.key)
    const vb = value(b.x, sort.key)
    // Rows without the value go last, whichever way.
    if (va === undefined || vb === undefined)
      return Number(va === undefined) - Number(vb === undefined)
    return sort.reversed ? vb - va : va - vb
  })
  const lowest = Object.fromEntries(
    LEADS.map((k) => [k, Math.min(...rows.flatMap((r) => r.x[k] ?? []))])
  ) as Record<SortKey, number>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-2xl">All results</h2>
        <p className="measured m-0 text-sm text-muted">
          {arch} · {memoryMb} MB · {period === 'current' ? 'current builds' : `${period} days`} ·
          Web Function at 2 GB
        </p>
      </div>
      <div className="overflow-x-auto rounded-card border border-rule bg-paper-2">
        <table className="w-full min-w-[72rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-2">
              <th scope="col" className="w-px py-3 pr-0.5 pl-3 text-left font-medium text-muted">
                #
              </th>
              <th scope="col" className="px-2 py-3 text-left font-medium text-muted">
                Function and build
              </th>
              {COLUMNS.map((c) => {
                const on = sort.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={on ? (sort.reversed ? 'descending' : 'ascending') : 'none'}
                    className="px-1 py-1.5 text-right"
                  >
                    <button
                      type="button"
                      onClick={() => pick(c.key)}
                      className={`inline-flex min-h-9 cursor-pointer items-center gap-1 px-1.5 font-medium whitespace-nowrap hover:text-ink ${on ? 'text-ink' : 'text-muted'}`}
                    >
                      {c.title}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 10 6"
                        className={`w-2 shrink-0 ${on ? '' : 'opacity-0'} ${sort.reversed ? '' : 'rotate-180'}`}
                      >
                        <path
                          d="M1 1l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                      </svg>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ f, x }, i) => (
              <tr
                key={f.id}
                className="border-b border-rule align-top"
                onMouseEnter={() => view.setFocus(f.base)}
                onMouseLeave={() => view.setFocus(undefined)}
              >
                <td className="measured w-px py-3 pr-0.5 pl-3 text-xs whitespace-nowrap text-muted">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <th scope="row" className="px-2 py-2.5 text-left font-normal">
                  <span
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-md font-medium text-ink"
                    title={f.about}
                  >
                    <FamilyIcon family={f.family} />
                    {f.name}
                    <Badges f={f} />
                    {f.web && <Badge>{`Web Function · ${f.memoryMb / 1024} GB`}</Badge>}
                  </span>
                  <span className="mt-1 flex flex-col gap-0.5">
                    <Command build={f.build} />
                    <Versions x={x} />
                  </span>
                </th>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-2.5 py-3 text-right">
                    {c.key === 'size' ? (
                      <span className="measured whitespace-nowrap text-ink-2">
                        {x.size ? `${x.size.toFixed(1)} MB` : 'KB'}
                      </span>
                    ) : c.key === 'cost' ? (
                      <span className="measured whitespace-nowrap text-ink-2">
                        {x.cost === undefined ? '—' : `$${x.cost.toFixed(2)}`}
                      </span>
                    ) : (
                      <Cell
                        value={x[c.key]}
                        digits={c.digits}
                        lead={LEADS.includes(c.key) && x[c.key] === lowest[c.key]}
                      />
                    )}
                    {c.key === 'cold' && x.p50 !== undefined && (
                      <span className="measured mt-0.5 block text-xs whitespace-nowrap text-muted">
                        {x.p50.toFixed(0)} · {x.p90!.toFixed(0)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 max-w-prose text-sm text-muted">
        Cold start is the mean init, under it p50 · p90 over every cold start in view. Times are in
        ms, memory in MB, cost in USD per million cold starts. Size is the deployed code: Node.js
        and the custom runtimes ship a few KB, as their runtime is already on Lambda.
      </p>
    </div>
  )
}
