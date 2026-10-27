/**
 * A minimal Lambda custom runtime for the Bun variants. Every Bun build in this repo ends up as the
 * `bootstrap` of a `provided.al2023` function, so the process polls the Runtime API itself:
 * https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
 */

export type LambdaContext = {
  awsRequestId: string
  invokedFunctionArn: string
  /** Epoch milliseconds at which Lambda stops the invocation. */
  deadlineMs: number
}

export type Handler<TEvent, TResult> = (
  event: TEvent,
  context: LambdaContext
) => TResult | Promise<TResult>

const toErrorPayload = (error: unknown) =>
  error instanceof Error
    ? {
        errorType: error.name,
        errorMessage: error.message,
        stackTrace: error.stack?.split('\n') ?? [],
      }
    : { errorType: 'Error', errorMessage: String(error), stackTrace: [] }

const post = async (
  url: string,
  body: unknown,
  headers?: Record<string, string>
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? null),
  })
  if (!response.ok) {
    throw new Error(`Runtime API answered ${response.status} to ${url}`)
  }
}

/**
 * Serves invocations one after another, the way Lambda hands them out. Never resolves: it rejects
 * once the Runtime API stops answering, which ends the process and lets Lambda start a fresh one.
 */
export const startLambdaRuntime = async <TEvent, TResult>(
  handler: Handler<TEvent, TResult>
): Promise<never> => {
  const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API
  if (!runtimeApi) {
    throw new Error(
      'AWS_LAMBDA_RUNTIME_API is not set; this executable runs as a Lambda bootstrap'
    )
  }
  const base = `http://${runtimeApi}/2018-06-01/runtime/invocation`

  while (true) {
    // A long poll that lasts as long as the function stays warm, past fetch's 300 s idle timeout.
    const next = await fetch(`${base}/next`, { timeout: false })
    if (!next.ok) {
      throw new Error(`Runtime API answered ${next.status} to ${base}/next`)
    }

    const awsRequestId = next.headers.get('lambda-runtime-aws-request-id')
    if (!awsRequestId) throw new Error('Invocation without a request id')

    // The X-Ray SDK and Powertools read the trace of the current invocation from here.
    const traceId = next.headers.get('lambda-runtime-trace-id')
    if (traceId) process.env._X_AMZN_TRACE_ID = traceId
    else delete process.env._X_AMZN_TRACE_ID

    const context: LambdaContext = {
      awsRequestId,
      invokedFunctionArn:
        next.headers.get('lambda-runtime-invoked-function-arn') ?? '',
      deadlineMs: Number(next.headers.get('lambda-runtime-deadline-ms')),
    }

    let result: TResult
    try {
      result = await handler((await next.json()) as TEvent, context)
    } catch (error) {
      const payload = toErrorPayload(error)
      await post(`${base}/${awsRequestId}/error`, payload, {
        'Content-Type': 'application/vnd.aws.lambda.error+json',
        'Lambda-Runtime-Function-Error-Type': payload.errorType,
      })
      continue
    }
    await post(`${base}/${awsRequestId}/response`, result)
  }
}
