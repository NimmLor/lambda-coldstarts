import type { FunctionSummary } from '../../src/perf/summary'

type Run = { runId: string; finishedAt: string; rounds: number; functionCount: number }

const API = import.meta.env.VITE_API_URL.replace(/\/$/, '')

const get = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

const runs = document.querySelector<HTMLSelectElement>('#runs')!
const meta = document.querySelector<HTMLParagraphElement>('#meta')!
const table = document.querySelector<HTMLTableElement>('#results')!

const COLUMNS: [string, (f: FunctionSummary) => string | number][] = [
  ['Function', (f) => f.functionId],
  ['Runtime', (f) => f.runtime],
  ['Arch', (f) => f.arch],
  ['Memory MB', (f) => f.memoryMb],
  ['Code MB', (f) => f.codeSizeMb],
  ['Init p50 ms', (f) => f.initMs.p50],
  ['Init p90 ms', (f) => f.initMs.p90],
  ['Init avg ms', (f) => f.initMs.avg],
  ['Init min ms', (f) => f.initMs.min],
  ['Init max ms', (f) => f.initMs.max],
  ['Duration avg ms', (f) => f.durationMsAvg],
  ['Max memory avg MB', (f) => f.maxMemoryMbAvg],
  ['Samples', (f) => f.samples],
]

const row = (tag: 'th' | 'td', cells: (string | number)[]) => {
  const tr = document.createElement('tr')
  for (const cell of cells) {
    const el = document.createElement(tag)
    el.textContent = String(cell)
    tr.append(el)
  }
  return tr
}

const show = async (runId: string) => {
  const run = await get<Run & { functions: FunctionSummary[] }>(
    `/runs/${encodeURIComponent(runId)}`
  )
  meta.textContent = `${run.functionCount} functions × ${run.rounds} cold starts, finished ${run.finishedAt}`
  table.replaceChildren(
    row('th', COLUMNS.map(([name]) => name)),
    ...run.functions.map((f) => row('td', COLUMNS.map(([, value]) => value(f))))
  )
}

const { runs: list } = await get<{ runs: Run[] }>('/runs')
if (!list.length) meta.textContent = 'No runs yet.'
runs.replaceChildren(...list.map((r) => new Option(r.runId, r.runId)))
runs.addEventListener('change', () => show(runs.value))
if (list[0]) await show(list[0].runId)
