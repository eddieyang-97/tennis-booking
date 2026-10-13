@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.cmd first and sign in using its separate Chrome profile.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" tennis.py dry-run %*
pause
