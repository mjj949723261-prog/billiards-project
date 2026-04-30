#!/bin/bash

# --- 台球游戏后端单独启动脚本 ---

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$SCRIPT_DIR"
BACKEND_DIR="$BASE_DIR/billiards-server"

echo -e "${YELLOW}🚀 正在准备启动后端服务...${NC}"

check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到 $1，请先安装。${NC}"
        exit 1
    fi
}

check_dependency "java"
check_dependency "mvn"
check_dependency "lsof"

JAVA_VER=$(java -version 2>&1 | head -n 1 | awk -F '"' '{print $2}' | cut -d'.' -f1)
if [ "$JAVA_VER" -lt 17 ]; then
    echo -e "${YELLOW}⚠️  警告: 检测到 Java 版本为 $JAVA_VER，建议使用 Java 17+ 以获得最佳兼容性。${NC}"
fi

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

clean_port 8080

echo -e "${GREEN}☕ 正在后台启动后端服务 (8080)...${NC}"
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}❌ 错误: 找不到后端目录 $BACKEND_DIR${NC}"
    exit 1
fi

cd "$BACKEND_DIR" || exit
nohup mvn spring-boot:run > "$BASE_DIR/backend.log" 2>&1 &

echo -n "⏳ 正在等待后端服务响应"
MAX_RETRIES=30
COUNT=0
while ! lsof -i:8080 >/dev/null; do
    echo -n "."
    sleep 2
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_RETRIES ]; then
        echo -e "\n${RED}❌ 启动超时! 请查看 backend.log 检查错误原因。${NC}"
        exit 1
    fi
done
echo -e "\n"

echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}🎉 后端启动成功！${NC}"
echo -e "🔌 服务地址: ${YELLOW}http://localhost:8080${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "📄 后端日志: tail -f backend.log"
echo -e "🛑 停止命令: lsof -ti:8080 | xargs kill -9"
