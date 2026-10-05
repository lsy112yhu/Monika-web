# Monika-web · redesign v2

一个原创的单页个人主页：把个人档案、轻量音乐播放器、友链空间和站点状态收在一张「薄荷绿的个人书桌」上，支持浅色、暗色和按本地时间切换主题。

此版本位于 `redesign-v2` 分支；旧版保留在 [`main`](https://github.com/lsy112yhu/Monika-web/tree/main)。前端重新设计，未读取或复用原版 `index.html`；原有 `server/` 服务、配置示例和 systemd 示例保持不变。

## 本地预览

无需安装依赖或构建。切换到此分支，在仓库根目录运行：

```bash
git switch redesign-v2
python3 -m http.server 4173
```

访问 <http://127.0.0.1:4173/>。这只是静态预览服务器，不会启动 `/api/*` 后端；页面会使用本地演示模式。

## 页面功能

- 响应式个人名片、游戏与社交入口、可点击的 Monika 吉祥物。
- 浅色 / 暗色 / 跟随时间切换：首次访问参考系统偏好，手动选择保存在本机；跟随时间模式在 07:00–19:00 使用浅色，其余时间使用暗色。
- 22:00–06:00 时，电台标题会切换为「深夜电台」。
- 吉祥物使用睁眼 3 秒、闭眼 150 毫秒的眨眼资源；点击会显示不重复的短台词，快速三连击会触发持续 2 秒的 “Can you hear me?” 彩蛋。开启 `prefers-reduced-motion` 时使用静态图。
- 播放、暂停、上一首、下一首、进度、音量和示例歌词展示。
- 内置三段约 8 秒的演示音乐；播放选择、当前曲目与音量使用 localStorage 保存。导入的本地音频仅在当前页面会话中可用，刷新后需重新选择文件。
- 友链卡片、申请表单；静态部署时申请会明确标记为「本地暂存（仅本机可见，未提交）」；连接后端后直接写入 `/api/friends`，成功后标记为「已发布」。
- 管理入口使用 `/api/friends/session` 查询和登录；连接后端后可编辑、删除友链，并在本地预览模式处理本机暂存申请。没有后端时不能登录管理员。
- 管理台检测到音乐服务时，会显示 QQ 音乐凭据、歌单刷新、曲目同步和已发布曲目管理；音乐服务不可用时该模块隐藏。
- 自动读取后端已发布歌单；站点探针成功返回后显示状态模块，无后端时隐藏。
- 无外部字体或第三方脚本依赖，图片使用 WebP，支持 `prefers-reduced-motion`。

Steam、小黑盒、邮件等个人入口和演示友链是占位内容，可在 `index.html`、`app.js` 中替换。内置歌词是演示文案；后端没有返回歌词时显示空状态。QQ 音乐账号配置、云端同步及歌单发布使用原有后端接口，并已在管理台提供图形化入口。

## 静态部署

发布目录为**仓库根目录**，无需构建命令；入口为 `index.html`，资源使用相对路径。GitHub Pages、Vercel、Cloudflare Pages 或 Nginx 均可托管这些静态文件。

上传到此分支不会修改默认分支或托管平台的发布分支。要让旧站与新版同时在线，应为 `redesign-v2` 配置单独的预览部署；继续让旧站使用 `main`。

## 可选后端

后端保持原仓库实现，启动和 systemd 示例见 [`server/README.md`](server/README.md)。配置项以 `server/friends/.env.example` 和 `server/music/.env.example` 为准。

前端请求同源的 `/api/*`，写操作携带 `X-Requested-With: XMLHttpRequest` 和会话 Cookie。生产环境通过反向代理接入只监听本机的服务。例如在已有 Nginx `server` 块中加入：

```nginx
location = /api/friends {
    proxy_pass http://127.0.0.1:8766;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location /api/friends/ {
    proxy_pass http://127.0.0.1:8766;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location /api/music/ {
    proxy_pass http://127.0.0.1:8767;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

静态托管平台不会执行 Python / Node 服务；需要另行运行服务并提供同源代理。真实环境文件、管理员口令哈希、会话密钥、音乐 Cookie 和运行数据保留在服务器，勿提交到仓库。接口说明和当前适配范围见 [`docs/API.md`](docs/API.md)。

## 目录

```text
index.html       页面结构与个人信息
styles.css       响应式布局与浅色 / 暗色主题
app.js           播放器、友链、管理入口与 API 适配
favicon.svg      站点图标
assets/          插画、演示音乐与原有资源
docs/API.md      前端接口说明
server/          保留的原有后端与服务配置示例
```

## 设计说明

视觉概念是「薄荷绿的个人书桌」：个人名片、深绿电台、纸张便签与紫色工具区形成不同密度的区域。布局、配色、文案和动效为原创；旧版可以从 `main` 分支随时查看。
