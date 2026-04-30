#!/bin/bash

# --- 台球游戏前端单独启动脚本 ---

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$SCRIPT_DIR"
FRONTEND_DIR="$BASE_DIR/daily-billiards-vanilla_web"

echo -e "${YELLOW}🚀 正在准备启动前端页面...${NC}"

check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到 $1，请先安装。${NC}"
        exit 1
    fi
}

check_dependency "python3"
check_dependency "lsof"

clean_port() {
    local port=$1
    local pid
    pid=$(lsof -ti :$port)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}🧹 端口 $port 被进程 $pid 占用，正在强制释放...${NC}"
        kill -9 $pid 2>/dev/null
        sleep 2
    fi
}

clean_port 8081

echo -e "${GREEN}🌐 正在启动前端页面 (8081)...${NC}"
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}❌ 错误: 找不到前端目录 $FRONTEND_DIR${NC}"
    exit 1
fi

cd "$FRONTEND_DIR" || exit
nohup python3 -m http.server 8081 > "$BASE_DIR/frontend.log" 2>&1 &

echo -n "⏳ 正在等待前端服务响应"
MAX_RETRIES=15
COUNT=0
while ! lsof -i:8081 >/dev/null; do
    echo -n "."
    sleep 1
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_RETRIES ]; then
        echo -e "\n${RED}❌ 启动超时! 请查看 frontend.log 检查错误原因。${NC}"
        exit 1
    fi
done
echo -e "\n"

LOCAL_IP=$(ipconfig getifaddr en0 || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)

echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}🎉 前端启动成功！${NC}"
echo -e "🖥️  电脑访问: ${YELLOW}http://localhost:8081${NC}"
echo -e "📱 手机访问: ${YELLOW}http://$LOCAL_IP:8081${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "📄 前端日志: tail -f frontend.log"
echo -e "🛑 停止命令: lsof -ti:8081 | xargs kill -9"
