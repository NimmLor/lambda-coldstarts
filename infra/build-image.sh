#!/bin/sh
# Sets up the container scripts/build-docker.ts builds the Bun variants in, on top of Lambda's own
# provided.al2023 OS: the released Bun as `bun`, and the latest canary, the first Bun with `--aot`
# and `--trim`, as `bun-aot`. The canary is whatever `main` was when the image was made.
# Runs as root in the container, with LAMBDA_ARCH set to x86_64 or arm64.
set -eu

BUN_VERSION=1.4.4

case "$LAMBDA_ARCH" in
  x86_64) name=bun-linux-x64 ;;
  arm64) name=bun-linux-aarch64 ;;
  *)
    echo "LAMBDA_ARCH must be x86_64 or arm64, not '$LAMBDA_ARCH'" >&2
    exit 1
    ;;
esac

dnf install -y gcc jq unzip
dnf clean all

# Installs $name.zip as /usr/local/bin/$1 if its SHA-256 is $2.
# Chained with && because `set -e` doesn't reach into a function called as `install_zip || ...`.
install_zip() {
  echo "$2  $name.zip" | sha256sum -c &&
    unzip -oq "$name.zip" &&
    install -m 755 "$name/bun" "/usr/local/bin/$1" &&
    rm -rf "$name" "$name.zip"
}

# The canary's SHASUMS256.txt isn't rewritten with each canary, so check against the digest
# GitHub reports for the asset instead.
install_canary() {
  digest=$(curl -fsSL https://api.github.com/repos/oven-sh/bun/releases/tags/canary |
    jq -er --arg name "$name.zip" '.assets[] | select(.name == $name) | .digest | ltrimstr("sha256:")') &&
    curl -fsSLO "https://github.com/oven-sh/bun/releases/download/canary/$name.zip" &&
    install_zip bun-aot "$digest"
}

cd /tmp
release="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
curl -fsSLO "$release/$name.zip"
install_zip bun "$(curl -fsSL "$release/SHASUMS256.txt" | grep " $name.zip\$" | cut -d' ' -f1)"
# Each push to main replaces the canary's files one by one, and a download in between 404s or
# doesn't match its digest, so give the upload a few minutes to finish.
for attempt in 1 2 3 4 5; do
  install_canary && break
  test "$attempt" -lt 5
  echo "The canary is being replaced; trying again in a minute" >&2
  sleep 60
done

# Fails here, not halfway through a build, when the image isn't the architecture it should be.
test "$(uname -m)" = "$(case "$LAMBDA_ARCH" in arm64) echo aarch64;; *) echo x86_64;; esac)"
bun --version
bun-aot --revision
