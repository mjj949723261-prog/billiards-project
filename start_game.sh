#!/bin/bash

# --- 台球游戏一键启动脚本 (增强容错版) ---

# 1. 颜色定义与配置
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # 无颜色

BASE_DIR=$(pwd)
BACKEND_DIR="$BASE_DIR/billiards-server"
FRONTEND_DIR="$BASE_DIR/daily-billiards-vanilla_web"

echo -e "${YELLOW}🚀 正在准备启动台球游戏环境...${NC}"

# 2. 检查依赖环境
check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ 错误: 未找到 $1，请先安装。${NC}"
        exit 1
    fi
}

check_dependency "java"
check_dependency "mvn"
check_dependency "python3"
check_dependency "lsof"

# 检查 Java 版本是否为 17+
JAVA_VER=$(java -version 2>&1 | head -n 1 | awk -F '"' '{print $2}' | cut -d'.' -f1)
if [ "$JAVA_VER" -lt 17 ]; then
    echo -e "${YELLOW}⚠️  警告: 检测到 Java 版本为 $JAVA_VER，建议使用 Java 17+ 以获得最佳兼容性。${NC}"
fi

# 3. 处理端口占用
clean_port() {
    local port=$1
    local pid=$(lsof -ti :$port)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}🧹 端口 $port 被进程 $pid 占用，正在强制释放...${NC}"
        kill -9 $pid 2>/dev/null
        sleep 2
    fi
}

clean_port 8080
clean_port 8081

# 4. 启动后端 (Maven 启动 Spring Boot)
echo -e "${GREEN}☕ 正在后台启动后端服务 (8080)...${NC}"
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}❌ 错误: 找不到后端目录 $BACKEND_DIR${NC}"
    exit 1
fi

cd "$BACKEND_DIR" || exit
nohup mvn spring-boot:run > "$BASE_DIR/backend.log" 2>&1 &

# 5. 启动前端 (Python SimpleHTTP)
echo -e "${GREEN}🌐 正在启动前端页面 (8081)...${NC}"
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}❌ 错误: 找不到前端目录 $FRONTEND_DIR${NC}"
    exit 1
fi

cd "$FRONTEND_DIR" || exit
nohup python3 -m http.server 8081 > "$BASE_DIR/frontend.log" 2>&1 &

# 6. 等待服务就绪 (轮询检查)
echo -n "⏳ 正在等待服务响应"
MAX_RETRIES=30
COUNT=0
while ! lsof -i:8080 >/dev/null || ! lsof -i:8081 >/dev/null; do
    echo -n "."
    sleep 2
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_RETRIES ]; then
        echo -e "\n${RED}❌ 启动超时! 请查看 backend.log 和 frontend.log 检查错误原因。${NC}"
        exit 1
    fi
done
echo -e "\n"

# 7. 显示访问信息
LOCAL_IP=$(ipconfig getifaddr en0 || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)

echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}🎉 启动成功！服务已就绪。${NC}"
echo -e "🖥️  电脑访问: ${YELLOW}http://localhost:8081${NC}"
echo -e "📱 手机访问: ${YELLOW}http://$LOCAL_IP:8081${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "📄 后端日志: tail -f backend.log"
echo -e "📄 前端日志: tail -f frontend.log"
echo -e "🛑 停止脚本: lsof -ti:8080,8081 | xargs kill -9"
