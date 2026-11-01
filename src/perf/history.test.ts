import { expect, it } from 'bun:test'
import { toHistoryRun } from './history'
import type { FunctionSummary } from './summary'

const stats = { p50: 30, p90: 38, avg: 30, min: 20, max: 40 }

const summary: FunctionSummary = {
  functionId: 'Node24Arm64M1769',
  runtime: 'nodejs24.x',
  version: 'node 24.11.1',
  arch: 'arm64',
  memoryMb: 1769,
  codeSizeMb: 0.1,
  samples: 2,
  initMs: stats,
  warmMs: { ...stats, samples: 4 },
  startupMs: stats,
  roundTripMs: null,
  firstRequestMs: null,
  durationMsAvg: 2,
  maxMemoryMbAvg: 70,
  initDurations: [40, 20],
}

it('drops the keys, the extremes and the sample counts, and keeps the rest', () => {
  const run = toHistoryRun({
    pk: 'summaries',
    sk: '2026-10-27T11:00:00.000Z',
    expiresAt: 1_800_000_000,
    runId: '2026-10-27T11:00:00.000Z',
    rounds: 2,
    functions: [summary],
  })
  expect(run).toEqual({
    runId: '2026-10-27T11:00:00.000Z',
    rounds: 2,
    functions: [
      {
        functionId: 'Node24Arm64M1769',
        runtime: 'nodejs24.x',
        version: 'node 24.11.1',
        arch: 'arm64',
        memoryMb: 1769,
        codeSizeMb: 0.1,
        initMs: { p50: 30, p90: 38, avg: 30 },
        warmMs: { p50: 30, p90: 38, avg: 30 },
        startupMs: { p50: 30, p90: 38, avg: 30 },
        roundTripMs: null,
        firstRequestMs: null,
        durationMsAvg: 2,
        maxMemoryMbAvg: 70,
        initDurations: [40, 20],
      },
    ],
  })
})

it('leaves out the statistics an older summary lacks', () => {
  const { startupMs, roundTripMs, firstRequestMs, ...old } = summary
  const [f] = toHistoryRun({ functions: [old] }).functions
  expect(JSON.parse(JSON.stringify(f))).not.toContainKey('startupMs')
  expect(f!.initMs).toEqual({ p50: 30, p90: 38, avg: 30 })
})
