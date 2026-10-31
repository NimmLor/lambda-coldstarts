import { expect, it } from 'bun:test'
import { archiveKey, previousMonth } from './export'

it('exports the month before, across a year', () => {
  expect(previousMonth(new Date('2026-11-01T05:17:00Z'))).toBe('2026-10')
  expect(previousMonth(new Date('2027-01-01T05:17:00Z'))).toBe('2026-12')
  expect(previousMonth(new Date('2026-03-31T23:59:59Z'))).toBe('2026-02')
})

it('files a month by year and month', () => {
  expect(archiveKey('2026-10', 'runs')).toBe('2026/10/runs.ndjson.gz')
  expect(archiveKey('2026-10', 'samples')).toBe('2026/10/samples.ndjson.gz')
})
