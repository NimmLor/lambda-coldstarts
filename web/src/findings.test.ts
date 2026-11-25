import { expect, test } from 'bun:test'
import type { HistoryFunction } from '../../src/perf/history'
import { figuresFor, figuresOf, runsIn, runsOf, toPoints, versionName } from './data'
import { archFinding, findings, memoryFinding, runtimeFinding, workloadFinding } from './findings'
import { tabOf } from './tabs'

const stats = (avg: number) => ({ p50: avg, p90: avg, avg })

type Shape = {
  cold: number
  version?: string
  durations?: number[]
  trip?: number
  dur?: number
  warm?: number
  runtime?: string
}

const summary = (functionId: string, arch: string, memoryMb: number, s: Shape) =>
  ({
    functionId,
    runtime: s.runtime ?? 'provided.al2023',
    version: s.version ?? null,
    arch,
    memoryMb,
    codeSizeMb: 50,
    initMs: stats(s.cold),
    warmMs: s.warm === undefined ? null : stats(s.warm),
    startupMs: null,
    roundTripMs: s.trip === undefined ? null : stats(s.trip),
    firstRequestMs: null,
    durationMsAvg: s.dur ?? 1,
    maxMemoryMbAvg: 40,
    initDurations: s.durations ?? [s.cold],
  }) as HistoryFunction

const DAY = 864e5
const run = (daysAgo: number, functions: HistoryFunction[]) => {
  const finishedAt = new Date(Date.UTC(2026, 10, 24) - daysAgo * DAY).toISOString()
  return toPoints({ runId: finishedAt, finishedAt, rounds: 10, functionCount: 1, functions })
}
const bun = (cold: number, version: string) =>
  summary('BunCompileArm64M256', 'arm64', 256, { cold, version })

test('the current build’s runs start where its version last changed, past a run it missed', () => {
  const runs = [
    run(5, [bun(119, 'bun 1.4.4+38afee6c8')]),
    run(4, [bun(120, 'bun 1.4.4+38afee6c8')]),
    run(3, [bun(217, 'bun 1.4.5+a7733435c')]),
    run(2, []),
    run(1, [bun(219, 'bun 1.4.5+a7733435c')]),
  ]
  expect(runsOf(runs, 'BunCompile/arm64/256', 'current').map((r) => r.points.size)).toEqual([1, 1])
  expect(runsOf(runs, 'BunCompile/arm64/256', 'current')[0]).toBe(runs[2]!)
  expect(runsOf(runs, 'BunCompile/arm64/256', 'current').at(-1)).toBe(runs[4]!)
})

test('a window of days counts back from the latest run', () => {
  const runs = [10, 8, 6, 1].map((d) => run(d, [bun(100, 'bun 1.4.5')]))
  expect(runsOf(runs, 'BunCompile/arm64/256', '7')).toEqual(runs.slice(2))
  expect(runsOf(runs, 'BunCompile/arm64/256', '14')).toEqual(runs)
  expect(runsOf([], 'BunCompile/arm64/256', 'current')).toEqual([])
  // The charts over time span the same days, and every run for the current builds.
  expect(runsIn(runs, '7')).toEqual(runs.slice(2))
  expect(runsIn(runs, '14')).toEqual(runs)
  expect(runsIn(runs, 'current')).toEqual(runs)
  expect(runsIn([], '7')).toEqual([])
})

test('figures pool every cold start for percentiles and leave the rest to the first answer', () => {
  const llrt = (cold: number, durations: number[]) =>
    summary('LlrtArm64M256', 'arm64', 256, { cold, durations, trip: 200, dur: 2 })
  const runs = [run(2, [llrt(25, [10, 20, 30, 40])]), run(1, [llrt(50, [50])])]
  const f = runs[1]!.functions[0]!
  const figures = figuresOf(runs, f, 'current')!
  expect(figures.runs).toBe(2)
  expect(figures.starts).toBe(5)
  expect(figures.cold).toBe(37.5)
  expect(figures.p50).toBe(30)
  expect(figures.p99).toBeCloseTo(49.6)
  expect(figures.load).toBe(200 - 37.5 - 2)
  expect(figures.cost).toBeGreaterThan(0)
  expect(figuresFor(runs, 'current').get('Llrt/arm64/256')).toEqual(figures)
})

test('versions read as their release', () => {
  expect(versionName('bun 1.4.5+a7733435c')).toBe('Bun 1.4.5')
  expect(versionName('bun 1.4.6-canary.1+dac8e3b0f')).toBe('Bun 1.4.6-canary.1')
  expect(versionName('llrt-lambda-arm64-no-sdk@v0.10.0-beta')).toBe('LLRT 0.10.0-beta')
  expect(versionName('node 24.22.3')).toBe('Node.js 24.22.3')
  expect(versionName('custom')).toBe('custom')
})

test('a URL fragment opens its tab, and the old arm64 anchor opens that one', () => {
  expect(tabOf('#warm')).toBe('warm')
  expect(tabOf('#arm64-vs-x86_64')).toBe('arch')
  expect(tabOf('#web-function')).toBe('web-function')
  expect(tabOf('#microvms')).toBe('microvms')
  expect(tabOf('#custom-runtimes')).toBe('deployment')
  expect(tabOf('')).toBeUndefined()
  expect(tabOf('#constructor')).toBeUndefined()
  expect(tabOf('#%')).toBeUndefined()
})

test('the architecture finding compares cold start, cost and warm start', () => {
  const pair = (mb: number, arm: number, x86: number, armWarm: number, x86Warm: number) => [
    summary(`LlrtArm64M${mb}`, 'arm64', mb, { cold: arm, warm: armWarm }),
    summary(`LlrtX64M${mb}`, 'x86_64', mb, { cold: x86, warm: x86Warm }),
  ]
  const runs = [run(1, [...pair(128, 50, 75, 2, 1), ...pair(256, 50, 75, 1, 1)])]
  const finding = archFinding(runs[0]!.functions, figuresFor(runs, 'current'))!
  expect(finding.title).toStartWith('arm64 cold-starts 1.5× as fast and costs')
  expect(finding.figure).toBe('1.5×')
  expect(finding.sub).toBe('But x86_64 has the faster warm start at 128 MB.')
  expect(finding.mark).toMatchObject({
    kind: 'bars',
    bars: [
      { name: 'arm64', value: 1 },
      { name: 'x86_64', value: 1.5 },
    ],
  })
})

test('the runtime finding compares a custom runtime with the variant it repackages', () => {
  const runs = [
    run(1, [
      summary('BunRuntimeArm64M256', 'arm64', 256, { cold: 243, trip: 721 }),
      summary('BunRuntimeCmrArm64M256', 'arm64', 256, { cold: 95, trip: 245, runtime: 'custom' }),
      summary('BunCompileAotTrimArm64M256', 'arm64', 256, { cold: 147, trip: 378 }),
      // Not at the glance's size.
      summary('BunCompileAotTrimArm64M128', 'arm64', 128, { cold: 147, trip: 444 }),
    ]),
  ]
  expect(runtimeFinding(runs[0]!.functions, figuresFor(runs, 'current'))).toEqual({
    tab: 'deployment',
    title: 'Bun runtime answers 2.9× sooner on a custom runtime',
    figure: '721 → 245 ms',
    sub: 'Its first answer at 256 MB, against the same Bun with the runtime in its .zip.',
    mark: {
      kind: 'bars',
      label:
        'First answer: 721 ms with the runtime in its .zip, 245 ms on a custom runtime, 378 ms as a trimmed AOT executable',
      bars: [
        {
          name: 'in the .zip',
          value: 721,
          color: 'var(--color-line-BunRuntime, var(--color-line-other))',
        },
        {
          name: 'custom runtime',
          value: 245,
          color: 'var(--color-line-BunRuntimeCmr, var(--color-line-other))',
        },
        {
          name: 'trimmed AOT',
          value: 378,
          color: 'var(--color-line-BunCompileAotTrim, var(--color-line-other))',
        },
      ],
    },
  })
})

test('the runtime finding names a custom runtime that runs another version than its counterpart', () => {
  const runs = [
    run(1, [
      summary('Node24Arm64M256', 'arm64', 256, { cold: 110, trip: 254, runtime: 'nodejs24.x' }),
      summary('Node27CmrArm64M256', 'arm64', 256, { cold: 166, trip: 700, runtime: 'custom' }),
    ]),
  ]
  expect(runtimeFinding(runs[0]!.functions, figuresFor(runs, 'current'))).toMatchObject({
    title: 'Node.js 27 alpha answers 2.8× later on a custom runtime',
    sub: 'Its first answer at 256 MB, against Node.js 24 on Lambda’s nodejs24.x.',
    // Node.js has no AOT executable to set beside it.
    mark: { bars: [{ name: 'nodejs24.x' }, { name: 'custom runtime' }] },
  })
})

test('the memory finding reports how little memory moves the cold start', () => {
  const at = (mb: number, cold: number, warm: number) =>
    summary(`NodeArm64M${mb}`.replace('Node', 'Node24'), 'arm64', mb, {
      cold,
      warm,
      runtime: 'nodejs24.x',
    })
  const runs = [run(1, [at(128, 110, 5.4), at(1769, 105, 1.6)])]
  const finding = memoryFinding(runs[0]!.functions, figuresFor(runs, 'current'))!
  expect(finding.title).toBe('Memory size barely moves the cold start')
  expect(finding.figure).toBe('5% at most')
  expect(finding.sub).toBe(
    'From 128 to 1769 MB. It does cut warm starts: Node.js’s from 5.4 to 1.6 ms.'
  )
  expect(finding.mark).toMatchObject({
    kind: 'lines',
    label: 'Each family’s cold start at every memory size from 128 to 1769 MB',
    from: '128 MB',
    to: '1769 MB',
    lines: [{ name: 'Node.js', values: [expect.closeTo(110), expect.closeTo(105)] }],
  })
  expect(findings(runs[0]!.functions, figuresFor(runs, 'current')).map((f) => f.tab)).toEqual([
    'memory',
  ])
  // No family at every size: no spread to report.
  const apart = [
    run(1, [at(128, 110, 5.4), summary('LlrtArm64M1769', 'arm64', 1769, { cold: 50 })]),
  ]
  expect(memoryFinding(apart[0]!.functions, figuresFor(apart, 'current'))).toBeUndefined()
})

test('the workload’s figures come only from runs of the latest run’s size', () => {
  const worked = (cold: number, workFirst: number, workSize?: number) =>
    ({
      ...bun(cold, 'bun 1.4.5'),
      workFirstMs: stats(workFirst),
      workWarmMs: stats(workFirst / 2),
      workDurationMs: stats(workFirst / 2 + 1),
      workSize: workSize ?? null,
    }) as HistoryFunction
  const runs = [
    run(3, [worked(100, 3)]),
    run(2, [worked(110, 30, 20_000)]),
    run(1, [worked(120, 40, 20_000)]),
  ]
  const f = runs.at(-1)!.functions[0]!
  const figures = figuresOf(runs, f, '7')!
  expect(figures.workFirst).toBe(35)
  expect(figures.workDur).toBe(18.5)
  // The cold starts are the hello world's in every run, so all three count.
  expect(figures.cold).toBe(110)
})

test('the workload finding sets the fastest first run of the four against Node.js 24', () => {
  const worked = (functionId: string, cold: number, first: number, warm: number) =>
    ({
      ...summary(functionId, 'arm64', 256, { cold }),
      workFirstMs: stats(first),
      workWarmMs: stats(warm),
      workSize: 20_000,
    }) as HistoryFunction
  const runs = [
    run(1, [
      worked('LlrtArm64M256', 44, 726, 691),
      worked('Node24Arm64M256', 106, 415, 173),
      worked('BunCompileAotTrimArm64M256', 149, 104, 60),
      // Not one of the four.
      worked('BunCompileAotArm64M256', 150, 90, 50),
    ]),
  ]
  const finding = workloadFinding(runs[0]!.functions, figuresFor(runs, 'current'))!
  expect(finding.tab).toBe('work')
  expect(finding.title).toBe(
    'Bun AOT executable, trimmed runs the workload 4.0× as fast as Node.js 24'
  )
  expect(finding.figure).toBe('415 → 104 ms')
  expect(finding.sub).toEndWith('Once warm, 60 against 173 ms.')
  expect(finding.mark).toMatchObject({
    kind: 'bars',
    bars: [
      { name: 'LLRT', value: 726 },
      { name: 'Node.js 24', value: 415 },
      { name: 'Bun AOT', value: 104 },
    ],
  })
})

test('the workload finding waits for runs that measured it', () => {
  const runs = [run(1, [summary('Node24Arm64M256', 'arm64', 256, { cold: 106 })])]
  expect(workloadFinding(runs[0]!.functions, figuresFor(runs, 'current'))).toBeUndefined()
})
