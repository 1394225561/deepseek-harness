<#
.SYNOPSIS
    一键结束本机正在运行的 dsh 进程树：从 pnpm 根执行 taskkill /T /F 树杀，
    连带 cmd.exe 中间层和 dsh 的 node 进程（及其所有子进程）。

.DESCRIPTION
    背景：在 Windows 上通过 `pnpm dsh web` 从源码启动时，实际进程链是
        pwsh(你的终端) -> node(pnpm/corepack) -> cmd.exe(/d /s /c) -> node(dsh bin.ts)
    某些终端环境（如 Warp + PowerShell 7）下按 Ctrl+C 时，控制台中断事件
    不会被传递到这条链里的任何子进程，导致 dsh 无法用 Ctrl+C 结束。
    本脚本自动发现这条链并从最顶层（pnpm 的 node 进程）做 taskkill /T /F 树杀。

    识别方式：dsh 主进程的特征是「node.exe 且命令行包含 apps\cli\src\bin.ts」；
    找到后沿父进程链向上，只要父进程仍是 node.exe(pnpm) 或 cmd.exe（命令行
    匹配启动链特征）就继续向上，直到不匹配为止（通常是你的终端 pwsh），
    链顶即为树杀根。

.PARAMETER DryRun
    只显示将要结束的进程树，不实际执行 taskkill（预览模式）。

.PARAMETER Yes
    跳过交互确认，直接执行树杀（真正的"一键"模式）。

.PARAMETER DshPid
    手动指定 dsh 主进程的 PID（自动发现失效时的兜底手段；
    可用 `tasklist | findstr node` 或任务管理器找到）。

.EXAMPLE
    .\stop-dsh.ps1              # 自动发现 -> 显示进程树 -> 回车确认 -> 树杀
.EXAMPLE
    .\stop-dsh.ps1 -Yes         # 跳过确认，直接树杀
.EXAMPLE
    .\stop-dsh.ps1 -DryRun      # 只看不动，预览将要结束的进程
.EXAMPLE
    .\stop-dsh.ps1 -DshPid 25756 -Yes   # 手动指定 dsh 主进程并直接树杀

.NOTES
    需要用 PowerShell 7 (pwsh) 运行。杀进程会立即中断正在运行的 dsh 会话
    （包括通过它的 Web GUI 对话），请确认没有未保存的工作。
#>

param(
    # 预览模式：只列出将要结束的进程，不执行任何 taskkill
    [switch]$DryRun,

    # 跳过回车确认，直接执行树杀
    [switch]$Yes,

    # 手动指定 dsh 主进程 PID；不传则自动发现
    [int]$DshPid = 0
)

# 任何 cmdlet 出错（如权限拒绝）立即终止脚本，而不是带着坏状态继续跑
$ErrorActionPreference = 'Stop'

# ---- 第 1 步：一次性取回全系统进程快照（后面所有查找都查这份表，避免多次 WMI 往返） ----
$all = Get-CimInstance Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine

# ---- 第 2 步：定位 dsh 主进程 ----
if ($DshPid -gt 0) {
    # 手动指定模式：按传入的 PID 精确查找
    $targets = @($all | Where-Object { $_.ProcessId -eq $DshPid })
    if ($targets.Count -eq 0) {
        Write-Error "未找到 PID 为 $DshPid 的进程。"
    }
}
else {
    # 自动发现模式：dsh 主进程 = node.exe 且命令行里出现源码入口 bin.ts
    # （源码启动和打包产物启动都写 bin.ts，此特征对两者都成立）
    $targets = @($all | Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts'
    })
}

# 一个实例都没找到：说明没有正在运行的 dsh，直接退出
if ($targets.Count -eq 0) {
    Write-Host '没有发现正在运行的 dsh 进程（未找到命令行含 bin.ts 的 node.exe）。' -ForegroundColor Yellow
    exit 0
}

# ---- 第 3 步：对每个 dsh 主进程，沿父链向上找到"树杀根" ----
# 根的判定规则：父进程必须是启动链的一环才算——
#   - node.exe 且命令行是 pnpm/corepack 包装（node_modules pnpm 或 corepack\dist\pnpm.js）
#   - cmd.exe 且命令行带 /d /s /c（pnpm 跑 npm script 用的固定形式）
# 一旦父进程不满足（比如是你的终端 pwsh / bash），就停止上溯，当前链顶即根。
$roots = @()          # 收集所有实例的树杀根
$forest = @()         # 收集所有实例的完整进程链，用于展示

foreach ($target in $targets) {
    # 用 List 头插法构建链：最终 $chain[0] 是链顶（最外层），$chain 末尾是 dsh 本体
    $chain = [System.Collections.Generic.List[object]]::new()
    $current = $target
    while ($null -ne $current) {
        $chain.Insert(0, $current)                    # 头插：父进程排在数组前面
        # 在快照里按 PID 查当前进程的父进程
        $parent = $all | Where-Object { $_.ProcessId -eq $current.ParentProcessId }
        if ($null -eq $parent) { break }              # 父进程已退出（孤儿），上溯终止

        $isNode = ($parent.Name -eq 'node.exe')
        $isCmd  = ($parent.Name -eq 'cmd.exe')
        # pnpm 包装进程的特征：命令行指向 corepack 的 pnpm.js 或 pnpm 包本体
        $isPnpm = $isNode -and ($parent.CommandLine -match 'corepack[\\/]+dist[\\/]+pnpm\.js|node_modules[\\/]pnpm')
        # pnpm 在 Windows 上跑 npm script 固定用 cmd /d /s /c，命令行必含 bin.ts
        $isCmdShim = $isCmd -and ($parent.CommandLine -match '/d /s /c')

        if ($isPnpm -or $isCmdShim) {
            $current = $parent                        # 父进程仍是启动链一环，继续上溯
        }
        else {
            break                                     # 到达链外（你的终端等），停止
        }
    }

    # 树杀根 = 链顶（最外层的 pnpm node 或直接启动时的 dsh node 本身）
    $roots += $chain[0].ProcessId
    $forest += , @($chain)                            # 把整条链存起来，稍后统一展示
}

# ---- 第 4 步：展示将要结束的进程树（DryRun 到这里就结束） ----
for ($i = 0; $i -lt $forest.Count; $i++) {
    Write-Host ''
    Write-Host ("实例 {0}（树杀根 PID = {1}）:" -f ($i + 1), $roots[$i]) -ForegroundColor Cyan
    # 从链顶到链底逐行打印：PID、进程名、命令行（截断到 120 字符防止刷屏）
    foreach ($p in $forest[$i]) {
        $cmdline = if ($p.CommandLine) { $p.CommandLine } else { '<命令行不可见>' }
        if ($cmdline.Length -gt 120) { $cmdline = $cmdline.Substring(0, 120) + ' ...' }
        Write-Host ("  {0,-8} {1,-10} {2}" -f $p.ProcessId, $p.Name, $cmdline)
    }
}

if ($DryRun) {
    Write-Host ''
    Write-Host '[DryRun] 预览结束，未执行任何操作。去掉 -DryRun 参数即可真正执行。' -ForegroundColor Green
    exit 0
}

# ---- 第 5 步：交互确认（-Yes 参数可跳过） ----
if (-not $Yes) {
    Write-Host ''
    Write-Host ('将强制结束上述 {0} 棵进程树（含正在运行的 dsh 与其会话）。回车确认，其他任意键取消:' -f $forest.Count) -ForegroundColor Yellow
    $key = [Console]::ReadKey($true)                  # 读单个按键，不回显
    if ($key.Key -ne [ConsoleKey]::Enter) {
        Write-Host '已取消，未做任何操作。' -ForegroundColor Yellow
        exit 0
    }
}

# ---- 第 6 步：从每个树杀根执行 taskkill /T /F ----
#   /T = 连带结束该进程的整棵子树（cmd.exe、dsh node、dsh 派生的工具子进程全包含）
#   /F = 强制结束（不发送优雅关闭请求，Windows 上等效于无条件终止）
foreach ($rootPid in $roots) {
    Write-Host ''
    Write-Host ("正在树杀根 PID {0} ..." -f $rootPid) -ForegroundColor Cyan
    & taskkill.exe /PID $rootPid /T /F                # 调用系统 taskkill 执行树杀
    if ($LASTEXITCODE -ne 0) {
        # taskkill 失败（如权限不足/进程已退出）时报告退出码，不中断剩余根的处理
        Write-Host ("taskkill 返回非零退出码 {0}，可能有进程未被结束。" -f $LASTEXITCODE) -ForegroundColor Red
    }
}

# ---- 第 7 步：复查确认结果 ----
Start-Sleep -Milliseconds 500                       # 给系统一点时间更新进程表
# 把根 PID 列表拼成 WMI 过滤器：ProcessId=27932 OR ProcessId=29216 ...
$filter = ($roots | ForEach-Object { "ProcessId=$_" }) -join ' OR '
# 重新查一次进程表，确认所有根都已消失
$stillAlive = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue)
if ($stillAlive.Count -gt 0) {
    Write-Host '以下根进程仍未结束，请手动处理:' -ForegroundColor Red
    $stillAlive | ForEach-Object { Write-Host ("  PID {0} {1}" -f $_.ProcessId, $_.Name) }
    exit 1
}

Write-Host ''
Write-Host '全部 dsh 进程树已结束。' -ForegroundColor Green
