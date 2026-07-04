# 腾讯云网页终端下一步

因为密码不应该写进命令、文档或日志，当前推荐使用腾讯云网页终端 `OrcaTerm` 完成服务器初始化。

## 第一步：打开网页终端

1. 回到腾讯云轻量云服务器详情页。
2. 点右上方蓝色按钮“登录”。
3. 选择 `OrcaTerm` 或网页 SSH。
4. 用户名使用：`ubuntu`。
5. 输入你设置好的服务器密码。

## 第二步：确认系统

登录后先执行：

```bash
cat /etc/os-release
```

如果看到 `Ubuntu 24.04` 或 `Ubuntu 22.04`，就可以继续。

## 第三步：粘贴初始化命令

把下面整段复制到网页终端里执行：

```bash
cat > /tmp/server_bootstrap_ubuntu.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "==> 更新系统软件源"
sudo apt update

echo "==> 安装基础工具"
sudo apt install -y ca-certificates curl git ufw unzip tar

echo "==> 安装 Docker 官方软件源"
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<DOCKER_EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER_EOF

echo "==> 安装 Docker 和 Docker Compose"
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

echo "==> 让当前用户可以直接执行 docker"
sudo usermod -aG docker "$USER"

echo "==> 安装 Caddy 反向代理"
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
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
EOF
bash /tmp/server_bootstrap_ubuntu.sh
```

## 第四步：把结果告诉我

执行完成后，把最后 20 行左右结果截图或复制给我。

如果中途出现红色报错，也直接截图给我，不要自己乱点重装。
