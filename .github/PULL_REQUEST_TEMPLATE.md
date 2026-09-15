## 提交前自查（白名单纪律，三问）

- [ ] 跑过 `scripts/precommit.ps1` 吗？（EXIT=0 才提交；跳过 ≠ 通过）
- [ ] `pytest` 与 `npx vitest run` 全绿吗？（贴汇总行：passed / failed 数）
- [ ] 有没有夹带 `report.json` / `logs` / `.env` / `.md` / `.db`？（`git diff --cached --name-only` 逐行核对）

> 说明：本仓库有“白名单提交”纪律（见 `docs/AI后续优化与测试提示词.md` §0.3 与 `scripts/precommit.ps1`）；
> 本模板只做最低限度提醒，不替代 precommit 脚本。
