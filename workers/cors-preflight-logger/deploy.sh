#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${WORKER_CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "\033[31mERROR\033[0m: set WORKER_CLOUDFLARE_API_TOKEN before running deploy." >&2
  echo "Generate a token with Workers Scripts/Routes permissions and export it, e.g.:" >&2
  echo "  export WORKER_CLOUDFLARE_API_TOKEN=..." >&2
  exit 1
fi

CLOUDFLARE_API_TOKEN="$WORKER_CLOUDFLARE_API_TOKEN" wrangler deploy "$@"
