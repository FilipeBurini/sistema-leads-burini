@echo off
title Parar Motor Scraper Google Maps
cd /d "%~dp0scraper"
py scripts/engine.py stop
pause

