import { describe, expect, it } from 'bun:test'
import { readEnvironmentLog } from './platform-events'

// The examples from Lambda's system log event schema, trimmed.
const STREAM = [
  {
    timestamp: '2026-09-25T11:12:30.893Z',
    level: 'INFO',
    type: 'platform.initStart',
    record: {
      functionName: 'my-web-app',
      revisionId: 'rev-fs0fq',
      initializationType: 'native-http',
    },
  },
  {
    timestamp: '2026-09-25T11:12:31.143Z',
    level: 'INFO',
    type: 'platform.initReport',
    record: {
      status: 'success',
      metrics: { totalDurationMs: 304, totalCpuTimeMs: 143, maxMemoryUsageMb: 142 },
    },
  },
  {
    timestamp: '2026-09-25T11:12:31.144Z',
    level: 'INFO',
    type: 'platform.invokeStart',
    record: {},
  },
  {
    timestamp: '2026-09-25T11:12:31.150Z',
    level: 'INFO',
    message: { method: 'GET' },
    requestId: 'KXH25FBDZ33GP4TQ4ARAUYSTSA',
  },
  {
    timestamp: '2026-09-25T11:12:31.154Z',
    level: 'DEBUG',
    type: 'platform.requestComplete',
    record: {
      requestId: 'KXH25FBDZ33GP4TQ4ARAUYSTSA',
      result: 200,
      metrics: { durationMs: 4.484, responseBytes: 40 },
    },
  },
].map((event) => JSON.stringify(event))

describe('readEnvironmentLog', () => {
  it('reads the init and each request', () => {
    const log = readEnvironmentLog(STREAM)
    expect(log).toEqual({
      revisionId: 'rev-fs0fq',
      initStartedAt: Date.parse('2026-09-25T11:12:30.893Z'),
      initMs: 304,
      initMemoryMb: 142,
      requestMs: new Map([['KXH25FBDZ33GP4TQ4ARAUYSTSA', 4.484]]),
    })
  })

  it('skips lines that are not JSON', () => {
    expect(readEnvironmentLog(['listening', ...STREAM]).initMs).toBe(304)
  })

  it('has no init duration when the init failed', () => {
    const failed = STREAM.map((line) => line.replace('"status":"success"', '"status":"failure"'))
    expect(readEnvironmentLog(failed).initMs).toBeUndefined()
  })
})
