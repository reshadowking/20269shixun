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

0. **克隆后一次性**：`powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1`
   —— 把 `scripts/precommit.ps1` 挂成 git pre-commit hook（停用：`git config --unset core.hooksPath`）。

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

> 口径：**以代码为准**（2026-09-14 刷新，基线 `fix/p0-baseline-defects` @ `6d3a28c`）。逐条需求对照见交付包内 `newdocs/需求-实现映射矩阵.md`。

- ✅ 阶段 1：工程底座 + Schema 定稿 + 令牌体系 + 后端骨架 + 画布渲染/拖拽/缩放 + Docker 四服务 + CI
- ✅ 阶段 2：**18 组件库**（T9 起新增 icon / switch / tabs）+ 编辑能力（属性面板/对齐分布/图层树）+ Yjs 协作 + 操作级撤销
- ✅ 阶段 3：AI 生成管线（8 模板 + 自由生成 + 4 档追问 + 增量编辑 + 探索 2 方案）+ 聊天面板
- ✅ 阶段 4：导出引擎（React 19 + TS 完整 Vite 工程 ZIP + 自包含 `preview.html`）+ 还原度评测 **80.8%**（三模板平均，达标口径见交付包内 `newdocs/项目度量指标总览.md`）
- ✅ 阶段 5：协作（房间隔离/presence/断线提示）+ 会话隔离（PG 三表）+ 版本历史 + 图片上传
- ✅ 阶段 6：MCP Server（3 工具）+ API 配置页 + 鉴权与会话加固 + 部署文档 + 项目设计报告

**尚未完成（已登记，见交付包内 `newdocs/需求-实现映射矩阵.md` 与 `docs/交付缺口清单.md`）**：

- ⚠️ 超大型页面生成 40.4s（目标 ≤30s，中低复杂度 23.9s 达标）；**Vue 导出未实现**；MCP 写工具为轻量过渡版
- ⚠️ 还原度整体 **80.8%**，其中**结构分仅 ~50%**（评测脚本用 tag/深度启发式，非业务 AST 比对）；且该脚本的**内置生成器不输出 `switch`/`tabs` 的标签文本**（真实导出器会输出），分数偏低约 1.5pp（口径详见度量总览）
- ⚠️ 组件推荐引擎不含用户画像；模板暂未启用新组件（icon/switch/tabs）

> ✅ **已补齐（曾登记为缺口）**：协作同步延迟已实测 **P50 27ms / P95 36ms**（目标 ≤200ms 达标，数据 `docs/reverse/collab-latency.json`）；导出工程的图片已**内联为 base64**（ADR-008）；测试门禁已加**本地 pre-commit 自动挂载**（克隆后跑 `scripts/install-hooks.ps1` 启用）。

**测试基线（2026-09-14 实测，HEAD `6d3a28c`）**：pytest **385 passed**（后端覆盖率 **94%**）｜ vitest **505 passed / 49 文件**（前端覆盖率：语句 **72.06%** / 分支 **62.47%** / 函数 **67.37%** / 行 **74.07%**）｜ Playwright E2E **52 用例 / 26 spec**（本地执行：空库 52 passed、复用库 51 passed + 1 skipped）

## 关键约定（v2.2 铁律）

- Schema 冻结后先改 Schema 再改代码；`design-schema.json` 与 `design-system.yaml` 是唯一源。
- 令牌改完跑 `python scripts/generate_tokens.py`，双端常量同步生成。
- 画布核心逻辑手写（DOM+flex，不用 Fabric.js）；导出只走模板拼装；用户输入必须转义。

## 本轮收口（2026-09-15：T16–T25，7 个提交）

> 起因：用真实模型跑生成/编辑后，画布出现过"被清空"、"整稿回退模板"、"改了不该改的颜色"等问题。本轮按任务卡逐张修复，每张卡 1 个提交。

| 提交 | 一句话 |
| --- | --- |
| `e7ac49a` T16 | 编辑结果**丢失既有节点即拒绝**（空壳树不再清空画布） |
| `2a43376` T17 | 解包 `{"design": {...}}` 类包裹并抢救根节点 id（日志里 76 次 Schema 失败全是这条） |
| `4dbc953` T24 | 会话历史接进生成链路（最近 2 轮原文+机器摘要），有稿时"太丑了/再来一版"不再被守卫误拦 |
| `6049d27` T18 | 运行期注入 18 个组件的 props 契约与 1 个正例（此前模型只能猜字段名） |
| `a742371` T19 | 合规兜底不再把非 hex 值刷成 `primary`；`#fff` 归一；组件库 `"card"` 默认值修正 |
| `14a4a31` T25 | 推荐引擎白名单断言改为引用唯一来源并覆盖 `switch`/`tabs` 分支 |
| `d33b864` T20 | **AI 生成专用线程池 + 并发闸门 + 整链路时间预算**（画布业务不再被生成拖住） |
| `0b1a885` T21 | AI 调用记账与溯源：`ai_calls` 表 + 提示词版本哈希 + `scripts/report_ai_calls.py`，MCP 路径一并接入 |
| `f4a4a54` T22 | 熔断（失败率/连续失败）+ 限流（用户/全局令牌桶）+ 日 token 配额；熔断打开仍出稿不返 5xx |
| `b2a0df8` T23 | 编辑改输出 **ops 结构化增量**（6 种 op、整批原子、删节点必须显式 remove） |

**测试基线（2026-09-15 实测）**：pytest **454 passed** ｜ vitest **510 passed / 49 文件** ｜ ruff / `tsc -b` / `scripts/precommit.ps1` 全绿。
**指标口径变化**：合规率不再把"合法但非令牌的写法（CSS 关键字、3/8 位 hex）"计入违规（同一份设计稿 14.3% → 71.4%），详见 `newdocs/项目度量指标总览.md`。
**已知限制**：生成网关是**进程内**实现（`--workers>1` 时各 worker 各自计数）；E2E 需本地 docker（y-websocket）+ mock 后端，本轮未在受限环境执行；MCP 路径不带 `session_key`，因而不取会话历史。
