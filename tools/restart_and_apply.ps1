Start-Sleep -Seconds 2

$appDir = "$env:LOCALAPPDATA\Programs\Antigravity"
$asarPath = "$appDir\resources\app.asar"
$bakPath = "$appDir\resources\app.asar.bak"
$toolsDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.gemini\antigravity\tools" }
$patchedPath = Join-Path $toolsDir "app.asar.patched"
$patchedVerPath = "$patchedPath.ver"
$updateScript = Join-Path $toolsDir "update_antigravity_mods.ps1"

function Get-ExeOrAsarVersion {
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

# 1. Close Antigravity processes and wait for file locks to release
$running = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
if ($running) {
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    $waitCount = 0
    while ((Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue) -and ($waitCount -lt 25)) {
        Start-Sleep -Milliseconds 200
        $waitCount++
    }
}

$exePath = "$appDir\Antigravity.exe"
$appVer = if (Test-Path $asarPath) { Get-ExeOrAsarVersion -TargetAsar $asarPath -ExePath $exePath } else { "unknown" }
$bakVer = if (Test-Path $bakPath) { Get-ExeOrAsarVersion -TargetAsar $bakPath -ExePath $exePath } else { "" }
$patchedVer = if (Test-Path $patchedVerPath) { (Get-Content $patchedVerPath -Raw).Trim() } else { "" }

$scriptNewer = ((Test-Path $updateScript) -and (Test-Path $patchedPath) -and ((Get-Item $updateScript).LastWriteTime -gt (Get-Item $patchedPath).LastWriteTime))

# 2. If prebuilt patched asar is missing, script-updated, or version-mismatched, delegate to full update script
if (-not (Test-Path $patchedPath) -or $scriptNewer -or ($appVer -ne "unknown" -and $patchedVer -ne $appVer)) {
    if (Test-Path $updateScript) {
        & $updateScript -ForceClose -AutoRestart
        exit $LASTEXITCODE
    }
}

# 3. Backup original if needed or outdated, then install patched asar
if ((Test-Path $asarPath) -and (-not (Test-Path $bakPath) -or ($bakVer -ne $appVer -and $appVer -ne "unknown"))) {
    Copy-Item $asarPath $bakPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $patchedPath) {
    Copy-Item $patchedPath $asarPath -Force
    if (Test-Path "$patchedPath.unpacked") {
        try {
            if (-not (Test-Path "$asarPath.unpacked")) { New-Item -ItemType Directory -Path "$asarPath.unpacked" -Force | Out-Null }
            Copy-Item -Path (Join-Path "$patchedPath.unpacked" '*') -Destination "$asarPath.unpacked" -Recurse -Force
        } catch {}
    }
}

# 4. Relaunch Antigravity detached as Administrator
Start-Sleep -Milliseconds 500
if (Test-Path $exePath) {
    $env:AG_LAUNCH_EXE = $exePath
    Start-Process -FilePath "powershell.exe" -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath $env:AG_LAUNCH_EXE -Verb RunAs"' -WindowStyle Hidden
}
