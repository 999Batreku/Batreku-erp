#!/bin/bash
# BATREKU ERP 一键启动脚本
# 使用方法: bash start.sh

echo "=========================================="
echo "  BATREKU ERP 启动中..."
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装：https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖..."
    npm install
fi

# 启动服务
echo ""
echo "🚀 启动 ERP 服务..."
echo "📱 浏览器访问: http://localhost:3000"
echo "📌 默认账号: admin / admin123"
echo "=========================================="
echo ""

node server.js
