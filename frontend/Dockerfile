# 前端镜像：构建（Node）→ 产物（nginx）
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
# 令牌常量是生成的源码（tokens.generated.ts 已随仓库存在），无需再生成
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
