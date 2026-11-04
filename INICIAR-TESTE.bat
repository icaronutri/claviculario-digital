@echo off
chcp 65001 >nul
title Claviculario Digital - TESTE
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado neste computador.
  echo  Vou abrir o site para baixar. Instale a versao LTS e depois
  echo  clique de novo neste arquivo.
  echo.
  start https://nodejs.org/pt
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJ=%%v
if %NODEMAJ% LSS 22 (
  echo.
  echo  Seu Node.js e muito antigo. Instale a versao LTS mais nova em https://nodejs.org/pt
  start https://nodejs.org/pt
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning server.js --teste
echo.
echo  O sistema foi encerrado.
pause
