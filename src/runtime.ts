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

/** `text.split('\n')` without `String.prototype.split`, which keeps the regex engine in a `--trim` build. */
const splitLines = (text: string) => {
  const lines: string[] = []
  let start = 0
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
    lines.push(text.slice(start, end))
    start = end + 1
  }
  lines.push(text.slice(start))
  return lines
}

// `String` proves to an --aot build that the fields of a built-in Error are strings. Without it,
// they could be anything, and a `--trim` build keeps whatever they might be: the regex engine, or
// the `indexOf` and `slice` of a Buffer or a Blob that `splitLines` might be calling.
const toErrorPayload = (error: unknown) =>
  error instanceof Error
    ? {
        errorType: String(error.name),
        errorMessage: String(error.message),
        stackTrace: error.stack === undefined ? [] : splitLines(String(error.stack)),
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

    // Read once: every `next.headers` is a lookup by name on a built-in object in an --aot build.
    const headers = next.headers
    const awsRequestId = headers.get('lambda-runtime-aws-request-id')
    if (!awsRequestId) throw new Error('Invocation without a request id')

    // The X-Ray SDK and Powertools read the trace of the current invocation from here.
    const traceId = headers.get('lambda-runtime-trace-id')
    if (traceId) process.env._X_AMZN_TRACE_ID = traceId
    else delete process.env._X_AMZN_TRACE_ID

    const context: LambdaContext = {
      awsRequestId,
      invokedFunctionArn:
        headers.get('lambda-runtime-invoked-function-arn') ?? '',
      deadlineMs: Number(headers.get('lambda-runtime-deadline-ms')),
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
