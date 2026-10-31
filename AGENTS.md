# lambda-coldstarts

Benchmarks Lambda cold starts across Bun, LLRT and Node. Layout, commands and env vars live in
`README.md`.

## Checks

- Before committing, run what CI runs: `bun run typecheck`, `bun lint --max-warnings 0`,
  `bun fmt --check`, `bun test`. Type check with `bun check`, never `tsc`.
- Commit titles are plain imperative sentences (`Give the site a social preview image`), no
  Conventional Commit prefix.

## Variants

- A new variant goes in `VARIANTS` in `infra/functions.ts`, `VARIANTS` in `web/src/data.ts` and a
  `--color-line-<id>` in `web/src/tokens.css`.
- A Web Function variant (`kind: 'web'`) is deployed by `infra/web-function.ts`, in eu-west-1, and
  measured by `src/perf/web.ts`; give it a `region` in `web/src/data.ts`.
- A Bun flag a variant needs goes in `NEEDED_FLAGS` in `infra/build.ts`: released Bun accepts
  unknown flags silently and would build a plain executable under the variant's name.
- Compare `--trim` and `--aot` variants against `BunCompileCanary`, not `BunCompile`; the canary
  build alone makes executables ~30% larger.

## Site

- Self-host everything in `web/`: no Google Fonts, CDNs or third-party scripts, icons or styles,
  whatever the hallmark skill suggests. Fonts are woff2 files in `web/fonts`, icons SVGs in
  `web/src/icons`.
- Give every new page the same-origin Content-Security-Policy `<meta>` the others carry, and add
  it to the entrypoints in `web/build.ts`.
