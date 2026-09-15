# ============================================================
#  提交前轻量门禁（pre-commit）
#
#  用途：把「文档纪律 + lint 门禁」从"靠人记得"变成"一条命令"，
#        防止历史上反复出现的两类事故：
#          ① git add . 误提交日志/评测产物/密钥（见 docs/CI测试说明.md §坑 3）
#          ② ruff 红灯未修就提交（见 docs/交付缺口清单.md §3.1）
#
#  用法：
#     powershell -ExecutionPolicy Bypass -File scripts/precommit.ps1
#     powershell -File scripts/precommit.ps1 -WithTests      # 额外跑 pytest + vitest（慢）
#     powershell -File scripts/precommit.ps1 -AllowDocs      # 明确允许提交 .md 时用
#
#  退出码：0 = 通过；1 = 有拦截项（不要提交）
# ============================================================
param(
    [switch]$WithTests,
    [switch]$AllowDocs
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$errors = @()
$warnings = @()

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [WARN] $t" -ForegroundColor Yellow; $script:warnings += $t }
function Fail($t) { Write-Host "  [FAIL] $t" -ForegroundColor Red; $script:errors += $t }

# ---------- 1. 暂存区路径自查（防误提交）----------
Section '1/4 暂存区路径自查'

$staged = @(git diff --cached --name-only 2>$null)
if ($staged.Count -eq 0) {
    Warn '暂存区为空（先 git add 再跑本脚本）'
} else {
    Ok "暂存文件数：$($staged.Count)"
}

# 禁止清单：路径正则 → 说明
$forbidden = @(
    @{ re = '(^|/)\.env$|(^|/)\.env\.[a-z]+$';        why = '环境文件（含真实密钥）' },
    @{ re = '\.log$|(^|/)logs_.*\.txt$';              why = '运行日志' },
    @{ re = 'report\.json$';                          why = '评测产物（CI 文档 §坑 3 事故）' },
    @{ re = '\.db$|\.sqlite3$';                        why = '本地测试数据库' },
    @{ re = '\.zip$';                                  why = '打包产物' },
    @{ re = 'llm-config\.json$|(^|/)backend/data/';    why = '运行时配置（含 API Key）' },
    @{ re = 'test-results/|playwright-report/';        why = 'E2E 产物' }
)

foreach ($f in $staged) {
    foreach ($rule in $forbidden) {
        if ($f -match $rule.re) { Fail "$f —— 禁止提交（$($rule.why)）" }
    }
    # 文档策略：docs/ newdocs/ lost/ 不入 git；README.md 为例外（见 newdocs/ADR/005 附录）
    if ($f -match '\.md$' -and -not $AllowDocs) {
        if ($f -match '(^|/)README\.md$') { Ok "$f（README 属入库例外，放行）" }
        else { Fail "$f —— 文档不入库（策略见 newdocs/ADR/005）；确需提交请加 -AllowDocs" }
    }
    if ($f -match '^backend/designs/images/') { Fail "$f —— 运行时上传图片，不入库" }
}

# ---------- 2. 后端 lint（ruff）----------
Section '2/4 后端静态检查（ruff）'

$venvWin = Join-Path $repo 'backend/.venv/Scripts/python.exe'
$venvNix = Join-Path $repo 'backend/.venv/bin/python'
$py = if (Test-Path $venvWin) { $venvWin } elseif (Test-Path $venvNix) { $venvNix } else { $null }

if (-not $py) {
    Warn 'backend/.venv 不存在，跳过 ruff（未验证 ≠ 通过）'
} else {
    $ruffOut = & $py -m ruff check backend scripts 2>&1
    if ($LASTEXITCODE -eq 0) { Ok 'ruff：All checks passed' }
    else {
        Fail "ruff 未通过（$LASTEXITCODE）："
        $ruffOut | Select-Object -First 15 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
        Write-Host '         修复：backend\.venv\Scripts\python.exe -m ruff check backend scripts --fix' -ForegroundColor DarkGray
    }
}

# ---------- 3. 前端类型检查（可选，默认跑）----------
Section '3/4 前端类型检查（tsc）'

if (Test-Path (Join-Path $repo 'frontend/node_modules')) {
    Push-Location (Join-Path $repo 'frontend')
    $tscOut = & npx tsc -b 2>&1
    $tscCode = $LASTEXITCODE
    Pop-Location
    if ($tscCode -eq 0) { Ok 'tsc -b 通过' }
    else {
        Fail "tsc 未通过："
        $tscOut | Select-Object -First 10 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }
    }
} else {
    Warn 'frontend/node_modules 不存在，跳过 tsc'
}

# ---------- 4. 测试（可选，-WithTests）----------
Section '4/4 测试套件'

if (-not $WithTests) {
    Warn '已跳过 pytest / vitest（加 -WithTests 运行；**跳过 ≠ 通过**）'
} elseif (-not $py) {
    Warn '无 venv，跳过 pytest'
} else {
    Push-Location (Join-Path $repo 'backend')
    # --basetemp：受限/沙箱环境下系统临时目录可能不可写，改用仓库内临时目录
    $pyOut = & $py -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp_precommit 2>&1
    $pyCode = $LASTEXITCODE
    Remove-Item (Join-Path $repo 'backend/.pytest_tmp_precommit') -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
    $summary = ($pyOut | Select-String -Pattern '\d+ (passed|failed|error)' -CaseSensitive | Select-Object -Last 1).Line
    if ($pyCode -eq 0) { Ok "pytest：$summary" }
    else { Fail "pytest 未通过：$summary" }

    if (Test-Path (Join-Path $repo 'frontend/node_modules')) {
        Push-Location (Join-Path $repo 'frontend')
        $vtOut = & npx vitest run 2>&1
        $vtCode = $LASTEXITCODE
        Pop-Location
        # 注意：Select-String 默认忽略大小写，'Duration ... tests 8.44s' 会被误匹配，故用锚定 + 大小写敏感
        $vtSummary = ($vtOut | Select-String -Pattern '^\s*Tests\s+\d+' -CaseSensitive | Select-Object -Last 1).Line
        if ($vtCode -eq 0) { Ok "vitest：$vtSummary" }
        else { Fail "vitest 未通过：$vtSummary" }
    }
}

# ---------- 汇总 ----------
Write-Host "`n==================== 结论 ====================" -ForegroundColor Cyan
if ($errors.Count -eq 0) {
    Write-Host "  ✅ 通过（warnings: $($warnings.Count)）—— 可以提交" -ForegroundColor Green
    if ($warnings.Count -gt 0) { $warnings | ForEach-Object { Write-Host "     · $_" -ForegroundColor Yellow } }
    exit 0
} else {
    Write-Host "  ❌ 拦截 $($errors.Count) 项，请修复后再提交：" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "     · $_" -ForegroundColor Red }
    exit 1
}
