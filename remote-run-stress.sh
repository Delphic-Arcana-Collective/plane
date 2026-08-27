#!/usr/bin/env bash
# Sync stress-test files to a Windows host and run remote-run-stress.cmd there.
# Required env: REMOTE_HOST, REMOTE_USER, REMOTE_PASS, REMOTE_PLANE_DIR (e.g. C:/Users/you/plane)
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:?set REMOTE_HOST}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_USER="${REMOTE_USER:?set REMOTE_USER}"
REMOTE_PASS="${REMOTE_PASS:?set REMOTE_PASS}"
REMOTE_PLANE_DIR="${REMOTE_PLANE_DIR:?set REMOTE_PLANE_DIR e.g. C:/Users/you/plane}"
ROUNDS="${ROUNDS:-100}"
CLICK_DELAY_MS="${CLICK_DELAY_MS:-0}"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
REMOTE_CMD="${REMOTE_PLANE_DIR//\\//}/remote-run-stress.cmd"

sync() {
  local files=(
    apps/web/helpers/linear-project-snapshot.storage.ts
    apps/web/core/store/issue/project/issue.store.ts
    apps/web/core/store/issue/workspace/issue.store.ts
    apps/web/core/components/workspace/sidebar/projects-list-item.tsx
    apps/web/core/components/issues/issue-layouts/roots/all-issue-layout-root.tsx
    apps/web/core/components/issues/issue-layouts/roots/project-layout-root.tsx
    apps/web/core/components/issues/issue-layouts/kanban/base-kanban-root.tsx
    apps/web/core/components/issues/issue-layouts/list/base-list-root.tsx
    apps/bff/tests/linear-navigation.stress.ts
    remote-run-stress.cmd
  )
  for f in "${files[@]}"; do
    sshpass -p "$REMOTE_PASS" scp -P "$REMOTE_PORT" -o StrictHostKeyChecking=no \
      "$REPO_ROOT/$f" "$REMOTE_USER@$REMOTE_HOST:${REMOTE_PLANE_DIR}/${f}"
  done
  python3 -c "
import pathlib
p = pathlib.Path('$REPO_ROOT/remote-run-stress.cmd')
p.write_bytes(p.read_text().replace('\r\n','\n').replace('\n','\r\n').encode('ascii'))
"
  sshpass -p "$REMOTE_PASS" scp -P "$REMOTE_PORT" -o StrictHostKeyChecking=no \
    "$REPO_ROOT/remote-run-stress.cmd" "$REMOTE_USER@$REMOTE_HOST:${REMOTE_PLANE_DIR}/remote-run-stress.cmd"
}

run() {
  sshpass -p "$REMOTE_PASS" ssh -o StrictHostKeyChecking=no -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
    "cmd /c \"set OPENSSL_CONF= && set ROUNDS=$ROUNDS && set CLICK_DELAY_MS=$CLICK_DELAY_MS && $REMOTE_CMD\""
}

sync
run
