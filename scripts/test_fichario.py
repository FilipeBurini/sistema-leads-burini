import urllib.request
import json
import urllib.parse
from collections import defaultdict

url = 'https://fichario.app/api/v1/busca-avancada?cidade=' + urllib.parse.quote('Franca') + '&uf=SP&cnae=4774100&por_pagina=20'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    cnpjs = [r['cnpj'] for r in data.get('resultados', [])[:10]]

print(f'Testing {len(cnpjs)} CNPJs for details and addresses...')
addresses = defaultdict(list)
for cnpj in cnpjs:
    detail_url = f'https://fichario.app/api/v1/cnpj/{cnpj}'
    dreq = urllib.request.Request(detail_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(dreq) as dresp:
            info = json.loads(dresp.read().decode())
            end = info.get('endereco', {})
            addr_str = f"{end.get('logradouro', '')}, {end.get('numero', '')} - {end.get('bairro', '')}".strip()
            addresses[addr_str].append({
                'cnpj': cnpj,
                'nome': info.get('razao_social'),
                'socios': [s.get('nome') for s in info.get('socios', [])]
            })
    except Exception as e:
        print('Error fetching detail:', e)

for addr, emps in addresses.items():
    print(f'Address: {addr} -> {len(emps)} empresa(s)')
    for emp in emps:
        print(f"   - {emp['nome']} (CNPJ: {emp['cnpj']}) | Sócios: {emp['socios']}")

