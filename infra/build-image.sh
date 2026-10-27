#!/bin/sh
# Sets up the container scripts/build-docker.ts builds the Bun variants in, on top of Lambda's own
# provided.al2023 OS: the released Bun as `bun`, and the build of oven-sh/bun#45631 as `bun-aot`
# (Buildkite build #133641, 1.4.4-canary.1+72ab4f530, artifacts expire around 2027-04-25).
# Runs as root in the container, with LAMBDA_ARCH set to x86_64 or arm64.
set -eu

BUN_VERSION=1.4.4

case "$LAMBDA_ARCH" in
  x86_64)
    name=bun-linux-x64
    aot_job=01a17d0b-2f8a-4994-b0d1-5aefc929366e/artifacts/01a17d12-dc53-4bb8-9856-d357395550f1
    aot_sha256=2bb09f3c5b9966dc5160ebc87e8bc981e7ea5dc6c511227943fb6065e06a7461
    ;;
  arm64)
    name=bun-linux-aarch64
    aot_job=01a17d0b-2f88-4810-9eb6-41b816096a80/artifacts/01a17d12-3998-4981-af33-6397c1d1b059
    aot_sha256=5628cba83e27f54719598c893f3c70f68e3352887ed9cbd987dd14d61162d4ae
    ;;
  *)
    echo "LAMBDA_ARCH must be x86_64 or arm64, not '$LAMBDA_ARCH'" >&2
    exit 1
    ;;
esac

dnf install -y gcc unzip
dnf clean all

cd /tmp
release="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
curl -fsSLO "$release/$name.zip"
curl -fsSL "$release/SHASUMS256.txt" | grep " $name.zip\$" | sha256sum -c
unzip -q "$name.zip"
install -m 755 "$name/bun" /usr/local/bin/bun
rm -rf "$name" "$name.zip"

curl -fsSL -o "$name.zip" "https://buildkite.com/organizations/bun/pipelines/bun/builds/133641/jobs/$aot_job"
echo "$aot_sha256  $name.zip" | sha256sum -c
unzip -q "$name.zip"
install -m 755 "$name/bun" /usr/local/bin/bun-aot
rm -rf "$name" "$name.zip"

# Fails here, not halfway through a build, when the image isn't the architecture it should be.
test "$(uname -m)" = "$(case "$LAMBDA_ARCH" in arm64) echo aarch64;; *) echo x86_64;; esac)"
bun --version
bun-aot --revision
