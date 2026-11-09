@echo off
title Motor Scraper Google Maps - Mapeador Urbano
echo ===================================================
echo   MOTOR DO SCRAPER GOOGLE MAPS (PORTA 8080)
echo ===================================================
echo.
echo 1. Abrindo painel visual no seu navegador...
start http://localhost:8080
echo.
echo 2. Iniciando motor de raspagem em segundo plano...
echo    (Mantenha esta janela aberta enquanto for usar o scraper)
echo.
cd /d "%~dp0scraper"
py engine\serve.py --port 8080
pause
