# Script de Execução Independente do Servidor Anima CPTEC
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "     Anima CPTEC - Servidor Independente (Flask)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$PythonExe = "python"
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    $Fallback = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path $Fallback) {
        $PythonExe = $Fallback
    }
}

Write-Host "Iniciando servidor Anima CPTEC em http://localhost:5000 ..." -ForegroundColor Green
Start-Process "http://localhost:5000"

& $PythonExe server.py
