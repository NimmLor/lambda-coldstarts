# `bun build --compile --aot` on AWS Lambda

A `--compile --aot` executable doesn't start on Lambda (`provided.al2023`), and starts once
[`aot-shim.c`](aot-shim.c) is `LD_PRELOAD`ed into it. Two functions, one handler
([`index.ts`](index.ts), a minimal Runtime API loop), both x86_64 at 128 MB:

| Function      | `bootstrap`                                               | Result                     |
| ------------- | --------------------------------------------------------- | -------------------------- |
| `Aot`         | the `--aot` executable itself                             | `Runtime.ExitError` (502)  |
| `AotWithShim` | `LD_PRELOAD=aot-shim.so exec ./app`, the same executable | `hello from bun <revision>` |

`Aot` exits during init:

```
error: can't run this executable's compiled code: it needs the lowest pages of the address space to be unmapped, and this system maps them
```

The shim works around two things:

1. **`mincore` → `EPERM`.** The AOT loader (`tryReserveLowPages`) calls `mincore()` on the pages
   below `mmap_min_addr` and expects `ENOMEM`. Lambda's seccomp filter fails `mincore` with `EPERM`,
   which the loader reads as "mapped". The shim turns that `EPERM` into `ENOMEM`.
2. **A 256 MB `mmap` at 128 MB.** At startup the AOT runtime maps a 256 MB table without
   `MAP_NORESERVE` and calls `abort()` when it fails, which it does in a 128 MB Lambda. The shim
   adds `MAP_NORESERVE` to private, writable, anonymous mappings of 128 MB or more.

## Run it

Needs Docker and AWS credentials.

```sh
bun install
./build.sh                         # builds out/Aot and out/AotWithShim in amazonlinux:2023 with the latest canary
bunx sst deploy --stage repro      # prints both Function URLs
curl <Aot url>; curl <AotWithShim url>
bunx sst remove --stage repro
```
