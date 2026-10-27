/**
 * Entry point of all four Bun variants. The process is the Lambda `bootstrap` (directly when
 * compiled, through `bun index.js` otherwise), so instead of exporting a handler it starts the
 * runtime loop itself.
 */
import { file } from 'bun'
import { buildReport } from './report'
import { startLambdaRuntime } from './runtime'

// `Bun.file` rather than `node:fs`, which would keep ~4.6 MB of fs in a `--trim` build.
const executableBytes = file(process.execPath).size

await startLambdaRuntime((event, context) =>
  buildReport({
    event,
    remainingTimeMs: context.deadlineMs - Date.now(),
    executableBytes,
  })
)
