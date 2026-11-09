#!/usr/bin/env python3
"""
Execução Automatizada: Prospecção de Ramos Estratégicos para Maquininhas de Cartão em Franca SP
- Nichos de Parcelado de Alto Valor (Odonto, Estética, Óticas, Roupas, Móveis, Auto Center, Celulares)
- Nichos de Giro Rápido & Alto Volume (Açougue, Hortifruti, Pet Shop, Barbearia, Farmácia, Lava Jato)
- Deduplicação inteligente contra a base existente
- Sincronização automática com Supabase e arquivos locais
"""

import os
import sys
import subprocess
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRAPER_DIR = os.path.join(BASE_DIR, "scraper")
KEYWORDS_FILE = os.path.join(SCRAPER_DIR, "keywords_maquininhas_franca.txt")
OUTPUT_JSON = os.path.join(SCRAPER_DIR, "maquininhas_franca_novos.json")
SYNC_SCRIPT = os.path.join(BASE_DIR, "scripts", "sync-scraper-to-mapeador.py")

print("=" * 75)
print("  PROSPECÇÃO INTELIGENTE DE LEADS B2B: MAQUININHAS & ADQUIRÊNCIA (FRANCA SP)")
print("  Foco: Parcelados de Alto Valor Agregado & Estabelecimentos de Alto Giro")
print("=" * 75)
print(f"Keywords: {KEYWORDS_FILE}")
print(f"Arquivo de Saída: {OUTPUT_JSON}\n")

# 1. Verificar se o motor scraper está ativo
def check_engine():
    try:
        with urllib.request.urlopen("http://localhost:8080/api/v1/jobs", timeout=2) as r:
            return True
    except Exception:
        return False

if not check_engine():
    print("▶ Iniciando motor de raspagem em segundo plano...")
    subprocess.run([sys.executable, os.path.join(SCRAPER_DIR, "scripts", "engine.py"), "start"], cwd=SCRAPER_DIR)
    time.sleep(2)
    if not check_engine():
        print("❌ Falha ao conectar ao motor de extração na porta 8080.")
        sys.exit(1)

print("✓ Motor de extração ativo e pronto (http://localhost:8080)!\n")

# 2. Executar o scraper
cmd_scrape = [
    sys.executable,
    os.path.join(SCRAPER_DIR, "scripts", "scrape.py"),
    "--keywords-file", KEYWORDS_FILE,
    "--city", "Franca, SP",
    "--lang", "pt",
    "--country", "br",
    "--depth", "3",
    "--no-deep-emails",
    "--full",
    "--out", OUTPUT_JSON
]

print("▶ Extraindo estabelecimentos comerciais do Google Maps em Franca SP...")
print("  (Aguardando varredura por todos os ramos configurados...)")
start_time = time.time()
res_scrape = subprocess.run(cmd_scrape, cwd=SCRAPER_DIR)

if res_scrape.returncode != 0:
    print(f"\n❌ Erro durante a raspagem (código {res_scrape.returncode}).")
    sys.exit(res_scrape.returncode)

elapsed = round(time.time() - start_time, 1)
print(f"\n✓ Extração dos novos ramos concluída em {elapsed}s!")

# 3. Sincronização e Deduplicação Rigorosa
print("\n▶ Iniciando processo de Deduplicação Rigorosa e Sincronização com Supabase...")
cmd_sync = [
    sys.executable,
    SYNC_SCRIPT,
    OUTPUT_JSON,
    "--append"
]

res_sync = subprocess.run(cmd_sync, cwd=BASE_DIR)
if res_sync.returncode == 0:
    print("\n" + "=" * 75)
    print("✓ PROSPECÇÃO E ATUALIZAÇÃO CONCLUÍDAS COM SUCESSO!")
    print("  Todos os novos leads foram gravados sem duplicações.")
    print("=" * 75)
else:
    print(f"\n⚠ Falha na sincronização dos dados (código {res_sync.returncode}).")
    sys.exit(res_sync.returncode)

