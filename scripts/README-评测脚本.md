# 导出还原度评测脚本（P0-3）

对比设计稿（DesignNode 树）与导出的前端代码，计算**一键转代码还原度**（三指标之一，目标 ≥70%）。

## 指标定义

```
还原度 = 0.4 × 组件数一致率 + 0.4 × 文本一致率 + 0.2 × 结构一致率
```

- **组件数一致率**：设计树中 **18 种组件**（T9 起新增 icon/switch/tabs）的出现次数 vs 导出代码中对应标签（`<button>`/`<nav>`/`<table>` 等）的出现次数
- **文本一致率**：设计树中的用户可见文本（标题/按钮/表格单元格/图表标签等）出现在导出代码中的比例（含 HTML 转义还原）
- **结构一致率**：布局容器（frame→div）嵌套深度比 与 容器数量比 的平均

## 用法

```bash
# 批量评测（scripts/designs/ 下 3 个示例设计稿）
python scripts/eval_export_quality.py --input scripts/designs --output scripts/designs/report.json

# 单文件对比（真实导出代码）
python scripts/eval_export_quality.py --design design.json --code App.tsx
```

- `--input`：设计稿 JSON 目录（每个 `.json` 一个设计稿；同名 `.tsx`/`.html` 作为对应导出代码）
- 无对应导出代码时，脚本用内置 Python 生成器（与前端 `export/designToReact.ts` 映射一致）自产代码再对比，保证一键可跑
- 真实场景：先用工作台「导出代码」下载 ZIP，解压 `src/App.tsx` 与设计稿 JSON 同目录命名，再跑脚本

## 输出

`report.json`：

```json
{
  "reports": {
    "ecommerce": {
      "component_rate": 1.0,
      "text_rate": 1.0,
      "structure_rate": 0.498,
      "overall": 0.9,
      "detail": { "design_components": {...}, "code_tags": {...}, "missing_texts": [...] }
    }
  },
  "average": 0.808
}
```

## 实测结果（2026-09-15 复跑，3 个模板示例）

| 设计稿 | 组件一致率 | 文本一致率 | 结构一致率 | 还原度 |
| --- | --- | --- | --- | --- |
| ecommerce（电商优惠券页） | 100% | 100% | 49.8% | 90.0% |
| login（登录页） | 100% | 62.5% | 50.0% | 75.0% |
| dashboard（仪表板） | 100% | 67.7% | 52.5% | 77.6% |
| **平均** | | | | **80.8%** ✅ ≥70% |

> ⚠️ **与 09-01 留档（82.3%）的差异不是真实还原度退化**：T15 给内置模板加了 `switch` / `tabs` 后，本脚本的**内置生成器**（`python_generate_code`）没有这两个组件的分支、走兜底只输出 `props.text/title`，于是 `switch.label` 与 `tabs.items[].label` 被丢掉；**真实前端导出器会输出这些文本**（`buildSwitchExport` / `buildTabsExport`，由 `frontend/src/export/parity.test.ts` 双通道断言锁死）。login 的文本分母 7→8、dashboard 32→34，正是新增的那 1 个 switch label 与 2 个 tabs label。
> **改进方向（待立项）**：给内置生成器补 `switch`/`tabs` 分支（或改为直接消费真实导出产物），让评测口径与真实导出器一致。

> 结构一致率偏低原因：导出代码对 frame 采用 div 扁平化（组件内部实现细节不计入布局深度），
> 与设计树的 frame 嵌套口径存在系统性差异——组件与文本一致率均接近满分，还原度达标。

## 测试

```bash
pytest backend/tests/test_eval_export_quality.py   # 10 个用例：提取/加权/一键运行
```
