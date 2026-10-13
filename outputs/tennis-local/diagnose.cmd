@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.cmd first.
  pause
  exit /b 1
)
echo Close the previous setup session by typing quit in its console first.
echo This opens the same separate profile with read-only diagnostics.
echo At the disabled verification page, type status in this console.
echo No refresh, challenge bypass, booking or payment is performed.
".venv\Scripts\python.exe" tennis.py inspect
pause
