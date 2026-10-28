/**
 * admin.html: sends PerfApi's POST /admin/<secret>/run, /pause, /resume and /purge
 * (src/perf/api.ts). A wrong
 * secret gets the 405 any unknown POST gets, since the routes don't exist for it.
 */
const form = document.getElementById('admin') as HTMLFormElement
const log = document.getElementById('log') as HTMLOutputElement
const buttons = form.querySelectorAll('button')

const say = (line: string) => {
  log.textContent = `${log.textContent}${line}\n`
}

/**
 * PerfRouter signs requests to PerfApi with Origin Access Control, which can't hash a POST body
 * itself: the sender gives the SHA-256 of it, here of the empty one.
 */
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const post = async (secret: string, action: string) => {
  const response = await fetch(`/api/admin/${encodeURIComponent(secret)}/${action}`, {
    method: 'POST',
    headers: { 'x-amz-content-sha256': EMPTY_BODY_SHA256 },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 405 ? 'Wrong secret' : JSON.stringify(body))
  return body
}

const run = async (secret: string) => {
  const { runId } = await post(secret, 'run')
  say(`Started run ${runId}`)
}

const scheduleStates: Record<string, string> = { ENABLED: 'running', DISABLED: 'paused' }

const setSchedule = async (secret: string, action: 'pause' | 'resume') => {
  const { state, was } = await post(secret, action)
  say(
    state === was
      ? `The hourly schedule was already ${scheduleStates[state]}`
      : `The hourly schedule is ${scheduleStates[state]} now`
  )
}

// Each call stops after about 15 s; `done` says whether the table is empty.
const purge = async (secret: string) => {
  let total = 0
  while (true) {
    const { deleted, done } = await post(secret, 'purge')
    total += deleted
    say(`Deleted ${total} items${done ? ', table is empty' : ', continuing…'}`)
    if (done) return
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const action = (event.submitter as HTMLButtonElement | null)?.value
  const secret = new FormData(form).get('secret') as string
  if (action === 'purge' && !confirm('Delete every run and sample in PerfResults?')) return

  log.textContent = ''
  buttons.forEach((button) => (button.disabled = true))
  try {
    if (action === 'purge') await purge(secret)
    else if (action === 'pause' || action === 'resume') await setSchedule(secret, action)
    else await run(secret)
  } catch (error) {
    say((error as Error).message)
  } finally {
    buttons.forEach((button) => (button.disabled = false))
  }
})
