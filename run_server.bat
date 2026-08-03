@echo off
title Anima CPTEC Server
echo ===================================================
echo     Anima CPTEC - Servidor Independente (Flask)
echo ===================================================
echo.
cd /d "%~dp0"

REM Search for python executable
set PYTHON_CMD=python
where python >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
        set "PYTHON_CMD=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    )
)

echo Iniciando servidor Anima CPTEC em http://localhost:5000 ...
echo Pressione Ctrl+C para encerrar.
echo.

start "" "http://localhost:5000"
"%PYTHON_CMD%" server.py

pause
