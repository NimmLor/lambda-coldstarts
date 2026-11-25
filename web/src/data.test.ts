import { expect, test } from 'bun:test'
import {
  bestOfFamilies,
  efficiency,
  type Family,
  type Fn,
  invocationCost,
  niceMax,
  PRICES,
  shortName,
} from './data'

test('niceMax rounds up to a step just above the value', () => {
  expect(niceMax(0)).toBe(1)
  expect(niceMax(120)).toBe(150)
  expect(niceMax(300)).toBe(400)
  expect(niceMax(4.2)).toBe(5)
})

test('niceMax finds a step for a value just under a power of ten', () => {
  expect(niceMax(960.97)).toBe(1250)
  expect(niceMax(99)).toBe(125)
  expect(niceMax(9.9)).toBe(12.5)
})

test('shortName drops the family from a variant’s name', () => {
  expect(shortName('BunRuntime')).toBe('runtime')
  expect(shortName('BunCompileAotTrim')).toBe('AOT executable, trimmed')
  expect(shortName('LlrtBytecode')).toBe('bytecode')
  expect(shortName('Llrt')).toBe('no SDK')
  expect(shortName('Node24')).toBe('24')
  expect(shortName('Unknown')).toBe('Unknown')
})

const fn = (arch: string, memoryMb: number) => ({ arch, memoryMb }) as Fn

test('invocationCost bills the duration rounded up to the millisecond, times memory, plus the request', () => {
  const perMs = PRICES.gbSecond.arm64 / 1e3
  expect(invocationCost(fn('arm64', 1024), 1.2)).toBeCloseTo((2 * perMs + PRICES.request) * 1e6)
  expect(invocationCost(fn('arm64', 512), 10)).toBeCloseTo((5 * perMs + PRICES.request) * 1e6)
  expect(invocationCost(fn('x86_64', 1024), 1)).toBeGreaterThan(
    invocationCost(fn('arm64', 1024), 1)!
  )
  expect(invocationCost(fn('riscv', 1024), 1)).toBeUndefined()
})

test('efficiency picks the cheapest, the fastest and the best balance of cost and time', () => {
  // CPU-bound: twice the memory, half the time, so the same cost until a whole vCPU.
  const points = [
    { memoryMb: 128, ms: 80, cost: 2.1 },
    { memoryMb: 256, ms: 40, cost: 2.1 },
    { memoryMb: 512, ms: 20, cost: 2.2 },
    { memoryMb: 1024, ms: 19, cost: 4 },
  ]
  const e = efficiency(points)!
  expect(e.cheapest.memoryMb).toBe(128)
  expect(e.fastest.memoryMb).toBe(1024)
  expect(e.balanced.memoryMb).toBe(512)
  // 128 MB costs no less than 256 MB and is slower.
  expect(e.frontier.map((p) => p.memoryMb)).toEqual([256, 512, 1024])
})

test('efficiency gives ties to the smaller size, and nothing for no sizes', () => {
  const e = efficiency([
    { memoryMb: 512, ms: 5, cost: 1 },
    { memoryMb: 256, ms: 5, cost: 1 },
  ])!
  expect([e.cheapest.memoryMb, e.fastest.memoryMb, e.balanced.memoryMb]).toEqual([256, 256, 256])
  expect(e.frontier.map((p) => p.memoryMb)).toEqual([256, 512])
  expect(efficiency([])).toBeUndefined()
})

test('bestOfFamilies keeps every Node.js version, but one Bun build and one LLRT build', () => {
  const row = (family: Family, base: string, score: number) => ({ f: { family, base }, score })
  const rows = [
    row('Bun', 'BunCompile', 5),
    row('Node', 'Node22', 4),
    row('LLRT', 'Llrt', 2),
    row('Bun', 'BunCompileAot', 3),
    row('LLRT', 'LlrtBytecode', 2),
    row('Node', 'Node24', 6),
  ]
  expect(bestOfFamilies(rows, (r) => r.score).map((r) => r.f.base)).toEqual([
    'Node22',
    'Llrt',
    'BunCompileAot',
    'Node24',
  ])
})
