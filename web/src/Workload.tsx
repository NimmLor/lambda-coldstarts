import { FAMILY_NAMES, type Family, isEvent, niceMax } from './data'
import { FAMILY_LINES, SizeChart } from './SizeChart'
import type { TabProps } from './tabs'
import { Card, FnLabel, Swatch, TabHead } from './ui'
import { familyBySize, variantsOf } from './WarmStarts'

const FAMILIES = Object.keys(FAMILY_NAMES) as Family[]

/** `n` in two decimals, one past 10 and none past 100, so 128 MB's seconds fit; a dash for none. */
const ms = (n: number | undefined) =>
  n === undefined ? '—' : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)

export const Workload = (props: TabProps) => {
  const { view, figures, functions, arch, memoryMb, memories } = props
  const shown = new Set(view.shown.map((f) => f.base))
  const families = FAMILIES.map((family) => ({
    family,
    values: familyBySize(family, 'workFirst', { ...props, shown }),
  })).filter((s) => s.values.some((v) => v !== undefined))
  const variants = variantsOf(
    functions.filter((f) => isEvent(f) && f.arch === arch && shown.has(f.base))
  )
  const runs = view.shown
    .filter(isEvent)
    .flatMap((f) => {
      const x = figures.get(f.id)
      return x?.workFirst !== undefined ? [{ f, first: x.workFirst, warm: x.workWarm }] : []
    })
    .sort((a, b) => a.first - b.first)
  const runMax = niceMax(Math.max(0, ...runs.map((r) => r.first)))
  const tableMax = Math.max(
    1,
    ...functions.flatMap((f) => (f.arch === arch ? (figures.get(f.id)?.workFirst ?? []) : []))
  )

  return (
    <div className="flex flex-col gap-8">
      <TabHead title="Workload">
        The same handler, asked to do some work: build 2,000 orders, keep the larger ones, rank and
        group them, and serialize the result, ten times over. Its code is part of every build but
        runs only on request, after the warm calls, so the cold starts stay the hello world’s. This
        measures the engines rather than their startup: the JITs of Node.js and Bun, an AOT build’s
        native code, LLRT’s interpreter.
      </TabHead>

      {runs.length === 0 ? (
        <Card id="work-none" title="Not measured yet">
          <p className="m-0 text-sm text-muted">
            None of the runs picked ran the workload on {arch} at {memoryMb} MB. It shows here from
            the first run that does.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card
            id="work-by-size"
            title="First run by memory size"
            caption={`Each family’s geometric mean on ${arch}, in ms; ${memoryMb} MB shaded. Below 1769 MB, a function gets its share of a vCPU.`}
          >
            <SizeChart
              label={`Workload’s first run by memory size: ${families.map((s) => `${FAMILY_NAMES[s.family]} from ${ms(s.values[0])} to ${ms(s.values.at(-1))} ms`).join('; ')}`}
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
            id="work-first-run"
            title="The first run and the runs after it"
            caption={`At ${memoryMb} MB, fastest first run first, in ms: the bar is the first run, its darker part a later one, once the engine has seen the code.`}
          >
            <ol className="m-0 flex list-none flex-col p-0">
              {runs.map(({ f, first, warm }) => (
                <li
                  key={f.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-rule py-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10.5rem]"
                >
                  <FnLabel f={f} className="text-sm" />
                  <span
                    aria-hidden="true"
                    className="relative col-span-full row-start-2 h-2.5 rounded-[2px] bg-paper-3 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                  >
                    <span
                      className="mark absolute inset-y-0 left-0 rounded-[2px] bg-icon-dur/45"
                      style={{ width: `${(first / runMax) * 100}%` }}
                    />
                    {warm !== undefined && (
                      <span
                        className="mark absolute inset-y-0 left-0 rounded-[2px] bg-icon-dur"
                        style={{ width: `${(Math.min(warm, first) / runMax) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="measured col-start-2 row-start-1 text-right text-sm whitespace-nowrap text-ink sm:col-start-3">
                    {ms(first)} <span className="text-muted">· later {ms(warm)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {runs.length > 0 && (
        <Card
          id="work-table"
          title="Every function at every size"
          caption={`The workload’s first run in each round’s environment on ${arch}, in ms; darker is slower.`}
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
                      const first = figures.get(`${v.base}/${arch}/${mb}`)?.workFirst
                      return (
                        <td
                          key={mb}
                          className={`measured rounded-chip px-2.5 py-1.5 text-right text-ink ${mb === memoryMb ? 'outline outline-cool/60' : ''}`}
                          style={{
                            background:
                              first === undefined
                                ? undefined
                                : `color-mix(in oklab, var(--color-icon-dur) ${Math.round(6 + 39 * Math.min(1, first / tableMax))}%, transparent)`,
                          }}
                        >
                          {ms(first)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-sm text-muted">
            Timed by the handler itself, around the workload alone: Lambda’s Duration would round it
            to the millisecond and add the runtime’s loop. Every answer’s digest is checked, so a
            build can’t skip the work.
          </p>
        </Card>
      )}
    </div>
  )
}
