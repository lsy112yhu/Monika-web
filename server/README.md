# 后端

主页的动态能力由两个只监听本机的小服务提供，再由反向代理把 `/api/*` 转进来。

| 服务 | 入口 | 默认端口 | 作用 |
|---|---|---|---|
| 友链 API | `friends/friends_api.py` | `127.0.0.1:8766` | 友链展示、申请与审核 |
| 音乐 API | `music/server.js` | `127.0.0.1:8767` | 歌单与播放代理 |

Python 3 与 Node.js 18+ 即可，没有第三方运行时依赖。

## 不要提交的内容

- 填好的 `.env`、口令哈希、会话密钥
- 友链数据文件、音乐状态文件
- 上游音乐账号的登录态（即使已加密）

仓库里只有 `.env.example`。真实配置放在服务器，例如 `/etc/monika-web/*.env`，权限收给运行用户。

## 启动

```bash
cp server/friends/.env.example /etc/monika-web/friends-api.env
cp server/music/.env.example /etc/monika-web/music-api.env
# 填入哈希、会话密钥和数据文件路径后再启动

python3 server/friends/friends_api.py
node server/music/server.js
```

`systemd/` 里是示例单元，路径和用户都是占位，按自己的机器改。两个服务默认只绑定 `127.0.0.1`，不要直接暴露到公网。
