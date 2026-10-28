import { expect, it } from 'bun:test'
import type { Sample } from './keys'
import { summarize } from './summary'

const sample = (
  functionId: string,
  round: number,
  initMs: number,
  warmMs?: number[],
  startupMs?: number
): Sample => ({
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
  warmMs,
  startupMs,
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
  expect(fast!.initMs).toEqual({ p50: 30, p90: 38, avg: 30, min: 20, max: 40 })
  expect(slow!.functionId).toBe('Slow')
  expect(slow!.samples).toBe(2)
})

it('pools the warm durations of every round, and has none for runs without them', () => {
  const [measured, old] = summarize([
    sample('Measured', 1, 10, [3, 1]),
    sample('Measured', 2, 10, [2, 4]),
    sample('Old', 1, 20),
  ])
  expect(measured!.warmMs).toEqual({ p50: 2.5, p90: 3.7, avg: 2.5, min: 1, max: 4, samples: 4 })
  expect(old!.warmMs).toBeNull()
})

it('interpolates percentiles, so p90 of ten cold starts is not just the slowest', () => {
  const [f] = summarize(
    [100, 101, 102, 103, 104, 105, 106, 107, 108, 500].map((initMs, i) =>
      sample('F', i + 1, initMs)
    )
  )
  expect(f!.initMs.p50).toBe(104.5)
  expect(f!.initMs.p90).toBe(147.2)
  expect(f!.initMs.max).toBe(500)
})

it('summarizes the in-process startup of the rounds that report it', () => {
  const [reported, missing] = summarize([
    sample('Reported', 1, 10, [], 4),
    sample('Reported', 2, 10, [], 6),
    sample('Reported', 3, 10),
    sample('Missing', 1, 20),
  ])
  expect(reported!.startupMs).toEqual({ p50: 5, p90: 5.8, avg: 5, min: 4, max: 6 })
  expect(missing!.startupMs).toBeNull()
})
