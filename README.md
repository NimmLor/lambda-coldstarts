# lambda-coldstarts

One SST stack, eleven Lambdas that do the same thing on different runtimes, and a script that
measures their cold and warm starts:

| Function            | Runtime                       | What ships                                                                                         |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `BunRuntime`        | `provided.al2023`             | `bun` executable + bundled `index.js`, started by a shell `bootstrap`                              |
| `BunCompile`        | `provided.al2023`             | `bun build --compile --minify --bytecode` executable as `bootstrap`                                |
| `BunCompileCanary`  | `provided.al2023`             | the same executable, built by the Bun build that `--trim` and `--aot` need                         |
| `BunCompileTrim`    | `provided.al2023`             | `BunCompileCanary` with `--trim`, which drops the parts of Bun the code doesn't use                |
| `BunCompileAot`     | `provided.al2023`             | `bun build --compile --aot` executable, behind a `bootstrap` that preloads the AOT shim            |
| `BunCompileAotTrim` | `provided.al2023`             | same with `--aot --trim`                                                                           |
| `Llrt`              | `provided.al2023`             | [LLRT](https://github.com/awslabs/llrt)'s no-sdk Lambda build as `bootstrap` + bundled `index.mjs` |
| `LlrtBytecode`      | `provided.al2023`             | the bundle as `llrt compile` bytecode, `index.lrt`, with LLRT's CLI build as `bootstrap`           |
| `Node22`            | `nodejs22.x`                  | SST's esbuild bundle                                                                               |
| `Node24`            | `nodejs24.x`                  | SST's esbuild bundle                                                                               |
| `Node26`            | `nodejs26.x` (public preview) | SST's esbuild bundle                                                                               |

Every function runs the same handler ([`src/report.ts`](src/report.ts)), has the same architecture
and timeout, and gets a public Function URL. Each one is deployed at 128, 256, 512, 1024 and
1769 MB (one full vCPU), as `BunCompileM128` and so on. The Bun
variants serve invocations through a small custom runtime loop ([`src/runtime.ts`](src/runtime.ts));
LLRT has its own and calls the handler in [`src/llrt.ts`](src/llrt.ts); the Node variants use
Lambda's managed runtime.

## Deploy

```sh
bun install
cp .env.example .env   # then fill in AWS_PROFILE or access keys
bun run deploy --stage dev   # every function on x86_64 and arm64, Bun and LLRT variants built in Docker
curl "$(jq -r '.functions.BunCompileX64.url' .sst/outputs.json)"
```

`bun run deploy` is `bun run build` (see [Both architectures](#both-architectures-built-in-docker))
and then `sst deploy` with `LAMBDA_ARCH=x86_64,arm64 BUN_BUNDLES=dist`; `bun run just-deploy` is
that deploy alone, from the bundles already in `dist/`. A plain `bunx sst deploy` builds on the
host instead, for its architecture only, and replaces the functions of the other.
`bun run remove --stage dev` tears a stage down; production's resources are retained.

Settings, all through the environment of `sst deploy`:

| Variable        | Default                 |                                                                                                                                                                            |
| --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LAMBDA_ARCH`   | build host's            | `x86_64`, `arm64` or `x86_64,arm64`. The `--aot` variants only build on the host when it matches; with two, see [Both architectures](#both-architectures-built-in-docker). |
| `LAMBDA_MEMORY` | `128,256,512,1024,1769` | MB; every variant is deployed once per size, its id ending in `M<MB>` when there is more than one                                                                          |
| `VARIANTS`      | all                     | e.g. `BunCompile,Node24`                                                                                                                                                   |
| `BUN_BIN`       | `bun`                   | Bun for `BunRuntime` and `BunCompile`                                                                                                                                      |
| `BUN_AOT_BIN`   | `$BUN_BIN`              | Bun for `BunCompileCanary` and the `--trim` and `--aot` variants                                                                                                           |
| `CC`            | `cc`                    | C compiler for the AOT shim                                                                                                                                                |
| `BUN_BUNDLES`   | unset                   | Deploy the Bun and LLRT variants from `$BUN_BUNDLES/<arch>/<Variant>` instead of building them                                                                             |

## Both architectures, built in Docker

```sh
bun run build                # every Bun variant for x86_64 and arm64, into dist/<arch>/<Variant>
bun run deploy --stage dev   # bun run build, then deploys all 110 functions
```

`bun run build` is [`scripts/build-docker.ts`](scripts/build-docker.ts). The Node variants need
no build of their own: SST bundles them during the deploy. `deploy` deploys with
`LAMBDA_ARCH=x86_64,arm64 BUN_BUNDLES=dist`. With more than one architecture, every function's
name ends in it: `BunCompileX64`, `BunCompileArm64`, `Node24Arm64`, and then in its memory size:
`BunCompileArm64M128`.

Each architecture builds in an Amazon Linux 2023 container of that architecture, which is
Lambda's `provided.al2023` OS. So `--aot` compiles natively, and the smoke test from
`build:local` runs against the glibc Lambda has. The container image installs released Bun
1.4.4 and the latest canary for its architecture, checksums verified
([`infra/build-image.sh`](infra/build-image.sh)), and is cached until that script changes. So
locally the canary stays the one from when the image was made; to pick up a newer one, remove the
image with `docker rmi $(docker images -q lambda-coldstarts-build)`. CI makes a new image every run.
`bun run build --arch arm64 BunCompileAot` builds just some of them.

The architecture the host isn't runs under QEMU, which Docker Desktop brings along. A Docker
Engine on Linux (WSL included) needs it registered once per boot:

```sh
docker run --privileged --rm tonistiigi/binfmt --install arm64   # amd64 on an arm64 host
```

Under QEMU, arm64 builds emulate a Neoverse N1, the core of Lambda's Graviton2, so nothing that
tunes code to the build CPU uses features Lambda lacks. Expect the emulated build to take
minutes rather than seconds.

## `--aot` and `--trim` are only in canary builds

`--aot` and `--trim` landed on Bun's `main` with
[oven-sh/bun#45631](https://github.com/oven-sh/bun/pull/45631), after the 1.4.4 release, so for
now only [canary builds](https://github.com/oven-sh/bun/releases/tag/canary) have them. Released
Bun **accepts unknown flags silently**, so `--compile --aot` on Bun 1.4.4 quietly builds a plain
executable. The build therefore checks that `bun build --help` lists every flag a variant needs
and skips that function with a warning otherwise, instead of deploying something mislabelled.

To build them, point `BUN_AOT_BIN` at a canary. `BunCompileTrim` builds on any host; the two
`--aot` variants need **Linux on the Lambda architecture**, because `--aot` can't cross-compile.

### Installing the canary

The canary is rebuilt from every push to `main`, which replaces its files, so there's no fixed
version to pin. This installs the current one next to your normal Bun, without replacing it as
`bun upgrade --canary` would (`bun-linux-aarch64` on Linux arm64). The canary's `SHASUMS256.txt`
isn't rewritten with each canary, so it checks the zip against the digest GitHub reports for it:

```sh
mkdir -p ~/.bun-aot && cd ~/.bun-aot
curl -fsSLO https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip
curl -fsSL https://api.github.com/repos/oven-sh/bun/releases/tags/canary |
  jq -r '.assets[] | select(.name == "bun-linux-x64.zip") | .digest | ltrimstr("sha256:") + "  bun-linux-x64.zip"' |
  sha256sum -c
unzip -o bun-linux-x64.zip
~/.bun-aot/bun-linux-x64/bun --revision   # 1.4.4-canary.1+<commit>
```

A download while a push is replacing the files 404s or fails the checksum; try again a few minutes
later. Then deploy with it. Only `BunCompileCanary` and the `--trim` and `--aot` variants use
`BUN_AOT_BIN`; installs and the other variants stay on your normal Bun:

```sh
BUN_AOT_BIN=~/.bun-aot/bun-linux-x64/bun bunx sst deploy --stage dev
```

The deploy also needs a C compiler (`cc`, or set `$CC`) for the AOT shim. `sst deploy`
prints `Skipping <Variant>: …` with the reason for every variant it can't build.

**macOS.** Install `bun-darwin-aarch64.zip` the same way. A Mac can build `BunCompileTrim` but not
the `--aot` variants, since `--aot` only builds for the machine it runs on; use `bun run build` in
Docker, or the [Deploy and benchmark](.github/workflows/bench.yml) workflow, which builds on native
x86_64 and arm64 runners.

To see which of the handler's code `--aot` compiled to a slow path, worst first:

```sh
bun run explain                     # the host's architecture, in the build container
bun run explain --arch arm64 trim   # or another report: json, guards, guards-json, trim, missed-optimizations, allocations
```

### Why the AOT shim

AOT executables start by reserving the lowest pages of the address space and then call
`mincore()` on page 0, expecting `ENOMEM` as proof it's unmapped. Lambda's seccomp filter makes
`mincore` fail with `EPERM` instead, so the loader exits during init:

> error: can't run this executable's compiled code: it needs the lowest pages of the address space to be unmapped, and this system maps them

[`infra/aot-shim.c`](infra/aot-shim.c) is `LD_PRELOAD`ed by the AOT `bootstrap` and
rewrites `EPERM` to `ENOMEM` for ranges below `mmap_min_addr`, which nothing can map anyway. It
only needs glibc 2.2.5 symbols, so it loads on Lambda's glibc 2.34. The real fix belongs upstream:
skip that check below `mmap_min_addr`.

### Why the shim also wraps `mmap`

Once at startup, the AOT runtime maps a 256 MB table without `MAP_NORESERVE` and calls `abort()`
when that fails. At 128 MB, Lambda's microVM has less RAM than that, so the kernel's overcommit
check refuses the mapping, although the table's pages only take memory once they're used. Every
128 MB AOT function then crashed during init:

> panic(main thread): abort() called

`--compile` without `--aot` makes no such mapping. The shim adds `MAP_NORESERVE` to private,
writable, anonymous mappings of 128 MB or more, the smallest Lambda's whole memory, so the table
becomes a reservation like JSC's other large regions. The real fix belongs upstream too: map that
table with `MAP_NORESERVE`.

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
deploys all 110 functions from those bundles and benchmarks them. That job runs in the `bench`
GitHub environment and assumes an AWS role through GitHub OIDC. `bun run bootstrap:aws`, with
admin credentials for the account and a logged-in `gh`, sets it up and is safe to re-run
([`scripts/bootstrap-aws.ts`](scripts/bootstrap-aws.ts)): the account's GitHub OIDC provider, the
role `lambda-coldstarts-github` that only the `bench` and `production` environments of
`<owner>/<repo>` may assume, with an inline policy for the services the stack uses, and both
environments with the role's ARN as their `AWS_ROLE_ARN` secret.

Every pull request runs [CI](.github/workflows/ci.yml): the checks and the same two native builds.
Every push to main runs [Deploy](.github/workflows/deploy.yml): the checks, the same two builds,
then `sst deploy --stage production` from those bundles in the `production` environment.
A `PERF_ADMIN_SECRET` secret on that environment turns on PerfApi's admin routes.

## Scheduled runs, like lambda-perf

The stack also runs the benchmark on its own, the way
[maxday/lambda-perf](https://github.com/maxday/lambda-perf) does, and keeps every result:

- **`PerfRun`**, a Step Functions state machine, maps over every deployed function in parallel
  and gives each `PERF_ROUNDS` rounds, one after another. A function that keeps failing is
  skipped, not the whole run. At the end, it writes the run to DynamoDB itself.
- **`PerfMeasure`** ([`src/perf/measure.ts`](src/perf/measure.ts)) does one round: changes the
  function's configuration so its warm environments retire, invokes it with `LogType: Tail`, then
  invokes it `PERF_WARM` more times in a row, which find the environment warm, and stores the
  `REPORT` numbers: `Init Duration` of the cold start, `Duration` of each warm invocation. A first
  invocation without an `Init Duration` throws, so Step Functions retries the round.
- **`PerfSummarize`** ([`src/perf/summarize.ts`](src/perf/summarize.ts)), the run's last step,
  computes its per-function statistics once and stores them with the run.
- **`PerfResults`**, a DynamoDB table: one item per round under `run#<runId>`, one per
  finished run under `runs`, and one per summary under `summaries`
  ([`src/perf/keys.ts`](src/perf/keys.ts)). A run's id is its execution's start time.
- **`PerfApi`** ([`src/perf/api.ts`](src/perf/api.ts)), served under the site's `/api`: `GET /runs`,
  `GET /runs/history?limit=` (30 by default, at most 90), `GET /runs/latest`, `GET /runs/<runId>`,
  all but the first with per-function p50/p90/avg/min/max of the cold starts' init and in-process
  startup, and of the warm invocations' duration. Percentiles interpolate between samples, so p90
  of ten cold starts isn't simply the slowest.
- **`PerfSite`**, a React and Tailwind page in [`web/`](web/), bundled by Bun
  ([`web/build.ts`](web/build.ts)). It opens with at-a-glance panels that compare LLRT, Bun AOT
  trimmed and Node.js 24 on arm64 at 256 MB over the last 3 days, then charts the last 14, 30 or
  90 days of runs per architecture and memory size (cold start, warm start, memory used,
  duration, and cold start by memory size), and tables their means, or a hovered run. The imprint
  and privacy policy are pages of their own.
- **`PerfRouter`**, the CloudFront distribution in front of both: `/api/*` goes to PerfApi's
  Function URL without the `/api`, everything else to PerfSite. On every stage but production it
  answers `/robots.txt` with `Disallow: /` and adds `X-Robots-Tag: noindex, nofollow` to every
  response; production serves [`web/robots.txt`](web/robots.txt) and
  [`web/sitemap.xml`](web/sitemap.xml).

The site is at `coldstarts.github.nimmervoll.work` in production and at
`<stage>.coldstarts.github.nimmervoll.work` on every other stage, e.g. `dev.coldstarts…`.

The state machine runs every hour on every stage (the admin routes below pause and resume that);
to start a run in between:

```sh
bun run perf --stage dev            # starts a run and waits for it
bun run perf --stage dev --detach   # just starts it
```

[`scripts/perf-run.ts`](scripts/perf-run.ts) runs itself under `sst shell` to find the state
machine, and prints the execution's console link.

Runs recorded before PerfSummarize existed have no summary, so the site leaves them out until
[`scripts/perf-summarize.ts`](scripts/perf-summarize.ts) summarizes them:

```sh
bun scripts/perf-summarize.ts --stage production         # the runs without a summary
bun scripts/perf-summarize.ts --stage production --all   # every run again, e.g. after summary.ts changed
```

With `PERF_ADMIN_SECRET` set at deploy time, PerfApi also takes these `POST`s under the secret,
which 404 like any unknown path without it:

```sh
curl -X POST https://dev.coldstarts.github.nimmervoll.work/api/admin/$PERF_ADMIN_SECRET/run     # starts a run
curl -X POST https://dev.coldstarts.github.nimmervoll.work/api/admin/$PERF_ADMIN_SECRET/pause   # stops the hourly runs
curl -X POST https://dev.coldstarts.github.nimmervoll.work/api/admin/$PERF_ADMIN_SECRET/resume  # starts them again
curl -X POST https://dev.coldstarts.github.nimmervoll.work/api/admin/$PERF_ADMIN_SECRET/purge   # empties PerfResults
```

`purge` stops after about 15 s to stay under CloudFront's origin timeout and answers
`{ "deleted": …, "done": false }` while items are left; call it again until `done` is `true`.
`pause` and `resume` answer `{ "state": "DISABLED" | "ENABLED", "was": … }`. A deploy that has
to update the schedule for another reason sets it back to `ENABLED`; any other deploy leaves its
state alone. The site's unlinked, `noindex` `/admin` page ([`web/admin.html`](web/admin.html))
does all of them from a secret field and a button each, repeating `purge` until it's done.

| Variable            | Default |                                                                             |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `PERF_ROUNDS`       | `10`    | Cold starts per function and run                                            |
| `PERF_WARM`         | `5`     | Warm invocations after each cold start                                      |
| `PERF_ADMIN_SECRET` | unset   | Path segment that turns on PerfApi's admin routes; URL-safe characters only |

To work on the site against a deployed API, [`web/dev.ts`](web/dev.ts) forwards `/api/*` to it:
`cd web && PERF_API_URL="$(jq -r '.perf.api' ../.sst/outputs.json)" bun run dev`.

The social preview, [`web/og.png`](web/og.png), is committed. After changing
[`web/og.html`](web/og.html), render it again with headless Chrome: `cd web && bun run og`
(`CHROME` names the binary, `google-chrome` by default).

## Try it locally

```sh
bun run build:local                 # builds the Bun and LLRT variants into dist/<arch>/ and smoke-tests them
bun test                            # runtime loop against a fake Runtime API, REPORT parsing, summaries
```

`build:local` starts every `bootstrap` against a fake Runtime API, so a broken bundle shows up
before a deploy.

The checks CI runs, which need a Bun canary for `bun lint` and `bunx sst install` once for the
types in `.sst/platform`:

```sh
bun run typecheck   # bun check, for the root and web/
bun lint --max-warnings 0
bun fmt --check
bun test
```

## Notes

- `nodejs26.x` needs the AWS provider pinned to 7.52.0 in `sst.config.ts`; the 7.20.0 that SST
  4.17.2 ships with rejects it. SST's own types stop at `nodejs24.x`, hence the cast in
  [`infra/functions.ts`](infra/functions.ts).
- All functions set `dev: false`: `sst dev` would route them to your machine.
- `BunCompileCanary` is `BunCompile` built by the canary instead of a release. Compare the
  `--trim` and `--aot` variants with it, not with `BunCompile`, or the difference includes what
  that Bun build changes. `BunCompileTrim` is `BunCompileCanary` plus `--trim`, so that pair
  isolates what trimming does without AOT. Whether `--trim` combines with `--bytecode` and a
  cross-compile `--target` is untested; a failed build stops the deploy with Bun's error.
- The compiled Bun variants are ~100 MB unzipped, against a few KB for Node. Lambda fetches that
  on every cold start, which is visible in the round trip even when init is fast.
- The LLRT variants use the pinned release in [`infra/llrt.ts`](infra/llrt.ts), downloaded and
  checked against its hashes, in its no-sdk builds: the default ones bundle AWS SDK clients and
  open TLS connections to AWS during init, which the handler doesn't need. LLRT lacks
  `process.memoryUsage`, `process.resourceUsage`, `process.execPath` and
  `navigator.hardwareConcurrency`, which [`src/llrt-env.ts`](src/llrt-env.ts) fills in from
  `/proc/self/status`, QuickJS's heap and `os.availableParallelism()`. Its `performance.now()`
  counts from when it starts QuickJS rather than from process start.
- `LlrtBytecode` doesn't run on LLRT's Lambda build: `.lrt` bytecode is compressed with a zstd
  dictionary built into the executable, the release's Lambda build has another than the CLI build
  that compiles it, and the Lambda build can't compile. So it ships the CLI build, 14 MB against
  5.5 MB, which also serves invocations. `Llrt` against `LlrtBytecode` therefore compares the
  executables as well as the bytecode. It builds on Linux on the Lambda architecture only, like
  `--aot`.
