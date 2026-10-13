@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto dependencies
py -3 --version >nul 2>&1
if errorlevel 1 (
  echo Install Python 3.11 or newer from python.org, including the Python launcher.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv
if errorlevel 1 goto failed
:dependencies
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" tennis.py inspect
pause
exit /b
:failed
echo Setup failed. Copy the error message for troubleshooting.
pause
exit /b 1
