@echo off
title Anima CPTEC Server (Miniforge Environment)
echo ===================================================
echo     Anima CPTEC - Servidor Independente (Miniforge)
echo ===================================================
echo.
cd /d "%~dp0"

REM Priority 1: Miniforge 3 Environment
set "PYTHON_CMD="

if exist "%USERPROFILE%\miniforge3\python.exe" (
    set "PYTHON_CMD=%USERPROFILE%\miniforge3\python.exe"
) else if exist "C:\miniforge3\python.exe" (
    set "PYTHON_CMD=C:\miniforge3\python.exe"
) else if exist "%LOCALAPPDATA%\miniforge3\python.exe" (
    set "PYTHON_CMD=%LOCALAPPDATA%\miniforge3\python.exe"
) else if exist "C:\ProgramData\miniforge3\python.exe" (
    set "PYTHON_CMD=C:\ProgramData\miniforge3\python.exe"
) else (
    REM Fallback to system python
    set "PYTHON_CMD=python"
)

echo Usando Miniforge Python: "%PYTHON_CMD%"
echo Iniciando servidor Anima CPTEC em http://localhost:5000 ...
echo Pressione Ctrl+C para encerrar.
echo.

start "" "http://localhost:5000"
"%PYTHON_CMD%" server.py

pause
