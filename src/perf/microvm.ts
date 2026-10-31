/**
 * One round of a Lambda MicroVM, for measure.ts. A MicroVM resumes from the snapshot its image was
 * built with, so it has no init to measure, and Lambda reports no numbers for it. The round runs a
 * new MicroVM, sends it a request as soon as it has a token to send, which the endpoint holds until
 * the MicroVM is running, times that from here, and terminates it. It sends no warm requests:
 * PerfMeasure's sliver of a vCPU would time its own 20 ms time slices instead (see `Sample`).
 */
import {
  CreateMicrovmAuthTokenCommand,
  LambdaMicrovmsClient,
  RunMicrovmCommand,
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

export const measureMicrovm = async (
  target: MicrovmTarget,
  round: number
): Promise<Omit<Sample, 'measuredAt'>> => {
  const client = clientFor(target.region)
  const start = performance.now()
  // A new MicroVM every round: each one resumes from the image's snapshot.
  const { microvmId, endpoint } = await client.send(
    new RunMicrovmCommand({
      imageIdentifier: target.imageArn,
      ingressNetworkConnectors: [target.ingressConnector],
      // The server makes no requests of its own, but no connector turns the internet off: an
      // empty list gets the image's.
      egressNetworkConnectors: [target.egressConnector],
      maximumDurationInSeconds: MAX_LIFETIME_S,
    })
  )
  try {
    // Lambda issues it while the MicroVM is still pending.
    const { authToken } = await client.send(
      new CreateMicrovmAuthTokenCommand({
        microvmIdentifier: microvmId,
        expirationInMinutes: 5,
        allowedPorts: [{ port: PORT }],
      })
    )
    const sentAt = performance.now()
    const response = await fetch(`https://${endpoint}/perf`, { headers: authToken })
    const text = await response.text()
    const answeredAt = performance.now()
    // A 502 when the MicroVM didn't start; the state machine retries the round with another.
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
