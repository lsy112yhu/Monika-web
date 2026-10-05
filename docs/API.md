# 新版前端接口适配

前端使用同源 `/api/*` 和 Cookie；写操作带 `X-Requested-With: XMLHttpRequest`。服务端负责 Origin 检查、权限、限流和最终字段校验。此分支没有修改或新增后端接口。

## 友链与会话

| 方法 | 路径 | 前端用途 |
|---|---|---|
| GET | `/api/friends` | 读取 `links` 数组，渲染友链 |
| POST | `/api/friends` | 提交申请 |
| PUT | `/api/friends/{id}` | 管理员编辑 |
| DELETE | `/api/friends/{id}` | 管理员删除 |
| GET | `/api/friends/session` | 查询 `authenticated` 和 `user` |
| POST | `/api/friends/session` | 使用 `username`、`password` 登录 |
| DELETE | `/api/friends/session` | 后端支持清除会话 Cookie |
| GET | `/api/friends/sites` | 读取 `sites` 数组和 `checkedAt` |

友链写入字段为：

```json
{
  "name": "昵称（最多18字）",
  "intro": "简介（最多10字）",
  "url": "https://example.com",
  "avatar": "data:image/png;base64,..."
}
```

头像可选，文件选择器接受 PNG / JPG / WebP / GIF，客户端限制 3MB；服务端应验证实际格式和数据。无后端时申请暂存 localStorage，仅对当前浏览器可见，不会发布到其他访客的友链列表。

原有服务的 `POST /api/friends` 会直接写入友链列表，没有独立的待审核状态接口。因此前端明确区分两种状态：后端不可用时显示「本地暂存（仅本机可见，未提交）」，后端接受成功后显示「已发布」。统一的云端先审后发仍需要扩展后端契约。

## 音乐

`GET /api/music/playlist` 返回 `tracks` 数组。前端读取每首歌的 `id`、`title`、`artist` 和 `stream`，使用 `stream` 作为音频地址。后端通常提供 `/api/music/stream/{trackId}`。`lyrics` 为可选的 `[秒数, 文本]` 数组，未提供时显示无歌词状态。

```json
{
  "available": true,
  "tracks": [
    {
      "id": "track-id",
      "title": "Song title",
      "artist": "Artist",
      "stream": "/api/music/stream/track-id"
    }
  ]
}
```

请求失败或没有已发布曲目时，前端使用内置的三段演示音频。播放列表选择、音量和当前曲目保存在 localStorage；通过文件选择器导入的音频使用当前会话的 Blob URL。

原有后端另有 `/api/music/session`、`/api/music/admin`、`/api/music/admin/credentials`、`/api/music/admin/catalog`、`/api/music/admin/sync`、`/api/music/admin/published`。管理台会在音乐服务可用时调用这些接口，提供凭据连接、歌单刷新、曲目同步和发布选中曲目的操作；服务不可用时隐藏音乐管理模块。

## 配置

保持同源代理即可，无需在前端填写 Token 或音乐 Cookie。服务端配置和部署示例见 `server/README.md`、两个服务的 `.env.example` 及 `server/systemd/`。
