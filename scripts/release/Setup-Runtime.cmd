@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-v8.ps1" -OutputDirectory "%~dp0."
if errorlevel 1 (
  echo Runtime setup failed. Check the error above.
  pause
  exit /b 1
)
echo Runtime setup complete.
pause
