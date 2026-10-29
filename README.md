<div align="center">

<img src="web/og.png" alt="Bun vs LLRT vs Node.js cold starts on AWS Lambda" width="720">

# ⚡ lambda-coldstarts

**How fast do Bun, LLRT and Node.js cold-start on AWS Lambda?**<br>
110 real Lambdas, benchmarked every hour.

[🌐 Live results](https://coldstarts.github.nimmervoll.work) ·
[🚀 Deploy](#-deploy) ·
[⏱️ Benchmark](#%EF%B8%8F-benchmark) ·
[🕐 Scheduled runs](#-scheduled-runs) ·
[🛠️ Develop](#%EF%B8%8F-develop)

[![CI](https://github.com/NimmLor/lambda-coldstarts/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![Deploy](https://github.com/NimmLor/lambda-coldstarts/actions/workflows/deploy.yml/badge.svg)](.github/workflows/deploy.yml)

</div>

## 🤔 What's in the box

One SST stack. Every function runs the same handler ([`src/report.ts`](src/report.ts)) and gets a
public Function URL, on **x86_64 and arm64** at **128, 256, 512, 1024 and 1769 MB**:
11 variants × 2 architectures × 5 sizes = **110 functions**, named like `BunCompileArm64M128`.

|     | Variant                        | What ships                                                                           |
| --- | ------------------------------ | ------------------------------------------------------------------------------------ |
| 🥟  | `BunRuntime`                   | `bun` executable + bundled `index.js`, started by a shell `bootstrap`                |
| 🥟  | `BunCompile`                   | `bun build --compile --minify --bytecode` executable as `bootstrap`                  |
| 🥟  | `BunCompileCanary`             | the same, built by Bun canary: the baseline for `--trim` and `--aot`                 |
| 🥟  | `BunCompileTrim`               | `BunCompileCanary` + `--trim`, which drops the parts of Bun the code doesn't use     |
| 🥟  | `BunCompileAot`                | `--compile --aot`, behind a `bootstrap` that preloads the [AOT shim](#-the-aot-shim) |
| 🥟  | `BunCompileAotTrim`            | `--aot --trim`                                                                       |
| 🪶  | `Llrt`                         | [LLRT](https://github.com/awslabs/llrt)'s no-sdk Lambda build + bundled `index.mjs`  |
| 🪶  | `LlrtBytecode`                 | the bundle as `llrt compile` bytecode, run by LLRT's CLI build                       |
| 🟢  | `Node22` · `Node24` · `Node26` | SST's esbuild bundle on `nodejs22.x`, `nodejs24.x`, `nodejs26.x` (preview)           |

Bun and LLRT run on `provided.al2023`. Bun serves invocations through a small runtime loop
([`src/runtime.ts`](src/runtime.ts)), LLRT through its own ([`src/llrt.ts`](src/llrt.ts)), and Node
through Lambda's managed runtime.

## 🚀 Deploy

```sh
bun install
cp .env.example .env         # add AWS_PROFILE or access keys
bun run deploy --stage dev   # builds both architectures in Docker, deploys all 110 functions
bun run remove --stage dev   # tears it down again (production is retained)
```

- 🔁 `bun run just-deploy` deploys the bundles already in `dist/` without building them again.
- 🎯 `bun run build --arch arm64 BunCompileAot` builds only the variants you name, into `dist/<arch>/<Variant>`.
- 🐳 Builds run in Amazon Linux 2023 containers, Lambda's own OS, with Bun 1.4.4 and the latest
  canary ([`infra/build-image.sh`](infra/build-image.sh)). The image is cached until that script
  changes; `docker rmi $(docker images -q lambda-coldstarts-build)` picks up a newer canary.
- 🦾 The architecture your host doesn't have builds under QEMU. On Docker Engine (Linux, WSL), register
  it once per boot: `docker run --privileged --rm tonistiigi/binfmt --install arm64`
- ⚠️ A plain `bunx sst deploy` builds on the host, for its architecture only, and replaces the
  other architecture's functions.

| Variable        | Default                 | What it does                                                   |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| `LAMBDA_ARCH`   | the host's              | `x86_64`, `arm64` or `x86_64,arm64`                            |
| `LAMBDA_MEMORY` | `128,256,512,1024,1769` | Memory sizes in MB; one function per variant and size          |
| `VARIANTS`      | all                     | e.g. `BunCompile,Node24`                                       |
| `BUN_BIN`       | `bun`                   | Bun for `BunRuntime` and `BunCompile`                          |
| `BUN_AOT_BIN`   | `$BUN_BIN`              | Bun for `BunCompileCanary`, `--trim` and `--aot`               |
| `CC`            | `cc`                    | C compiler for the AOT shim                                    |
| `BUN_BUNDLES`   | unset                   | Deploy Bun/LLRT from `$BUN_BUNDLES/<arch>/<Variant>`, no build |

## 🧪 `--aot` and `--trim`

Both landed in [oven-sh/bun#45631](https://github.com/oven-sh/bun/pull/45631), after 1.4.4, so for
now only [canary builds](https://github.com/oven-sh/bun/releases/tag/canary) have them.

- 🙈 Released Bun **silently accepts unknown flags**, so the build checks `bun build --help` and
  skips a variant with `Skipping <Variant>: …` instead of deploying a mislabelled plain executable.
- 🐧 `--aot` can't cross-compile: it needs **Linux on the Lambda architecture**. On a Mac, use
  `bun run build` (Docker) or the [Deploy and benchmark](.github/workflows/bench.yml) workflow.
- 📏 Compare against `BunCompileCanary`, not `BunCompile`: canary executables are ~30% larger on
  their own.
- 🔍 `bun run explain [--arch arm64] [report]` lists the handler code `--aot` compiled to slow
  paths, worst first (reports: `json`, `guards`, `guards-json`, `trim`, `missed-optimizations`,
  `allocations`).

<details>
<summary>📦 Installing the canary next to your normal Bun</summary>

The canary's files are replaced on every push to `main`, so there's no version to pin. This
checks the zip against the digest GitHub reports (use `bun-linux-aarch64` on arm64,
`bun-darwin-aarch64` on a Mac):

```sh
mkdir -p ~/.bun-aot && cd ~/.bun-aot
curl -fsSLO https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip
curl -fsSL https://api.github.com/repos/oven-sh/bun/releases/tags/canary |
  jq -r '.assets[] | select(.name == "bun-linux-x64.zip") | .digest | ltrimstr("sha256:") + "  bun-linux-x64.zip"' |
  sha256sum -c
unzip -o bun-linux-x64.zip
~/.bun-aot/bun-linux-x64/bun --revision   # 1.4.4-canary.1+<commit>

BUN_AOT_BIN=~/.bun-aot/bun-linux-x64/bun bunx sst deploy --stage dev
```

A 404 or a failed checksum means a push is replacing the files; try again in a few minutes.

</details>

### 🩹 The AOT shim

[`infra/aot-shim.c`](infra/aot-shim.c) is `LD_PRELOAD`ed by the AOT `bootstrap` and works around
two things Lambda breaks. Both fixes belong upstream.

<details>
<summary>Why it's needed</summary>

1. **`mincore` → `EPERM`.** AOT executables check that page 0 is unmapped by calling `mincore()` and
   expecting `ENOMEM`. Lambda's seccomp filter returns `EPERM`, so the loader exits during init. The
   shim rewrites `EPERM` to `ENOMEM` below `mmap_min_addr`.
2. **A 256 MB `mmap` at 128 MB.** The AOT runtime maps a 256 MB table without `MAP_NORESERVE` and
   calls `abort()` when that fails, which it does in a 128 MB microVM. The shim adds
   `MAP_NORESERVE` to private, writable, anonymous mappings of 128 MB or more.

It only needs glibc 2.2.5 symbols, so it loads on Lambda's glibc 2.34.

</details>

## ⏱️ Benchmark

```sh
bun run bench                                                # 3 rounds × 10 cold, then 20 warm per function
bun run bench --rounds 5 --cold 20 --only BunCompile,Node24
```

Each round changes an environment variable on every function, which retires its warm environments,
then fires concurrent cold invocations. The numbers come from Lambda's own `REPORT` line:

- ❄️ **Init**: `Init Duration`, from runtime start until it first asks for an event
- 🏁 **In-process startup**: `performance.now()` when the handler module is evaluated
- 🔁 **Invoke / round trip**: Lambda's `Duration`, and what the client saw

Results land in `bench-results/` as Markdown and JSON.

## 🕐 Scheduled runs

The stack also benchmarks itself every hour, the way
[maxday/lambda-perf](https://github.com/maxday/lambda-perf) does, and keeps every result.

```mermaid
flowchart LR
  S[⏰ EventBridge Scheduler<br>every hour] --> R[PerfRun<br>Step Functions]
  R -- every function, in parallel --> M[PerfMeasure<br>PERF_ROUNDS × cold + PERF_WARM warm]
  M --> D[(PerfResults<br>DynamoDB)]
  R -- at the end --> Z[PerfSummarize] --> D
  D --> A[PerfApi]
  A -- /api/* --> C[☁️ PerfRouter<br>CloudFront]
  W[PerfSite<br>React + Tailwind] --> C
```

| Piece           | Source                                           | Job                                                                     |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `PerfMeasure`   | [`src/perf/measure.ts`](src/perf/measure.ts)     | One round: retire warm environments, one cold invoke, then warm invokes |
| `PerfSummarize` | [`src/perf/summarize.ts`](src/perf/summarize.ts) | Per-function p50/p90/avg/min/max, stored with the run                   |
| `PerfApi`       | [`src/perf/api.ts`](src/perf/api.ts)             | `GET /runs/history`: the latest 90 runs, the one request the site makes |
| `PerfSite`      | [`web/`](web/)                                   | The charts at [coldstarts.github.nimmervoll.work][site]                 |

Other stages live at `<stage>.coldstarts.github.nimmervoll.work` and tell search engines to stay
away.

```sh
bun run perf --stage dev [--detach]                    # start a run now (and wait for it)
bun scripts/perf-summarize.ts --stage production [--all]   # summarize runs that have no summary yet
```

| Variable                | Default |                                                                                     |
| ----------------------- | ------- | ----------------------------------------------------------------------------------- |
| `PERF_ROUNDS`           | `10`    | Cold starts per function and run                                                    |
| `PERF_WARM`             | `5`     | Warm invocations after each cold start                                              |
| `PERF_ADMIN_SECRET`     | unset   | Turns on the admin routes (URL-safe characters only)                                |
| `POSTHOG_PROJECT_TOKEN` | unset   | Turns on the site's PostHog analytics, sent through `/ingest` to PostHog's EU cloud |

<details>
<summary>🔐 Admin routes</summary>

With `PERF_ADMIN_SECRET` set, PerfApi takes `POST /api/admin/$PERF_ADMIN_SECRET/<action>`.
Without it, these paths 404. The unlinked `/admin` page ([`web/admin.html`](web/admin.html)) has a
button for each. PerfApi only answers through PerfRouter, whose Origin Access Control needs the
body's hash on a POST: `curl` one with
`-H 'x-amz-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'`.

| Action   | Does                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| `run`    | Starts a run                                                                        |
| `pause`  | Stops the hourly runs; a deploy that updates the schedule turns them back on        |
| `resume` | Starts the hourly runs again                                                        |
| `purge`  | Empties PerfResults, ~15 s at a time; call it again until it answers `"done": true` |

</details>

## 🤖 CI/CD

- ✅ **Pull requests** run [CI](.github/workflows/ci.yml): the checks plus native x86_64 and arm64 builds.
- 🚢 **Pushes to `main`** run [Deploy](.github/workflows/deploy.yml): the same, then
  `sst deploy --stage production`.
- 📊 **[Deploy and benchmark](.github/workflows/bench.yml)** (manual) builds on native runners, deploys
  every function and benchmarks them.
- 🔑 AWS access goes through GitHub OIDC. `bun run bootstrap:aws` sets up the provider, the role and
  the `bench` and `production` environments, and is safe to re-run
  ([`scripts/bootstrap-aws.ts`](scripts/bootstrap-aws.ts)).

## 🛠️ Develop

```sh
bun run build:local   # build Bun + LLRT for this host and smoke-test every bootstrap against a fake Runtime API
bun run typecheck     # the same checks CI runs ↓
bun lint --max-warnings 0
bun fmt --check
bun test
```

`bun lint` needs a Bun canary, and the types need `bunx sst install` once.

- 🖥️ **Site against a deployed API:**
  `cd web && PERF_API_URL="$(jq -r '.perf.api' ../.sst/outputs.json)" bun run dev`
- 🖼️ **Social preview:** after editing [`web/og.html`](web/og.html), run `cd web && bun run og`
  (headless Chrome; set `CHROME` to use another binary).

## 📝 Good to know

- 📦 Compiled Bun executables are ~100 MB against a few KB for Node. Lambda fetches them on every cold
  start, which shows up in the round trip even when init is fast.
- 🪶 LLRT is pinned in [`infra/llrt.ts`](infra/llrt.ts) and uses the no-sdk builds.
  [`src/llrt-env.ts`](src/llrt-env.ts) fills in the `process` and `navigator` APIs it lacks.
- 🧩 `LlrtBytecode` ships LLRT's CLI build (14 MB vs 5.5 MB), because only the CLI build reads
  bytecode the CLI compiled. Comparing it with `Llrt` therefore compares the executables as well.
  Like `--aot`, it only builds on Linux on the Lambda architecture.
- 📌 `nodejs26.x` needs the AWS provider pinned to 7.52.0 in [`sst.config.ts`](sst.config.ts).
- 🚫 Every function sets `dev: false`, since `sst dev` would route it to your machine.

[site]: https://coldstarts.github.nimmervoll.work
