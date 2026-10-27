/** Entry point of the Node variants, run by Lambda's managed `nodejsXX.x` runtimes. */
import { statSync } from 'node:fs'
import type { Context } from 'aws-lambda'
import { buildReport } from './report'

const executableBytes = statSync(process.execPath).size

export const handler = async (event: unknown, context: Context) =>
  buildReport({
    event,
    remainingTimeMs: context.getRemainingTimeInMillis(),
    executableBytes,
  })
