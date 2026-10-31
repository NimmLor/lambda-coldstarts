/** A choice among a few: cells from a tablet up, the system picker on a phone. */
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
  /** After each option in the phone's picker, which has no label to carry it. */
  unit?: string
}) => (
  <>
    <div className="flex shrink-0 items-center gap-2.5 max-sm:hidden">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="cells" role="group" aria-label={label}>
        {options.map((v) => (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>
            {text(v)}
          </button>
        ))}
      </div>
    </div>
    {/* A phone has no room for every cell: the system picker, its value saying what it is. */}
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
  </>
)
