import {
  FAMILY_NAMES,
  type Family,
  type Figures,
  type Fn,
  geomeanOf,
  isEvent,
  niceMax,
  ORDER,
} from './data'
import { FAMILY_LINES, SizeChart } from './SizeChart'
import type { TabProps } from './tabs'
import { Card, FnLabel, Swatch, TabHead } from './ui'

const FAMILIES = Object.keys(FAMILY_NAMES) as Family[]

/** Each variant once, in legend order: the rows of a chart across sizes. */
export const variantsOf = (fns: Fn[]) => [
  ...new Map(
    fns.toSorted((a, b) => ORDER.indexOf(a.base) - ORDER.indexOf(b.base)).map((f) => [f.base, f])
  ).values(),
]

/**
 * A family's geometric mean of `key` at each memory size, over its shown Event Functions on `arch`.
 */
export const familyBySize = (
  family: Family,
  key: keyof Figures,
  {
    functions,
    arch,
    memories,
    figures,
    shown,
  }: { shown: Set<string> } & Pick<TabProps, 'functions' | 'arch' | 'memories' | 'figures'>
) =>
  memories.map((mb) =>
    geomeanOf(
      functions.filter(
        (f) =>
          isEvent(f) &&
          f.family === family &&
          f.arch === arch &&
          f.memoryMb === mb &&
          shown.has(f.base)
      ),
      (f) => {
        const v = figures.get(f.id)?.[key]
        return typeof v === 'number' ? v : undefined
      }
    )
  )

/** `n` in two decimals, or one past 10; a dash for none. */
const ms = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(n >= 10 ? 1 : 2))

export const WarmStarts = (props: TabProps) => {
  const { view, figures, functions, arch, memoryMb, memories } = props
  const shown = new Set(view.shown.map((f) => f.base))
  const fns = view.shown.filter(isEvent)
  const families = FAMILIES.map((family) => ({
    family,
    values: familyBySize(family, 'warm', { ...props, shown }),
  })).filter((s) => s.values.some((v) => v !== undefined))
  const variants = variantsOf(
    functions.filter((f) => isEvent(f) && f.arch === arch && shown.has(f.base))
  )
  const calls = fns
    .flatMap((f) => {
      const x = figures.get(f.id)
      return x?.dur !== undefined && x.warm !== undefined ? [{ f, x }] : []
    })
    .sort((a, b) => b.x.dur! - a.x.dur!)
  const callMax = niceMax(Math.max(0, ...calls.map((c) => c.x.dur!)))
  const warmMax = Math.max(
    1,
    ...functions.flatMap((f) => (f.arch === arch ? (figures.get(f.id)?.warm ?? []) : []))
  )
  return (
    <div className="flex flex-col gap-8">
      <TabHead title="Warm starts" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          id="warm-by-size"
          title="Warm start by memory size"
          caption={`Each family’s geometric mean on ${arch}, in ms; ${memoryMb} MB shaded.`}
        >
          <SizeChart
            label={`Warm start by memory size: ${families.map((s) => `${FAMILY_NAMES[s.family]} from ${ms(s.values[0])} to ${ms(s.values.at(-1))} ms`).join('; ')}`}
            memories={memories}
            highlight={memoryMb}
            height={220}
            series={families.map((s) => ({
              name: s.family,
              ...FAMILY_LINES[s.family],
              values: s.values,
            }))}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {families.map((s) => (
              <Swatch key={s.family} shape="line" {...FAMILY_LINES[s.family]}>
                {FAMILY_NAMES[s.family]}
              </Swatch>
            ))}
          </div>
        </Card>

        <Card
          id="first-call"
          title="The first call after a cold start"
          caption={`At ${memoryMb} MB: the cold invocation’s duration, and how many warm calls it’s worth.`}
        >
          <ol className="m-0 flex list-none flex-col p-0">
            {calls.map(({ f, x }) => (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-rule py-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem]"
              >
                <FnLabel f={f} className="text-sm" />
                <span
                  aria-hidden="true"
                  className="col-span-full row-start-2 h-2.5 rounded-[2px] bg-paper-3 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                >
                  <span
                    className="mark block h-full rounded-[2px] bg-icon-warm"
                    style={{ width: `${(x.dur! / callMax) * 100}%` }}
                  />
                </span>
                <span className="measured col-start-2 row-start-1 text-right text-sm whitespace-nowrap text-ink sm:col-start-3">
                  {x.dur!.toFixed(1)} ms{' '}
                  <span className="text-muted">· {(x.dur! / x.warm!).toFixed(0)}× warm</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card
        id="warm-table"
        title="Every function at every size"
        caption={`Mean of the ${view.latest.warmInvocations === undefined ? '' : `${view.latest.warmInvocations} `}warm calls after each cold start on ${arch}, in ms; darker is slower.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-[3px] text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-medium text-muted">
                  Function
                </th>
                {memories.map((mb) => (
                  <th
                    key={mb}
                    scope="col"
                    className={`measured px-2.5 py-1.5 text-right font-medium ${mb === memoryMb ? 'text-ink' : 'text-muted'}`}
                  >
                    {mb} MB
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.base}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    <FnLabel f={v} />
                  </th>
                  {memories.map((mb) => {
                    const warm = figures.get(`${v.base}/${arch}/${mb}`)?.warm
                    return (
                      <td
                        key={mb}
                        className={`measured rounded-chip px-2.5 py-1.5 text-right text-ink ${mb === memoryMb ? 'outline outline-cool/60' : ''}`}
                        style={{
                          background:
                            warm === undefined
                              ? undefined
                              : `color-mix(in oklab, var(--color-icon-warm) ${Math.round(6 + 39 * Math.min(1, warm / warmMax))}%, transparent)`,
                        }}
                      >
                        {warm === undefined ? '—' : warm.toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 text-sm text-muted">
          The handler does nothing, so this is the runtime’s own loop: polling for an event, calling
          the handler and posting its response.
        </p>
      </Card>
    </div>
  )
}
