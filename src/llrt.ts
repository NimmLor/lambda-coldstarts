/**
 * Entry point of the LLRT variants. LLRT is the `bootstrap` and runs the Runtime API loop itself,
 * so like src/node.ts this only exports the handler, which `_HANDLER=index.handler` names.
 */
import './llrt-env'
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
