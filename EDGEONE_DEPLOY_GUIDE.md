# EdgeOne Makers（原 EdgeOne Pages）部署五行麻将联网对战指南

> 💡 **产品升级说明**：腾讯云已将原 **EdgeOne Pages** 全面升级为 **EdgeOne Makers**，作为专为全球开发者打造的现代化 Web 及全栈应用边缘构建与托管平台。原有 Pages 项目与功能无缝延续，并在全球 3200+ 边缘节点加速、自动化 CI/CD 构建以及安全防护上进行了全面增强。

本项目已专门针对 **腾讯云 EdgeOne Makers** 进行了网络拓扑与 WebSocket 深度适配，支持**零配置极速部署**与**私有后端自定义接入**两种模式。

---

## 方案一：EdgeOne Makers 极速开箱即用（0 配置推荐）

本项目前端已内置 **智能边缘网络自适应探针**（`isEdgeOneOrExternalStaticHost`），无需架设任何后端即可畅玩公网多人联机：

### 1. 在 EdgeOne Makers 中创建项目
1. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) 或 EdgeOne Makers 平台。
2. 在左侧导航栏点击 **【EdgeOne Makers】**（若原控制台入口为 Pages，现已自动重定向至 Makers）。
3. 点击 **【新建项目】**（或【创建应用】），选择关联您的 Git 代码仓库（支持 GitHub、GitLab、Gitee 等）或直接上传代码压缩包。

### 2. 配置构建参数
EdgeOne Makers 会自动识别 Vite 项目，请确认以下构建选项：
- **框架预设**：`Vite`
- **构建命令 (Build Command)**：`npm run build`
- **输出目录 (Output Directory)**：`dist`
- **Node.js 版本**：推荐选择 `20.x` 或 `18.x`
- **根目录**：保持默认 `./` 即可

### 3. 一键部署与全网联机
1. 点击 **【开始部署】**，EdgeOne Makers 将在全球 3200+ 边缘节点自动拉取依赖、编译并秒级分发静态资源。
2. 部署完成后，点击 EdgeOne Makers 自动分配的专属域名（例如 `xxx.edgeone.app`）：
   - 前端探针将**自动识别 EdgeOne Makers 边缘运行环境**。
   - **自动切换并直连官方高速云端对战中继引擎**。
   - 进入多人大厅即可**直接开房、全网好友跨域匹配、实时打牌对战**，完全无需手动搭建或配置服务器！

---

## 方案二：EdgeOne Makers + 自建私有 Node.js 后端

如果您希望使用自己云服务器上运行的私有 Node.js 游戏后台（参考根目录 `LINUX_DEPLOY_GUIDE.md`）：

### 方式 A：在 EdgeOne Makers 控制台配置环境变量（推荐）
1. 在 EdgeOne Makers 控制台进入您的项目。
2. 点击 **【设置】 -> 【环境变量】**。
3. 新增环境变量：
   ```env
   VITE_BACKEND_URL=https://api.your-backend-domain.com
   ```
4. 保存后点击 **【重新部署】**。构建脚本会将该后端地址固化打包至前端，上线后所有玩家默认直连您的私有后端。

### 方式 B：游戏大厅内随时图形化切换（支持 IP:端口）
玩家或管理员打开 EdgeOne Makers 网页后：
1. 点击多人大厅右上角的 **【服务器/IP:端口设置】**。
2. 支持两种设置模式：
   - **IP 和端口直连**：分别填入服务器 IP（如 `124.222.12.34`）和端口（如 `3000`）；
   - **完整 URL / 预设**：填入域名（如 `https://api.your-backend-domain.com`）或一键选择【官方云端对战中继】。
3. 点击 **【测试服务器连通性 (Ping)】** 确认延迟正常。
4. 点击 **【保存并立即生效】**，设置将持久保存在玩家本地浏览器中。

### 方式 C：EdgeOne 边缘规则反向代理（进阶同域方案）
利用 EdgeOne 的边缘函数与规则引擎实现前后端同域：
1. 进入 EdgeOne 控制台 -> **【规则引擎】 -> 【自定义规则】**。
2. 添加规则：
   - **匹配条件**：URL 路径以 `/api/` 开头，或者 URL 路径以 `/socket.io/` 开头。
   - **执行动作**：**修改源站 / 回源代理** 至您的云服务器 IP 或域名。
   - **协议支持**：务必勾选 **【开启 WebSocket 协议支持】**。

---

## 三、自定义域名与 HTTPS 安全证书

EdgeOne Makers 提供开箱即用的安全与网络加速能力：
1. 在项目控制台的 **【域名管理】** 中，点击 **【添加自定义域名】**（如 `mahjong.yourdomain.com`）。
2. 根据页面提示在 DNS 解析商处添加一条 `CNAME` 记录指向 EdgeOne 提供的节点地址。
3. EdgeOne Makers 会**全自动申请并下发免费 Let's Encrypt SSL 证书**，支持 HTTP/2、HTTP/3 (QUIC) 以及 WSS 安全长连接，无需手动维护证书续期。
