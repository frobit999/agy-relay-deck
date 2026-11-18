#!/bin/zsh
set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "$0")" && pwd)"
PARENT="${PACKAGE_ROOT:h}"
NAME="${PACKAGE_ROOT:t}"
ARCHIVE="$PARENT/$NAME.tar"

if [[ ! -f "$PACKAGE_ROOT/FINAL-SNAPSHOT-COMPLETE.txt" ]]; then
  echo "尚未完成最终同步。请先关闭所有 agy，并运行 Final-Sync-Mac.command。"
  read -k 1 "?按任意键退出…"
  exit 1
fi

temp="$PARENT/.$NAME.tar.building"
rm -f "$temp"
tar -cf "$temp" -C "$PARENT" "$NAME"
mv -f "$temp" "$ARCHIVE"

echo ""
echo "单文件传输包已生成："
echo "$ARCHIVE"
echo ""
echo "Windows 解包命令：tar -xf $NAME.tar"
read -k 1 "?按任意键关闭…"
