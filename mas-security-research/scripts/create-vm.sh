#!/bin/bash
# ==========================================================
# 虚拟机创建脚本 - MAS安全研究沙箱
# 使用 VBoxManage 自动化创建和配置 Ubuntu VM
# ==========================================================
# 用法: bash create-vm.sh
# 注意: 需要以管理员身份运行（VBoxManage 需要创建网络等）

VBOX="C:/Program Files/Oracle/VirtualBox/VBoxManage.exe"
VM_NAME="mas-security-lab"
VM_DIR="C:/Users/19546/VirtualBox VMs/${VM_NAME}"
ISO_PATH="C:/Users/19546/Downloads/ubuntu-22.04.5-desktop-amd64.iso"
UBUNTU_URL="https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso"
OS_TYPE="Ubuntu_64"

# VM 配置参数
RAM_MB=8192        # 内存 8GB
VRAM_MB=128        # 显存
CPU_COUNT=4        # CPU 核心数
DISK_SIZE_MB=30720 # 硬盘 30GB

echo "=== MAS 安全研究沙箱 - VM 创建脚本 ==="

# 检查 VBoxManage
if [ ! -f "$VBOX" ]; then
    echo "❌ 未找到 VBoxManage，请检查 VirtualBox 安装路径"
    exit 1
fi

# === 步骤 1: 检查/下载 Ubuntu ISO ===
echo ""
echo "[1/6] 检查 Ubuntu 22.04 ISO..."
if [ ! -f "$ISO_PATH" ]; then
    echo "  ISO 不存在，需要下载..."
    echo "  请手动下载: ${UBUNTU_URL}"
    echo "  或运行: curl -L -o \"$ISO_PATH\" \"$UBUNTU_URL\""
    echo "  (文件约 4.6GB，下载可能需要一些时间)"
    read -p "  下载完成后按 Enter 继续..."
    if [ ! -f "$ISO_PATH" ]; then
        echo "❌ ISO 未就绪，退出"
        exit 1
    fi
else
    echo "✅ ISO 已存在: $ISO_PATH"
fi

# === 步骤 2: 创建虚拟机 ===
echo ""
echo "[2/6] 创建虚拟机..."
"$VBOX" createvm --name "$VM_NAME" --ostype "$OS_TYPE" --register --basefolder "$VM_DIR"
if [ $? -ne 0 ]; then
    echo "❌ 创建 VM 失败"
    exit 1
fi
echo "✅ VM 已创建: $VM_NAME"

# === 步骤 3: 配置虚拟机 ===
echo ""
echo "[3/6] 配置虚拟机硬件..."
# 内存和 CPU
"$VBOX" modifyvm "$VM_NAME" --memory $RAM_MB --vram $VRAM_MB --cpus $CPU_COUNT
# 网络: NAT (访问外网下载包) + Host-Only (宿主机访问)
"$VBOX" modifyvm "$VM_NAME" --nic1 nat --nictype1 virtio
"$VBOX" modifyvm "$VM_NAME" --nic2 hostonly --hostonlyadapter2 "VirtualBox Host-Only Ethernet Adapter" --nictype2 virtio 2>/dev/null || \
    echo "  ⚠️ Host-Only 网络未配置，可稍后手动添加"
# 其他配置
"$VBOX" modifyvm "$VM_NAME" --clipboard bidirectional
"$VBOX" modifyvm "$VM_NAME" --draganddrop bidirectional
"$VBOX" modifyvm "$VM_NAME" --ioapic on
"$VBOX" modifyvm "$VM_NAME" --boot1 dvd --boot2 disk --boot3 none --boot4 none
"$VBOX" modifyvm "$VM_NAME" --audio none  # 不需要音频
"$VBOX" modifyvm "$VM_NAME" --usb on --usbehci on
echo "✅ VM 配置完成: RAM ${RAM_MB}MB, CPU ${CPU_COUNT}核"

# === 步骤 4: 创建虚拟硬盘 ===
echo ""
echo "[4/6] 创建虚拟硬盘..."
VDI_PATH="${VM_DIR}/${VM_NAME}.vdi"
"$VBOX" createmedium disk --filename "$VDI_PATH" --size $DISK_SIZE_MB --format VDI --variant standard
if [ $? -ne 0 ]; then
    echo "❌ 创建虚拟硬盘失败"
    exit 1
fi
echo "✅ 虚拟硬盘已创建: ${DISK_SIZE_MB}MB (动态分配)"

# === 步骤 5: 挂载 ISO 和硬盘 ===
echo ""
echo "[5/6] 挂载存储设备..."
"$VBOX" storagectl "$VM_NAME" --name "SATA Controller" --add sata --controller IntelAhci --portcount 2
"$VBOX" storageattach "$VM_NAME" --storagectl "SATA Controller" --port 0 --device 0 --type hdd --medium "$VDI_PATH"
"$VBOX" storageattach "$VM_NAME" --storagectl "SATA Controller" --port 1 --device 0 --type dvddrive --medium "$ISO_PATH"
echo "✅ 存储设备已挂载"

# === 步骤 6: 打印启动信息 ===
echo ""
echo "[6/6] ✅ 虚拟机创建完成！"
echo ""
echo "=================================="
echo "  VM 名称:    $VM_NAME"
echo "  操作系统:   Ubuntu 22.04 LTS"
echo "  内存:       ${RAM_MB}MB"
echo "  CPU:        ${CPU_COUNT}核"
echo "  硬盘:       ${DISK_SIZE_MB}MB"
echo "  网络:       NAT (VM→外网)"
echo "               Host-Only (宿主机↔VM)"
echo "=================================="
echo ""
echo "接下来："
echo "  1. 打开 VirtualBox，启动 $VM_NAME 虚拟机"
echo "  2. 按照提示安装 Ubuntu 22.04"
echo "     - 语言: English / 中文均可"
echo "     - 分区: 默认 (Erase disk and install Ubuntu)"
echo "     - 用户名: masuser"
echo "     - 密码: maslab2026"
echo "     - 主机名: mas-security-lab"
echo "  3. 安装完成后重启,登录"
echo "  4. 继续运行下一步: bash setup-vm.sh"
echo ""
