@echo off
setlocal
cd /d "%~dp0\.."
echo ============================================================
echo HNL QLTC - Build portable Windows EXE
 echo Source: %CD%
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File ".\desktop-wrapper\build-launcher.ps1"
if errorlevel 1 (
  echo.
  echo BUILD FAILED. Please capture this window and send it for support.
  pause
  exit /b 1
)
echo.
echo BUILD SUCCESS: HNL-QLTC-Windows.exe
echo.
pause
