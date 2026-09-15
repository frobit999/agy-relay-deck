#!/bin/zsh
set -e
SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"
clear
echo "正在启动 Agy Relay Deck…"
echo "关闭这个终端窗口，面板就会停止。"
exec /usr/bin/env node server.mjs
