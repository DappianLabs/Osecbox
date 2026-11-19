#!/usr/bin/env bash
# Install the repository-pinned Node.js runtime for WSL2 development.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
VERSION="$(tr -d '\r\n' < "$REPO_ROOT/.nvmrc")"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo "Unsupported WSL architecture: $ARCH" >&2; exit 1 ;;
esac

INSTALL_DIR="$HOME/.local/lib/node-v$VERSION"
NODE_BIN="$INSTALL_DIR/bin"
if [ ! -x "$NODE_BIN/node" ] || [ "$("$NODE_BIN/node" --version)" != "v$VERSION" ]; then
  BASE_URL="https://nodejs.org/dist/v$VERSION"
  ARCHIVE="node-v$VERSION-linux-$NODE_ARCH.tar.xz"
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT

  curl -fsSL "$BASE_URL/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
  curl -fL "$BASE_URL/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
  (cd "$TEMP_DIR" && grep -E " $ARCHIVE$" SHASUMS256.txt | sha256sum --check --status)

  mkdir -p "$INSTALL_DIR"
  tar -xJf "$TEMP_DIR/$ARCHIVE" -C "$INSTALL_DIR" --strip-components=1
fi

PATH_LINE="export PATH=\"\$HOME/.local/lib/node-v$VERSION/bin:\$HOME/go/bin:\$PATH\""
if ! grep -Fq "$PATH_LINE" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n%s\n' "$PATH_LINE" >> "$HOME/.bashrc"
fi

export PATH="$NODE_BIN:$HOME/go/bin:$PATH"
node --version
npm --version
echo "Node.js $VERSION is ready for this WSL2 checkout."
