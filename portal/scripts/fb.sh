#!/usr/bin/env bash
# The portal's firebase command. Every npm script goes through this wrapper.
#
#  - It runs the firebase-tools version pinned in package.json, never a global install.
#  - METADATA_SERVER_DETECTION=none skips the probe for Google Cloud credentials. The emulators
#    need none.
#  - When an outbound proxy is configured, firebase-tools sends its own calls to the local
#    emulators through that proxy, where they fail. The preloaded shim sends loopback addresses
#    direct and leaves the proxy in place for every other host (see cli-loopback-direct.cjs).
#    On a machine without a proxy the shim is not loaded and this wrapper changes nothing.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export METADATA_SERVER_DETECTION="${METADATA_SERVER_DETECTION:-none}"
export FIREBASE_CLI_DISABLE_UPDATE_CHECK=1
PRELOAD=()
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}" ]; then
  PRELOAD=(--require "$ROOT/scripts/cli-loopback-direct.cjs")
fi
exec node ${PRELOAD[@]+"${PRELOAD[@]}"} "$ROOT/node_modules/firebase-tools/lib/bin/firebase.js" "$@"
