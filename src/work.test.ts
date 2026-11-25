import { expect, it } from 'bun:test'
import { passesOf, recordsOf, runWork, WORK_DIGEST, WORK_PASSES, WORK_RECORDS } from './work'

it('computes the digest PerfMeasure checks every /work answer against', () => {
  expect(runWork(WORK_RECORDS, WORK_PASSES)).toBe(WORK_DIGEST)
})

it('depends on the records and the passes, so no build can fold or skip either', () => {
  expect(runWork(WORK_RECORDS + 1, WORK_PASSES)).not.toBe(WORK_DIGEST)
  expect(runWork(WORK_RECORDS, WORK_PASSES - 1)).not.toBe(WORK_DIGEST)
  // Each pass works on records of its own, so two passes aren't one done twice.
  expect(runWork(WORK_RECORDS, 2)).not.toBe(runWork(WORK_RECORDS, 0))
})

it('takes the size from a request within bounds, and the default otherwise', () => {
  expect(recordsOf('500')).toBe(500)
  expect(recordsOf('1e9')).toBe(20_000)
  expect(passesOf('3')).toBe(3)
  expect(passesOf('1000')).toBe(20)
  for (const bad of [undefined, '', 'abc', '-3', '0', '2.5']) {
    expect(recordsOf(bad)).toBe(WORK_RECORDS)
    expect(passesOf(bad)).toBe(WORK_PASSES)
  }
})
