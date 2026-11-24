import type { Figures, Fn, View, Window } from './data'

/** The tabs under the glance, in order. Each answers one question; its id is its URL fragment. */
export const TABS = [
  { id: 'cold', label: 'Cold starts' },
  { id: 'warm', label: 'Warm starts' },
  { id: 'arch', label: 'arm64 vs x86_64' },
  { id: 'memory', label: 'Memory & cost' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'results', label: 'All results' },
] as const
export type TabId = (typeof TABS)[number]['id']

/** Fragments that open a tab without being its id: the arm64 section's anchor from before tabs. */
const ALIASES: Record<string, TabId> = { 'arm64-vs-x86_64': 'arch' }

/** The tab a URL fragment opens, if any. */
export const tabOf = (hash: string): TabId | undefined => {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  return TABS.find((t) => t.id === id)?.id ?? (Object.hasOwn(ALIASES, id) ? ALIASES[id] : undefined)
}

/**
 * The toolbar's filters each tab reads; the others hide, keeping what was picked, and `note` says
 * what the tab shows instead. Every tab reads the runs picked.
 */
export const FILTERS: Record<
  TabId,
  { functions: boolean; arch: boolean; memory: boolean; note?: string }
> = {
  cold: { functions: true, arch: true, memory: true },
  warm: { functions: true, arch: true, memory: true },
  arch: { functions: true, arch: false, memory: true, note: 'Both architectures side by side' },
  memory: { functions: true, arch: true, memory: true },
  deployment: {
    functions: false,
    arch: true,
    memory: true,
    note: 'Web Function and MicroVMs: arm64 only, at their own sizes',
  },
  results: { functions: true, arch: true, memory: true },
}

/** What every tab is given: the toolbar's picks, and the runs' figures over the picked period. */
export type TabProps = {
  /**
   * The functions on the picked architecture at the picked size, the shown ones among them, and
   * their history for the charts over time; `agg` reads `figures`, or a hovered run.
   */
  view: View
  /** Each function's figures over the picked runs, by id. */
  figures: Map<string, Figures>
  /** Every function the latest run measured, on every architecture and at every size. */
  functions: Fn[]
  arch: string
  memoryMb: number
  /** Every Event Function size, ascending. */
  memories: number[]
  period: Window
  /** The history the charts over time need is still on its way. */
  waiting: boolean
  onMemory: (memoryMb: number) => void
}
