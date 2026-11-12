#!/usr/bin/env bash
# Installs an UNMODIFIED EverShop next to EchoBench for the R1 measurement. EchoBench never edits it.
# EverShop is GPL-3.0; it is downloaded here, not copied into this repository.
# Not run by the build. Read targets/evershop/README.md first, then run it yourself.
set -euo pipefail

TARGET_DIR="${1:-$(pwd)/.evershop}"
if [ -e "$TARGET_DIR" ]; then
  echo "Refusing to overwrite $TARGET_DIR. Pick another folder or remove it yourself." >&2
  exit 1
fi

git clone --depth 1 https://github.com/evershopcommerce/evershop.git "$TARGET_DIR"
cd "$TARGET_DIR"
echo "Cloned $(git rev-parse HEAD). Write this commit id into the results."
echo "Next: follow targets/evershop/README.md (PostgreSQL, sandbox credentials, webhook id)."
