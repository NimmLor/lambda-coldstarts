import { afterEach, describe, expect, it } from 'bun:test'
import { serve } from 'bun'
import { startLambdaRuntime } from './runtime'

type QueuedInvocation = { requestId: string; event: unknown; traceId?: string }
type Posted = {
  path: string
  contentType: string | null
  errorType: string | null
  body: unknown
}

const FUNCTION_ARN = 'arn:aws:lambda:eu-central-1:123456789012:function:hello'
const DEADLINE_MS = 1_700_000_000_000

let server: ReturnType<typeof serve> | undefined

afterEach(() => {
  server?.stop(true)
  delete process.env.AWS_LAMBDA_RUNTIME_API
  delete process.env._X_AMZN_TRACE_ID
})

/** A Runtime API that hands out `queue` in order, then answers 500, which ends the runtime. */
const serveRuntimeApi = (queue: QueuedInvocation[]) => {
  const posted: Posted[] = []
  server = serve({
    port: 0,
    async fetch(request: Request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/2018-06-01/runtime/invocation/next') {
        const next = queue.shift()
        if (!next) return new Response('stopping', { status: 500 })
        return Response.json(next.event, {
          headers: {
            'lambda-runtime-aws-request-id': next.requestId,
            'lambda-runtime-deadline-ms': String(DEADLINE_MS),
            'lambda-runtime-invoked-function-arn': FUNCTION_ARN,
            ...(next.traceId && { 'lambda-runtime-trace-id': next.traceId }),
          },
        })
      }
      posted.push({
        path: pathname,
        contentType: request.headers.get('content-type'),
        errorType: request.headers.get('lambda-runtime-function-error-type'),
        body: await request.json(),
      })
      return new Response(null, { status: 202 })
    },
  })
  process.env.AWS_LAMBDA_RUNTIME_API = `127.0.0.1:${server.port}`
  return posted
}

describe('startLambdaRuntime', () => {
  it('posts each result to its invocation, with the context and trace Lambda sent', async () => {
    const posted = serveRuntimeApi([
      { requestId: 'req-1', event: { name: 'Ada' }, traceId: 'Root=1-a' },
      { requestId: 'req-2', event: { name: 'Grace' } },
    ])
    const seen: unknown[] = []

    await expect(
      startLambdaRuntime((event: { name: string }, context) => {
        seen.push({ ...context, traceId: process.env._X_AMZN_TRACE_ID })
        return { greeting: `Hello ${event.name}` }
      })
    ).rejects.toThrow('Runtime API answered 500')

    expect(seen).toEqual([
      {
        awsRequestId: 'req-1',
        invokedFunctionArn: FUNCTION_ARN,
        deadlineMs: DEADLINE_MS,
        traceId: 'Root=1-a',
      },
      {
        awsRequestId: 'req-2',
        invokedFunctionArn: FUNCTION_ARN,
        deadlineMs: DEADLINE_MS,
        traceId: undefined,
      },
    ])
    expect(posted).toEqual([
      {
        path: '/2018-06-01/runtime/invocation/req-1/response',
        contentType: null,
        errorType: null,
        body: { greeting: 'Hello Ada' },
      },
      {
        path: '/2018-06-01/runtime/invocation/req-2/response',
        contentType: null,
        errorType: null,
        body: { greeting: 'Hello Grace' },
      },
    ])
  })

  it('reports a throwing handler on the error endpoint and serves the next invocation', async () => {
    const posted = serveRuntimeApi([
      { requestId: 'req-1', event: { fail: true } },
      { requestId: 'req-2', event: { fail: false } },
    ])

    await expect(
      startLambdaRuntime((event: { fail: boolean }) => {
        if (event.fail) throw new TypeError('boom')
        return 'ok'
      })
    ).rejects.toThrow('Runtime API answered 500')

    expect(posted).toEqual([
      {
        path: '/2018-06-01/runtime/invocation/req-1/error',
        contentType: 'application/vnd.aws.lambda.error+json',
        errorType: 'TypeError',
        body: {
          errorType: 'TypeError',
          errorMessage: 'boom',
          stackTrace: expect.any(Array),
        },
      },
      {
        path: '/2018-06-01/runtime/invocation/req-2/response',
        contentType: null,
        errorType: null,
        body: 'ok',
      },
    ])
  })
})
