# ============================================================
#  T13-A3：启用仓库自带的 git hooks（把「人记得跑 precommit」变成机制）
#
#  作用：git config core.hooksPath .githooks —— 只改【当前仓库】的配置
#        （绝不加 --global，不动用户全局配置）。
#  效果：此后每次 git commit 会先执行 .githooks/pre-commit → scripts/precommit.ps1，
#        被拦（EXIT=1）即中止提交。
#
#  用法：powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1
#  停用：git config --unset core.hooksPath
#  临时跳过：git commit --no-verify（仅限明确知道原因时使用）
# ============================================================
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    Write-Host '[FAIL] git config core.hooksPath .githooks 执行失败' -ForegroundColor Red
    exit 1
}

$current = git config --get core.hooksPath
Write-Host "[OK]   已启用：core.hooksPath = $current" -ForegroundColor Green
Write-Host '       此后每次 git commit 将先跑 scripts/precommit.ps1；被拦即中止提交。' -ForegroundColor Green
Write-Host '       停用：git config --unset core.hooksPath' -ForegroundColor Yellow
Write-Host '       临时跳过：git commit --no-verify（仅限明确知道原因时使用）' -ForegroundColor Yellow
