import { expect, it } from 'bun:test'
import { expiresAt, RETENTION_DAYS, runIdOf, samplesPk } from './keys'

const runId = '2026-10-30T12:00:00.123Z'

it('expires a run RETENTION_DAYS after it started, in epoch seconds', () => {
  expect(expiresAt(runId)).toBe(Date.parse('2026-10-30T12:00:00Z') / 1000 + RETENTION_DAYS * 86_400)
  expect(new Date(expiresAt(runId) * 1000).toISOString()).toBe('2027-02-27T12:00:00.000Z')
})

it('finds the run of every kind of item', () => {
  expect(runIdOf({ pk: 'runs', sk: runId })).toBe(runId)
  expect(runIdOf({ pk: 'summaries', sk: runId })).toBe(runId)
  expect(runIdOf({ pk: samplesPk(runId), sk: 'Node24X8664M128#001' })).toBe(runId)
  expect(runIdOf({ pk: 'other', sk: runId })).toBeUndefined()
})
