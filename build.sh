#!/bin/sh
# Builds both Lambda bundles in Lambda's own OS (Amazon Linux 2023, x86_64) with the latest Bun
# canary, since --aot compiles for the host it runs on:
#   out/Aot/bootstrap          the `bun build --compile --aot` executable itself
#   out/AotWithShim/bootstrap  a shell script that starts the same executable with aot-shim.so preloaded
set -eu

docker run --rm --platform linux/amd64 -v "$PWD:/work" -w /work -e OWNER="$(id -u):$(id -g)" \
  public.ecr.aws/amazonlinux/amazonlinux:2023 sh -euc '
    dnf install -y -q gcc unzip >/dev/null
    curl -fsSLO https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip
    unzip -oq bun-linux-x64.zip -d /opt && rm bun-linux-x64.zip
    bun=/opt/bun-linux-x64/bun
    $bun --revision

    rm -rf out && mkdir -p out/Aot out/AotWithShim
    $bun build index.ts --compile --aot --outfile out/Aot/bootstrap

    cp out/Aot/bootstrap out/AotWithShim/app
    gcc -shared -fPIC -O2 -o out/AotWithShim/aot-shim.so aot-shim.c
    printf "#!/bin/sh\nLD_PRELOAD=\"\${0%%/*}/aot-shim.so\" exec \"\${0%%/*}/app\"\n" > out/AotWithShim/bootstrap
    chmod +x out/AotWithShim/bootstrap

    $bun --revision > out/version
    chown -R "$OWNER" out
  '
