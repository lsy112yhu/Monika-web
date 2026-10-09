# 新版前端接口适配

前端使用同源 `/api/*` 和 Cookie；写操作带 `X-Requested-With: XMLHttpRequest`。服务端负责 Origin 检查、权限、限流和最终字段校验。友链与留言都写入友链服务的数据文件，成功提交后对所有访客可见。

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

头像可选，文件选择器接受 PNG / JPG / WebP / GIF，客户端限制 3MB；服务端会再次验证实际格式和数据。只有在后端不可用的本地预览中，申请才会暂存 localStorage；连接后端成功时会直接写入共享友链列表。

`POST /api/friends` 会直接写入共享友链列表，没有独立的待审核状态接口。因此前端明确区分两种状态：后端不可用时显示「本地暂存（仅本机可见，未提交）」，后端接受成功后显示「已发布」。

## 留言板

| 方法 | 路径 | 前端用途 |
|---|---|---|
| GET | `/api/whispers` | 读取所有访客可见的留言 |
| POST | `/api/whispers` | 发布一条留言 |
| DELETE | `/api/whispers/{id}` | 管理员删除留言 |

留言写入字段为：

```json
{
  "nickname": "昵称（最多18字）",
  "message": "留言内容（最多80字）"
}
```

留言会和友链保存在同一个受保护的数据文件中，服务端最多保留最近 200 条；匿名发布受 IP 限流，删除需要管理员会话。静态本地预览无法访问 `/api/whispers` 时，页面会明确显示 `local preview`，此时留言只保存在当前浏览器，不会伪装成共享数据。

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
