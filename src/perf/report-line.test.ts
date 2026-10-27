import { describe, expect, it } from 'bun:test'
import { parseReport } from './report-line'

const COLD =
  'START RequestId: 32f5cbf1 Version: $LATEST\nREPORT RequestId: 32f5cbf1\tDuration: 8.40 ms\tBilled Duration: 179 ms\tMemory Size: 1769 MB\tMax Memory Used: 66 MB\tInit Duration: 170.13 ms\t\n'

describe('parseReport', () => {
  it('reads every number of a cold start', () => {
    expect(parseReport(COLD)).toEqual({
      requestId: '32f5cbf1',
      initMs: 170.13,
      durationMs: 8.4,
      billedMs: 179,
      maxMemoryMb: 66,
    })
  })

  it('has no init duration for a warm start', () => {
    const warm = COLD.replace('Init Duration: 170.13 ms\t', '')
    expect(parseReport(warm).initMs).toBeUndefined()
  })

  it('throws without a REPORT line', () => {
    expect(() => parseReport('START RequestId: 1\n')).toThrow('No REPORT line')
  })
})
