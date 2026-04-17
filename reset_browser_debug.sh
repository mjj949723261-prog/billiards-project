#!/bin/bash

# Chrome DevTools / 专用调试浏览器一键清理与重启脚本
# 用途：
# 1. 清理残留的 chrome-devtools-mcp 进程
# 2. 清理占用专用调试 profile 的 Chrome 进程
# 3. 可选重新拉起干净的 Chrome 调试实例并打开指定页面

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CHROME_APP="/Applications/Google Chrome.app"
PROFILE_DIR="$HOME/.cache/chrome-devtools-mcp/chrome-profile"
DEFAULT_URL="http://127.0.0.1:8081/?room=asd123"
TARGET_URL="${1:-$DEFAULT_URL}"
OPEN_BROWSER=1

if [ "${1:-}" = "--clean-only" ]; then
  TARGET_URL="$DEFAULT_URL"
  OPEN_BROWSER=0
fi

if [ "${2:-}" = "--clean-only" ]; then
  OPEN_BROWSER=0
fi

echo -e "${YELLOW}🧰 正在重置 Chrome DevTools 调试链路...${NC}"
echo -e "${BLUE}Profile:${NC} $PROFILE_DIR"
echo -e "${BLUE}Target :${NC} $TARGET_URL"

kill_matching() {
  local pattern="$1"
  local label="$2"
  local pids

  pids=$(ps -ax | grep "$pattern" | grep -v grep | awk '{print $1}')
  if [ -z "$pids" ]; then
    echo -e "${GREEN}✓ 未发现残留 $label 进程${NC}"
    return 0
  fi

  echo -e "${YELLOW}🧹 发现残留 $label 进程: $pids${NC}"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1

  for pid in $pids; do
    if ps -p "$pid" >/dev/null 2>&1; then
      echo -e "${YELLOW}↻ 进程 $pid 仍存活，升级为强制结束${NC}"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

kill_matching "chrome-devtools-mcp" "chrome-devtools-mcp"
kill_matching "Google Chrome.*$PROFILE_DIR" "专用 Chrome profile"
kill_matching "Google Chrome Helper.*$PROFILE_DIR" "专用 Chrome helper"
kill_matching "remote-debugging-pipe" "remote-debugging pipe"

mkdir -p "$PROFILE_DIR"

echo -e "${GREEN}✓ 调试链路清理完成${NC}"

if command -v curl >/dev/null 2>&1; then
  if ! curl -s -I --max-time 2 "$TARGET_URL" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  当前目标地址暂时不可达：$TARGET_URL${NC}"
    echo -e "${YELLOW}   浏览器仍然可以打开，但如果页面空白，请先确认前端服务已经启动。${NC}"
  fi
fi

if [ "$OPEN_BROWSER" -eq 0 ]; then
  echo -e "${BLUE}提示:${NC} 已按 clean-only 模式结束。"
  exit 0
fi

if [ ! -d "$CHROME_APP" ]; then
  echo -e "${RED}✗ 未找到 Chrome: $CHROME_APP${NC}"
  exit 1
fi

echo -e "${GREEN}🚀 正在启动干净的 Chrome 调试实例...${NC}"
open -na "$CHROME_APP" --args \
  --user-data-dir="$PROFILE_DIR" \
  --disable-extensions \
  --new-window \
  "$TARGET_URL"

echo -e "${GREEN}✓ 已请求打开 Chrome${NC}"
echo -e "${BLUE}如果仍然连不上浏览器，请检查：${NC}"
echo "  1. macOS -> 隐私与安全性 -> 自动操作，给终端/代理授权控制 Google Chrome"
echo "  2. macOS -> 隐私与安全性 -> 辅助功能，给终端/代理授权"
echo "  3. 重新执行本脚本，确保只保留一份专用 Chrome profile 实例"
