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
bunx sst deploy --stage dev
curl "$(jq -r '.functions.BunCompile.url' .sst/outputs.json)"
```

Settings, all through the environment of `sst deploy`:

| Variable | Default | |
|---|---|---|
| `LAMBDA_ARCH` | build host's | `x86_64` or `arm64`. The `--aot` variants only build when it matches the host. |
| `LAMBDA_MEMORY` | `1769` | MB, for every function |
| `VARIANTS` | all | e.g. `BunCompile,Node24` |
| `BUN_BIN` | `bun` | Bun for `BunRuntime` and `BunCompile` |
| `BUN_AOT_BIN` | `$BUN_BIN` | Bun for the `--trim` and `--aot` variants |
| `CC` | `cc` | C compiler for the mincore shim |

## `--aot` and `--trim` aren't released yet

`--aot` and `--trim` only exist on [oven-sh/bun#45631](https://github.com/oven-sh/bun/pull/45631),
which is still a draft. Released Bun **accepts unknown flags silently**, so `--compile --aot` on
Bun 1.4.4 quietly builds a plain executable. The build therefore checks that `bun build --help`
lists every flag a variant needs and skips that function with a warning otherwise, instead of
deploying something mislabelled.

To build them, point `BUN_AOT_BIN` at a build of that PR. `BunCompileTrim` builds anywhere; the
`--aot` variants need **Linux** on the Lambda architecture, since `--aot` can't cross-compile:

```sh
bunx bun-pr 45631                       # downloads it as ~/.bun/bin/bun-45631
BUN_AOT_BIN=~/.bun/bin/bun-45631 bunx sst deploy --stage dev
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
[Deploy and benchmark](.github/workflows/bench.yml) workflow does all of it from an x86_64 runner,
AOT build included; it needs an `AWS_ROLE_ARN` secret for GitHub OIDC.

## Try it locally

```sh
bun run build:local                 # builds the Bun variants into dist/ and smoke-tests them
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
