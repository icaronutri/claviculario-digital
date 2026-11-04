@echo off
title Claviculario Digital - versao HTML
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node ferramentas\servir-html.js 8080 --abrir
  goto fim
)
echo Node.js nao encontrado; usando o PowerShell do Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ferramentas\servir-html.ps1"
:fim
echo.
echo  O sistema foi encerrado.
pause
