# y-websocket 服务（v2.2 §8.1：官方镜像不可达时的本地构建，与官方做法同源）
# 运行：node node_modules/y-websocket/bin/server.js（读取 HOST/PORT/ROOM/YPERSISTENCE 环境变量）
FROM node:22-alpine

WORKDIR /app

# 固定 y-websocket 2.1.0（2.x 带 bin/server.cjs，支持 HOST/PORT/ROOM/YPERSISTENCE；
# 3.x 重构为纯库无 bin，故不用）
RUN npm install --silent y-websocket@2.1.0

EXPOSE 1234

CMD ["node", "node_modules/y-websocket/bin/server.cjs"]
