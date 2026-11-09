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
echo [1] Etapa Saúde: Clínicas Odontológicas, Estética VIP e Médicas
echo [2] Etapa Tech e Joias: Óticas, Joalherias e Celulares
echo [3] Etapa Auto e Móveis: Auto Centers, Mecânicas, Pneus e Móveis
echo [4] Etapa Moda: Roupas, Boutiques e Calçados de Alto Padrão
echo [5] Etapa Alimentação: Restaurantes, Bares, Adegas, Carnes e Padarias
echo [6] ALTO TICKET COMPLETO (Parcelados)
echo [7] TODOS OS SEGMENTOS (Global)
echo [8] Digitar um código CNAE específico (Ex: 4774-1/00 ou 5611-2/01)
echo [9] Sair
echo.
echo ==============================================================================
set /p opt="Digite o número da opção desejada (1-9): "

if "%opt%"=="1" goto SAUDE
if "%opt%"=="2" goto TECH_JOIAS
if "%opt%"=="3" goto AUTO_MOVEIS
if "%opt%"=="4" goto MODA
if "%opt%"=="5" goto ALIMENTACAO
if "%opt%"=="6" goto ALTO_TICKET
if "%opt%"=="7" goto TODOS
if "%opt%"=="8" goto CNAE_MANUAL
if "%opt%"=="9" goto FIM

echo Opção inválida!
timeout /t 2 > nul
goto MENU

:SAUDE
echo.
echo 🚀 Iniciando extração da Etapa Saúde (3 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento saude --tempo-minutos 3 --limite 40
goto PAUSA

:TECH_JOIAS
echo.
echo 🚀 Iniciando extração da Etapa Tech e Joias (3 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento tech_joias --tempo-minutos 3 --limite 40
goto PAUSA

:AUTO_MOVEIS
echo.
echo 🚀 Iniciando extração da Etapa Auto e Móveis (3 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento auto_moveis --tempo-minutos 3 --limite 40
goto PAUSA

:MODA
echo.
echo 🚀 Iniciando extração da Etapa Moda (3 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento moda --tempo-minutos 3 --limite 40
goto PAUSA

:ALIMENTACAO
echo.
echo 🚀 Iniciando extração da Etapa Alimentação (3 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento alimentacao --tempo-minutos 3 --limite 40
goto PAUSA

:ALTO_TICKET
echo.
echo 🚀 Iniciando extração do segmento ALTO TICKET (5 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento alto_ticket --tempo-minutos 5 --limite 35
goto PAUSA

:TODOS
echo.
echo 🚀 Iniciando extração de TODOS os segmentos (5 minutos de limite contínuo)...
python -u scripts\fichario_cnpj_manager.py --segmento todos --tempo-minutos 5 --limite 30
goto PAUSA

:CNAE_MANUAL
echo.
set /p cnae_code="Digite o código CNAE (ex: 4774-1/00): "
python -u scripts\fichario_cnpj_manager.py --cnae "%cnae_code%" --tempo-minutos 3 --limite 40
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

