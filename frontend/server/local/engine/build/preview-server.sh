#!/usr/bin/env bash
# The preview server of the real builds (previewServer.ts): start | stop | status.
# Started detached (setsid nohup); its exact PID goes to engine-host/preview-server.pid and PREVIEW-SERVER.md.
# stop kills only that PID, and only when it still is this server.
set -euo pipefail
# links resolved (pwd -P): on the engine host the server runs on the files of the concrete release it started from, and
# its command line names that release (the install's prune keeps a release a process names)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/../../../../.." && pwd -P)"
HOST_DIR="${MF_ENGINE_HOST_DIR:-$(cd "$REPO/.." && pwd)/madp-factory-work/engine-host}"
PID_FILE="$HOST_DIR/preview-server.pid"
LOG="$HOST_DIR/preview-server.log"
MD="$HOST_DIR/PREVIEW-SERVER.md"
NODE="${NODE_BIN:-$(command -v node)}"
PORT="${MF_PREVIEW_PORT:-5321}"
ORIGIN="${MF_PREVIEW_ORIGIN:-https://dbsaun.slsblx.com:$PORT}"
SERVER="$HERE/previewServer.ts"

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid; pid="$(cat "$PID_FILE")"
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "previewServer.ts" && echo "$pid"
}

healthy() { curl -sk --max-time 2 "https://127.0.0.1:$PORT/_health" 2>/dev/null | grep -q '^ok$'; }

write_md() {
  cat > "$MD" <<EOF
# Preview server (real builds)

Serves every real build of MADP Factory over HTTPS: \`$ORIGIN/<projectId>/\` (latest published build),
\`/<projectId>/v/<version>/\` (milestone previews and releases), \`/<projectId>/stage/\`, \`/<projectId>/production/\`.
Files: \`\$MF_ENGINE_ROOT/projects/<workspaceId>/<projectId>/builds/<buildId>/\`, chosen by that folder's project.json
(MF_ENGINE_ROOT now: \`${MF_ENGINE_ROOT:-$(cd "$REPO/.." && pwd)/madp-factory-work/engine-root}\`).
Certificate: \`frontend/.cert/dev-cert.pem\` + \`dev-key.pem\`.

- Status: **$1**
- PID: \`$2\` (recorded $(date -Iseconds) by $3)
- Listens: 127.0.0.1:$PORT (dbsaun.slsblx.com resolves to 127.0.0.1 in /etc/hosts)
- Log: \`$LOG\`

Start:  \`bash $HERE/preview-server.sh start\`
Stop:   \`bash $HERE/preview-server.sh stop\`   (kills exactly PID $2 after checking it is previewServer.ts)
Status: \`bash $HERE/preview-server.sh status\`
EOF
}

case "${1:-status}" in
  start)
    if pid="$(running_pid)"; then echo "already running: PID $pid"; exit 0; fi
    if healthy; then echo "port $PORT already serves a preview server not started by this script"; exit 1; fi
    mkdir -p "$HOST_DIR"
    setsid nohup "$NODE" "$SERVER" >> "$LOG" 2>&1 < /dev/null &
    pid=$!
    echo "$pid" > "$PID_FILE"
    for _ in $(seq 1 40); do healthy && break; sleep 0.25; done
    if healthy; then write_md "running" "$pid" "${2:-preview-server.sh}"; echo "started: PID $pid on $ORIGIN"; else echo "did not answer on port $PORT; see $LOG"; exit 1; fi
    ;;
  stop)
    if pid="$(running_pid)"; then kill "$pid"; rm -f "$PID_FILE"; write_md "stopped" "$pid" "${2:-preview-server.sh}"; echo "stopped PID $pid"; else echo "not running"; fi
    ;;
  status)
    if pid="$(running_pid)"; then echo "running: PID $pid"; healthy && echo "healthy" || echo "not answering"; else echo "not running"; exit 3; fi
    ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
