# bun-aot-lambda

One SST stack, eight Lambdas that do the same thing on different runtimes, and a script that
measures their cold and warm starts:

| Function | Runtime | What ships |
|---|---|---|
| `BunRuntime` | `provided.al2023` | `bun` executable + bundled `index.js`, started by a shell `bootstrap` |
| `BunCompile` | `provided.al2023` | `bun build --compile --minify --bytecode` executable as `bootstrap` |
| `BunCompileTrim` | `provided.al2023` | same with `--trim`, which drops the parts of Bun the code doesn't use |
| `BunCompileAot` | `provided.al2023` | `bun build --compile --aot` executable, behind a `bootstrap` that preloads the mincore shim |
| `BunCompileAotTrim` | `provided.al2023` | same with `--aot --trim` |
| `Node22` | `nodejs22.x` | SST's esbuild bundle |
| `Node24` | `nodejs24.x` | SST's esbuild bundle |
| `Node26` | `nodejs26.x` (public preview) | SST's esbuild bundle |

Every function runs the same handler ([`src/report.ts`](src/report.ts)), has the same memory
(1769 MB, one full vCPU), architecture and timeout, and gets a public Function URL. The Bun
variants serve invocations through a small custom runtime loop ([`src/runtime.ts`](src/runtime.ts));
the Node variants use Lambda's managed runtime.

## Deploy

```sh
bun install
cp .env.example .env   # then fill in AWS_PROFILE or access keys
bun run deploy --stage dev   # every function on x86_64 and arm64, Bun variants built in Docker
curl "$(jq -r '.functions.BunCompileX64.url' .sst/outputs.json)"
```

`bun run deploy` is `bun run build` (see [Both architectures](#both-architectures-built-in-docker))
and then `sst deploy` with `LAMBDA_ARCH=x86_64,arm64 BUN_BUNDLES=dist`. A plain `bunx sst deploy`
builds on the host instead, for its architecture only, and replaces the functions of the other.

Settings, all through the environment of `sst deploy`:

| Variable | Default | |
|---|---|---|
| `LAMBDA_ARCH` | build host's | `x86_64`, `arm64` or `x86_64,arm64`. The `--aot` variants only build on the host when it matches; with two, see [Both architectures](#both-architectures-built-in-docker). |
| `LAMBDA_MEMORY` | `1769` | MB, for every function |
| `VARIANTS` | all | e.g. `BunCompile,Node24` |
| `BUN_BIN` | `bun` | Bun for `BunRuntime` and `BunCompile` |
| `BUN_AOT_BIN` | `$BUN_BIN` | Bun for the `--trim` and `--aot` variants |
| `CC` | `cc` | C compiler for the mincore shim |
| `BUN_BUNDLES` | unset | Deploy the Bun variants from `$BUN_BUNDLES/<arch>/<Variant>` instead of building them |

## Both architectures, built in Docker

```sh
bun run build                # every Bun variant for x86_64 and arm64, into dist/<arch>/<Variant>
bun run deploy --stage dev   # bun run build, then deploys all 16 functions
```

`bun run build` is [`scripts/build-docker.ts`](scripts/build-docker.ts). The Node variants need
no build of their own: SST bundles them during the deploy. `deploy` deploys with
`LAMBDA_ARCH=x86_64,arm64 BUN_BUNDLES=dist`. With more than one architecture, every function's
name ends in it: `BunCompileX64`, `BunCompileArm64`, `Node24Arm64`.

Each architecture builds in an Amazon Linux 2023 container of that architecture, which is
Lambda's `provided.al2023` OS. So `--aot` compiles natively, and the smoke test from
`build:local` runs against the glibc Lambda has. The container image installs released Bun
1.4.4 and the pinned AOT build for its architecture, checksums verified
([`infra/build-image.sh`](infra/build-image.sh)), and is cached until that script changes.
`bun run build --arch arm64 BunCompileAot` builds just some of them.

The architecture the host isn't runs under QEMU, which Docker Desktop brings along. A Docker
Engine on Linux (WSL included) needs it registered once per boot:

```sh
docker run --privileged --rm tonistiigi/binfmt --install arm64   # amd64 on an arm64 host
```

Under QEMU, arm64 builds emulate a Neoverse N1, the core of Lambda's Graviton2, so nothing that
tunes code to the build CPU uses features Lambda lacks. Expect the emulated build to take
minutes rather than seconds.

## `--aot` and `--trim` aren't released yet

`--aot` and `--trim` only exist on [oven-sh/bun#45631](https://github.com/oven-sh/bun/pull/45631),
which is still a draft. Released Bun **accepts unknown flags silently**, so `--compile --aot` on
Bun 1.4.4 quietly builds a plain executable. The build therefore checks that `bun build --help`
lists every flag a variant needs and skips that function with a warning otherwise, instead of
deploying something mislabelled.

To build them, point `BUN_AOT_BIN` at a build of that PR. `BunCompileTrim` builds on any host;
the two `--aot` variants need **Linux on the Lambda architecture**, because `--aot` can't
cross-compile.

### Installing the AOT build of Bun

The pinned build is Buildkite build
[#133641](https://buildkite.com/bun/bun/builds/133641) of oven-sh/bun#45631,
`1.4.4-canary.1+72ab4f530`. Its artifacts expire around 2027-04-25.

**Linux x64.** This installs it next to your normal Bun, without replacing it:

```sh
mkdir -p ~/.bun-aot && cd ~/.bun-aot
curl -fL -o bun-linux-x64.zip "https://buildkite.com/organizations/bun/pipelines/bun/builds/133641/jobs/01a17d0b-2f8a-4994-b0d1-5aefc929366e/artifacts/01a17d12-dc53-4bb8-9856-d357395550f1"
echo "2bb09f3c5b9966dc5160ebc87e8bc981e7ea5dc6c511227943fb6065e06a7461  bun-linux-x64.zip" | sha256sum -c
unzip -o bun-linux-x64.zip && chmod +x bun-linux-x64/bun
~/.bun-aot/bun-linux-x64/bun --revision   # 1.4.4-canary.1+72ab4f530
```

Then deploy with it. Only the `--trim` and `--aot` variants use `BUN_AOT_BIN`; installs and the
other variants stay on your normal Bun:

```sh
BUN_AOT_BIN=~/.bun-aot/bun-linux-x64/bun bunx sst deploy --stage dev
```

The deploy also needs a C compiler (`cc`, or set `$CC`) for the mincore shim. `sst deploy`
prints `Skipping <Variant>: …` with the reason for every variant it can't build.

**Linux arm64 and macOS.** The same build has `linux-aarch64` and `darwin-aarch64` binaries: on
the [build page](https://buildkite.com/bun/bun/builds/133641), open the matching `build-bun` job's
Artifacts tab. Install them the same way, with `LAMBDA_ARCH=arm64` on Linux arm64. A Mac can
build `BunCompileTrim` but not the `--aot` variants, since `--aot` only builds for the machine it
runs on; use `bun run build` in Docker, or the [Deploy and benchmark](.github/workflows/bench.yml)
workflow, which builds on native x86_64 and arm64 runners.

**A newer build of the PR.** [`bun-pr`](https://www.npmjs.com/package/bun-pr), by Bun's author,
downloads the latest finished build of a PR for your OS and architecture, next to the `bun` on
your `PATH` (or into `$BUN_OUT_DIR`), and links it as `bun-45631`:

```sh
bunx bun-pr 45631
export BUN_AOT_BIN="$(dirname "$(which bun)")/bun-45631"
"$BUN_AOT_BIN" build --help | grep -E -- '--(aot|trim)\b'   # stock Bun prints nothing
```

### Why the mincore shim

AOT executables start by reserving the lowest pages of the address space and then call
`mincore()` on page 0, expecting `ENOMEM` as proof it's unmapped. Lambda's seccomp filter makes
`mincore` fail with `EPERM` instead, so the loader exits during init:

> error: can't run this executable's compiled code: it needs the lowest pages of the address space to be unmapped, and this system maps them

[`infra/mincore-shim.c`](infra/mincore-shim.c) is `LD_PRELOAD`ed by the AOT `bootstrap` and
rewrites `EPERM` to `ENOMEM` for ranges below `mmap_min_addr`, which nothing can map anyway. It
only needs glibc 2.2.5 symbols, so it loads on Lambda's glibc 2.34. The real fix belongs upstream:
skip that check below `mmap_min_addr`.

## Benchmark

```sh
bun run bench                                   # 3 rounds × 10 cold, then 20 warm per function
bun run bench --rounds 5 --cold 20 --only BunCompile,Node24
```

Each round changes an environment variable on every function, which retires its warm execution
environments, and then sends the concurrent cold invocations. Numbers come from the `REPORT` line
Lambda returns with `LogType: Tail`, so they are Lambda's own:

- **Init** — Lambda's `Init Duration`: from starting the runtime until it first asks for an event.
  For the Bun variants that's exactly the executable's startup; for Node it includes the managed
  runtime.
- **In-process startup** — `performance.now()` when the handler module is evaluated.
- **Invoke / round trip** — Lambda's `Duration`, and what the client saw over the Invoke API.

Results land in `bench-results/` as Markdown and raw JSON. The
[Deploy and benchmark](.github/workflows/bench.yml) workflow does all of it: `bun run build` on an
`ubuntu-24.04` and an `ubuntu-24.04-arm` runner, each for its own architecture, then one job that
deploys all 16 functions from those bundles and benchmarks them. It needs an `AWS_ROLE_ARN` secret
for GitHub OIDC.

## Scheduled runs, like lambda-perf

The stack also runs the benchmark on its own, the way
[maxday/lambda-perf](https://github.com/maxday/lambda-perf) does, and keeps every result:

- **`PerfRun`**, a Step Functions state machine, maps over the deployed functions,
  `PERF_CONCURRENCY` at a time, and gives each `PERF_ROUNDS` cold starts, one after another. A
  function that keeps failing is skipped, not the whole run. At the end, it writes the run to
  DynamoDB itself.
- **`PerfMeasure`** ([`src/perf/measure.ts`](src/perf/measure.ts)) does one round: changes the
  function's configuration so its warm environments retire, invokes it with `LogType: Tail`, and
  stores the `REPORT` numbers. An invocation without an `Init Duration` throws, so Step Functions
  retries it.
- **`PerfResults`**, a DynamoDB table: one item per cold start under `run#<runId>`, one per
  finished run under `runs` ([`src/perf/keys.ts`](src/perf/keys.ts)). A run's id is its
  execution's start time.
- **`PerfApi`** ([`src/perf/api.ts`](src/perf/api.ts)), a Function URL: `GET /runs`,
  `GET /runs/history?limit=90`, `GET /runs/latest`, `GET /runs/<runId>`, all but the first with
  per-function p50/p90/avg/min/max of the cold starts' init and in-process startup, and of the
  warm invocations' duration. Percentiles interpolate between samples, so p90 of ten cold starts
  isn't simply the slowest.
- **`PerfSite`**, a React and Tailwind page in [`web/`](web/), bundled by Bun, that charts the
  last 14, 30 or 90 days of runs per architecture and tables their means, or a hovered run.

The site is at `coldstarts.github.nimmervoll.work` in production and at
`<stage>.coldstarts.github.nimmervoll.work` on every other stage, e.g. `dev.coldstarts…`.

In production, the state machine runs every day at 11:00 UTC; on other stages, start it by hand:

```sh
bun run perf --stage dev            # starts a run and waits for it
bun run perf --stage dev --detach   # just starts it
```

[`scripts/perf-run.ts`](scripts/perf-run.ts) runs itself under `sst shell` to find the state
machine, and prints the execution's console link.

| Variable | Default | |
|---|---|---|
| `PERF_ROUNDS` | `10` | Cold starts per function and run |
| `PERF_CONCURRENCY` | `4` | Functions measured at once; each holds two of the account's concurrent executions |
| `PERF_SCHEDULE` | `cron(0 11 * * ? *)` in production, none elsewhere | An EventBridge Scheduler expression |

To work on the site against a deployed API:
`cd web && BUN_PUBLIC_API_URL="$(jq -r '.perf.api' ../.sst/outputs.json)" bun run dev`.

## Try it locally

```sh
bun run build:local                 # builds the Bun variants into dist/<arch>/ and smoke-tests them
bun test                            # runtime loop against a fake Runtime API
```

`build:local` starts every `bootstrap` against a fake Runtime API, so a broken bundle shows up
before a deploy.

## Notes

- `nodejs26.x` needs the AWS provider pinned to 7.52.0 in `sst.config.ts`; the 7.20.0 that SST
  4.17.2 ships with rejects it. SST's own types stop at `nodejs24.x`, hence the cast in
  [`infra/functions.ts`](infra/functions.ts).
- All functions set `dev: false`: `sst dev` would route them to your machine.
- `BunCompileTrim` is `BunCompile` plus `--trim`, so the pair isolates what trimming does
  without AOT. Whether `--trim` combines with `--bytecode` and a cross-compile `--target` is
  untested; a failed build stops the deploy with Bun's error.
- The compiled Bun variants are ~100 MB unzipped, against a few KB for Node. Lambda fetches that
  on every cold start, which is visible in the round trip even when init is fast.
