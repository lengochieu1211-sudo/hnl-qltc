@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo      HNL QLTC RC2.2.2 - DEV EMULATOR GOLDEN
echo ==============================================
where node >nul 2>nul || (echo [ERROR] Chua cai Node.js 22+ & pause & exit /b 1)
where npm >nul 2>nul || (echo [ERROR] Khong tim thay npm & pause & exit /b 1)
where java >nul 2>nul || (echo [ERROR] Firestore Emulator can Java. Hay cai Java 11+ / 17+ & pause & exit /b 1)
if not exist node_modules\ (
  echo [1/2] Dang cai dependency bang npm ci...
  call npm ci || (pause & exit /b 1)
)
echo [2/2] Dang build va khoi dong Firebase Emulator...
call npm run dev:emulator
if errorlevel 1 pause
endlocal
