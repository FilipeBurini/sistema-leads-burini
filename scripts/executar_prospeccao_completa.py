#!/usr/bin/env python3
"""
Executa a prospecção completa do setor alimentício em Franca SP
e sincroniza automaticamente com o Supabase e arquivos locais.
"""
import os
import sys
import subprocess
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRAPER_DIR = os.path.join(BASE_DIR, "scraper")
KEYWORDS_FILE = os.path.join(SCRAPER_DIR, "keywords_alimenticio_franca.txt")
OUTPUT_JSON = os.path.join(SCRAPER_DIR, "alimenticio_franca_completo.json")
SYNC_SCRIPT = os.path.join(BASE_DIR, "scripts", "sync-scraper-to-mapeador.py")

print("=" * 70)
print("INICIANDO PROSPECÇÃO EM MASSA - RAMO ALIMENTÍCIO EM FRANCA SP")
print("=" * 70)
print(f"Keywords: {KEYWORDS_FILE}")
print(f"Saída: {OUTPUT_JSON}")

# 1. Executar o scraper
cmd_scrape = [
    sys.executable,
    os.path.join(SCRAPER_DIR, "scripts", "scrape.py"),
    "--keywords-file", KEYWORDS_FILE,
    "--city", "Franca, SP",
    "--lang", "pt",
    "--country", "br",
    "--depth", "4",
    "--no-deep-emails",
    "--full",
    "--out", OUTPUT_JSON
]

print("\n▶ Rodando o motor de extração do Google Maps...")
start_time = time.time()
res_scrape = subprocess.run(cmd_scrape, cwd=SCRAPER_DIR)

if res_scrape.returncode != 0:
    print(f"\n❌ Erro durante a execução do scraper (código {res_scrape.returncode}).")
    sys.exit(res_scrape.returncode)

elapsed = round(time.time() - start_time, 1)
print(f"\n✓ Extração concluída em {elapsed}s!")

# 2. Sincronizar com o Supabase e Mapeador Urbano
print("\n▶ Sincronizando com o Supabase e arquivos do Mapeador Urbano...")
cmd_sync = [
    sys.executable,
    SYNC_SCRIPT,
    OUTPUT_JSON,
    "--append"
]

res_sync = subprocess.run(cmd_sync, cwd=BASE_DIR)
if res_sync.returncode == 0:
    print("\n" + "=" * 70)
    print("✓ PROCESSO COMPLETO FINALIZADO COM SUCESSO!")
    print("Todos os estabelecimentos de alimentação foram gravados no Supabase.")
    print("=" * 70)
else:
    print(f"\n⚠ Falha na sincronização final (código {res_sync.returncode}).")

