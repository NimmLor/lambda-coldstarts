/**
 * One round of a Lambda MicroVM, for measure.ts. A MicroVM resumes from the snapshot its image was
 * built with, so it has no init to measure, and Lambda reports no numbers for it. The round runs a
 * new MicroVM, sends it requests as soon as it has a token to send until it answers, times that
 * from here, and terminates it. It sends no warm requests:
 * PerfMeasure's sliver of a vCPU would time its own 20 ms time slices instead (see `Sample`).
 */
import {
  CreateMicrovmAuthTokenCommand,
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  ServiceQuotaExceededException,
  TerminateMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms'
import type { Sample } from './keys'

/** What infra/microvm.ts hands PerfRun for a MicroVM image. */
export type MicrovmTarget = {
  id: string
  kind: 'microvm'
  region: string
  imageArn: string
  /** Lambda's connectors that let HTTPS requests in and the MicroVM out to the internet. */
  ingressConnector: string
  egressConnector: string
  memoryMb: number
  /** What the server runs in, which Sample's `runtime` records. */
  containerImage: string
  codeBytes: number
}

/** Where src/microvm.ts listens, which the token grants access to. */
const PORT = 8080

/** How long Lambda lets a MicroVM live should terminating it fail: well past a round's last request. */
const MAX_LIFETIME_S = 120

/**
 * How long a round waits for room under the account's MicroVM memory quota, 8 GB unless raised,
 * which another stage's MicroVMs or one still terminating can hold.
 */
const QUOTA_WAIT_MS = 90_000

/** How long a round asks a MicroVM again while it's still resuming, well past the 8 GB's 3 s. */
const RESUME_WAIT_MS = 30_000

const round2 = (value: number) => Math.round(value * 100) / 100

const clients = new Map<string, LambdaMicrovmsClient>()
const clientFor = (region: string) => {
  let client = clients.get(region)
  if (!client) {
    client = new LambdaMicrovmsClient({ region })
    clients.set(region, client)
  }
  return client
}

/**
 * A new MicroVM from the image, which resumes from its snapshot, and when the call that started it
 * went out: the ones refused for want of memory under the quota don't count.
 */
const runMicrovm = async (client: LambdaMicrovmsClient, target: MicrovmTarget) => {
  const deadline = Date.now() + QUOTA_WAIT_MS
  for (;;) {
    const start = performance.now()
    try {
      const microvm = await client.send(
        new RunMicrovmCommand({
          imageIdentifier: target.imageArn,
          ingressNetworkConnectors: [target.ingressConnector],
          // The server makes no requests of its own, but no connector turns the internet off: an
          // empty list gets the image's.
          egressNetworkConnectors: [target.egressConnector],
          maximumDurationInSeconds: MAX_LIFETIME_S,
        })
      )
      return { ...microvm, start }
    } catch (e) {
      if (!(e instanceof ServiceQuotaExceededException) || Date.now() > deadline) throw e
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
}

export const measureMicrovm = async (
  target: MicrovmTarget,
  round: number
): Promise<Omit<Sample, 'measuredAt'>> => {
  const client = clientFor(target.region)
  const { microvmId, endpoint, start } = await runMicrovm(client, target)
  try {
    // Lambda issues it while the MicroVM is still pending.
    const { authToken } = await client.send(
      new CreateMicrovmAuthTokenCommand({
        microvmIdentifier: microvmId,
        expirationInMinutes: 5,
        allowedPorts: [{ port: PORT }],
      })
    )
    // The endpoint holds a request for about 1.3 s while the MicroVM resumes, then gives up with a
    // 502; the larger sizes often take longer than that. A caller would ask again, and so does the
    // round.
    const sentAt = performance.now()
    const deadline = Date.now() + RESUME_WAIT_MS
    let response: Response
    for (;;) {
      response = await fetch(`https://${endpoint}/perf`, { headers: authToken })
      const resuming =
        response.status === 502 &&
        response.headers.get('x-aws-proxy-error') === 'MICROVM_CONNECT_FAILED'
      if (!resuming || Date.now() > deadline) break
      await response.body?.cancel()
    }
    const text = await response.text()
    const answeredAt = performance.now()
    // The state machine retries the round with another MicroVM.
    if (!response.ok) throw new Error(`${target.id} answered ${response.status}: ${text}`)
    const body = JSON.parse(text)
    // The snapshot was taken before the server's first request, so this should never happen.
    if (!body.container?.coldStart) {
      throw new Error(`${target.id} answered as if warm in round ${round}`)
    }

    return {
      functionId: target.id,
      round,
      runtime: target.containerImage,
      arch: 'arm64',
      memoryMb: target.memoryMb,
      codeSizeMb: Math.round((target.codeBytes / 1024 / 1024) * 10) / 10,
      maxMemoryMb: body.memory.maxRssMb,
      version: body.runtime,
      roundTripMs: round2(answeredAt - start),
      firstRequestMs: round2(answeredAt - sentAt),
      graviton: response.headers.get('x-graviton') ?? undefined,
      requestId: microvmId!,
    }
  } finally {
    await client.send(new TerminateMicrovmCommand({ microvmIdentifier: microvmId }))
  }
}
