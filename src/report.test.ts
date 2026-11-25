import { expect, it } from 'bun:test'
import { buildReport } from './report'
import { WORK_DIGEST, WORK_PASSES, WORK_RECORDS } from './work'

const bodyOf = (event: unknown) => JSON.parse(buildReport({ event, executableBytes: 0 }).body)

it('answers every request but /work as the hello world, with no work', () => {
  const body = bodyOf({ rawPath: '/perf', requestContext: { http: { method: 'GET' } } })
  expect(body.request).toEqual({ method: 'GET', path: '/perf' })
  expect(body.work).toBeNull()
})

it('runs the workload for /work, of the size the request asks for', () => {
  const { work } = bodyOf({
    rawPath: '/work',
    queryStringParameters: { records: String(WORK_RECORDS), passes: String(WORK_PASSES) },
  })
  expect(work).toMatchObject({ records: WORK_RECORDS, passes: WORK_PASSES, digest: WORK_DIGEST })
  expect(work.workMs).toBeGreaterThan(0)
  const small = bodyOf({ rawPath: '/work', queryStringParameters: { records: '10', passes: '2' } })
  expect(small.work).toMatchObject({ records: 10, passes: 2 })
})

it('runs the default workload for /work without a query', () => {
  expect(bodyOf({ rawPath: '/work' }).work).toMatchObject({
    records: WORK_RECORDS,
    passes: WORK_PASSES,
  })
})
