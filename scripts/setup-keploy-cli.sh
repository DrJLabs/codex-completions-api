#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL=${KEPLOY_INSTALL_URL:-https://keploy.io/install.sh}
BIN_NAME=${KEPLOY_BIN:-keploy}
RECORD_PORT=${KEPLOY_RECORD_PORT:-16789}
TEST_PORT=${KEPLOY_TEST_PORT:-16790}
DNS_PORT=${KEPLOY_DNS_PORT:-26789}
HOST_BIND=${KEPLOY_HOST_BIND:-127.0.0.1}
KEPLOY_HOME=${KEPLOY_HOME:-"$HOME/.keploy"}

log() {
  printf '[keploy-setup] %s\n' "$*"
}

die() {
  printf '[keploy-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required"
}

need_cmd curl
if command -v ss >/dev/null 2>&1; then
  ensure_port_free() {
    local port=$1
    if ss -Htnl "sport = :$port" | grep -q .; then
      die "Port $port is already in use; adjust overrides before running"
    fi
  }
elif command -v lsof >/dev/null 2>&1; then
  ensure_port_free() {
    local port=$1
    if lsof -nPiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      die "Port $port is already in use; adjust overrides before running"
    fi
  }
else
  die "Neither 'ss' nor 'lsof' is available to validate port usage"
fi
need_cmd bash
need_cmd mktemp

log "ensuring required ports are free (record:$RECORD_PORT test:$TEST_PORT dns:$DNS_PORT)"
ensure_port_free "$RECORD_PORT"
ensure_port_free "$TEST_PORT"
ensure_port_free "$DNS_PORT"

log "using host bind $HOST_BIND"
export KEPLOY_HOST_BIND="$HOST_BIND"

if [ -d "$KEPLOY_HOME/bin" ]; then
  export PATH="$KEPLOY_HOME/bin:$PATH"
fi
if [ -d "$HOME/.local/bin" ]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log "downloading Keploy installer"
curl -fsSL "$INSTALL_URL" -o "$TMP_DIR/install.sh"
chmod +x "$TMP_DIR/install.sh"

log "running installer"
if ! bash "$TMP_DIR/install.sh" >/dev/null; then
  die "Keploy installer failed"
fi

if ! command -v "$BIN_NAME" >/dev/null 2>&1; then
  # try resolved path under ~/.keploy/bin when BIN_NAME is 'keploy'
  if [ "$BIN_NAME" = "keploy" ] && [ -x "$KEPLOY_HOME/bin/keploy" ]; then
    export PATH="$KEPLOY_HOME/bin:$PATH"
  else
    die "Keploy CLI ('$BIN_NAME') not found on PATH after installation"
  fi
fi

RESOLVED_BIN="$(command -v "$BIN_NAME")"
log "Keploy CLI located at $RESOLVED_BIN"

log "verifying CLI version"
"$RESOLVED_BIN" version

log "Keploy preflight complete"
