# Monika-web

> 🌸 个人主页与多功能集成面板 / Personal Homepage & Dashboard

一个优雅、沉浸式的二次元风格极简个人主页，集成状态展示、音乐播放器、个人空间、友链生态及后台管理交互。

## ✨ 特性亮点

- **视觉与交互**：
  - 玻璃拟态（Glassmorphism）与樱花动效背景。
  - 响应式布局，适配移动端与桌面端屏幕。
  - 动效音效反馈及沉浸式体验。
- **功能集成**：
  - **个人档案**：精选游戏主页（Steam、小黑盒）、社交渠道与联系方式。
  - **在线音乐播放器**：悬浮播放器，支持歌词滚动、播放列表管理与云端同步。
  - **友链空间**：支持展示好友站点与自动化互动申请。
  - **管理面板（STAFF Panel）**：后端 API 联动的安全管理面板（歌单同步、友链审核与凭证管理）。
- **极简工程结构**：
  - 单文件零额外构建依赖，原生 HTML5 + Modern CSS + Vanilla JavaScript，开箱即用。

## 🚀 部署与使用

### 1. 静态部署
你可以将 `index.html` 直接放置在任何静态托管平台（GitHub Pages、Vercel、Cloudflare Pages、Nginx 等）：

```bash
# 本地快速预览
python3 -m http.server 8080
```
访问 `http://localhost:8080` 即可浏览。

### 2. 后端
友链与音乐由 `server/` 下两个只监听本机的服务提供，经反向代理接入 `/api/*`。启动方式、环境变量和示例 systemd 单元见 [server/README.md](server/README.md)。

> 密钥、口令哈希和音乐登录态只放在服务器上，不要写进仓库。没有后端时，相关功能会降级为本地模式。

## 📄 开源许可
[MIT License](LICENSE)
