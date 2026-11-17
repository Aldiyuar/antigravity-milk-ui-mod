@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 > nul

rem Usage: Apply_AG_UI_Mods.bat [-BuildOnly] [-Rebuild] [-Restore]
rem   (no args)  apply UI mods (closes Antigravity, installs patched app.asar, restarts it)
rem   -BuildOnly build app.asar.patched only, do not touch the installed app
rem   -Rebuild   force full rebuild of the patched asar
rem   -Restore   roll back to the original app.asar (app.asar.bak)

set "MOD_SCRIPT=%USERPROFILE%\.gemini\antigravity\tools\update_antigravity_mods.ps1"
set "CORE_MOD=%USERPROFILE%\.gemini\antigravity\tools\antigravity_core_mod.js"
set "AG_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
set "EXTRA_ARGS=%*"

rem Normalise arguments: accept "BuildOnly" with or without dash, and never pass
rem -ForceClose/-NoRestart twice (PowerShell rejects duplicate parameters).
set "IS_BUILD_ONLY=0"
set "PS_ARGS="
for %%A in (%*) do (
    set "ARG_HANDLED=0"
    if /I "%%~A"=="-BuildOnly" (set "IS_BUILD_ONLY=1" & set "PS_ARGS=!PS_ARGS! -BuildOnly" & set "ARG_HANDLED=1")
    if /I "%%~A"=="BuildOnly"  (set "IS_BUILD_ONLY=1" & set "PS_ARGS=!PS_ARGS! -BuildOnly" & set "ARG_HANDLED=1")
    if /I "%%~A"=="-Rebuild"   (set "PS_ARGS=!PS_ARGS! -Rebuild" & set "ARG_HANDLED=1")
    if /I "%%~A"=="Rebuild"    (set "PS_ARGS=!PS_ARGS! -Rebuild" & set "ARG_HANDLED=1")
    if /I "%%~A"=="-Restore"   (set "PS_ARGS=!PS_ARGS! -Restore" & set "ARG_HANDLED=1")
    if /I "%%~A"=="Restore"    (set "PS_ARGS=!PS_ARGS! -Restore" & set "ARG_HANDLED=1")
    if /I "%%~A"=="-ForceClose" set "ARG_HANDLED=1"
    if /I "%%~A"=="ForceClose"  set "ARG_HANDLED=1"
    if /I "%%~A"=="-NoRestart"  set "ARG_HANDLED=1"
    if /I "%%~A"=="NoRestart"   set "ARG_HANDLED=1"
    if "!ARG_HANDLED!"=="0" set "PS_ARGS=!PS_ARGS! %%~A"
)

if "%IS_BUILD_ONLY%"=="0" (
    net session > nul 2>&1
    if errorlevel 1 (
        echo Requesting Administrator privileges...
        set "BAT_SELF=%~f0"
        if defined EXTRA_ARGS (
            powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:BAT_SELF -ArgumentList $env:EXTRA_ARGS -Verb RunAs"
        ) else (
            powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:BAT_SELF -Verb RunAs"
        )
        exit /b !errorlevel!
    )
)

if not exist "%MOD_SCRIPT%" (
    echo [ERROR] Script not found: "%MOD_SCRIPT%"
    pause
    exit /b 1
)

if exist "%CORE_MOD%" (
    where node > nul 2>&1
    if not errorlevel 1 (
        node --check "%CORE_MOD%"
        if errorlevel 1 (
            echo [ERROR] Syntax error in "%CORE_MOD%".
            pause
            exit /b 1
        )
    )
)

echo Applying Antigravity UI mods...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MOD_SCRIPT%" -ForceClose -NoRestart %PS_ARGS%

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to apply modifications.
    pause
    exit /b 1
)

set "SKIP_START=%IS_BUILD_ONLY%"

if "%SKIP_START%"=="0" (
    tasklist /FI "IMAGENAME eq Antigravity.exe" 2> nul | find /I "Antigravity.exe" > nul
    if errorlevel 1 (
        if exist "%AG_EXE%" (
            echo Starting Antigravity as Administrator...
            set "AG_LAUNCH_EXE=%AG_EXE%"
            start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath $env:AG_LAUNCH_EXE -Verb RunAs" > nul 2>&1 < nul
        )
    )
)

echo.
echo Done!
timeout /t 2 /nobreak > nul 2>&1
exit /b 0
