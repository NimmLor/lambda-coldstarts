/**
 * `bun run og`: renders og.html into og.png, the 1200×630 social preview index.html points at,
 * with headless Chrome over the DevTools protocol. `--screenshot` won't do: headless Chrome's
 * viewport is shorter than its `--window-size`, so it leaves the bottom unpainted. `CHROME` is
 * the binary, google-chrome by default.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [WIDTH, HEIGHT] = [1200, 630]

const profile = await mkdtemp(join(tmpdir(), 'og-'))
const chrome = Bun.spawn(
  [
    process.env.CHROME ?? 'google-chrome',
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stderr: 'pipe' }
)

try {
  // Chrome announces the port it picked on stderr.
  let log = ''
  const decoder = new TextDecoder()
  for await (const chunk of chrome.stderr) {
    log += decoder.decode(chunk)
    if (/DevTools listening on ws:/.test(log)) break
  }
  const port = log.match(/ws:\/\/[^:]+:(\d+)\//)?.[1]
  if (!port) throw new Error(`Chrome didn't start:\n${log}`)
  const targets: { type: string; webSocketDebuggerUrl: string }[] = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()
  // The tab, not a built-in extension's background page.
  const target = targets.find((t) => t.type === 'page')
  if (!target) throw new Error('Chrome has no tab to render in')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map<number, (result: unknown) => void>()
  const events = new Map<string, () => void>()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    pending.get(message.id)?.(message.result)
    events.get(message.method)?.()
  })
  const send = <T>(method: string, params = {}) =>
    new Promise<T>((resolve) => {
      pending.set(++id, resolve as (result: unknown) => void)
      socket.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const loaded = new Promise<void>((resolve) => events.set('Page.loadEventFired', resolve))
  await send('Page.navigate', { url: `file://${import.meta.dir}/og.html` })
  await loaded
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
  await Bun.write(join(import.meta.dir, 'og.png'), Buffer.from(data, 'base64'))
  socket.close()
  console.log('wrote og.png')
} finally {
  chrome.kill()
  await chrome.exited
  await rm(profile, { recursive: true, force: true })
}
