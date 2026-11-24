import { FAMILY_NAMES, type Family, type Figures, isEvent, PRICES, STACK_REGION } from './data'
import { FAMILY_LINES, SizeChart } from './SizeChart'
import type { TabProps } from './tabs'
import { Card, FamilyIcon, FnLabel, Swatch, TabHead } from './ui'
import { familyBySize, variantsOf } from './WarmStarts'

const FAMILIES = Object.keys(FAMILY_NAMES) as Family[]

/** What each small chart shows across the sizes, in the order the tab reads. */
const CHARTS: { key: keyof Figures; title: string; unit: string; digits: number }[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 0 },
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0 },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 1 },
  { key: 'cost', title: 'Cost per 1M cold starts', unit: 'USD', digits: 2 },
]

export const MemoryCost = (props: TabProps) => {
  const { view, figures, functions, arch, memoryMb, memories, onMemory } = props
  const shown = new Set(view.shown.map((f) => f.base))
  const lines = (key: keyof Figures) =>
    FAMILIES.map((family) => ({
      family,
      values: familyBySize(family, key, { ...props, shown }),
    })).filter((s) => s.values.some((v) => v !== undefined))
  const charts = CHARTS.map((c) => ({ ...c, series: lines(c.key) }))
  const variants = variantsOf(
    functions.filter((f) => isEvent(f) && f.arch === arch && shown.has(f.base))
  )
  const costAt = (base: string, mb: number) => figures.get(`${base}/${arch}/${mb}`)?.cost
  const cheapest = memories.map((mb) =>
    Math.min(...variants.flatMap((v) => costAt(v.base, mb) ?? []))
  )
  const used = view.shown
    .filter(isEvent)
    .flatMap((f) => {
      const mem = figures.get(f.id)?.mem
      return mem === undefined ? [] : [{ f, mem }]
    })
    .sort((a, b) => a.mem - b.mem)
  const usedMax = Math.max(1, ...used.map((u) => u.mem))
  const discount = Math.round((1 - PRICES.gbSecond.arm64 / PRICES.gbSecond.x86_64) * 100)

  return (
    <div className="flex flex-col gap-8">
      <TabHead title="Memory & cost" />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {FAMILIES.map((family) => (
            <Swatch key={family} shape="line" {...FAMILY_LINES[family]}>
              {FAMILY_NAMES[family]}
            </Swatch>
          ))}
          <span className="text-sm text-muted">
            Each line is a family’s geometric mean; {memoryMb} MB shaded.
          </span>
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
          {charts.map((c) => (
            <section key={c.key} className="flex min-w-0 flex-col gap-3 bg-paper-2 p-5">
              <h3 className="flex items-baseline gap-2 text-md">
                {c.title}
                <span className="text-sm font-normal text-muted">{c.unit}</span>
              </h3>
              <SizeChart
                label={`${c.title} by memory size: ${c.series.map((s) => `${FAMILY_NAMES[s.family]} from ${s.values[0]?.toFixed(c.digits) ?? '—'} to ${s.values.at(-1)?.toFixed(c.digits) ?? '—'}`).join('; ')}`}
                memories={memories}
                highlight={memoryMb}
                series={c.series.map((s) => ({
                  name: s.family,
                  ...FAMILY_LINES[s.family],
                  values: s.values,
                }))}
              />
              <p className="measured m-0 text-xs text-muted">
                {c.series
                  .map(
                    (s) =>
                      `${FAMILY_NAMES[s.family]} ${s.values[0]?.toFixed(c.digits) ?? '—'} → ${s.values.at(-1)?.toFixed(c.digits) ?? '—'}`
                  )
                  .join(' · ')}
              </p>
            </section>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          id="cost"
          title={
            <>
              Cost per million cold starts <span className="text-sm text-muted">USD</span>
            </>
          }
          caption={`On ${arch}: init plus the first invocation, times memory, at first-tier GB-second prices in ${STACK_REGION}, plus the request. arm64’s GB-second is ${discount}% cheaper. Cheapest at each size highlighted.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule-2">
                  <th scope="col" className="px-1.5 py-2 text-left font-medium text-muted">
                    Function
                  </th>
                  {memories.map((mb) => (
                    <th key={mb} scope="col" className="p-0 text-right">
                      <button
                        type="button"
                        onClick={() => onMemory(mb)}
                        aria-pressed={mb === memoryMb}
                        className={`measured cursor-pointer px-1.5 py-2 font-medium hover:text-ink ${mb === memoryMb ? 'text-ink underline decoration-cool underline-offset-4' : 'text-muted'}`}
                      >
                        {mb}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.base} className="border-b border-rule">
                    <th scope="row" className="px-1.5 py-2 text-left font-normal">
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        <FamilyIcon family={v.family} size={14} />
                        <span className="truncate" title={v.about}>
                          {v.name}
                        </span>
                      </span>
                    </th>
                    {memories.map((mb, i) => {
                      const cost = costAt(v.base, mb)
                      return (
                        <td key={mb} className="px-1.5 py-2 text-right">
                          <span
                            className={`measured rounded-chip px-1 ${cost === cheapest[i] ? 'bg-cool-soft text-cool' : 'text-ink-2'}`}
                          >
                            {cost === undefined ? '—' : cost.toFixed(2)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          id="memory-used"
          title={
            <>
              Memory used <span className="text-sm text-muted">MB at {memoryMb} MB</span>
            </>
          }
          caption="Lambda’s Max Memory Used: the peak of the whole execution environment."
        >
          <ol className="m-0 flex list-none flex-col p-0">
            {used.map(({ f, mem }) => (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-3 border-t border-rule py-1.5"
              >
                <FnLabel f={f} className="text-sm" />
                <span aria-hidden="true" className="h-2.5 rounded-[2px] bg-paper-3">
                  <span
                    className="mark block h-full rounded-[2px] bg-icon-mem"
                    style={{ width: `${(mem / usedMax) * 100}%` }}
                  />
                </span>
                <span className="measured text-right text-sm text-ink">{mem.toFixed(1)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
