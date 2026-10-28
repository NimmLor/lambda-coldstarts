/**
 * admin.html: sends PerfApi's POST /admin/<secret>/run and /purge (src/perf/api.ts). A wrong
 * secret gets the 405 any unknown POST gets, since the routes don't exist for it.
 */
const form = document.getElementById('admin') as HTMLFormElement
const log = document.getElementById('log') as HTMLOutputElement
const buttons = form.querySelectorAll('button')

const say = (line: string) => {
  log.textContent = `${log.textContent}${line}\n`
}

const post = async (secret: string, action: string) => {
  const response = await fetch(`/api/admin/${encodeURIComponent(secret)}/${action}`, {
    method: 'POST',
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 405 ? 'Wrong secret' : JSON.stringify(body))
  return body
}

const run = async (secret: string) => {
  const { runId } = await post(secret, 'run')
  say(`Started run ${runId}`)
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
    await (action === 'purge' ? purge(secret) : run(secret))
  } catch (error) {
    say((error as Error).message)
  } finally {
    buttons.forEach((button) => (button.disabled = false))
  }
})
