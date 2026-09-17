# 前端镜像：构建（Node）→ 产物（nginx）
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
# 2026-09-17 修：前端源码要 import 仓库根的 shared/（图标库、角色守卫词表）——
#   src/components/canvas/icon/index.tsx → '../../../../../shared/icon-library.json'
#   src/lib/designGuard.ts              → '../../../shared/design-guard-words.json'
# 它们从 /app/src/... 往上解析到 **/shared**，所以这里必须像后端 Dockerfile 一样把 shared 拷进来；
# 否则 `docker compose build frontend` 直接失败（tsc: Cannot find module '…/shared/…'），
# 镜像停留在旧版本（实测本机镜像还是两周前的）。
COPY shared /shared
# 令牌常量是生成的源码（tokens.generated.ts 已随仓库存在），无需再生成
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
