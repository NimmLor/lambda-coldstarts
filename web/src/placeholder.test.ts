import { expect, test } from 'bun:test'
import { ORDER } from './data'
import { placeholderHistory } from './placeholder'

test('the placeholder run has every function production deploys', () => {
  const run = placeholderHistory().at(-1)
  // 13 Event Functions on 2 architectures at 5 sizes, the Web Function and 6 MicroVMs.
  expect(run!.functions).toHaveLength(137)
  expect(new Set(run!.functions.map((f) => f.base))).toEqual(new Set(ORDER))
  expect(run!.functions.find((f) => f.id === 'Node24MicroVm/arm64/8192')?.name).toBe(
    'Node.js 24, MicroVM · 8 GB'
  )
  expect(run!.points.get('Node24Web/arm64/2048')?.cold).toBe(239)
})
