# FM 世界 — 联机服务器镜像（Node + 静态站点同端口）
# 目标：群晖 Container Manager / 任意 Docker 主机，配合 Cloudflare Tunnel 使用。

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    FM_DATA_DIR=/app/data \
    FM_STATIC_DIR=/app/dist \
    FM_TICK_MS=30000

# 运行期需要 tsx（devDependency），因此不做 --omit=dev。
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules

# dist: 静态站点；server/src: 运行时 TS；docs: /api/agent/docs 依赖 path.resolve('docs/...')；
# tsconfig.json: tsx 解析路径别名/编译选项要用。
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/docs ./docs
COPY --from=build /app/tsconfig.json ./

# 存档目录：compose 会把宿主机目录挂到这里，容器重建不丢档。
RUN mkdir -p /app/data

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 直接运行 Node，确保容器 SIGTERM 到达应用并执行退出前 flush。
CMD ["node", "--import", "tsx", "server/index.ts"]
