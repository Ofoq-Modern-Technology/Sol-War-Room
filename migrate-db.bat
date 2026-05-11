@echo off
REM Upgrade the SOL_WAR_ROOM database to the latest schema.
REM Run this after pulling a new version: migrate-db.bat

setlocal

REM Resolve project root (directory this script lives in, without trailing backslash)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "DB_PATH=%ROOT%\artifacts\api-server\solwarroom.db"

if not exist "%DB_PATH%" (
  echo.
  echo   DB not found at: %DB_PATH%
  echo   If you moved your database, set DATABASE_PATH before running:
  echo     set DATABASE_PATH=C:\path\to\solwarroom.db ^&^& migrate-db.bat
  echo.
  if "%DATABASE_PATH%"=="" exit /b 1
) else (
  set "DATABASE_PATH=%DB_PATH%"
)

echo.
echo   SOL_WAR_ROOM -- DB Migration
echo   DB path: %DATABASE_PATH%
echo.

cd /d "%ROOT%\lib\db"
npx drizzle-kit push --config ./drizzle.config.ts

echo.
echo   Done -- database is up to date.
echo.

endlocal
