# 面向 2026 的 AI 原生产品设计工具（选题 28）

AI 原生的产品设计与研发协同平台：**自然语言 → 可编辑设计稿 → 一致化代码**。
开发依据：`面向2026的AI原生产品设计工具 — 项目总设计文档（v2.2 定稿）.docx`（唯一开工依据）。

## 仓库结构

```
backend/       Python FastAPI 单后端（:8000）——AI 编排/资产/导出/上传/版本/MCP/鉴权
frontend/      React 19 + Vite + TS + Tailwind 4 + shadcn/ui（dev :5173 / prod :8080）
shared/        design-schema.json（DesignNode Schema 唯一源）+ design-system.yaml（令牌唯一源）
docker/        docker-compose.yml + y-websocket 本地构建
scripts/       令牌生成（generate_tokens.py）、评测脚本
docs/          开发文档（API 契约、评测口径、部署）
.agents/skills/ 4 人虚拟团队角色 Skill（架构师/AI 管线/后端/前端）
.github/       GitHub Actions CI
```

## 快速开始（本机开发）

1. **Docker 基础服务**（PG / Redis:6380 / Jaeger / y-websocket:1234）：
   ```bash
   cd docker && docker compose up -d postgres redis jaeger y-websocket
   ```
   > 本机端口特例：Redis 映射 6380（本机 6379 被 Windows 原生 Redis 占用）；
   > 前端 nginx 映射 8080（本机 80 被 Apache 占用）。

2. **后端**（Python 3.13 venv）：
   ```bash
   cd backend
   python -m venv .venv
   .venv/Scripts/pip install -r requirements.txt   # Windows；Linux/macOS 用 .venv/bin/pip
   .venv/Scripts/python -m uvicorn app.main:app --port 8000
   ```

3. **前端**（Node 22+）：
   ```bash
   cd frontend
   npm install
   npm run dev        # http://localhost:5173（登录：demo / demo123）
   ```

4. **LLM 配置**：默认 `LLM_MODE=mock`（单测/开发零网络）。要真实生成，复制 `.env.template`
   为 `.env` 并填写 `LLM_API_KEY`/`LLM_MODEL`，设 `LLM_MODE=real`。**API Key 只放 .env，不入库。**

## 测试

| 层级 | 命令 | 说明 |
|:---|:---|:---|
| 后端单测+接口测试 | `cd backend && .venv/Scripts/python -m pytest tests/` | Mock LLM，零网络，可进 CI |
| 前端单测 | `cd frontend && npx vitest run` | 几何换算/树操作/组件（含转义用例） |
| E2E 冒烟 | `cd frontend && npx playwright test` | 需先起前后端（登录→画布→拖拽→缩放命中） |
| 静态检查 | `ruff check backend/ scripts/` / `npm run build`（tsc） | |

## 阶段进度

> 口径：**以代码为准**（2026-09-11 核对，基线 `fix/p0-baseline-defects` @ `9aacb52`）。逐条需求对照见交付包内 `newdocs/需求-实现映射矩阵.md`。

- ✅ 阶段 1：工程底座 + Schema 定稿 + 令牌体系 + 后端骨架 + 画布渲染/拖拽/缩放 + Docker 四服务 + CI
- ✅ 阶段 2：15 组件库 + 编辑能力（属性面板/对齐分布/图层树）+ Yjs 协作 + 操作级撤销
- ✅ 阶段 3：AI 生成管线（8 模板 + 自由生成 + 4 档追问 + 增量编辑 + 探索 2 方案）+ 聊天面板
- ✅ 阶段 4：导出引擎（React 19 + TS 完整 Vite 工程 ZIP + 自包含 `preview.html`）+ 还原度评测 82.3%
- ✅ 阶段 5：协作（房间隔离/presence/断线提示）+ 会话隔离（PG 三表）+ 版本历史 + 图片上传
- ✅ 阶段 6：MCP Server（3 工具）+ API 配置页 + 鉴权与会话加固 + 部署文档 + 项目设计报告

**尚未完成（已登记，见交付包内 `newdocs/需求-实现映射矩阵.md` 与 `docs/交付缺口清单.md`）**：

- ❌ 协作同步延迟（≤200ms）**无实测数据**——四大指标中唯一空白项
- ⚠️ 导出工程对上传图片仍引用 `/api/images/{id}`，脱离平台后图片 404（P0 缺口，方案见 `newdocs/ADR/008-图片导出资源内联方案.md`）
- ⚠️ 超大型页面生成 40.4s（目标 ≤30s）；Vue 导出未实现；MCP 写工具为轻量过渡版

**测试基线（2026-09-11 实测）**：pytest **299 passed** ｜ vitest **329 passed / 39 文件** ｜ Playwright E2E 39 用例（**未执行**，需浏览器）

## 关键约定（v2.2 铁律）

- Schema 冻结后先改 Schema 再改代码；`design-schema.json` 与 `design-system.yaml` 是唯一源。
- 令牌改完跑 `python scripts/generate_tokens.py`，双端常量同步生成。
- 画布核心逻辑手写（DOM+flex，不用 Fabric.js）；导出只走模板拼装；用户输入必须转义。
