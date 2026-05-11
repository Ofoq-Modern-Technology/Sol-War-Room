@echo off
REM Full production release build for SOL_WAR_ROOM
REM Usage: build-release.bat [--obfuscate]
REM Output: artifacts\api-server\dist\

setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set OBFUSCATE=0

for %%A in (%*) do (
  if "%%A"=="--obfuscate" set OBFUSCATE=1
)

echo.
echo   SOL_WAR_ROOM -- Release Build
echo   ----------------------------
echo.

REM 1. Build frontend
echo   [1/3] Building frontend...
cd /d "%ROOT%\artifacts\sol-war"
set BASE_PATH=/
set NODE_ENV=production
call pnpm vite build --config vite.config.ts
if errorlevel 1 ( echo   ERROR: Frontend build failed & exit /b 1 )
echo         OK Frontend built

REM 2. Build backend
echo   [2/3] Building backend...
cd /d "%ROOT%\artifacts\api-server"
call pnpm run build
if errorlevel 1 ( echo   ERROR: Backend build failed & exit /b 1 )
echo         OK Backend built

REM 3. Obfuscate (optional)
if "%OBFUSCATE%"=="1" (
  echo   [3/3] Obfuscating server.cjs...
  call javascript-obfuscator "%ROOT%\artifacts\api-server\dist\server.cjs" ^
    --output "%ROOT%\artifacts\api-server\dist\server.cjs" ^
    --compact true --string-array true --rotate-string-array true ^
    --string-array-encoding base64 --self-defending true ^
    --rename-globals false --source-map false
  if errorlevel 1 ( echo   WARNING: Obfuscation failed, shipping unobfuscated )
  echo         OK Obfuscated
) else (
  echo   [3/3] Skipping obfuscation (pass --obfuscate to enable^)
)

echo.
echo   Release ready: artifacts\api-server\dist\
echo.
echo   Distribute the dist\ folder. Users run: start.bat
echo.
endlocal
