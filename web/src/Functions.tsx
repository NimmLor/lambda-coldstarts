import { useEffect, useId, useRef, useState } from 'react'
import { DASHES, type View } from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'

const FAMILIES = [
  ['Bun', 'Bun', bunIcon],
  ['LLRT', 'LLRT', llrtIcon],
  ['Node', 'Node.js', nodeIcon],
] as const

/** A row: its checkbox across, its "only" at the end. */
const ROW = 'group flex items-center gap-1 rounded-pill pr-1 hover:bg-paper-3'
const CHECK =
  'flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 pl-2 text-left disabled:cursor-default'
/** Shows its row and nothing else; out of sight until the row is hovered or focused, or there is no hover. */
const ONLY =
  'shrink-0 cursor-pointer rounded-chip px-1.5 py-0.5 text-xs text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-rule hover:text-ink [@media(hover:none)]:opacity-100'

/** A family's checkbox: ticked when all of it shows, a dash when some does. */
const Box = ({ checked }: { checked: boolean | 'mixed' }) => (
  <span
    aria-hidden="true"
    className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border ${checked ? 'border-cool bg-cool text-paper' : 'border-rule-2'}`}
  >
    {checked === true && (
      <svg viewBox="0 0 10 10" className="size-2.5">
        <path d="M2 5.2l2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )}
    {checked === 'mixed' && <span className="h-0.5 w-2 bg-current" />}
  </span>
)

/** Which functions the charts and the board show, by family or one at a time. */
export const Functions = ({
  view,
  setHidden,
}: {
  view: View
  setHidden: (hidden: Set<string>) => void
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const { fns, shown, setFocus, toggle } = view
  const on = (base: string) => shown.some((f) => f.base === base)
  const show = (bases: string[]) =>
    setHidden(new Set(fns.map((f) => f.base).filter((base) => !bases.includes(base))))

  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      setFocus(undefined)
    }
    const away = (e: PointerEvent) => root.current?.contains(e.target as Node) || close()
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open, setFocus])

  return (
    <div ref={root} className="relative flex shrink-0 items-center gap-2.5">
      <span className="text-xs font-medium text-muted max-sm:sr-only">Functions</span>
      <div className="cells">
        {/* On a phone, just the count: it shares a line with the other pickers. */}
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-2.5 aria-expanded:bg-paper-2 aria-expanded:text-ink sm:min-w-[180px]"
        >
          <span aria-hidden="true" className="flex -space-x-1 max-sm:hidden">
            {shown.map((f) => (
              <span
                key={f.id}
                className="size-2.5 rounded-full ring-2 ring-paper-3"
                style={{ background: f.color }}
              />
            ))}
          </span>
          {shown.length === fns.length ? `All ${fns.length}` : `${shown.length} of ${fns.length}`}
          <svg aria-hidden="true" viewBox="0 0 10 6" className="ml-auto w-2.5 text-muted">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          id={id}
          role="group"
          aria-label="Functions"
          className="absolute top-full left-0 mt-3 flex max-h-[calc(100dvh-7rem)] w-72 flex-col overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-[0_16px_40px_oklch(0%_0_0/0.5)]"
        >
          {/* The list scrolls on a short screen; Show all stays in view under it. */}
          <div className="min-h-0 overflow-y-auto p-1.5">
            {FAMILIES.map(([family, name, icon]) => {
              const members = fns.filter((f) => f.family === family)
              if (!members.length) return null
              const count = members.filter((f) => on(f.base)).length
              const checked = count === members.length ? true : count ? 'mixed' : false
              return (
                <div
                  key={family}
                  className="flex flex-col border-t border-rule py-1 first:border-t-0"
                >
                  <div className={ROW}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`All ${name}`}
                      // Hiding the only family shown would leave nothing to chart.
                      disabled={checked === true && count === shown.length}
                      onClick={() =>
                        show(
                          (checked === true
                            ? shown.filter((f) => f.family !== family)
                            : [...shown, ...members]
                          ).map((f) => f.base)
                        )
                      }
                      className={`${CHECK} text-sm font-medium text-ink`}
                    >
                      <Box checked={checked} />
                      <img src={icon} alt="" width={16} height={16} className="block shrink-0" />
                      {name}
                      <svg
                        aria-hidden="true"
                        width="20"
                        height="4"
                        className="ml-auto stroke-muted"
                      >
                        <line
                          x1="1"
                          x2="19"
                          y1="2"
                          y2="2"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray={DASHES[family]}
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Only ${name}`}
                      onClick={() => show(members.map((f) => f.base))}
                      className={ONLY}
                    >
                      only
                    </button>
                  </div>
                  {members.map((f) => {
                    const isOn = on(f.base)
                    return (
                      <div
                        key={f.id}
                        className={ROW}
                        onMouseEnter={() => isOn && setFocus(f.base)}
                        onMouseLeave={() => setFocus(undefined)}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isOn}
                          disabled={isOn && shown.length === 1}
                          onClick={() => toggle(f.base)}
                          className={`${CHECK} text-sm ${isOn ? 'text-ink-2' : 'text-muted'}`}
                        >
                          <span
                            aria-hidden="true"
                            className="size-3.5 shrink-0 rounded-full border-2"
                            style={{
                              borderColor: f.color,
                              background: isOn ? f.color : 'transparent',
                            }}
                          />
                          <span className="truncate">{f.name}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Only ${f.name}`}
                          onClick={() => show([f.base])}
                          className={ONLY}
                        >
                          only
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="border-t border-rule p-2">
            <button
              type="button"
              disabled={shown.length === fns.length}
              onClick={() => show(fns.map((f) => f.base))}
              className="btn w-full justify-center"
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
