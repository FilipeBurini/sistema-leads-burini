@echo off
chcp 65001 > nul
title Importador e Integrador de CNPJs (Fichário) - CityMapHub
cd /d "%~dp0"

:MENU
cls
echo ==============================================================================
echo        INTEGRADOR DE CNPJS DA RECEITA FEDERAL (FICHÁRIO API)
echo ==============================================================================
echo.
echo Escolha o tipo de extração de CNPJs para Franca-SP:
echo.
echo [1] Segmento ALTO TICKET / PARCELADOS (Óticas, Odonto, Joalherias, Roupas, Oficinas)
echo [2] Segmento ALIMENTAÇÃO / ALTO GIRO (Restaurantes, Bares, Adegas, Padarias)
echo [3] TODOS OS SEGMENTOS CONFIGURADOS
echo [4] Digitar um código CNAE específico (Ex: 4774-1/00 ou 5611-2/01)
echo [5] Sair
echo.
echo ==============================================================================
set /p opt="Digite o número da opção desejada (1-5): "

if "%opt%"=="1" goto ALTO_TICKET
if "%opt%"=="2" goto ALIMENTACAO
if "%opt%"=="3" goto TODOS
if "%opt%"=="4" goto CNAE_MANUAL
if "%opt%"=="5" goto FIM

echo Opção inválida!
timeout /t 2 > nul
goto MENU

:ALTO_TICKET
echo.
echo 🚀 Iniciando extração do segmento ALTO TICKET (5 minutos de limite contínuo)...
python scripts\fichario_cnpj_manager.py --segmento alto_ticket --tempo-minutos 5 --limite 35
goto PAUSA

:ALIMENTACAO
echo.
echo 🚀 Iniciando extração do segmento ALIMENTAÇÃO (5 minutos de limite contínuo)...
python scripts\fichario_cnpj_manager.py --segmento alimentacao --tempo-minutos 5 --limite 35
goto PAUSA

:TODOS
echo.
echo 🚀 Iniciando extração de TODOS os segmentos (5 minutos de limite contínuo)...
python scripts\fichario_cnpj_manager.py --segmento todos --tempo-minutos 5 --limite 30
goto PAUSA

:CNAE_MANUAL
echo.
set /p cnae_code="Digite o código CNAE (ex: 4774-1/00): "
python scripts\fichario_cnpj_manager.py --cnae "%cnae_code%" --tempo-minutos 3 --limite 40
goto PAUSA

:PAUSA
echo.
echo ==============================================================================
echo Processo concluído! Os dados foram agregados e salvos.
echo Verifique o painel Admin (admin.html) para visualizar os CNPJs e alertas.
echo ==============================================================================
echo.
pause
goto MENU

:FIM
exit

