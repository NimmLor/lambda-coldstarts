/**
 * Entry point of the Lambda Web Function variant: a plain `node:http` server on the address Lambda
 * gives it, answering every request with the report the other variants return. infra/web-function.ts
 * bundles it as the `index.js` that the `nodejs24.x` Web Function runtime loads.
 */
import { statSync } from 'node:fs'
import { createServer } from 'node:http'
import { buildReport } from './report'

const executableBytes = statSync(process.execPath).size

// `host:port`. Lambda sets it; running locally, the server falls back to port 3000.
const [host, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? '127.0.0.1:3000').split(':')

createServer((request, response) => {
  // What a Function URL event says about the request, so the report reads both the same way.
  const event = { rawPath: request.url, requestContext: { http: { method: request.method } } }
  const { statusCode, headers, body } = buildReport({ event, executableBytes })
  response.writeHead(statusCode, headers).end(body)
}).listen(Number(port), host)
