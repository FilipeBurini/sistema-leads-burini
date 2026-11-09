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
echo [4] Etapa Farmácias e Pet: Drogarias, Veterinárias, Pet Shops e Fitness
echo [5] Etapa Moda: Roupas, Boutiques e Calçados de Alto Padrão
echo [6] Etapa Alimentação: Restaurantes, Adegas, Carnes e Padarias
echo [7] ALTO TICKET COMPLETO (Parcelados - Dossiê Profundo)
echo [8] TODOS OS SEGMENTOS (Extração Massiva - Consumir Cota Diária)
echo [9] Digitar um código CNAE específico (Ex: 4774-1/00 ou 5611-2/01)
echo [10] Sair
echo.
echo ==============================================================================
set /p opt="Digite o número da opção desejada (1-10): "

if "%opt%"=="1" goto SAUDE
if "%opt%"=="2" goto TECH_JOIAS
if "%opt%"=="3" goto AUTO_MOVEIS
if "%opt%"=="4" goto FARMACIA_PET
if "%opt%"=="5" goto MODA
if "%opt%"=="6" goto ALIMENTACAO
if "%opt%"=="7" goto ALTO_TICKET
if "%opt%"=="8" goto TODOS
if "%opt%"=="9" goto CNAE_MANUAL
if "%opt%"=="10" goto FIM

echo Opção inválida!
timeout /t 2 > nul
goto MENU

:SAUDE
echo.
echo 🚀 Iniciando extração da Etapa Saúde (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento saude --tempo-minutos 10 --limite 100
goto PAUSA

:TECH_JOIAS
echo.
echo 🚀 Iniciando extração da Etapa Tech e Joias (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento tech_joias --tempo-minutos 10 --limite 100
goto PAUSA

:AUTO_MOVEIS
echo.
echo 🚀 Iniciando extração da Etapa Auto e Móveis (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento auto_moveis --tempo-minutos 10 --limite 100
goto PAUSA

:FARMACIA_PET
echo.
echo 🚀 Iniciando extração da Etapa Farmácias e Pet (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento farmacia_pet --tempo-minutos 10 --limite 100
goto PAUSA

:MODA
echo.
echo 🚀 Iniciando extração da Etapa Moda (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento moda --tempo-minutos 10 --limite 100
goto PAUSA

:ALIMENTACAO
echo.
echo 🚀 Iniciando extração da Etapa Alimentação (Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento alimentacao --tempo-minutos 10 --limite 100
goto PAUSA

:ALTO_TICKET
echo.
echo 🚀 Iniciando extração do segmento ALTO TICKET (Parcelados - Dossiê Profundo)...
python -u scripts\fichario_cnpj_manager.py --segmento alto_ticket --tempo-minutos 25 --limite 100 --max-total 1500
goto PAUSA

:TODOS
echo.
echo 🚀 Iniciando extração de TODOS os segmentos (Consumindo Cota Diária com Auto-Save)...
python -u scripts\fichario_cnpj_manager.py --segmento todos --tempo-minutos 45 --limite 150 --max-total 2500
goto PAUSA

:CNAE_MANUAL
echo.
set /p cnae_code="Digite o código CNAE (ex: 4774-1/00): "
python -u scripts\fichario_cnpj_manager.py --cnae "%cnae_code%" --tempo-minutos 5 --limite 100
goto PAUSA

:PAUSA
echo.
echo 🧭 Geocodificando CNPJs para suas coordenadas reais no mapa de Franca...
python scripts\geocode_cnpj_leads.py
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

