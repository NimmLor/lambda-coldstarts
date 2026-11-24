import { expect, it } from 'bun:test'
import { HISTORY_RUNS, RUNS_ROUTES } from './api'

const run = (runId: string) => ({ runId, functions: [] })

it('serves the newest run alone at /runs/latest', () => {
  const latest = RUNS_ROUTES.get('/runs/latest')!
  expect(latest.limit).toBe(1)
  expect(latest.body([run('2026-11-24T10:36:52.542Z')])).toEqual({
    run: run('2026-11-24T10:36:52.542Z'),
  })
})

it('answers /runs/latest with null before the first run', () => {
  expect(RUNS_ROUTES.get('/runs/latest')!.body([])).toEqual({ run: null })
})

it('serves the latest runs at /runs/history, newest first as read', () => {
  const history = RUNS_ROUTES.get('/runs/history')!
  const runs = [run('2026-11-24T10:36:52.542Z'), run('2026-11-24T06:36:52.542Z')]
  expect(history.limit).toBe(HISTORY_RUNS)
  expect(history.body(runs)).toEqual({ runs })
})

it('has no route for any other path', () => {
  expect(RUNS_ROUTES.has('/runs')).toBe(false)
  expect(RUNS_ROUTES.has('/runs/history/')).toBe(false)
})
