#!/usr/bin/env bash
set -euo pipefail

echo "==> 更新系统软件源"
sudo apt update

echo "==> 安装基础工具"
sudo apt install -y ca-certificates curl git ufw unzip tar

echo "==> 安装 Docker 和 Docker Compose"
sudo apt update
if ! sudo apt install -y docker.io docker-compose-v2; then
  echo "==> Ubuntu 源没有 docker-compose-v2，尝试安装 docker.io 和 docker-compose"
  sudo apt install -y docker.io docker-compose
fi
sudo systemctl enable --now docker

echo "==> 让当前用户可以直接执行 docker"
sudo usermod -aG docker "$USER"

echo "==> 安装 Caddy 反向代理"
sudo apt update
sudo apt install -y caddy
sudo systemctl enable --now caddy

echo "==> 开放服务器内部防火墙端口"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "==> 创建项目目录"
sudo mkdir -p /opt/manjiao
sudo chown -R "$USER:$USER" /opt/manjiao

echo "==> 当前系统信息"
cat /etc/os-release

echo "==> Docker 版本"
docker --version || sudo docker --version
docker compose version || sudo docker compose version

echo "==> Caddy 状态"
systemctl is-active caddy

echo "==> 初始化完成。请关闭当前终端后重新登录一次，让 docker 用户组生效。"
