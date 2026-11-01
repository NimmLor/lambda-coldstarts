import type { HistoryFunction } from '../../src/perf/history'
import { ARCHS, type RunPoints, toPoints, VARIANTS } from './data'

/** The sizes infra/functions.ts deploys every Event Function at by default. */
const MEMORIES = [128, 256, 512, 1024, 1769]
/** infra/microvm.ts's: every size Lambda offers a MicroVM at, unless the variant names its own. */
const MICROVM_SIZES: Record<string, number[]> = { BunCompileAotTrimMicroVm: [2048] }
const MICROVM_DEFAULT_SIZES = [512, 1024, 2048, 4096, 8192]
/** The one size every Web Function has. */
const WEB_MB = 2048
/** What PerfSchedule measures each function with. */
const ROUNDS = 10
const WARM_INVOCATIONS = 5

/** LLRT's build for each variant, which its version names. */
const LLRT_BUILDS: Record<string, (arch: string) => string> = {
  Llrt: (arch) => `lambda-${arch}-no-sdk`,
  LlrtBytecode: (arch) => `linux-${arch}-no-sdk`,
  LlrtStdSdk: (arch) => `lambda-${arch}`,
  LlrtFullSdk: (arch) => `lambda-${arch}-full-sdk`,
}

/** What it ran on, in production's form, which the board wraps as it will that: canary Bun's is longer. */
const version = (base: string, arch: string) => {
  const v = VARIANTS[base]!
  if (v.family === 'Bun') return v.canary ? 'bun 1.4.4-canary.1+3f3a9ff87' : 'bun 1.4.4+38afee6c8'
  if (v.family === 'Node') return `node ${base.match(/\d+/)![0]}.22.2`
  return `llrt-${LLRT_BUILDS[base]!(arch === 'x86_64' ? 'x64' : 'arm64')}@v0.9.0-beta`
}

/**
 * Production's figures on arm64 at 256 MB, a Web Function's at its 2 GB and a MicroVM's at each
 * size, rounded, from November 2026: cold start, warm start, memory, first answer, duration, size
 * and time to handler, or for a MicroVM memory, first answer and first request. The placeholders
 * then lead, wrap and read as production's: each bone as wide as its reading, each leader's name
 * the one that will be there.
 */
const TYPICAL: Record<string, number[]> = {
  BunRuntime: [162, 2.2, 41, 646, 109, 53, 79],
  BunCompile: [119, 2.3, 37, 666, 171, 53, 39],
  BunCompileCanary: [131, 2.8, 37, 649, 104, 70, 38],
  BunCompileTrim: [129, 2.5, 37, 529, 116, 41, 40],
  BunCompileAot: [169, 1.3, 42, 535, 97, 34, 77],
  BunCompileAotTrim: [150, 1.2, 41, 401, 72, 15, 69],
  Llrt: [50, 1.3, 31, 207, 1.6, 4.8, 2.2],
  LlrtBytecode: [74, 1.5, 24, 243, 2.5, 6.2, 36],
  LlrtStdSdk: [54, 1.3, 31, 229, 1.6, 5.8, 2.2],
  LlrtFullSdk: [59, 1.3, 34, 245, 1.6, 7.3, 2.6],
  Node22: [113, 2.1, 72, 252, 8.5, 0, 86],
  Node24: [110, 2.2, 75, 254, 12, 0, 86],
  Node26: [166, 2.3, 78, 282, 9.3, 0, 128],
  Node24Web: [239, 1, 138, 532, 16, 0, 128],
  'Node24MicroVm/512': [59, 1640, 1230],
  'Node24MicroVm/1024': [58, 1570, 1240],
  'Node24MicroVm/2048': [59, 1550, 1240],
  'Node24MicroVm/4096': [60, 1960, 1650],
  'Node24MicroVm/8192': [59, 3060, 2790],
  'BunCompileAotTrimMicroVm/2048': [25, 1590, 1280],
}

/**
 * How x86_64 and the other sizes differ, as in production: a half slower to cold-start at every
 * size, which barely moves it; warm, faster below 512 MB, and everything slower at 128 MB.
 */
const WARM_BY_SIZE: Record<number, number> = { 128: 2.5, 256: 1 }
const X86_WARM_BY_SIZE: Record<number, number> = { 128: 0.72, 256: 0.86 }

const stats = (avg: number) => ({ p50: avg, p90: avg * 1.2, avg })

const summary = (base: string, arch: string, memoryMb: number): HistoryFunction => {
  const v = VARIANTS[base]!
  const x86 = arch === 'x86_64'
  const runtime = v.family === 'Node' ? `nodejs${base.match(/\d+/)![0]}.x` : 'provided.al2023'
  const common = { runtime, version: version(base, arch), arch, memoryMb }
  if (v.microvm) {
    const [mem, trip, first] = TYPICAL[`${base}/${memoryMb}`]!
    return {
      ...common,
      functionId: `${base}M${memoryMb}`,
      runtime: 'public.ecr.aws/lambda/microvms:al2023-minimal',
      codeSizeMb: 0,
      initMs: null,
      warmMs: null,
      startupMs: null,
      roundTripMs: stats(trip!),
      firstRequestMs: stats(first!),
      durationMsAvg: null,
      maxMemoryMbAvg: mem!,
      initDurations: [],
    }
  }
  const [arm, warm, mem, trip, dur, size, startup] = TYPICAL[base]!
  const cold = arm! * (x86 ? 1.5 : 1)
  return {
    ...common,
    functionId: v.web ? base : `${base}${x86 ? 'X64' : 'Arm64'}M${memoryMb}`,
    codeSizeMb: size!,
    initMs: stats(cold),
    warmMs: stats(
      warm! *
        (v.web
          ? 1
          : (WARM_BY_SIZE[memoryMb] ?? 0.8) * (x86 ? (X86_WARM_BY_SIZE[memoryMb] ?? 1) : 1))
    ),
    startupMs: stats(startup!),
    roundTripMs: stats(trip!),
    firstRequestMs: null,
    durationMsAvg: dur!,
    maxMemoryMbAvg: mem!,
    initDurations: Array<number>(ROUNDS).fill(cold),
  }
}

/** How often PerfSchedule starts a run. */
const RUN_EVERY_MS = 4 * 36e5
/** Half of that, as on average: "Last run 2 hours ago" is as wide as most. */
const AGE_MS = RUN_EVERY_MS / 2
/** Enough for the charts' dates to spread along their axes, short of a second range to pick. */
const RUNS = 25

/**
 * Four days of runs of every function production deploys, oldest first, which the dashboard lays
 * out until the first load, its readings veiled: the page loads into the layout it then keeps.
 */
export const placeholderHistory = (now = Date.now()): RunPoints[] => {
  const functions = Object.entries(VARIANTS)
    .flatMap(([base, v]) =>
      v.web
        ? [summary(base, 'arm64', WEB_MB)]
        : v.microvm
          ? (MICROVM_SIZES[base] ?? MICROVM_DEFAULT_SIZES).map((mb) => summary(base, 'arm64', mb))
          : ARCHS.flatMap((arch) => MEMORIES.map((mb) => summary(base, arch, mb)))
    )
    // In summarize's order, which the sections' counterparts come in: fastest cold start first.
    .sort((a, b) => (a.initMs?.p50 ?? Infinity) - (b.initMs?.p50 ?? Infinity))
  return Array.from({ length: RUNS }, (_, i) => {
    const finishedAt = new Date(now - AGE_MS - (RUNS - 1 - i) * RUN_EVERY_MS).toISOString()
    return toPoints({
      runId: finishedAt,
      finishedAt,
      rounds: ROUNDS,
      warmInvocations: WARM_INVOCATIONS,
      functionCount: functions.length,
      functions,
    })
  })
}
