/**
 * The Amazon Linux 2023 containers scripts/build-docker.ts and scripts/explain.ts run Bun in, one
 * per Lambda architecture, under QEMU when it isn't the host's: what --aot needs.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type LambdaArch, toLambdaArch } from '../infra/build'

/** Lambda's provided.al2023 OS, so the AOT shim and the smoke test see the glibc Lambda has. */
const BASE_IMAGE = 'public.ecr.aws/amazonlinux/amazonlinux:2023'
const SETUP = 'infra/build-image.sh'

export const hostArch = toLambdaArch(process.arch)
const dockerPlatform = (arch: LambdaArch) => (arch === 'arm64' ? 'linux/arm64' : 'linux/amd64')

/** The command that registers QEMU for `arch`, for a Docker that can't run it yet. */
export const emulationHint = (arch: LambdaArch) =>
  arch === hostArch
    ? ''
    : `\nRunning ${arch} containers on this ${hostArch} host needs QEMU. On Linux, register it once per boot with:\n` +
      `  docker run --privileged --rm tonistiigi/binfmt --install ${arch === 'arm64' ? 'arm64' : 'amd64'}\n`

const docker = (args: string[], input?: string) =>
  execFileSync('docker', args, {
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  })

/**
 * The image to build `arch` in: BASE_IMAGE after SETUP, made with `docker run` and `docker commit`.
 * `docker build` without buildx is Docker's legacy builder, which starts from the host's
 * architecture of the base image whatever `--platform` says. The tag carries SETUP's hash, so
 * changing SETUP makes a new image.
 */
const buildImage = (arch: LambdaArch) => {
  const setup = readFileSync(SETUP, 'utf8')
  const hash = createHash('sha256').update(setup).digest('hex').slice(0, 12)
  const image = `bun-aot-lambda-build:${arch}-${hash}`
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) {
    return image
  }
  const container = `bun-aot-lambda-setup-${arch}-${process.pid}`
  try {
    docker(
      [
        'run',
        '-i',
        '--platform',
        dockerPlatform(arch),
        '--name',
        container,
        '-e',
        `LAMBDA_ARCH=${arch}`,
        BASE_IMAGE,
        'sh',
        '-s',
      ],
      setup
    )
    docker(['commit', container, image])
  } finally {
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  }
  return image
}

/** Runs `command` in the image for `arch`, in the repository mounted at /work. */
export const runInImage = (arch: LambdaArch, command: string[]) => {
  const image = buildImage(arch)
  docker([
    'run',
    '--rm',
    '--platform',
    dockerPlatform(arch),
    // As the host user, so dist/ stays the host user's.
    ...(process.getuid ? ['--user', `${process.getuid()}:${process.getgid!()}`] : []),
    '-v',
    `${process.cwd()}:/work`,
    '-w',
    '/work',
    '-e',
    'HOME=/tmp',
    '-e',
    `LAMBDA_ARCH=${arch}`,
    '-e',
    'BUN_AOT_BIN=bun-aot',
    // Lambda's arm64 is Graviton2. QEMU otherwise emulates a CPU with every feature it knows, and
    // anything that tunes code to the CPU it builds on would tune it to that one.
    ...(arch === 'arm64' && hostArch !== 'arm64' ? ['-e', 'QEMU_CPU=neoverse-n1'] : []),
    image,
    ...command,
  ])
}
