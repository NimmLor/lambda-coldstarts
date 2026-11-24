import type { ReactNode } from 'react'
import { type Family, type Fn, fixed } from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'

export const FAMILY_ICONS: Record<Family, string> = { Bun: bunIcon, LLRT: llrtIcon, Node: nodeIcon }

/** A family's logo, as decoration: its name is always beside it. */
export const FamilyIcon = ({ family, size = 16 }: { family: Family; size?: number }) => (
  <img src={FAMILY_ICONS[family]} alt="" width={size} height={size} className="block shrink-0" />
)

/** A function's line colour as a dot, which ties a row to its line and bar. */
export const Dot = ({ color, className = 'size-2' }: { color: string; className?: string }) => (
  <span
    aria-hidden="true"
    className={`mark shrink-0 rounded-full ${className}`}
    style={{ background: color }}
  />
)

/** A function's name with its colour, cut short with an ellipsis when its column is narrow. */
export const FnLabel = ({ f, className = '' }: { f: Fn; className?: string }) => (
  <span className={`flex min-w-0 items-center gap-2 text-ink ${className}`} title={f.about}>
    <Dot color={f.color} />
    <span className="truncate">{f.name}</span>
  </span>
)

/** A reading in the instrument face with its unit after it, small and muted. */
export const Reading = ({
  value,
  digits,
  unit,
  className = '',
}: {
  value: number | undefined
  digits: number
  unit?: string
  className?: string
}) => (
  <span className={`measured whitespace-nowrap ${className}`}>
    {fixed(value, digits)}
    {unit && value !== undefined && <span className="ml-0.5 text-xs text-muted">{unit}</span>}
  </span>
)

/**
 * A choice set: a strip of cells from `sm`, the system's picker on a phone, which has no room for
 * every cell. Its label stays beside it either way.
 */
export const Segmented = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  text = String,
  unit,
}: {
  label: string
  options: readonly T[]
  value: T | undefined
  onPick: (v: T) => void
  text?: (v: T) => string
  /** After each option in the phone's picker. */
  unit?: string
}) => (
  <div className="flex shrink-0 items-center gap-2.5">
    <span className="text-xs font-medium text-muted">{label}</span>
    <div className="cells max-sm:hidden" role="group" aria-label={label}>
      {options.map((v) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>
          {text(v)}
        </button>
      ))}
    </div>
    <span className="select sm:hidden">
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onPick(options.find((o) => String(o) === e.target.value)!)}
      >
        {options.map((o) => (
          <option key={o} value={String(o)}>
            {unit ? `${text(o)} ${unit}` : text(o)}
          </option>
        ))}
      </select>
      <svg aria-hidden="true" viewBox="0 0 10 6" className="select__caret">
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  </div>
)

/** A tab's heading: its title, what it shows in the instrument face, and its finding. */
export const TabHead = ({
  title,
  meta,
  children,
}: {
  title: string
  meta: string
  children?: ReactNode
}) => (
  <div className="flex flex-col gap-2.5">
    <h2 className="text-2xl">{title}</h2>
    <p className="measured m-0 text-sm text-muted">{meta}</p>
    {children && (
      <p className="datum m-0 max-w-prose text-lg/normal text-pretty text-ink-2">{children}</p>
    )}
  </div>
)

/** A figure in the instrument face inside running text. */
export const Figure = ({ children }: { children: ReactNode }) => (
  <span className="measured text-ink">{children}</span>
)

/** A chart or list on its own card. */
export const Card = ({
  title,
  caption,
  aside,
  children,
  className = '',
  id,
}: {
  title: ReactNode
  caption?: ReactNode
  /** Beside the title, at the right: a legend or a control. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) => (
  <section
    id={id}
    aria-labelledby={id && `${id}-title`}
    className={`flex min-w-0 flex-col gap-4 rounded-card border border-rule bg-paper-2 p-5 sm:p-6 ${className}`}
  >
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex flex-col gap-1">
        <h3 id={id && `${id}-title`} className="text-lg">
          {title}
        </h3>
        {caption && <p className="m-0 text-sm text-pretty text-muted">{caption}</p>}
      </div>
      {aside}
    </div>
    {children}
  </section>
)

/** A legend entry: a swatch, a line or a dot, and its name. */
export const Swatch = ({
  color,
  children,
  shape = 'block',
  dash,
}: {
  color: string
  children: ReactNode
  shape?: 'block' | 'line'
  dash?: string
}) => (
  <span className="inline-flex items-center gap-2 text-sm text-muted">
    {shape === 'line' ? (
      <svg aria-hidden="true" width="24" height="4">
        <line
          x1="1"
          x2="23"
          y1="2"
          y2="2"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
    ) : (
      <span aria-hidden="true" className="size-3 rounded-[3px]" style={{ background: color }} />
    )}
    {children}
  </span>
)

/** A loading state the size of what it stands in for: the history the tab needs is on its way. */
export const Waiting = ({ height, children }: { height: number; children: ReactNode }) => (
  <div
    role="status"
    className="flex items-center justify-center rounded-pill border border-dashed border-rule-2 text-sm text-muted"
    style={{ height }}
  >
    {children}
  </div>
)

/** A dashed outline for how a build was made or where it runs; amber for a runtime in preview. */
export const Badge = ({
  children,
  tone = 'outline',
}: {
  children: string
  tone?: 'outline' | 'amber'
}) => (
  <span
    className={`shrink-0 rounded-chip border px-1.5 text-xs font-medium whitespace-nowrap ${
      tone === 'amber'
        ? 'border-rule bg-accent-soft text-accent'
        : 'border-dashed border-rule-2 text-ink-2'
    }`}
  >
    {children}
  </span>
)

/** A function's badges: built by canary Bun, or on a runtime in preview. */
export const Badges = ({ f }: { f: Fn }) => (
  <>
    {f.canary && <Badge>canary Bun</Badge>}
    {f.preview && <Badge tone="amber">preview</Badge>}
  </>
)
