#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

command_line=${SSH_ORIGINAL_COMMAND:-"${*:-}"}
if [[ ! "$command_line" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Expected deploy followed by a commit SHA.' >&2
  exit 2
fi
sha=${BASH_REMATCH[1]}
exec 9>/run/lock/resume-bot-deploy.lock
flock -x 9

base=/opt/resume-bot
data=/var/lib/resume-bot
repo="$base/repository.git"
current="$base/current"
previous=$(readlink -f "$current" 2>/dev/null || true)
release=''
backup=''
service_stopped=0
finished=0

rollback() {
  code=$?
  if (( code != 0 && service_stopped == 1 && finished == 0 )); then
    echo 'Deployment failed; restoring the previous release and database.' >&2
    systemctl stop resume-bot.service || true
    if [[ -n "$backup" && -f "$backup" ]]; then
      rm -f "$data/dev.db-wal" "$data/dev.db-shm"
      cp "$backup" "$data/dev.db"
      chown resumebot:resumebot "$data/dev.db"
    fi
    if [[ -n "$previous" && -d "$previous" ]]; then
      ln -sfn "$previous" "$current"
      systemctl start resume-bot.service || true
    else
      rm -f "$current"
    fi
  fi
  exit "$code"
}
trap rollback EXIT

git --git-dir="$repo" fetch --quiet origin '+refs/heads/prod:refs/remotes/origin/prod'
tip=$(git --git-dir="$repo" rev-parse refs/remotes/origin/prod)
if [[ "$tip" != "$sha" ]]; then
  echo 'A newer prod commit exists; its own workflow will deploy it.'
  finished=1
  exit 0
fi

release=$(mktemp -d "$base/releases/${sha:0:12}.XXXXXXXX")
git --git-dir="$repo" archive "$sha" | tar -x -C "$release"
chown -R resumebot:resumebot "$release"
app_env=(env HOME="$data" PATH="$base/node/bin:/usr/local/bin:/usr/bin:/bin" DATABASE_URL="file:$data/dev.db" HH_STORAGE_STATE_PATH="$data/hh-auth.json" PLAYWRIGHT_BROWSERS_PATH="$data/playwright" NEXT_TELEMETRY_DISABLED=1)
runuser -u resumebot -- "${app_env[@]}" bash -c 'cd "$1"; npm ci; npx playwright install chromium; npm run build' _ "$release"

systemctl stop resume-bot.service || true
service_stopped=1
backup="$data/backups/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.db"
if [[ -f "$data/dev.db" ]]; then
  python3 - "$data/dev.db" "$backup" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as source, sqlite3.connect(sys.argv[2]) as destination:
    source.backup(destination)
PY
  chown resumebot:resumebot "$backup"
fi
runuser -u resumebot -- "${app_env[@]}" bash -c 'cd "$1"; npm run prisma:deploy' _ "$release"
ln -sfn "$release" "$current"
systemctl start resume-bot.service
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet resume-bot.service && curl --fail --silent --max-time 2 http://127.0.0.1:3013/healthz > /dev/null; then
    finished=1
    echo "Deployed $sha successfully."
    exit 0
  fi
  sleep 1
done
echo 'The new application did not pass its local health check.' >&2
exit 1
