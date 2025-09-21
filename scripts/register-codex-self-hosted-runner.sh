#!/usr/bin/env bash
set -euo pipefail

# Registers or reconfigures a repository-scoped self-hosted runner for
# DrJLabs/codex-completions-api with the labels our workflows expect.
# Requirements:
#   - gh CLI authenticated with access to the repo (scope: repo)
#   - curl, jq, tar
#   - sudo privileges (for systemd service install and overrides)
#   - network egress to GitHub endpoints (see docs)

REPO_SLUG=${REPO_SLUG:-"DrJLabs/codex-completions-api"}
RUNNER_NAME=${RUNNER_NAME:-"codex-keploy-ci-01"}
RUNNER_ROOT=${RUNNER_ROOT:-"/home/drj/runners"}
RUNNER_DIR="${RUNNER_ROOT}/${RUNNER_NAME}"
LABELS=${LABELS:-"self-hosted,linux,x64,keploy,ci"}

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [ ! -x ./config.sh ]; then
  echo "Runner binaries not found; downloading latest release..."
  API_URL="https://api.github.com/repos/actions/runner/releases/latest"
  TARBALL_URL=$(curl -fsSL "${API_URL}" | jq -r '.assets[] | select(.name|test("linux-x64.*.tar.gz$")) | .browser_download_url')
  curl -fsSL -o actions-runner.tar.gz "${TARBALL_URL}"
  tar xzf actions-runner.tar.gz
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required but not found in PATH" >&2
  exit 1
fi

echo "Requesting registration token for ${REPO_SLUG}..."
TOKEN=$(gh api -X POST "repos/${REPO_SLUG}/actions/runners/registration-token" -q .token)

if [ -f .service ]; then
  echo "Stopping existing runner service..."
  sudo ./svc.sh stop || true
fi

echo "Configuring runner ${RUNNER_NAME} with labels: ${LABELS}"
./config.sh --unattended \
  --url "https://github.com/${REPO_SLUG}" \
  --token "${TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${LABELS}" \
  --replace \
  --disableupdate

echo "Installing runner as a systemd service..."
sudo ./svc.sh install

SERVICE_NAME=$(cat .service)

# Apply systemd overrides so Keploy can lock memory for eBPF (CAP_IPC_LOCK)
# and bind to privileged ports if we need to expose the proxy locally.
echo "Configuring systemd overrides for ${SERVICE_NAME}"
sudo mkdir -p "/etc/systemd/system/${SERVICE_NAME}.d"
cat <<'OVERRIDE' | sudo tee "/etc/systemd/system/${SERVICE_NAME}.d/override.conf" >/dev/null
[Service]
LimitMEMLOCK=infinity
CapabilityBoundingSet=CAP_IPC_LOCK CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_IPC_LOCK CAP_NET_BIND_SERVICE
NoNewPrivileges=false
OVERRIDE

sudo systemctl daemon-reload
sudo systemctl restart "${SERVICE_NAME}"

echo "Runner service ${SERVICE_NAME} is active. Current status:"
systemctl --no-pager --lines=20 status "${SERVICE_NAME}"

echo "Self-hosted runner ${RUNNER_NAME} ready at ${RUNNER_DIR}."
echo "Labels: ${LABELS}"
