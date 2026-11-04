# 群晖 + Cloudflare Tunnel 部署

目标：群晖 NAS（无公网 IP）跑联机服务器，通过自己的域名 `https://fm.example.com` 对外提供**全功能**版本（账号、SSE 实时同步、服务器联赛推进、Agent/MCP）。

**业务代码无需任何修改**：前端全部走相对路径 `/api/*`，服务器侧无 Origin 校验、无 Cookie 依赖，SSE 已带 15 秒心跳和 `X-Accel-Buffering: no`，可以直接穿过 Cloudflare。

---

## 1. 前置条件

- 群晖 DSM 7.2+（Container Manager），x86 / ARM 均可
- 域名，NS 已托管到 Cloudflare 免费版
- 局域网能访问 NAS

## 2. 准备目录

SSH 或 File Station 创建：

```bash
mkdir -p /volume1/docker/fm-world/data
cd /volume1/docker/fm-world
git clone https://github.com/harjeb/fm_world.git app
cp app/deploy/env.example .env
```

编辑 `.env`，把 `CLOUDFLARE_TUNNEL_TOKEN` 留到第 4 步再填。

> `data/` 与 `app/` 必须是同级目录：`docker-compose.yml` 里的 `./data:/app/data` 相对 compose 文件所在位置解析。

## 3. 建 Cloudflare 隧道

Zero Trust 后台（`one.dash.cloudflare.com`）：

1. **Networks → Tunnels → Create a tunnel** → 选 **Cloudflared**
2. 隧道名随意，例如 `fm-world`
3. 复制生成的 `--token` 后面那串，粘进 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN=`
4. 进隧道 → **Public Hostname → Add a public hostname**
   - Subdomain: `fm`
   - Domain: `你的域名`
   - Type: `HTTP`
   - URL: **`fm:8787`**
5. 保存

第 4 步的 `fm` 是 compose 里的服务名，cloudflared 容器和它同处 `fmnet` 网络，Docker 内置 DNS 会解析。**不要写 `localhost`**——那指的是 cloudflared 容器自己。

## 4. 启动

Container Manager → **项目 → 新增** → 路径选 `/volume1/docker/fm-world` → 使用现有 `docker-compose.yml` → 构建并启动。

或 SSH：

```bash
cd /volume1/docker/fm-world
docker compose up -d --build
docker compose logs -f fm          # 看到 "FM online server: http://localhost:8787"
```

健康检查通过后 `docker compose ps` 里 `fm_world` 显示 `healthy`。

## 5. 验证

| 检查 | 命令 / 地址 |
|---|---|
| 局域网 | `http://NAS-IP:18787` |
| 公网首页 | `https://fm.你的域名` |
| 健康接口 | `https://fm.你的域名/api/health` → `{"ok":true,...}` |
| SSE | 登录后账号面板显示「SSE 已连接」且带「已同步」 |

公网首页能打开但 `/api/health` 404 → 隧道 hostname 的 URL 写错了（应指向 `fm:8787`）。
页面能打开、登录后 SSE 一直「重连中」→ 检查是否在 Cloudflare 前面套了会缓冲响应的反向代理；本方案不需要额外反代。

## 6. 注册控制（不需要 Cloudflare Access）

Cloudflare Access 是按人头计费的企业零信任（免费 50 席，付费约 $7/人/月），游戏不需要它。本项目自带账号体系（用户名 + scrypt 密码 + 会话令牌 + Agent 令牌隔离），用下面的环境变量控制谁能注册：

| 变量 | 默认 | 说明 |
|---|---|---|
| `FM_REGISTRATION` | `open` | `open` 谁都能注册；`invite` 必须填邀请码；`closed` 只能登录 |
| `FM_INVITE_CODE` | 空 | `invite` 模式必填，缺失时启动会自动降级为 `closed` 并打日志 |
| `FM_REGISTER_LIMIT_PER_HOUR` | `5` | 单 IP 每小时注册次数，`0` 不限 |
| `FM_TURNSTILE_SITEKEY` | 空 | Cloudflare Turnstile 站点 key，空则跳过人机验证 |
| `FM_TURNSTILE_SECRET` | 空 | Turnstile 服务端 secret，配了才会真正校验 |

### Turnstile 人机验证（免费、不限量、不限站点数）

1. Cloudflare 后台 → **Turnstile → Add widget**
2. Hostname 填 `fm.你的域名`
3. 拿 **Site Key** 填 `FM_TURNSTILE_SITEKEY`，**Secret Key** 填 `FM_TURNSTILE_SECRET`
4. `docker compose up -d` 重建容器

效果：注册表单多一个人机验证框，机器人过不去，真人注册**无人数上限**。只配了 secret 没配 sitekey 时前端不显示控件、后端仍会拒绝——两个要么都配，要么都不配。

### 按场景选组合

| 场景 | 配置 |
|---|---|
| 只有自己玩 | `FM_REGISTRATION=closed` |
| 拉朋友 | `FM_REGISTRATION=invite` + `FM_INVITE_CODE` |
| 公开给陌生人 | `FM_REGISTRATION=open` + Turnstile + 限速（默认 5/小时） |

前端行为由 `GET /api/public-config` 
下发（只返回注册模式与 sitekey，**邀请码和 secret 永不下发**）：`closed` 隐藏“去注册”按钮，`invite` 多一个邀请码输入框。

### 还是想用 Access 的话

**Zero Trust → Access → Applications → Add an application → Self-hosted**，Domain 填 `fm.你的域名`，Policy 选 `Allow` + `Emails`/`GitHub`。免费 50 席是整个账号共享的。

注意：启用 Access 后 Agent / MCP 请求 `/api/agent/*` 也会被拦，需为该路径单开一条 `Bypass` 策略（Agent 令牌本身已鉴权，与会话令牌隔离）。

## 7. 备份

存档就三个 JSON：`data/accounts.json`、`data/world.json`、`data/sessions.json`。

Hyper Backup 直接备份 `/volume1/docker/fm-world/data`。或加一条计划任务：

```bash
cd /volume1/docker/fm-world && mkdir -p backup && \
  tar czf "backup/fm-$(date +%F).tar.gz" data && \
  find backup -name 'fm-*.tar.gz' -mtime +30 -delete
```

`world.json` 会随赛季推进增大，长期跑建议每月确认一次体积。

## 8. Agent / MCP 接入

令牌在游戏内账号面板生成，然后：

```bash
FM_AGENT_TOKEN=fm_... FM_SERVER=https://fm.你的域名 npm run mcp
```

- `docs/agent-api.md` 通过 `GET /api/agent/docs` 在线获取（镜像内已包含 `docs/`）
- 令牌走 HTTPS Header 明文传输，勿在公共网络使用

## 9. 常见问题

**`/api/agent/docs` 返回 404**
镜像里缺 `docs/` 目录。本项目 Dockerfile 已 `COPY docs ./docs`；若自定义镜像请补上——该接口用 `path.resolve('docs/agent-api.md')`，依赖容器工作目录为 `/app`。

**`data/` 权限报错**
本 Dockerfile 以 root 运行，便于群晖 bind mount。若改为非 root，需先 `chown -R 1026:100 /volume1/docker/fm-world/data`（群晖用户 GID 通常为 100）。

**注册时提示“邀请码不正确”但填的就是那个值**
检查 `FM_INVITE_CODE` 是否被 shell 或 compose 的 `$` 展开污染。邀请码含 `$` 时在 `.env` 里用单引号：`FM_INVITE_CODE='a$b123'`。首尾空格服务端会自动 trim。

**人机验证一直加载不出来**
站点必须走 HTTPS（`https://fm.你的域名`），Turnstile 不接受通过 `http://` 或 IP 访问的域名；另外确认 `FM_TURNSTILE_SITEKEY` 与 `FM_TURNSTILE_SECRET` 成对配置。

**注册返回 429**
命中单 IP 限速。调大 `FM_REGISTER_LIMIT_PER_HOUR` 或设 `0` 关闭；走 Cloudflare 隧道时服务端读的是 `cf-connecting-ip`，能拿到真实客户端 IP。

**公网地址比局域网慢 / 存档同步有 1-2 秒延迟**
正常。每次存档写入会经 Cloudflare 回源，属于预期。

**想停掉公网只留局域网**
`docker compose stop cloudflared`，局域网 `http://NAS-IP:18787` 不受影响。

**升级到新版本**

```bash
cd /volume1/docker/fm-world/app && git pull && cd .. && docker compose up -d --build
```

`data/` 在宿主机上，重建容器不丢档。
