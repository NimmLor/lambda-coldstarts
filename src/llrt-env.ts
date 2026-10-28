/**
 * Fills in what report.ts reads and LLRT lacks: `process.memoryUsage`, `process.resourceUsage`,
 * `process.execPath` and `navigator.hardwareConcurrency`. src/llrt.ts imports this before
 * report.ts, which reads the vCPUs as soon as it's evaluated.
 */
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { ComputeMemoryUsage } from 'llrt:qjs'

/** A `kB` field of /proc/self/status, such as `VmRSS`, in KiB. */
const statusKib = (field: string) => {
  const status = readFileSync('/proc/self/status', 'utf8')
  const start = status.indexOf(`\n${field}:`) + field.length + 2
  return Number.parseInt(status.slice(start, status.indexOf('\n', start)), 10)
}

// QuickJS's own heap stands in for V8's: what it has allocated, and what of that is in use.
process.memoryUsage = (() => {
  const heap = ComputeMemoryUsage()
  return {
    rss: statusKib('VmRSS') * 1024,
    heapTotal: heap.malloc_size,
    heapUsed: heap.memory_used_size,
    external: 0,
    arrayBuffers: 0,
  }
}) as typeof process.memoryUsage

// The peak resident size, in KiB like Node's: what Lambda reports as "Max Memory Used".
process.resourceUsage = (() => ({ maxRSS: statusKib('VmHWM') })) as typeof process.resourceUsage

// The bootstrap Lambda started, which is LLRT itself. Its `process.argv[0]` doesn't say where.
process.execPath = `${process.env.LAMBDA_TASK_ROOT}/bootstrap`

Object.defineProperty(navigator, 'hardwareConcurrency', { value: availableParallelism() })
