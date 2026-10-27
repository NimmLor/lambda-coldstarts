import { expect, it } from 'bun:test'
import type { Sample } from './keys'
import { summarize } from './summary'

const sample = (functionId: string, round: number, initMs: number): Sample => ({
  functionId,
  round,
  runtime: 'nodejs24.x',
  arch: 'arm64',
  memoryMb: 1769,
  codeSizeMb: 0.1,
  initMs,
  durationMs: 2,
  billedMs: 100,
  maxMemoryMb: 70,
  requestId: `${functionId}-${round}`,
  measuredAt: '2026-10-27T11:00:00.000Z',
})

it('summarizes each function, fastest first, with init durations in round order', () => {
  const [fast, slow] = summarize([
    sample('Slow', 2, 300),
    sample('Fast', 2, 20),
    sample('Slow', 1, 200),
    sample('Fast', 1, 40),
  ])
  expect(fast!.functionId).toBe('Fast')
  expect(fast!.initDurations).toEqual([40, 20])
  expect(fast!.initMs).toEqual({ p50: 40, p90: 40, avg: 30, min: 20, max: 40 })
  expect(slow!.functionId).toBe('Slow')
  expect(slow!.samples).toBe(2)
})
