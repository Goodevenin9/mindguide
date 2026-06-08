#!/bin/bash
# ==========================================================
# 虚拟机内部设置脚本 - 在 Ubuntu VM 中运行
# 安装 Ollama + AutoGen + 依赖
# ==========================================================
# 用法: bash setup-vm.sh
# 前置条件: Ubuntu 22.04 已安装, 网络正常

set -e  # 出错立即停止

echo "=== MAS 安全研究沙箱 - 环境初始化 ==="
echo ""

# === 系统更新 ===
echo "[1/7] 更新系统包..."
sudo apt update && sudo apt upgrade -y
echo "✅ 系统更新完成"

# === 安装基础工具 ===
echo ""
echo "[2/7] 安装基础工具..."
sudo apt install -y \
    curl wget git vim htop \
    build-essential dkms \
    python3 python3-pip python3-venv \
    net-tools tcpdump \
    auditd audispd-plugins \
    rsyslog logrotate
echo "✅ 基础工具安装完成"

# === 安装 Ollama ===
echo ""
echo "[3/7] 安装 Ollama..."
curl -fsSL https://ollama.com/install.sh | sh
if [ $? -eq 0 ]; then
    echo "✅ Ollama 安装成功"
    # 启动 Ollama 服务
    sudo systemctl start ollama
    sudo systemctl enable ollama
else
    echo "❌ Ollama 安装失败，请手动安装: https://ollama.com/download/linux"
    exit 1
fi

# === 拉取 LLM 模型 ===
echo ""
echo "[4/7] 拉取 LLM 模型（首次会下载，需要几分钟）..."
# 主模型: Llama 3 8B (约 4.7GB)
echo "  → 拉取 Llama 3 8B..."
ollama pull llama3
# 备选模型: Qwen 2.5 7B (中文能力更强, 约 4.7GB)
echo "  → 拉取 Qwen 2.5 7B..."
ollama pull qwen2.5:7b
# 小模型用于快速测试
echo "  → 拉取 Phi-3 Mini (快速测试用)..."
ollama pull phi3:mini
echo "✅ 模型拉取完成"
echo "  已安装模型:"
ollama list

# === 设置 Python 虚拟环境 ===
echo ""
echo "[5/7] 设置 Python 虚拟环境..."
mkdir -p ~/mas-research
cd ~/mas-research
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
echo "✅ Python 虚拟环境已创建"

# === 安装 AutoGen ===
echo ""
echo "[6/7] 安装 AutoGen..."
pip install pyautogen
echo "✅ AutoGen 安装完成"
python3 -c "import autogen; print(f'AutoGen 版本: {autogen.__version__}')"

# === 安装其他依赖 ===
echo ""
echo "[7/7] 安装研究工具..."
pip install \
    matplotlib \
    pandas \
    numpy \
    jupyter \
    seaborn \
    networkx \
    tqdm \
    pyyaml \
    loguru
echo "✅ 研究工具安装完成"

# === 配置审计日志 ===
echo ""
echo "[额外] 配置系统审计日志..."
sudo systemctl enable auditd
sudo auditctl -e 1
echo "✅ 审计日志已启用"

# === 完成 ===
echo ""
echo "=================================="
echo "  ✅ 环境初始化完成！"
echo "=================================="
echo ""
echo "模型状态:"
ollama list
echo ""
echo "使用方法:"
echo "  source ~/mas-research/venv/bin/activate"
echo "  cd ~/mas-research"
echo "  # 开始写实验代码"
echo ""
echo "可用模型:"
echo "  ollama run llama3      # Llama 3 8B"
echo "  ollama run qwen2.5:7b  # Qwen 2.5 7B（中文）"
echo "  ollama run phi3:mini   # Phi-3 Mini（快速测试）"
echo ""

# 打印系统信息
echo "系统信息:"
echo "  OS: $(lsb_release -d | cut -f2)"
echo "  Python: $(python3 --version)"
echo "  RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "  Disk: $(df -h / | tail -1 | awk '{print $4}') 可用"
echo ""
