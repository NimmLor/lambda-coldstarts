/**
 * Entry point of the Lambda MicroVM variant: a plain `node:http` server on port 8080, answering
 * every request with the report the other variants return. Lambda starts it once, while it builds
 * the image, and snapshots the running process; every MicroVM resumes from that snapshot, so this
 * module never runs during a cold start. infra/microvm.ts bundles it as the image's `index.mjs`.
 */
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { gravitonOf } from './graviton'
import { buildReport } from './report'

/** Where Lambda sends its build hooks, on the port infra/microvm.ts gives the image. */
const HOOKS = '/aws/lambda-microvms/runtime/v1/'

/** Where Lambda routes requests to unless they ask for another port. */
const PORT = 8080

const executableBytes = statSync(process.execPath).size

// Lambda builds a snapshot for each Graviton it runs MicroVMs on, and resumes a MicroVM from the
// one built on its own, so what the build saw holds for every MicroVM.
const graviton = gravitonOf(readFileSync('/proc/cpuinfo', 'utf8')) ?? process.arch

createServer((request, response) => {
  if (request.url?.startsWith(HOOKS)) {
    // `/ready` asks before the snapshot whether the server is up, which it is once it answers.
    // `/validate` comes to a MicroVM resumed from the new snapshot. It serves a report like a
    // request would, and Lambda records which pages that touched, to fetch them first at run time.
    if (request.url === `${HOOKS}validate`) buildReport({ event: {}, executableBytes })
    response.writeHead(200).end()
    return
  }
  // What a Function URL event says about the request, so the report reads both the same way.
  const event = { rawPath: request.url, requestContext: { http: { method: request.method } } }
  const { statusCode, headers, body } = buildReport({ event, executableBytes })
  response.writeHead(statusCode, { ...headers, 'x-graviton': graviton }).end(body)
}).listen(PORT)
