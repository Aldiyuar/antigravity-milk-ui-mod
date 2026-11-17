<#
.SYNOPSIS
  Устанавливает Antigravity Milk UI Mod (тема + обои + панель токенов и карта роя).
.DESCRIPTION
  Копирует скрипты в %USERPROFILE%\.gemini\antigravity\tools,
  обои в %USERPROFILE%\.gemini\antigravity\wallpapers и Apply_AG_UI_Mods.bat на Рабочий стол,
  затем (если не указан -NoPatch) применяет патч к Antigravity.
#>
param(
    [switch]$NoPatch = $false,
    [switch]$BuildOnly = $false,
    [switch]$NoDesktopBat = $false,
    [switch]$SkipWallpapers = $false,
    [string]$TargetGeminiDir = "$env:USERPROFILE\.gemini\antigravity",
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = "Stop"
$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

$srcTools = Join-Path $repoRoot "tools"
$srcWallpapers = Join-Path $repoRoot "wallpapers"
$srcBat = Join-Path $repoRoot "Apply_AG_UI_Mods.bat"

$dstTools = Join-Path $TargetGeminiDir "tools"
$dstWallpapers = Join-Path $TargetGeminiDir "wallpapers"

Write-Host "=== Antigravity Milk UI Mod Installer ===" -ForegroundColor Cyan

# 1. Check Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js не найден в PATH. Установите Node.js (LTS) и повторите попытку." -ForegroundColor Red
    exit 1
}

# 2. Check Antigravity installation (unless -NoPatch)
$agAsar = "$env:LOCALAPPDATA\Programs\Antigravity\resources\app.asar"
if (-not $NoPatch -and -not (Test-Path $agAsar)) {
    Write-Host "[ERROR] Не найден Antigravity по пути: $agAsar" -ForegroundColor Red
    Write-Host "        Если Antigravity установлен в другую папку, поправьте `$appDir в update_antigravity_mods.ps1." -ForegroundColor Yellow
    exit 1
}

# 3. Copy mod scripts
New-Item -ItemType Directory -Path $dstTools -Force | Out-Null
foreach ($f in @("antigravity_core_mod.js", "update_antigravity_mods.ps1", "restart_and_apply.ps1")) {
    $src = Join-Path $srcTools $f
    if (-not (Test-Path $src)) {
        throw "Не найден обязательный файл: $src"
    }
    Copy-Item $src (Join-Path $dstTools $f) -Force
}
Write-Host "[OK] Скрипты скопированы в $dstTools" -ForegroundColor Green

# 4. Syntax check core UI mod
& node --check (Join-Path $dstTools "antigravity_core_mod.js")
if ($LASTEXITCODE -ne 0) {
    throw "Ошибка синтаксиса в antigravity_core_mod.js"
}

# 5. Copy wallpapers
if (-not $SkipWallpapers -and (Test-Path $srcWallpapers)) {
    New-Item -ItemType Directory -Path $dstWallpapers -Force | Out-Null
    $wpFiles = @(Get-ChildItem -Path $srcWallpapers -File)
    foreach ($wp in $wpFiles) {
        Copy-Item $wp.FullName (Join-Path $dstWallpapers $wp.Name) -Force
    }
    Write-Host "[OK] Обои ($($wpFiles.Count) шт.) скопированы в $dstWallpapers" -ForegroundColor Green
}

# 6. Copy Apply_AG_UI_Mods.bat to Desktop
if (-not $NoDesktopBat -and (Test-Path $srcBat) -and $DesktopDir) {
    if (-not (Test-Path $DesktopDir)) { New-Item -ItemType Directory -Path $DesktopDir -Force | Out-Null }
    Copy-Item $srcBat (Join-Path $DesktopDir "Apply_AG_UI_Mods.bat") -Force
    Write-Host "[OK] Apply_AG_UI_Mods.bat скопирован на Рабочий стол ($DesktopDir)" -ForegroundColor Green
}

if ($NoPatch) {
    Write-Host "`nФайлы разложены (-NoPatch). Для применения запустите Apply_AG_UI_Mods.bat." -ForegroundColor Cyan
    exit 0
}

# 7. Run patcher
$updater = Join-Path $dstTools "update_antigravity_mods.ps1"
if ($BuildOnly) {
    & $updater -BuildOnly
} else {
    & $updater -ForceClose -AutoRestart
}
exit $LASTEXITCODE
