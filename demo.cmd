@echo off
rem Doble clic para levantar la demo (ver demo.py). Acepta los mismos argumentos: --local, --reiniciar.
cd /d "%~dp0"
where uv >nul 2>nul || (
  echo Falta uv. Instalalo desde https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)
uv run demo.py %*
pause
