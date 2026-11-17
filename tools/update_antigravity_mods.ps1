# ==============================================================================
# Antigravity Mods Auto-Updater & Integrator (v2.32+ / Electron 44+ Compatible)
# Монитор токенов, скорости (tok/s), шагов и контекстного окна внизу экрана
# ==============================================================================

param(
    [switch]$AutoRestart = $true,
    [switch]$NoRestart = $false,
    [switch]$ForceClose = $false,
    [switch]$Rebuild = $false,
    [switch]$BuildOnly = $false,
    [switch]$Restore = $false
)

$ErrorActionPreference = "Stop"

$appDir = "$env:LOCALAPPDATA\Programs\Antigravity"
$resourcesDir = "$appDir\resources"
$asarPath = "$resourcesDir\app.asar"
$backupPath = "$resourcesDir\app.asar.bak"
$toolsDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { "$env:USERPROFILE\.gemini\antigravity\tools" }
if (-not $toolsDir -or -not (Test-Path $toolsDir)) {
    $toolsDir = "$env:USERPROFILE\.gemini\antigravity\tools"
}
$modFile = Join-Path $toolsDir "antigravity_core_mod.js"
$prebuiltAsar = Join-Path $toolsDir "app.asar.patched"
$scriptPath = $MyInvocation.MyCommand.Path

function Write-Utf8NoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Sync-UnpackedModules {
    # Merge prebuilt .unpacked modules into the installed app.asar.unpacked (non-fatal on failure)
    $srcUnpacked = "$prebuiltAsar.unpacked"
    $dstUnpacked = "$asarPath.unpacked"
    if (-not (Test-Path $srcUnpacked)) { return }
    try {
        if (-not (Test-Path $dstUnpacked)) { New-Item -ItemType Directory -Path $dstUnpacked -Force | Out-Null }
        Copy-Item -Path (Join-Path $srcUnpacked '*') -Destination $dstUnpacked -Recurse -Force
    } catch {
        Write-Host "      Предупреждение: не удалось синхронизировать app.asar.unpacked: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-AsarAppVersion {
    param([string]$TargetAsar, [string]$ExePath)
    try {
        $ver = node -e "
const fs = require('fs');
let fd;
try {
  fd = fs.openSync(process.argv[1], 'r');
  const hdrBuf = Buffer.alloc(16);
  if (fs.readSync(fd, hdrBuf, 0, 16, 0) === 16) {
    const baseOffset = 8 + hdrBuf.readUInt32LE(4);
    const headerSize = hdrBuf.readUInt32LE(12);
    if (headerSize > 0 && headerSize < 64 * 1024 * 1024) {
      const jsonBuf = Buffer.allocUnsafe(headerSize);
      fs.readSync(fd, jsonBuf, 0, headerSize, 16);
      const headerStr = jsonBuf.toString('utf8');
      const header = JSON.parse(headerStr.slice(0, headerStr.lastIndexOf('}') + 1));
      const pkg = header.files && header.files['package.json'];
      if (pkg && pkg.size > 0 && pkg.size < 1024 * 1024) {
        const off = baseOffset + parseInt(pkg.offset, 10);
        const pkgBuf = Buffer.allocUnsafe(pkg.size);
        fs.readSync(fd, pkgBuf, 0, pkg.size, off);
        const json = JSON.parse(pkgBuf.toString('utf8'));
        if (json && json.version) process.stdout.write(String(json.version).trim());
      }
    }
  }
} finally {
  if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
}
" $TargetAsar 2>$null
        if ($ver) { return $ver.Trim() }
    } catch {}

    if (Test-Path $ExePath) {
        $fv = (Get-Item $ExePath).VersionInfo.FileVersion
        if ($fv) { return $fv.Trim() }
    }
    return "unknown"
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   Antigravity Mods Integrator (v2.32+ Compatible)   " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

if (-not (Test-Path $asarPath)) {
    Write-Host "Ошибка: app.asar не найден по пути $asarPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $modFile)) {
    Write-Host "Ошибка: файл улучшений не найден: $modFile" -ForegroundColor Red
    exit 1
}

# 0. Check running processes (skipped in BuildOnly mode)
$runningProcesses = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue)
$wasRunning = ($runningProcesses.Count -gt 0)

if (-not $BuildOnly -and $wasRunning) {
    Write-Host "[0/5] Antigravity запущен ($($runningProcesses.Count) процессов)." -ForegroundColor Yellow
    Write-Host "      Windows блокирует app.asar во время работы программы." -ForegroundColor Yellow

    $shouldClose = $ForceClose
    if (-not $shouldClose) {
        $ans = Read-Host "Закрыть Antigravity для применения обновления интерфейса? (Y/n)"
        if ($ans -eq "" -or $ans -match "^[yYдД]") {
            $shouldClose = $true
        }
    }

    if ($shouldClose) {
        Write-Host "Завершение процессов Antigravity..." -ForegroundColor Gray
        $runningProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        $waitTicks = 0
        while ((Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue) -and ($waitTicks -lt 25)) {
            Start-Sleep -Milliseconds 200
            $waitTicks++
        }
    } else {
        Write-Host "Обновление отменено: закройте Antigravity вручную и запустите скрипт снова." -ForegroundColor Yellow
        exit 0
    }
}

$appVersion = Get-AsarAppVersion -TargetAsar $asarPath -ExePath "$appDir\Antigravity.exe"
$bakVersion = if (Test-Path $backupPath) { Get-AsarAppVersion -TargetAsar $backupPath -ExePath "$appDir\Antigravity.exe" } else { "" }

# -Restore: put the original app.asar back (rollback of all UI mods)
if ($Restore) {
    if ($BuildOnly) { Write-Host "Ошибка: -Restore несовместим с -BuildOnly." -ForegroundColor Red; exit 1 }
    if (-not (Test-Path $backupPath)) { Write-Host "Ошибка: резервная копия $backupPath не найдена." -ForegroundColor Red; exit 1 }
    if ($appVersion -ne "unknown" -and $bakVersion -ne $appVersion) {
        Write-Host "Ошибка: версия резервной копии ($bakVersion) не совпадает с установленной ($appVersion). Откат отменён, чтобы не сломать приложение." -ForegroundColor Red
        exit 1
    }
    Copy-Item $backupPath $asarPath -Force
    Write-Host "Оригинальный app.asar восстановлен (версия $bakVersion). UI-моды отключены." -ForegroundColor Green
    if ($wasRunning -and $AutoRestart -and (-not $NoRestart)) {
        Write-Host "Перезапуск Antigravity (от имени администратора)..." -ForegroundColor Cyan
        $env:AG_LAUNCH_EXE = "$appDir\Antigravity.exe"
        Start-Process -FilePath "powershell.exe" -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath $env:AG_LAUNCH_EXE -Verb RunAs"' -WindowStyle Hidden
    }
    exit 0
}

# 1. Backup original app.asar (when not BuildOnly)
if (-not $BuildOnly) {
    Write-Host "[1/5] Проверка резервной копии оригинального app.asar..." -ForegroundColor Gray
    if (-not (Test-Path $backupPath) -or ($bakVersion -ne $appVersion -and $appVersion -ne "unknown")) {
        $isAlreadyModded = $false
        try {
            $rawBytes = [System.IO.File]::ReadAllBytes($asarPath)
            $asciiProbe = [System.Text.Encoding]::ASCII.GetString($rawBytes)
            if ($asciiProbe.Contains("antigravityTokenBridge")) { $isAlreadyModded = $true }
        } catch {}
        if (-not $isAlreadyModded) {
            Write-Host "      Создание актуальной резервной копии app.asar.bak (версия $appVersion)..." -ForegroundColor Gray
            Copy-Item $asarPath $backupPath -Force
            $bakVersion = $appVersion
        } elseif (-not (Test-Path $backupPath)) {
            Write-Host "      Внимание: текущий app.asar уже содержит моды, чистый app.asar.bak не создан." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[1/5] Режим BuildOnly: сборка app.asar.patched без остановки Antigravity..." -ForegroundColor Cyan
}

$sourceAsar = $asarPath
$prebuiltVersion = if (Test-Path "$prebuiltAsar.ver") { (Get-Content "$prebuiltAsar.ver" -Raw).Trim() } else { "" }
$scriptNewer = ($scriptPath -and (Test-Path $prebuiltAsar) -and ((Get-Item $scriptPath).LastWriteTime -gt (Get-Item $prebuiltAsar).LastWriteTime))
$useFastInstall = (Test-Path $prebuiltAsar) -and (-not $Rebuild) -and (-not $BuildOnly) -and (-not $scriptNewer) -and ($appVersion -ne "unknown") -and ($prebuiltVersion -eq $appVersion)

if ($useFastInstall) {
    Write-Host "[2/5] Версия приложения ($appVersion) совпадает. Установка пакета app.asar.patched..." -ForegroundColor Green
    Copy-Item $prebuiltAsar $asarPath -Force
    Sync-UnpackedModules
} else {
    if ($prebuiltVersion -ne $appVersion -and $prebuiltVersion -ne "") {
        Write-Host "[2/5] Обнаружено обновление Antigravity (версия $appVersion, в кэше $prebuiltVersion). Выполняется пересборка..." -ForegroundColor Yellow
    } elseif ($scriptNewer) {
        Write-Host "[2/5] Скрипт сборки обновлён. Выполняется пересборка app.asar.patched ($appVersion)..." -ForegroundColor Yellow
    }

    $tempExtract = "$env:TEMP\antigravity_update_asar"
    if (Test-Path $tempExtract) {
        Remove-Item $tempExtract -Recurse -Force
    }

    Write-Host "[2/5] Распаковка $(Split-Path -Leaf $sourceAsar) (версия $appVersion)..." -ForegroundColor Gray
    npx --yes @electron/asar extract $sourceAsar $tempExtract
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось распаковать ASAR ($sourceAsar), код выхода: $LASTEXITCODE"
    }

    $preloadPath = "$tempExtract\dist\preload.js"
    $utilsPath = "$tempExtract\dist\utils.js"
    $ipcPath = "$tempExtract\dist\ipcHandlers.js"

    # 3. Patch utils.js (win.webContents.on('did-finish-load') hook)
    Write-Host "[3/5] Интеграция загрузчика мода в utils.js..." -ForegroundColor Gray
    $utilsContent = Get-Content $utilsPath -Raw -Encoding UTF8
    $utilsBegin = "// Antigravity Core Mod Loader BEGIN"
    $utilsEnd = "// Antigravity Core Mod Loader END"

    $hookCode = @'
    // Antigravity Core Mod Loader BEGIN
    win.webContents.on('did-finish-load', () => {
        try {
            const fs_core = require('fs');
            const path_core = require('path');
            const os_core = require('os');
            const coreModPath = path_core.join(os_core.homedir(), '.gemini', 'antigravity', 'tools', 'antigravity_core_mod.js');
            if (fs_core.existsSync(coreModPath)) {
                const modCode = fs_core.readFileSync(coreModPath, 'utf8');
                win.webContents.executeJavaScript(modCode).catch(() => {});
            }
        } catch (_) {}
    });
    // Antigravity Core Mod Loader END
'@

    $legacyHookRegex = "(?s)\s*win\.webContents\.on\('did-finish-load',\s*\(\)\s*=>\s*\{\s*try\s*\{[^}]*antigravity_core_mod\.js.*?\}\s*catch\s*\(_\)\s*\{\}\s*\}\);"
    $targetHook = "(0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);"

    if ($utilsContent.Contains($utilsBegin) -and $utilsContent.Contains($utilsEnd)) {
        $uStart = $utilsContent.IndexOf($utilsBegin)
        $uEnd = $utilsContent.IndexOf($utilsEnd) + $utilsEnd.Length
        $utilsContent = $utilsContent.Substring(0, $uStart) + $hookCode.Trim() + $utilsContent.Substring($uEnd)
        Write-Utf8NoBom -Path $utilsPath -Value $utilsContent
        Write-Host "      Хук did-finish-load успешно обновлён в utils.js." -ForegroundColor Green
    } elseif ($utilsContent -match $legacyHookRegex) {
        $utilsContent = [regex]::Replace($utilsContent, $legacyHookRegex, "`n$hookCode")
        Write-Utf8NoBom -Path $utilsPath -Value $utilsContent
        Write-Host "      Старый хук did-finish-load обновлён до размеченной версии в utils.js." -ForegroundColor Green
    } elseif ($utilsContent.Contains($targetHook)) {
        $utilsContent = $utilsContent.Replace($targetHook, "$targetHook`n$hookCode")
        Write-Utf8NoBom -Path $utilsPath -Value $utilsContent
        Write-Host "      Хук did-finish-load успешно встроен в utils.js." -ForegroundColor Green
    } else {
        throw "Метка attachLoadingOverlay не найдена в utils.js."
    }

    # 4. Patch preload.js (expose antigravityTokenBridge with convId + optional modelName)
    Write-Host "[4/5] Настройка моста antigravityTokenBridge в preload.js..." -ForegroundColor Gray
    $preloadContent = Get-Content $preloadPath -Raw -Encoding UTF8
    $bridgeBegin = "// Antigravity Token Bridge BEGIN"
    $bridgeEnd = "// Antigravity Token Bridge END"

    $bridgeCode = @'
// Antigravity Token Bridge BEGIN
try {
  const __agyElectron = (typeof electron_1 !== 'undefined') ? electron_1 : require('electron');
  __agyElectron.contextBridge.exposeInMainWorld('antigravityTokenBridge', {
    getStats: (convId, modelName) => __agyElectron.ipcRenderer.invoke('antigravity:get-token-stats', convId, modelName),
    listWallpapers: () => __agyElectron.ipcRenderer.invoke('antigravity:list-wallpapers'),
    readWallpaper: (fileName) => __agyElectron.ipcRenderer.invoke('antigravity:read-wallpaper', fileName),
    openWallpapersDir: () => __agyElectron.ipcRenderer.invoke('antigravity:open-wallpapers-dir')
  });
} catch(e) { try { console.error('[antigravity-mod] token bridge failed:', e); } catch (_) {} }
// Antigravity Token Bridge END
'@

    if ($preloadContent.Contains($bridgeBegin) -and $preloadContent.Contains($bridgeEnd)) {
        $bStart = $preloadContent.IndexOf($bridgeBegin)
        $bEnd = $preloadContent.IndexOf($bridgeEnd) + $bridgeEnd.Length
        $preloadContent = $preloadContent.Substring(0, $bStart) + $bridgeCode.Trim() + $preloadContent.Substring($bEnd)
    } elseif ($preloadContent -match "antigravityTokenBridge") {
        $oldBridgeRegex = "(?s)try\s*\{\s*electron_1\.contextBridge\.exposeInMainWorld\('antigravityTokenBridge'.*?\}\s*catch\(e\)\s*\{\}"
        if ($preloadContent -match $oldBridgeRegex) {
            $preloadContent = [regex]::Replace($preloadContent, $oldBridgeRegex, $bridgeCode.Trim())
        }
    } else {
        $preloadContent += "`n$($bridgeCode.Trim())`n"
    }
    Write-Utf8NoBom -Path $preloadPath -Value $preloadContent
    Write-Host "      Мост antigravityTokenBridge успешно обновлён в preload.js." -ForegroundColor Green

    # 5. Patch ipcHandlers.js (antigravity:get-token-stats)
    Write-Host "[5/5] Интеграция IPC-обработчика для чтения токенов и скорости..." -ForegroundColor Gray
    $ipcContent = Get-Content $ipcPath -Raw -Encoding UTF8

    $ipcHandlerCode = @'
    // Antigravity Token Stats IPC Handler BEGIN
    const __tokenStatsCache = new Map();
    const __tokenLiveTracker = new Map();

    function __resolveModelLimit(modelName) {
        return { limit: 1048576, label: '1M' };
    }

    function __formatTokensCompact(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
        return String(n);
    }

    function __median(nums) {
        if (!nums || nums.length === 0) return 0;
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }

    function __formatDuration(ms) {
        const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
        if (totalSec < 60) return totalSec + 's';
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }

    function __getNodeActiveTimeMs(st) {
        let total = st.activeTimeMs || 0;
        const prev = st.prevItemMeta;
        if (prev && prev.type === 'PLANNER_RESPONSE' && !prev.hasTools && prev.output > 0) {
            const estSpeed = st.speeds.length > 0 ? st.speeds[st.speeds.length - 1] : 100;
            total += Math.min(180000, Math.round((prev.output / Math.max(10, estSpeed)) * 1000));
        }
        return total;
    }

    function __resolveModelPricing(modelName, nowMs) {
        const name = String(modelName || '').toLowerCase();
        const ts = typeof nowMs === 'number' ? nowMs : Date.now();
        const afterDec2026 = ts >= Date.UTC(2026, 11, 1);
        const afterJan2027 = ts >= Date.UTC(2027, 0, 1);

        if (/hydrogen/.test(name)) {
            return { label: 'Gemini 4 Hydrogen', input: 1.50, cache: 0.075, output: 7.50 };
        }
        if (/argon/.test(name)) {
            return afterDec2026
                ? { label: 'Gemini 4 Argon', input: 4.00, cache: 0.20, output: 20.00 }
                : { label: 'Gemini 4 Argon', input: 2.00, cache: 0.10, output: 10.00 };
        }
        if (/carbon/.test(name)) {
            return afterDec2026
                ? { label: 'Gemini 4 Carbon', input: 4.00, cache: 0.20, output: 20.00 }
                : { label: 'Gemini 4 Carbon', input: 2.00, cache: 0.10, output: 10.00 };
        }
        if (/3\.8|flash/.test(name)) {
            return afterJan2027
                ? { label: 'Gemini 3.8 Flash', input: 1.50, cache: 0.15, output: 7.50 }
                : { label: 'Gemini 3.8 Flash', input: 0.75, cache: 0.075, output: 3.75 };
        }
        // Fallback: Gemini 4 Hydrogen rate as baseline when model pill is unrecognized
        return { label: 'Gemini (Auto)', input: 1.50, cache: 0.075, output: 7.50 };
    }

    function __calculateNodeCost(st, p) {
        const low = st.tierLow || { input: st.totalInput || 0, cache: st.totalCache || 0, output: st.totalOutput || 0 };
        const high = st.tierHigh || { input: 0, cache: 0, output: 0 };
        const hiIn = typeof p.highInput === 'number' ? p.highInput : p.input;
        const hiCa = typeof p.highCache === 'number' ? p.highCache : p.cache;
        const hiOut = typeof p.highOutput === 'number' ? p.highOutput : p.output;

        const inputCost = (low.input * p.input + high.input * hiIn) / 1e6;
        const cacheCost = (low.cache * p.cache + high.cache * hiCa) / 1e6;
        const outputCost = (low.output * p.output + high.output * hiOut) / 1e6;
        return {
            inputCost,
            cacheCost,
            outputCost,
            totalCost: inputCost + cacheCost + outputCost
        };
    }

    function __formatUsd(amount) {
        const v = Number(amount) || 0;
        if (v <= 0) return '$0.00';
        if (v < 0.01) return '$' + v.toFixed(4);
        if (v < 10) return '$' + v.toFixed(3).replace(/0$/, '');
        return '$' + v.toFixed(2);
    }

    function __formatRateShort(n) {
        const v = Number(n) || 0;
        return Number(v.toFixed(3)).toString();
    }

    function __cleanToolPath(raw) {
        if (!raw || typeof raw !== 'string') return '';
        let s = raw.trim();
        while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.slice(1, -1).trim();
        }
        return s;
    }

    function __extractToolFilePath(argsObj) {
        if (!argsObj || typeof argsObj !== 'object') return '';
        const keys = ['Path', 'path', 'file_path', 'TargetFile', 'AbsolutePath', 'FilePath', 'uri', 'file'];
        for (const k of keys) {
            if (typeof argsObj[k] === 'string' && argsObj[k].trim()) {
                return __cleanToolPath(argsObj[k]);
            }
        }
        return '';
    }

    function __createEmptyParseState() {
        return {
            byteOffset: 0,
            turns: 0,
            steps: 0,
            plannerSteps: 0,
            lastInput: 0,
            lastCache: 0,
            totalInput: 0,
            totalCache: 0,
            totalOutput: 0,
            tierLow: { input: 0, cache: 0, output: 0 },
            tierHigh: { input: 0, cache: 0, output: 0 },
            activeTimeMs: 0,
            prevItemMeta: null,
            lastEventType: null,
            lastToolName: '',
            lastActivityMs: 0,
            pendingPlanner: null,
            pendingSubagentCalls: 0,
            pendingSubagentRoles: [],
            pendingToolResponses: 0,
            childConvIds: [],
            childSubagentMeta: {},
            childSubagentModels: {},
            pendingSubagentModels: [],
            toolSummary: { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, chars: 0 },
            toolCounts: {},
            filesMap: {},
            speeds: []
        };
    }

    function __applyTranscriptLines(state, text) {
        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
            if (!rawLine) continue;
            let item;
            try {
                item = JSON.parse(rawLine);
            } catch (_) {
                continue;
            }

            if (typeof item.step_index === 'number') {
                state.steps = Math.max(state.steps, item.step_index);
            }
            if (item.type === 'USER_INPUT') {
                state.turns++;
                state.pendingSubagentCalls = 0;
                state.pendingSubagentRoles = [];
            }

            const t = item.created_at ? new Date(item.created_at).getTime() : null;
            const validT = (typeof t === 'number' && !Number.isNaN(t)) ? t : null;
            if (validT) state.lastActivityMs = Math.max(state.lastActivityMs || 0, validT);
            const hasTools = Array.isArray(item.tool_calls) && item.tool_calls.length > 0;
            const outputTokens = item.output_tokens || 0;

            // Accumulate active AI work time (excluding user idle gaps and orchestrator sleep gaps)
            const prev = state.prevItemMeta;
            if (prev) {
                const diff = (prev.time && validT) ? (validT - prev.time) : -1;
                if (prev.type === 'PLANNER_RESPONSE') {
                    if (prev.hasTools && (item.type === 'GENERIC' || item.type === 'ERROR_MESSAGE' || item.type === 'CHECKPOINT') && diff >= 0 && diff <= 300000) {
                        state.activeTimeMs += diff;
                    } else if (prev.output > 0) {
                        const estSpeed = state.speeds.length > 0 ? state.speeds[state.speeds.length - 1] : 100;
                        state.activeTimeMs += Math.min(180000, Math.round((prev.output / Math.max(10, estSpeed)) * 1000));
                    }
                } else if (prev.type === 'GENERIC') {
                    if ((item.type === 'GENERIC' || item.type === 'PLANNER_RESPONSE' || item.type === 'ERROR_MESSAGE' || item.type === 'CHECKPOINT') && diff >= 0 && diff <= 300000) {
                        state.activeTimeMs += diff;
                    } else if (item.type === 'SYSTEM_MESSAGE' && diff >= 0 && diff <= 60000) {
                        state.activeTimeMs += diff;
                    }
                } else if (prev.type === 'CHECKPOINT' || prev.type === 'ERROR_MESSAGE') {
                    if ((item.type === 'PLANNER_RESPONSE' || item.type === 'GENERIC' || item.type === 'ERROR_MESSAGE' || item.type === 'CHECKPOINT') && diff >= 0 && diff <= 300000) {
                        state.activeTimeMs += diff;
                    }
                } else if ((prev.type === 'USER_INPUT' || prev.type === 'SYSTEM_MESSAGE') && item.type === 'PLANNER_RESPONSE' && diff >= 0 && diff <= 300000) {
                    state.activeTimeMs += diff;
                }
            }

            // Complete speed measurement for the previous PLANNER_RESPONSE using the start time of its tool execution step
            if (state.pendingPlanner && state.pendingPlanner.hasTools && (item.type === 'GENERIC' || item.type === 'ERROR_MESSAGE') && validT && state.pendingPlanner.time) {
                const sec = (validT - state.pendingPlanner.time) / 1000;
                if (sec >= 1 && sec < 120 && state.pendingPlanner.output > 0) {
                    const spd = Math.round(state.pendingPlanner.output / sec);
                    if (spd > 0 && spd < 1500) {
                        state.speeds.push(spd);
                        if (state.speeds.length > 20) state.speeds.shift();
                    }
                }
                state.pendingPlanner = null;
            } else if (item.type === 'USER_INPUT' || item.type === 'SYSTEM_MESSAGE') {
                state.pendingPlanner = null;
            }

            if (item.type === 'PLANNER_RESPONSE') {
                state.plannerSteps++;
                state.pendingSubagentCalls = 0;
                state.pendingSubagentRoles = [];
                state.pendingSubagentModels = [];
                state.pendingToolResponses = 0;
                if (!state.toolSummary) state.toolSummary = { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, chars: 0 };
                if (!state.toolCounts) state.toolCounts = {};
                if (!state.filesMap) state.filesMap = {};
                if (!state.tierLow) state.tierLow = { input: 0, cache: 0, output: 0 };
                if (!state.tierHigh) state.tierHigh = { input: 0, cache: 0, output: 0 };

                if (hasTools) {
                    const stepIdx = typeof item.step_index === 'number' ? item.step_index : state.steps;
                    for (const tc of item.tool_calls) {
                        if (!tc || !tc.name) continue;
                        const tName = String(tc.name);
                        state.lastToolName = tName;
                        state.pendingToolResponses++;
                        state.toolSummary.total++;
                        state.toolCounts[tName] = (state.toolCounts[tName] || 0) + 1;

                        let parsedArgs = {};
                        try {
                            const rawArgs = tc.arguments !== undefined ? tc.arguments : tc.args;
                            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
                        } catch (_) {}

                        const lowerName = tName.toLowerCase();
                        const isRead = /^(read_file|view_file|view_file_outline|view_code_item|read_resource|list_dir|find_by_name|grep_search|search_files)$/.test(lowerName) || /read|view/.test(lowerName);
                        const isEdit = /^(edit_file|write_file|replace_file_content|multi_replace_file_content|write_to_file)$/.test(lowerName) || /edit|write|replace/.test(lowerName);

                        if (lowerName === 'invoke_subagent') {
                            state.toolSummary.subagents++;
                            state.pendingSubagentCalls++;
                            const roleRaw = parsedArgs.Role || parsedArgs.TypeName || '';
                            const roleLabel = __cleanToolPath(String(roleRaw || 'Subagent')).replace(/^"+|"+$/g, '').trim();
                            state.pendingSubagentRoles.push((roleLabel || 'Subagent').slice(0, 48));
                            if (!state.pendingSubagentModels) state.pendingSubagentModels = [];
                            let modelRaw = parsedArgs.Model || (String(parsedArgs.TypeName || '').toLowerCase() === 'browser' ? 'flash' : '');
                            // 'inherit' means "same model as the parent chat" -> keep empty so parent pricing is used
                            if (String(modelRaw || '').trim().toLowerCase() === 'inherit') modelRaw = '';
                            state.pendingSubagentModels.push(String(modelRaw || ''));
                        } else if (/command|terminal|shell/.test(lowerName)) {
                            state.toolSummary.cmds++;
                        } else if (/search_web|web|url|fetch/.test(lowerName)) {
                            state.toolSummary.web++;
                        } else if (/mcp/.test(lowerName)) {
                            state.toolSummary.mcp++;
                        } else if (isEdit) {
                            state.toolSummary.edits++;
                        } else if (isRead) {
                            state.toolSummary.reads++;
                        } else {
                            state.toolSummary.other++;
                        }

                        // Directory/search tools take a folder in Path - don't list those as "files in context"
                        const isDirTool = /^(list_dir|find_by_name|grep_search|search_files|search_directory)$/.test(lowerName);
                        if ((isRead || isEdit) && !isDirTool) {
                            const fPath = __extractToolFilePath(parsedArgs);
                            if (fPath) {
                                const normKey = fPath.replace(/\\/g, '/').toLowerCase();
                                const base = fPath.split(/[\\/]/).pop() || fPath;
                                let entry = state.filesMap[normKey];
                                if (!entry) {
                                    entry = { path: fPath, name: base, reads: 0, edits: 0, lastStep: stepIdx };
                                    state.filesMap[normKey] = entry;
                                }
                                if (isEdit) entry.edits++;
                                else entry.reads++;
                                entry.lastStep = Math.max(entry.lastStep || 0, stepIdx);
                            }
                        }
                    }
                }

                const input = item.input_tokens || 0;
                const cache = item.cache_read_tokens || 0;

                if (input > 0 || cache > 0) {
                    state.lastInput = input;
                    state.lastCache = cache;
                }
                state.totalInput += input;
                state.totalCache += cache;
                state.totalOutput += outputTokens;

                const stepContext = input + cache;
                const bucket = stepContext > 200000 ? state.tierHigh : state.tierLow;
                bucket.input += input;
                bucket.cache += cache;
                bucket.output += outputTokens;

                if (outputTokens > 0 && validT) {
                    state.pendingPlanner = { time: validT, output: outputTokens, hasTools };
                } else {
                    state.pendingPlanner = null;
                }
                if (!hasTools) {
                    state.lastToolName = 'Ответ модели';
                }
            } else if (item.type === 'GENERIC') {
                if (state.pendingToolResponses > 0 && typeof item.content === 'string') {
                    if (!state.toolSummary) state.toolSummary = { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, chars: 0 };
                    state.toolSummary.chars += item.content.length;
                    state.pendingToolResponses = Math.max(0, state.pendingToolResponses - 1);
                }
                const createdMarker = (state.pendingSubagentCalls > 0 && typeof item.content === 'string')
                    ? item.content.replace(/^(?:(?:Created|Completed) At:[^\n]*\n)+/, '').trimStart()
                    : '';
                if (createdMarker.startsWith('Created the following subagent')) {
                    const subMatch = createdMarker.match(/Created the following subagents?:\s*\{[\s\S]*?"conversationId"\s*:\s*"([a-zA-Z0-9_\-]+)"/);
                    if (subMatch && subMatch[1]) {
                        const subId = subMatch[1];
                        const assignedModel = (state.pendingSubagentModels && state.pendingSubagentModels.length > 0)
                            ? state.pendingSubagentModels.shift() : '';
                        if (!state.childSubagentModels) state.childSubagentModels = {};
                        if (assignedModel && !state.childSubagentModels[subId]) state.childSubagentModels[subId] = assignedModel;
                        const assignedRole = (state.pendingSubagentRoles && state.pendingSubagentRoles.length > 0)
                            ? state.pendingSubagentRoles.shift()
                            : 'Subagent';
                        if (!state.childConvIds.includes(subId)) {
                            state.childConvIds.push(subId);
                        }
                        if (!state.childSubagentMeta) state.childSubagentMeta = {};
                        if (!state.childSubagentMeta[subId]) {
                            state.childSubagentMeta[subId] = assignedRole;
                        }
                        state.pendingSubagentCalls = Math.max(0, state.pendingSubagentCalls - 1);
                    }
                }
            }

            state.prevItemMeta = { type: item.type, time: validT, hasTools, output: outputTokens };
            state.lastEventType = item.type || state.lastEventType;
        }
    }

    async function __readTranscriptCached(targetId, brainDir, nodeFs, nodePath) {
        if (!targetId || typeof targetId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(targetId) || targetId === 'new') {
            return null;
        }
        const transcriptPath = nodePath.join(brainDir, targetId, '.system_generated', 'logs', 'transcript.jsonl');
        let stat;
        try {
            stat = await nodeFs.promises.stat(transcriptPath);
        } catch (_) {
            return null;
        }
        if (!stat || stat.size === 0) return null;

        let cached = __tokenStatsCache.get(targetId);
        const fileChanged = !cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size;
        const hasPendingTail = Boolean(cached && cached.state && cached.state.byteOffset < stat.size && (cached.incompleteRetries || 0) < 3);

        if (fileChanged || hasPendingTail) {
            let state;
            let startOffset = 0;
            let incompleteRetries = (!fileChanged && cached) ? (cached.incompleteRetries || 0) : 0;

            if (cached && cached.state && stat.size >= cached.state.byteOffset) {
                state = cached.state;
                startOffset = state.byteOffset;
            } else {
                state = __createEmptyParseState();
                startOffset = 0;
                incompleteRetries = 0;
            }

            const bytesToRead = stat.size - startOffset;
            if (bytesToRead > 0) {
                const fh = await nodeFs.promises.open(transcriptPath, 'r');
                try {
                    const buf = Buffer.allocUnsafe(bytesToRead);
                    let totalRead = 0;
                    while (totalRead < bytesToRead) {
                        const { bytesRead } = await fh.read(buf, totalRead, bytesToRead - totalRead, startOffset + totalRead);
                        if (bytesRead <= 0) break;
                        totalRead += bytesRead;
                    }
                    if (totalRead > 0) {
                        const slice = buf.subarray(0, totalRead);
                        const lastNl = slice.lastIndexOf(0x0a);
                        if (lastNl !== -1) {
                            const completeText = slice.subarray(0, lastNl + 1).toString('utf8');
                            __applyTranscriptLines(state, completeText);
                            state.byteOffset = startOffset + lastNl + 1;

                            if (lastNl + 1 < totalRead) {
                                const remText = slice.subarray(lastNl + 1).toString('utf8').trim();
                                if (remText) {
                                    try {
                                        JSON.parse(remText);
                                        __applyTranscriptLines(state, remText);
                                        state.byteOffset = startOffset + totalRead;
                                    } catch (_) {
                                        incompleteRetries++;
                                    }
                                } else {
                                    state.byteOffset = startOffset + totalRead;
                                }
                            } else {
                                incompleteRetries = 0;
                            }
                        } else {
                            const maybeText = slice.toString('utf8').trim();
                            if (maybeText) {
                                try {
                                    JSON.parse(maybeText);
                                    __applyTranscriptLines(state, maybeText);
                                    state.byteOffset = startOffset + totalRead;
                                    incompleteRetries = 0;
                                } catch (_) {
                                    incompleteRetries++;
                                }
                            } else {
                                state.byteOffset = startOffset + totalRead;
                                incompleteRetries = 0;
                            }
                        }
                    }
                } finally {
                    await fh.close();
                }
            }

            cached = { mtimeMs: stat.mtimeMs, size: stat.size, incompleteRetries, state };
            __tokenStatsCache.set(targetId, cached);
            if (__tokenStatsCache.size > 128) {
                const oldestKey = __tokenStatsCache.keys().next().value;
                if (oldestKey && oldestKey !== targetId) __tokenStatsCache.delete(oldestKey);
            }
        }
        return cached;
    }

    electron_1.ipcMain.handle('antigravity:get-token-stats', async (_event, convId, modelName) => {
        try {
            const nodeFs = require('fs');
            const nodePath = require('path');
            const nodeOs = require('os');
            const { limit: modelLimit, label: modelLimitLabel } = __resolveModelLimit(modelName);
            const nowMs = Date.now();
            const pricing = __resolveModelPricing(modelName, nowMs);
            const pricingLabel = `${pricing.label} · $${__formatRateShort(pricing.input)}/$${__formatRateShort(pricing.cache)}/$${__formatRateShort(pricing.output)}`;

            const defaultZero = {
                turns: 0,
                steps: 0,
                plannerSteps: 0,
                speed: 0,
                speedHistory: [],
                contextTokens: '0',
                rawContextTokens: 0,
                lastInput: '0',
                lastCache: '0',
                sessionInput: '0',
                sessionCache: '0',
                totalOutput: '0',
                grandTotalTokens: '0',
                chatTotalTokens: '0',
                subagentTotalTokens: '0',
                subagentCount: 0,
                subagents: [],
                swarmRoot: null,
                grandTotalRaw: 0,
                totalWorkTime: '0s',
                chatWorkTime: '0s',
                subagentWorkTime: '0s',
                totalWorkTimeSec: 0,
                cacheHit: 0,
                sessionCacheHit: 0,
                percent: 0,
                exactPercent: 0,
                modelLimitLabel,
                apiCost: '$0.00',
                apiCostRaw: 0,
                apiCostChat: '$0.00',
                apiCostSubagents: '$0.00',
                apiCostInput: '$0.00',
                apiCostCache: '$0.00',
                apiCostOutput: '$0.00',
                pricingLabel,
                contextInspector: {
                    summary: { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, approxTokens: '0' },
                    topTools: [],
                    files: []
                },
                hasTokens: false
            };

            const brainDir = nodePath.join(nodeOs.homedir(), '.gemini', 'antigravity', 'brain');
            const cached = await __readTranscriptCached(convId, brainDir, nodeFs, nodePath);
            if (!cached) return defaultZero;

            const state = cached.state;
            let live = __tokenLiveTracker.get(convId);
            if (!live) {
                live = {
                    lastPlannerSteps: state.plannerSteps,
                    lastSteps: state.steps,
                    waitStartMs: state.lastEventType && state.lastEventType !== 'PLANNER_RESPONSE' ? nowMs : null,
                    liveSpeed: 0
                };
                __tokenLiveTracker.set(convId, live);
            } else {
                if (state.plannerSteps > live.lastPlannerSteps && live.waitStartMs && state.pendingPlanner && state.pendingPlanner.output > 0) {
                    const elapsedSec = (nowMs - live.waitStartMs) / 1000;
                    if (elapsedSec >= 0.2 && elapsedSec < 120) {
                        const spd = Math.round(state.pendingPlanner.output / elapsedSec);
                        if (spd > 0 && spd < 1500) {
                            live.liveSpeed = spd;
                        }
                    }
                }
                live.lastPlannerSteps = state.plannerSteps;
                // Restart the wait timer only when a NEW non-planner step arrived (not on every poll)
                const stepChanged = state.steps !== live.lastSteps;
                live.lastSteps = state.steps;
                if (state.lastEventType && state.lastEventType !== 'PLANNER_RESPONSE') {
                    if (stepChanged || !live.waitStartMs) live.waitStartMs = nowMs;
                } else if (state.lastEventType === 'PLANNER_RESPONSE') {
                    live.waitStartMs = null;
                }
            }

            const combinedSpeeds = state.speeds.slice(-5);
            if (live.liveSpeed > 0 && (state.pendingPlanner !== null || combinedSpeeds.length === 0)) {
                combinedSpeeds.push(live.liveSpeed);
            }
            const speed = __median(combinedSpeeds.slice(-5));
            const speedHistory = state.speeds.slice(-16);
            if (live.liveSpeed > 0 && (state.pendingPlanner !== null || speedHistory.length === 0)) {
                speedHistory.push(live.liveSpeed);
            }

            // Recursively aggregate total processed tokens, API cost, and active work time across all spawned subagents
            let subagentTotal = 0;
            let subagentWorkTimeMs = 0;
            let subagentCount = 0;
            let subagentCostIn = 0;
            let subagentCostCache = 0;
            let subagentCostOut = 0;
            let subagentCostTotal = 0;
            const subagentsList = [];
            const roleMap = Object.assign({}, state.childSubagentMeta || {});
            const modelMap = Object.assign({}, state.childSubagentModels || {});
            const visited = new Set([convId]);
            const queue = (state.childConvIds || []).map((cid) => ({ id: cid, parentId: convId, depth: 1 }));
            const MAX_SUBAGENTS = 100;

            while (queue.length > 0 && visited.size <= MAX_SUBAGENTS) {
                const qItem = queue.shift();
                const subId = qItem && qItem.id;
                const parentId = (qItem && qItem.parentId) || convId;
                const depth = (qItem && qItem.depth) || 1;
                if (!subId || visited.has(subId)) continue;
                visited.add(subId);

                const subCached = await __readTranscriptCached(subId, brainDir, nodeFs, nodePath);
                if (!subCached || !subCached.state) continue;

                const ss = subCached.state;
                subagentCount++;
                const subTok = (ss.totalInput + ss.totalCache + ss.totalOutput);
                const subMs = __getNodeActiveTimeMs(ss);
                const subPricing = modelMap[subId] ? __resolveModelPricing(modelMap[subId], nowMs) : pricing;
                const subC = __calculateNodeCost(ss, subPricing);
                subagentTotal += subTok;
                subagentWorkTimeMs += subMs;
                subagentCostIn += subC.inputCost;
                subagentCostCache += subC.cacheCost;
                subagentCostOut += subC.outputCost;
                subagentCostTotal += subC.totalCost;

                if (ss.childSubagentMeta) {
                    Object.assign(roleMap, ss.childSubagentMeta);
                }
                if (ss.childSubagentModels) {
                    Object.assign(modelMap, ss.childSubagentModels);
                }

                const subLastTs = Math.max(ss.lastActivityMs || 0, subCached.mtimeMs || 0);
                const subAgeMs = nowMs - subLastTs;
                const subHasTools = Boolean(ss.prevItemMeta && ss.prevItemMeta.hasTools);
                const subIsActive = Boolean(
                    subAgeMs < 45000
                    && (ss.lastEventType === 'GENERIC' || ss.lastEventType === 'USER_INPUT' || (ss.pendingToolResponses || 0) > 0 || subHasTools)
                );

                subagentsList.push({
                    id: subId,
                    parentId,
                    depth,
                    role: roleMap[subId] || 'Subagent',
                    steps: ss.steps || 0,
                    turns: ss.turns || 0,
                    tokens: __formatTokensCompact(subTok),
                    rawTokens: subTok,
                    cost: __formatUsd(subC.totalCost),
                    workTime: __formatDuration(subMs),
                    lastTool: ss.lastToolName || '',
                    isActive: subIsActive
                });

                if (ss.childConvIds && ss.childConvIds.length > 0) {
                    for (const nestedId of ss.childConvIds) {
                        if (!visited.has(nestedId)) {
                            queue.push({ id: nestedId, parentId: subId, depth: depth + 1 });
                        }
                    }
                }
            }

            const chatCost = __calculateNodeCost(state, pricing);
            const grandCostTotal = chatCost.totalCost + subagentCostTotal;
            const grandCostIn = chatCost.inputCost + subagentCostIn;
            const grandCostCache = chatCost.cacheCost + subagentCostCache;
            const grandCostOut = chatCost.outputCost + subagentCostOut;

            const chatTotal = state.totalInput + state.totalCache + state.totalOutput;
            const grandTotal = chatTotal + subagentTotal;
            const chatWorkTimeMs = __getNodeActiveTimeMs(state);
            const totalWorkTimeMs = chatWorkTimeMs + subagentWorkTimeMs;

            const rootLastTs = Math.max(state.lastActivityMs || 0, cached.mtimeMs || 0);
            const rootAgeMs = nowMs - rootLastTs;
            const rootHasTools = Boolean(state.prevItemMeta && state.prevItemMeta.hasTools);
            const rootIsActive = Boolean(
                rootAgeMs < 45000
                && (state.lastEventType === 'GENERIC' || state.lastEventType === 'USER_INPUT' || (state.pendingToolResponses || 0) > 0 || rootHasTools)
            );
            const swarmRoot = {
                id: convId,
                role: 'Main Chat',
                steps: state.steps || 0,
                turns: state.turns || 0,
                tokens: __formatTokensCompact(chatTotal),
                rawTokens: chatTotal,
                cost: __formatUsd(chatCost.totalCost),
                workTime: __formatDuration(chatWorkTimeMs),
                lastTool: state.lastToolName || '',
                isActive: rootIsActive
            };

            const tsSum = state.toolSummary || { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, chars: 0 };
            const topTools = Object.entries(state.toolCounts || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([name, count]) => ({ name, count }));
            const filesList = Object.values(state.filesMap || {})
                .sort((a, b) => {
                    if ((b.edits > 0) !== (a.edits > 0)) return b.edits > 0 ? 1 : -1;
                    if (b.lastStep !== a.lastStep) return (b.lastStep || 0) - (a.lastStep || 0);
                    return (b.reads + b.edits) - (a.reads + a.edits);
                })
                .slice(0, 24);

            const lastContext = state.lastInput + state.lastCache;
            const totalContextSeen = state.totalInput + state.totalCache;
            const cacheHit = lastContext > 0 ? Math.min(100, Math.max(0, Math.round((state.lastCache / lastContext) * 100))) : 0;
            const sessionCacheHit = totalContextSeen > 0 ? Math.min(100, Math.max(0, Math.round((state.totalCache / totalContextSeen) * 100))) : 0;
            const rawPercent = (lastContext / modelLimit) * 100;
            const percent = Math.min(100, Math.max(0, Math.round(rawPercent)));
            const exactPercent = Math.min(100, Math.max(0, Number(rawPercent.toFixed(1))));

            return {
                turns: state.turns,
                steps: state.steps,
                plannerSteps: state.plannerSteps,
                speed,
                speedHistory: speedHistory.slice(-16),
                contextTokens: __formatTokensCompact(lastContext),
                rawContextTokens: lastContext,
                lastInput: __formatTokensCompact(state.lastInput),
                lastCache: __formatTokensCompact(state.lastCache),
                sessionInput: __formatTokensCompact(state.totalInput),
                sessionCache: __formatTokensCompact(state.totalCache),
                totalOutput: __formatTokensCompact(state.totalOutput),
                grandTotalTokens: __formatTokensCompact(grandTotal),
                chatTotalTokens: __formatTokensCompact(chatTotal),
                subagentTotalTokens: __formatTokensCompact(subagentTotal),
                subagentCount,
                subagents: subagentsList,
                swarmRoot,
                grandTotalRaw: grandTotal,
                totalWorkTime: __formatDuration(totalWorkTimeMs),
                chatWorkTime: __formatDuration(chatWorkTimeMs),
                subagentWorkTime: __formatDuration(subagentWorkTimeMs),
                totalWorkTimeSec: Math.round(totalWorkTimeMs / 1000),
                cacheHit,
                sessionCacheHit,
                percent,
                exactPercent,
                modelLimitLabel,
                apiCost: __formatUsd(grandCostTotal),
                apiCostRaw: Number(grandCostTotal.toFixed(6)),
                apiCostChat: __formatUsd(chatCost.totalCost),
                apiCostSubagents: __formatUsd(subagentCostTotal),
                apiCostInput: __formatUsd(grandCostIn),
                apiCostCache: __formatUsd(grandCostCache),
                apiCostOutput: __formatUsd(grandCostOut),
                pricingLabel,
                contextInspector: {
                    summary: {
                        reads: tsSum.reads || 0,
                        edits: tsSum.edits || 0,
                        cmds: tsSum.cmds || 0,
                        web: tsSum.web || 0,
                        mcp: tsSum.mcp || 0,
                        subagents: tsSum.subagents || 0,
                        other: tsSum.other || 0,
                        total: tsSum.total || 0,
                        approxTokens: __formatTokensCompact(Math.round((tsSum.chars || 0) / 4))
                    },
                    topTools,
                    files: filesList
                },
                hasTokens: lastContext > 0
            };
        } catch (e) {
            return null;
        }
    });

    const __wallpaperMimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm'
    };

    electron_1.ipcMain.handle('antigravity:list-wallpapers', async () => {
        try {
            const nodeFs = require('fs');
            const nodePath = require('path');
            const nodeOs = require('os');
            const wallDir = nodePath.join(nodeOs.homedir(), '.gemini', 'antigravity', 'wallpapers');
            let entries;
            try {
                entries = await nodeFs.promises.readdir(wallDir, { withFileTypes: true });
            } catch (_) {
                return [];
            }
            return entries
                .filter((e) => e.isFile() && Object.prototype.hasOwnProperty.call(__wallpaperMimeMap, nodePath.extname(e.name).toLowerCase()))
                .map((e) => e.name)
                .sort((a, b) => a.localeCompare(b));
        } catch (_) {
            return [];
        }
    });

    electron_1.ipcMain.handle('antigravity:read-wallpaper', async (_event, fileName) => {
        try {
            const nodeFs = require('fs');
            const nodePath = require('path');
            const nodeOs = require('os');
            if (!fileName || typeof fileName !== 'string' || fileName !== nodePath.basename(fileName) || fileName.includes('..')) {
                return null;
            }
            const ext = nodePath.extname(fileName).toLowerCase();
            const mime = __wallpaperMimeMap[ext];
            if (!mime) return null;

            const wallDir = nodePath.join(nodeOs.homedir(), '.gemini', 'antigravity', 'wallpapers');
            const fullPath = nodePath.join(wallDir, fileName);
            const stat = await nodeFs.promises.stat(fullPath);
            if (!stat || !stat.isFile() || stat.size <= 0 || stat.size > 104857600) {
                return null;
            }
            const buf = await nodeFs.promises.readFile(fullPath);
            return {
                mime,
                bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
            };
        } catch (_) {
            return null;
        }
    });

    electron_1.ipcMain.handle('antigravity:open-wallpapers-dir', async () => {
        try {
            const nodeFs = require('fs');
            const nodePath = require('path');
            const nodeOs = require('os');
            const wallDir = nodePath.join(nodeOs.homedir(), '.gemini', 'antigravity', 'wallpapers');
            await nodeFs.promises.mkdir(wallDir, { recursive: true });
            if (electron_1.shell && typeof electron_1.shell.openPath === 'function') {
                await electron_1.shell.openPath(wallDir);
                return true;
            }
            return false;
        } catch (_) {
            return false;
        }
    });
    // Antigravity Token Stats IPC Handler END
'@

    $beginMarker = "// Antigravity Token Stats IPC Handler BEGIN"
    $endMarker = "// Antigravity Token Stats IPC Handler END"
    $legacyMarker = "// Antigravity Token Stats IPC Handler"

    if ($ipcContent.Contains($beginMarker) -and $ipcContent.Contains($endMarker)) {
        $startIdx = $ipcContent.IndexOf($beginMarker)
        $endIdx = $ipcContent.IndexOf($endMarker) + $endMarker.Length
        $ipcContent = $ipcContent.Substring(0, $startIdx) + $ipcHandlerCode.Trim() + $ipcContent.Substring($endIdx)
    } elseif ($ipcContent.Contains($legacyMarker)) {
        $idx = $ipcContent.IndexOf($legacyMarker)
        $cleanBefore = $ipcContent.Substring(0, $idx).TrimEnd()
        $ipcContent = $cleanBefore + "`n`n    " + $ipcHandlerCode.Trim() + "`n}`n"
    } else {
        # Insert before the closing brace of registerIpcHandlers, ignoring a trailing sourceMappingURL comment and keeping any tail intact
        $srcMapIdx = $ipcContent.LastIndexOf('//# sourceMappingURL')
        $searchLimit = if ($srcMapIdx -ge 0) { $srcMapIdx } else { $ipcContent.Length }
        $lastIdx = $ipcContent.Substring(0, $searchLimit).LastIndexOf('}')
        if ($lastIdx -eq -1) {
            throw "Не найдена закрывающая скобка функции в ipcHandlers.js"
        }
        $cleanBefore = $ipcContent.Substring(0, $lastIdx).TrimEnd()
        $ipcContent = $cleanBefore + "`n`n    " + $ipcHandlerCode.Trim() + "`n" + $ipcContent.Substring($lastIdx)
    }
    $ipcContent = $ipcContent.TrimEnd() + "`n"  # drop accumulated trailing blank lines
    Write-Utf8NoBom -Path $ipcPath -Value $ipcContent
    Write-Host "      IPC-обработчик успешно обновлён в ipcHandlers.js." -ForegroundColor Green

    # Validate JS syntax of all patched files before packing
    Write-Host "      Проверка синтаксиса модифицированных файлов..." -ForegroundColor Gray
    node -e "
const fs = require('fs');
for (const f of process.argv.slice(1)) {
  const code = fs.readFileSync(f, 'utf8');
  new Function('exports', 'require', 'module', '__filename', '__dirname', code);
}
console.log('Syntax check OK for all 3 files.');
" $utilsPath $preloadPath $ipcPath
    if ($LASTEXITCODE -ne 0) {
        throw "Ошибка синтаксиса в одном из пропатченных файлов!"
    }

    # 6. Repack asar
    Write-Host "Упаковка пакета app.asar..." -ForegroundColor Gray
    $tempOutAsar = "$env:TEMP\app_repacked_mods.asar"
    if (Test-Path $tempOutAsar) {
        Remove-Item $tempOutAsar -Force
    }

    npx --yes @electron/asar pack $tempExtract $tempOutAsar --unpack "**/node_modules/chrome-devtools-mcp/**"
    if ($LASTEXITCODE -ne 0) {
        throw "Ошибка упаковки ASAR, код выхода: $LASTEXITCODE"
    }

    # 7. Save prebuilt archive and version stamp (and install if not BuildOnly)
    Copy-Item $tempOutAsar $prebuiltAsar -Force
    Write-Utf8NoBom -Path "$prebuiltAsar.ver" -Value $appVersion

    # Keep the .unpacked companion (native/unpacked modules) next to the prebuilt asar
    if (Test-Path "$tempOutAsar.unpacked") {
        if (Test-Path "$prebuiltAsar.unpacked") { Remove-Item "$prebuiltAsar.unpacked" -Recurse -Force }
        Copy-Item "$tempOutAsar.unpacked" "$prebuiltAsar.unpacked" -Recurse -Force
    }

    if (-not $BuildOnly) {
        Write-Host "Установка обновленного app.asar в программу..." -ForegroundColor Gray
        Copy-Item $tempOutAsar $asarPath -Force
        Sync-UnpackedModules
    } else {
        Write-Host "Готовый пакет сохранён в $prebuiltAsar (версия $appVersion)." -ForegroundColor Green
    }

    # 8. Cleanup
    Remove-Item $tempExtract -Recurse -Force
    Remove-Item $tempOutAsar -Force
    if (Test-Path "$tempOutAsar.unpacked") { Remove-Item "$tempOutAsar.unpacked" -Recurse -Force }
}

if ($BuildOnly) {
    Write-Host "`nСборка завершена! Для применения app.asar перезапустите Antigravity через restart_and_apply.ps1." -ForegroundColor Green
} else {
    Write-Host "`nВсе модификации успешно установлены в Antigravity!" -ForegroundColor Green
    Write-Host "Показатели скорости, токенов, шагов и контекста готовы к работе." -ForegroundColor Green
    if ($wasRunning -and $AutoRestart -and (-not $NoRestart)) {
        Write-Host "Перезапуск Antigravity (от имени администратора)..." -ForegroundColor Cyan
        $env:AG_LAUNCH_EXE = "$appDir\Antigravity.exe"
        Start-Process -FilePath "powershell.exe" -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath $env:AG_LAUNCH_EXE -Verb RunAs"' -WindowStyle Hidden
    }
}
