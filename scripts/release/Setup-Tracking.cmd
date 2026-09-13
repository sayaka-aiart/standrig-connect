@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-v8.ps1" -OutputDirectory "%~dp0."
if errorlevel 1 (
  echo V8 setup failed. Tracking setup was not started.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-native-inference.ps1" -OutputDirectory "%~dp0." -WithUpperBody
if errorlevel 1 (
  echo Tracking setup failed. Check the error above.
  pause
  exit /b 1
)
echo Tracking setup complete. Start Connect.Desktop.exe.
pause
