# Script de Execução Independente do Servidor Anima CPTEC com Miniforge
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "     Anima CPTEC - Servidor Independente (Miniforge)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# Localizar Miniforge Python
$MiniforgePaths = @(
    "$env:USERPROFILE\miniforge3\python.exe",
    "C:\miniforge3\python.exe",
    "$env:LOCALAPPDATA\miniforge3\python.exe",
    "C:\ProgramData\miniforge3\python.exe"
)

$PythonExe = "python"
foreach ($path in $MiniforgePaths) {
    if (Test-Path $path) {
        $PythonExe = $path
        break
    }
}

Write-Host "Usando Miniforge Python: $PythonExe" -ForegroundColor Yellow
Write-Host "Iniciando servidor Anima CPTEC em http://localhost:5000 ..." -ForegroundColor Green
Start-Process "http://localhost:5000"

& $PythonExe server.py
