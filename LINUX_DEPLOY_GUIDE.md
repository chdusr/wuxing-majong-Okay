# 五行麻将 Node.js 后端服务器 Linux 部署与配置全指南

本文档提供在各类主流 Linux 服务器（腾讯云 Lighthouse/CVM、阿里云 ECS、华为云、自建 Ubuntu/Debian/CentOS）上部署本项目 Node.js 对战后端的完整系统配置与操作流程。

---

## 一、服务器基础硬件与系统要求

| 配置项 | 推荐配置 | 最低配置 | 说明 |
| :--- | :--- | :--- | :--- |
| **CPU** | 2 核 | 1 核 | 1核足以支撑数十桌并发对战 |
| **内存** | 2 GB+ | 1 GB | 若使用 1G 内存轻量服务器，**强烈建议开启 2GB Swap 虚拟内存**，防止在执行 `npm run build` 时因内存耗尽被系统 OOM Kill |
| **操作系统** | Ubuntu 22.04/24.04 LTS、Debian 12 | Ubuntu 20.04、CentOS 7/8、Rocky 9 | 推荐 Ubuntu / Debian，包管理与 Node 升级最便捷 |
| **公网带宽** | 3 Mbps ~ 10 Mbps | 1 Mbps | WebSocket 麻将出牌包体仅几百字节，带宽占用极小 |

---

## 二、Linux 系统防火墙与云安全组端口开放

必须在**云服务商控制台（安全组/防火墙）**及 **Linux 本机防火墙**放行以下端口：

| 端口 | 协议 | 用途 | 是否必选 |
| :--- | :--- | :--- | :--- |
| **22** | TCP | SSH 远程连接 | 必选 |
| **80** | TCP | HTTP 网页访问 / Certbot SSL 证书申请 | 必选 |
| **443** | TCP | HTTPS 网页访问 / WSS (WebSocket Secure) 安全长连接 | **必选**（EdgeOne 前端走 HTTPS，要求后端也必须为 HTTPS/WSS） |
| **3000** | TCP | Node.js 原始监听端口（若配置了 Nginx 反向代理，可不必对外暴露 3000） | 可选 |

### Linux 系统防火墙放行命令
- **Ubuntu / Debian (ufw)**：
  ```bash
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 3000/tcp
  sudo ufw reload
  ```
- **CentOS / RHEL (firewalld)**：
  ```bash
  sudo firewall-cmd --zone=public --add-port=80/tcp --permanent
  sudo firewall-cmd --zone=public --add-port=443/tcp --permanent
  sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent
  sudo firewall-cmd --reload
  ```

---

## 三、基础环境安装（Node.js 20 LTS + Git + Nginx + PM2）

### 1. Ubuntu / Debian 系统一键安装：
```bash
# 1. 更新系统包索引
sudo apt update && sudo apt upgrade -y

# 2. 安装基础依赖与 Git、Nginx
sudo apt install -y curl wget git build-essential nginx

# 3. 安装 Node.js 20.x LTS (官方 NodeSource 源)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. 验证版本 (Node 应 >= 18.0.0，npm 应 >= 9.0.0)
node -v
npm -v

# 5. 全局安装 PM2 守护进程管理器
sudo npm install -g pm2
```

### 2. CentOS 7/8 / Rocky Linux 系统安装：
```bash
sudo yum update -y
sudo yum install -y epel-release
sudo yum install -y git nginx curl

curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

sudo npm install -g pm2
```

---

## 四、（重要）针对 1GB 内存服务器配置 Swap 虚拟内存

*注：如果您的服务器内存在 2GB 以上，可跳过此步。若为 1GB 内存服务器，请务必配置，避免前端打包时内存溢出报错：`JavaScript heap out of memory`。*

```bash
# 创建 2GB Swap 文件
sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 写入 fstab 实现开机自启
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 检查生效情况
free -h
```

---

## 五、项目克隆、编译与启动

```bash
# 1. 进入推荐运行目录并拉取项目（或将代码上传至此目录）
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
# git clone <您的仓库地址> wuxing-mahjong
cd wuxing-mahjong

# 2. 安装项目依赖
npm install

# 3. 执行生产环境打包（编译前端至 dist/，打包后端至 dist/server.cjs）
npm run build

# 4. 试运行测试服务
npm start
# 看到输出 "五行麻将 & 时间局 server running on http://localhost:3000" 说明服务正常
# 按 Ctrl + C 退出测试
```

---

## 六、使用 PM2 实现 7×24 小时后台守护运行与开机自启

本项目根目录已内置 `ecosystem.config.cjs` 配置文件：

```bash
# 使用 ecosystem 配置文件启动服务
pm2 start ecosystem.config.cjs

# 查看运行状态与内存占用
pm2 status

# 查看实时输出日志
pm2 logs wuxing-mahjong

# 设置服务器重启后自动唤醒服务
pm2 startup
# (执行终端提示的 sudo env PATH=... 脚本命令)
pm2 save
```

常用 PM2 运维命令：
- 重启服务：`pm2 restart wuxing-mahjong`
- 停止服务：`pm2 stop wuxing-mahjong`
- 查看资源负载：`pm2 monit`

---

## 七、配置 Nginx 反向代理与 SSL / HTTPS 证书（必选）

由于 EdgeOne 前端部署通常使用 HTTPS 访问，现代浏览器禁止在 HTTPS 网页上发起未加密的 `http://` 或 `ws://` 请求（报 `Mixed Content` 阻断），因此**后端必须配置域名并开启 HTTPS / WSS**。

### 1. 编辑 Nginx 虚拟主机配置
新建配置文件 `/etc/nginx/conf.d/mahjong.conf` 或 `/etc/nginx/sites-available/mahjong`：

```bash
sudo nano /etc/nginx/conf.d/mahjong.conf
```

填入以下内容（**请将 `your-mahjong-domain.com` 替换为您解析到该服务器的真实二级域名**）：

```nginx
server {
    listen 80;
    server_name your-mahjong-domain.com; # 替换为您的后端域名

    # 客户端请求体大小限制
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket 关键协议升级配置（不可缺失）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 真实客户端 IP 与 Host 头透传
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时时间优化（长连接保活，防止对局中因空闲被 Nginx 切断）
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;

        # 禁用代理缓存
        proxy_buffering off;
    }
}
```

测试并重载 Nginx：
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 2. 使用 Certbot 一键申请免费 Let's Encrypt SSL 证书
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-mahjong-domain.com
```
按照提示输入邮箱并同意条款，Certbot 会自动修改 Nginx 配置文件启用 443 SSL 和 HTTPS 重定向，并自动配置 90 天证书续期定时任务。

---

## 八、Linux 内核长连接与句柄数调优（进阶优化）

为了让 Linux 服务器能够从容应对大量玩家并发 WebSocket 长连接，可调整最大文件句柄限制：

```bash
# 查看当前限制
ulimit -n

# 修改 /etc/security/limits.conf 在末尾追加：
sudo bash -c 'cat >> /etc/security/limits.conf << EOF
* soft nofile 65535
* hard nofile 65535
EOF'

# 修改 /etc/sysctl.conf 优化 TCP 参数
sudo bash -c 'cat >> /etc/sysctl.conf << EOF
fs.file-max = 65535
net.ipv4.tcp_max_syn_backlog = 8192
net.core.somaxconn = 8192
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5
EOF'

sudo sysctl -p
```

---

## 九、在前端大厅验证接入（支持 IP:端口 或 域名）

五行麻将联机大厅已原生支持 **IP 与端口分离设置** 与 **智能 URL 解析**：

1. 在浏览器打开部署好的前端页面（如 EdgeOne Makers 域名或本地页面）。
2. 点击多人对战大厅右上角的 **【服务器/IP:端口设置】** 按钮。
3. 选择您喜欢的配置模式：
   - **方式 A：设置 IP 和端口 (自建服务器直连)**：
     - **协议**：选择 `http://` 或 `https://`
     - **IP 地址 / 主机**：填入您的 Linux 服务器公网 IP（例如 `124.222.12.34`）
     - **端口号**：填入监听端口（例如 `3000` 或 `8080`）
     - 系统将自动拼装生效后端地址为 `http://124.222.12.34:3000`
   - **方式 B：完整 URL / 预设**：
     - 直接填入完整地址（如 `https://your-mahjong-domain.com`），或一键切换为【官方云端对战中继】
4. 点击 **【测试服务器连通性 (Ping)】**：
   - 看到绿色提示 `连通正常 (延迟: XXms)` 即表示全链路与长连接引擎正常通畅！
5. 点击 **【保存并立即生效】**，大厅将即刻重连，房间列表自动刷新，即可开始联机对局！
6. 弹窗内支持 **一键复制当前生效后端地址**，方便与群友对账与排查连通问题。
