#!/bin/zsh
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$HOME/.gemini/antigravity-cli"
RELAY_ROOT="$HOME/.agy-relay-deck"
PAYLOAD="$PACKAGE_ROOT/payload/antigravity-cli"
RELAY_PAYLOAD="$PACKAGE_ROOT/payload/relay-state"

if pgrep -x agy >/dev/null 2>&1; then
  echo "检测到 agy 仍在运行。请先正常关闭所有 agy 窗口，再重新双击本脚本。"
  read -k 1 "?按任意键退出…"
  exit 1
fi

mkdir -p "$PAYLOAD" "$RELAY_PAYLOAD"

rsync -a --delete --delete-excluded \
  --exclude '.DS_Store' \
  --exclude 'antigravity-oauth-token' \
  --exclude 'installation_id' \
  --exclude 'bin/' \
  --exclude 'builtin/' \
  --exclude 'crashes/' \
  --exclude 'log/' \
  --exclude 'updater/' \
  --exclude 'presence/' \
  --exclude 'scratch/' \
  --exclude 'cli.log' \
  --exclude 'last_check.timestamp' \
  --exclude '*.db-wal' \
  --exclude '*.db-shm' \
  "$SOURCE_ROOT/" "$PAYLOAD/"

mkdir -p "$PAYLOAD/conversations"
for db in "$SOURCE_ROOT"/conversations/*.db; do
  [[ -e "$db" ]] || continue
  name="${db:t}"
  temp="$PAYLOAD/conversations/$name.snapshot.tmp"
  rm -f "$temp"
  sqlite3 "$db" ".backup '$temp'"
  mv -f "$temp" "$PAYLOAD/conversations/$name"
done

summary_temp="$PAYLOAD/conversation_summaries.db.snapshot.tmp"
rm -f "$summary_temp"
sqlite3 "$SOURCE_ROOT/conversation_summaries.db" ".backup '$summary_temp'"
mv -f "$summary_temp" "$PAYLOAD/conversation_summaries.db"

rsync -a --delete --exclude 'open-*.command' --exclude 'open-*.cmd' "$RELAY_ROOT/" "$RELAY_PAYLOAD/"

python3 "$PACKAGE_ROOT/scripts/build_inventory.py" --package "$PACKAGE_ROOT" --source-version "$(agy --version 2>/dev/null || echo unknown)"

rm -f "$PACKAGE_ROOT/PRELIMINARY-SNAPSHOT-请最终同步.txt"
date -u "+Final snapshot completed: %Y-%m-%dT%H:%M:%SZ" > "$PACKAGE_ROOT/FINAL-SNAPSHOT-COMPLETE.txt"

echo ""
echo "最终同步与校验清单已完成。"
echo "现在可以把整个 AgyRelay-Windows-Migration 文件夹复制到 Windows。"
read -k 1 "?按任意键关闭…"

