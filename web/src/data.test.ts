import { expect, test } from 'bun:test'
import { fullName, niceMax, shortName } from './data'

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

test('fullName tells a variant apart without its family’s heading', () => {
  expect(fullName('Llrt')).toBe('LLRT, no SDK')
  expect(fullName('BunRuntime')).toBe('Bun runtime')
  expect(fullName('Unknown')).toBe('Unknown')
})
