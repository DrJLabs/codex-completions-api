#!/usr/bin/env bash
set -euo pipefail

# Deprecated: the canonical deployment path is docker-compose with Traefik.
# This installer was archived to docs/_archive/install.sh for reference only.
# Refuse to run to avoid drifting from the supported deployment model.

echo "[codex-proxy] scripts/install.sh is deprecated. Use docker-compose.yml; the legacy installer is archived internally." >&2
exit 1
