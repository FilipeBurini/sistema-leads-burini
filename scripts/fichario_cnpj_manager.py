"""
=============================================================================
CITYMAP HUB - GERENCIADOR & INTEGRADOR DE CNPJS DA RECEITA FEDERAL (FICHÁRIO)
=============================================================================
Funcionalidades:
1. Puxa CNPJs oficiais de Franca-SP via API Fichário (por CNAE ou Segmento) sob demanda.
2. Armazena em tabela dedicada 'public.cnpj_leads' no banco de dados.
3. Cruza com 'public.leads' para evitar duplicidade e enriquecer leads existentes com:
   - CNPJ oficial
   - Lista completa de Sócios / QSA (tomadores de decisão)
   - Faixa de faturamento anual estimado
   - Porte (ME, EPP, Demais) e E-mail corporativo
4. Detecta concentração de CNPJs no mesmo endereço (Suspeita de CNPJs Fantasmas / Endereço Virtual).
=============================================================================
"""

import sys
import os
import json
import re
import time
import argparse
import unicodedata
import urllib.request
import urllib.parse
from collections import defaultdict

# Configurações do Supabase
SUPABASE_URL = "https://ubnpeahxlffutiuopafm.supabase.co"
SUPABASE_KEY = "sb_publishable_G8l2tHVnRTNLJN6UFqigGQ_yAjCLvOi"

# Configuração da API Fichário
FICHARIO_BASE_URL = "https://fichario.app/api/v1"
HEADERS_FICHARIO = {
    "User-Agent": "CityMapHub-Integration/2.0 (contato@citymap.com)"
}

HEADERS_SUPABASE = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# CNAEs mais relevantes para maquininhas e vendas B2B em Franca/SP
CNAE_PRESETS = {
    "alto_ticket": [
        {"codigo": "4774-1/00", "nome": "Óticas e Artigos de Óptica"},
        {"codigo": "8630-5/04", "nome": "Clínicas Odontológicas"},
        {"codigo": "9602-5/02", "nome": "Clínicas de Estética VIP e Cuidados Corporais"},
        {"codigo": "4783-1/01", "nome": "Joalherias e Relojoarias"},
        {"codigo": "4752-1/00", "nome": "Celulares, Smartphones e Assistência Técnica"},
        {"codigo": "4754-7/01", "nome": "Lojas de Móveis Planejados e Colchões"},
        {"codigo": "4520-0/01", "nome": "Oficinas Mecânicas e Auto Centers"},
        {"codigo": "4530-7/05", "nome": "Lojas de Pneus e Rodas (Pneumáticos)"},
        {"codigo": "4530-7/03", "nome": "Autopeças e Acessórios Veiculares"},
        {"codigo": "4782-2/01", "nome": "Lojas de Calçados de Alto Padrão"},
        {"codigo": "4781-4/00", "nome": "Lojas de Vestuário e Boutiques"},
    ],
    "alimentacao": [
        {"codigo": "5611-2/01", "nome": "Restaurantes e Similares"},
        {"codigo": "5611-2/02", "nome": "Bares e Choperias"},
        {"codigo": "5611-2/03", "nome": "Lanchonetes e Casas de Sucos"},
        {"codigo": "4723-7/00", "nome": "Adegas e Comércio de Bebidas"},
        {"codigo": "4721-1/02", "nome": "Padarias e Confeitarias"},
        {"codigo": "4712-1/00", "nome": "Mercados de Bairro e Mercearias"},
    ]
}

def clean_digits(val):
    if not val:
        return ""
    return re.sub(r"\D", "", str(val))

def normalize_text(text):
    if not text:
        return ""
    # Remove acentos e converte para minúsculas
    norm = unicodedata.normalize('NFKD', str(text)).encode('ASCII', 'ignore').decode('utf-8')
    norm = norm.lower()
    # Remove termos comuns de empresa
    norm = re.sub(r"\b(ltda|me|epp|s\/a|sa|eireli|cia|comercio|artigos|servicos)\b", "", norm)
    # Remove caracteres especiais
    norm = re.sub(r"[^a-z0-9\s]", " ", norm)
    return " ".join(norm.split())

def format_cnpj(digits):
    d = clean_digits(digits).zfill(14)
    return f"{d[0:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"

class FicharioManager:
    def __init__(self, cidade="Franca", uf="SP"):
        self.cidade = cidade
        self.uf = uf
        self.existing_leads = []
        self.leads_by_cnpj = {}
        self.leads_by_phone = {}
        self.leads_by_name = []
        self.last_remaining = 60
        self.last_reset = 0
        self.total_api_calls = 0

    def load_existing_leads(self):
        """Carrega leads já existentes no banco para checagem cruzada"""
        print(f"📡 Carregando leads existentes do Supabase...")
        try:
            all_leads = []
            from_idx = 0
            step = 1000
            while True:
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/rest/v1/leads?select=id,name,phone,whatsapp,address,cnpj,crm_notes,cnae,data_abertura&offset={from_idx}&limit={step}",
                    headers={**HEADERS_SUPABASE, "Prefer": "count=exact"}
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    chunk = json.loads(resp.read().decode())
                    if not chunk:
                        break
                    all_leads.extend(chunk)
                    if len(chunk) < step:
                        break
                    from_idx += step
            self.existing_leads = all_leads
            print(f"✔ {len(self.existing_leads)} leads carregados do banco de dados.")
        except Exception as e:
            print(f"⚠️ Erro ao buscar leads da nuvem ({e}). Tentando fallback local...")
            local_path = os.path.join(os.path.dirname(__file__), "..", "data", "default-places.json")
            if os.path.exists(local_path):
                with open(local_path, "r", encoding="utf-8") as f:
                    self.existing_leads = json.load(f)
                print(f"✔ {len(self.existing_leads)} leads carregados do arquivo local.")

        # Índices em memória para matching rápido
        for l in self.existing_leads:
            lid = l.get("id")
            # CNPJ index
            if l.get("cnpj"):
                clean_c = clean_digits(l["cnpj"])
                if clean_c:
                    self.leads_by_cnpj[clean_c] = l
            # Phone index
            for ph in [l.get("phone"), l.get("whatsapp")]:
                clean_p = clean_digits(ph)
                if len(clean_p) >= 8:
                    # Considera os últimos 8 dígitos
                    self.leads_by_phone[clean_p[-8:]] = l
            # Name index
            norm_n = normalize_text(l.get("name"))
            if norm_n:
                self.leads_by_name.append({
                    "norm": norm_n,
                    "lead": l
                })

    def fetch_cnpj_list(self, cnae_code, limit=50):
        """Busca lista de CNPJs por CNAE no Fichário (usando código limpo)"""
        cnae_digits = clean_digits(cnae_code)
        print(f"\n🔍 Consultando Fichário para CNAE {cnae_code} ({cnae_digits}) em {self.cidade}/{self.uf}...")
        url = f"{FICHARIO_BASE_URL}/busca-avancada?cidade={urllib.parse.quote(self.cidade)}&uf={self.uf}&cnae={cnae_digits}&por_pagina={min(limit, 100)}"
        
        req = urllib.request.Request(url, headers=HEADERS_FICHARIO)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                self.last_remaining = int(resp.headers.get("X-RateLimit-Remaining", 60))
                self.last_reset = float(resp.headers.get("X-RateLimit-Reset", 0))
                self.total_api_calls += 1
                data = json.loads(resp.read().decode())
                resultados = data.get("resultados", [])
                total = data.get("total", len(resultados))
                print(f"✔ Encontradas {total} empresas registradas. Selecionando lote de {min(len(resultados), limit)}...")
                return resultados[:limit]
        except Exception as e:
            print(f"❌ Erro ao consultar CNAE {cnae_code}: {e}")
            return []

    def fetch_cnpj_details(self, cnpj):
        """Consulta dossiê completo de um CNPJ respeitando rate limits da API"""
        clean_c = clean_digits(cnpj)
        url = f"{FICHARIO_BASE_URL}/cnpj/{clean_c}"
        req = urllib.request.Request(url, headers=HEADERS_FICHARIO)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.last_remaining = int(resp.headers.get("X-RateLimit-Remaining", 60))
                    self.last_reset = float(resp.headers.get("X-RateLimit-Reset", 0))
                    self.total_api_calls += 1
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print("      ⏳ Rate limit atingido (HTTP 429). Aguardando 12s para reabertura da janela...")
                    time.sleep(12)
                else:
                    return None
            except Exception:
                time.sleep(1)
        return None

    def match_with_existing_lead(self, cnpj_clean, razao_social, nome_fantasia, telefone, endereco_logradouro):
        """Verifica se a empresa já existe no sistema para evitar duplicar"""
        # 1. Matching por CNPJ
        if cnpj_clean in self.leads_by_cnpj:
            return self.leads_by_cnpj[cnpj_clean], "cnpj"

        # 2. Matching por Telefone
        clean_p = clean_digits(telefone)
        if len(clean_p) >= 8 and clean_p[-8:] in self.leads_by_phone:
            return self.leads_by_phone[clean_p[-8:]], "phone"

        # 3. Matching por Nome e Endereço
        for target_name in [nome_fantasia, razao_social]:
            if not target_name:
                continue
            norm_target = normalize_text(target_name)
            if len(norm_target) < 3:
                continue
            for item in self.leads_by_name:
                item_norm = item["norm"]
                # Match se um contém o outro ou se as palavras-chave coincidem
                if norm_target in item_norm or item_norm in norm_target:
                    lead = item["lead"]
                    # Se tiver logradouro, confirma proximidade de endereço
                    if endereco_logradouro:
                        norm_end = normalize_text(endereco_logradouro)
                        lead_addr = normalize_text(lead.get("address", ""))
                        # Se contiver a mesma rua ou se o nome for bem específico
                        if any(w in lead_addr for w in norm_end.split() if len(w) > 4):
                            return lead, "name_address"
                    return lead, "name"

        return None, "none"

    def detect_ghost_clusters(self, cnpj_records, threshold=3):
        """
        Detecta endereços com muitos CNPJs registrados (Suspeita de Fantasma / Escritório Virtual).
        Retorna dicionário com endereços suspeitos.
        """
        print(f"\n🕵️ Analisando concentração de endereços (Detecção de CNPJs Fantasmas)...")
        address_map = defaultdict(list)

        for rec in cnpj_records:
            logr = rec.get("logradouro") or ""
            num = rec.get("numero") or ""
            bairro = rec.get("bairro") or ""
            
            # Normalizar chave de endereço
            norm_key = f"{normalize_text(logr)}_{clean_digits(num)}".strip("_")
            if norm_key and norm_key != "0" and len(norm_key) > 4:
                address_map[norm_key].append(rec)

        ghost_alerts = {}
        for addr_key, items in address_map.items():
            if len(items) >= threshold:
                sample = items[0]
                addr_display = f"{sample.get('logradouro')}, {sample.get('numero')} - {sample.get('bairro')}"
                ghost_alerts[addr_key] = {
                    "address_display": addr_display,
                    "count": len(items),
                    "cnpjs": [it["cnpj"] for it in items],
                    "companies": [it.get("nome_fantasia") or it.get("razao_social") for it in items]
                }

        # Atualizar os registros de CNPJ com a flag de suspeita
        for rec in cnpj_records:
            logr = rec.get("logradouro") or ""
            num = rec.get("numero") or ""
            norm_key = f"{normalize_text(logr)}_{clean_digits(num)}".strip("_")
            if norm_key in ghost_alerts:
                alert = ghost_alerts[norm_key]
                rec["is_ghost_suspect"] = True
                rec["ghost_count_at_address"] = alert["count"]
                rec["ghost_reason"] = (
                    f"⚠️ ALERTA: {alert['count']} empresas registradas exatamente neste mesmo endereço "
                    f"({alert['address_display']}). Possível empresa fantasma, escritório virtual ou endereço fiscal."
                )
            else:
                rec["is_ghost_suspect"] = False
                rec["ghost_count_at_address"] = 1
                rec["ghost_reason"] = None

        return ghost_alerts

    def save_cnpj_leads_to_supabase(self, records):
        """Salva a lista dedicada de CNPJs no Supabase"""
        if not records:
            return True
        print(f"\n💾 Salvando {len(records)} registros na tabela 'public.cnpj_leads' do Supabase...")
        
        chunk_size = 50
        for i in range(0, len(records), chunk_size):
            chunk = records[i:i + chunk_size]
            payload = json.dumps(chunk).encode("utf-8")
            req = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/cnpj_leads",
                headers={**HEADERS_SUPABASE, "Prefer": "resolution=merge-duplicates"},
                data=payload,
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    pass
            except Exception as e:
                print(f"⚠️ Aviso ao gravar lote no Supabase: {e}")
                # Fallback: salva localmente
                self.save_local_backup(records)
                return False

        print(f"✔ Todos os {len(records)} CNPJs foram sincronizados com sucesso na tabela public.cnpj_leads!")
        return True

    def save_local_backup(self, records):
        local_path = os.path.join(os.path.dirname(__file__), "..", "data", "cnpj-leads.json")
        try:
            existing = {}
            if os.path.exists(local_path):
                try:
                    with open(local_path, "r", encoding="utf-8") as f:
                        for item in json.load(f):
                            if item.get("cnpj"):
                                existing[item["cnpj"]] = item
                except:
                    pass
            for r in records:
                if r.get("cnpj"):
                    existing[r["cnpj"]] = r
            merged_list = list(existing.values())
            with open(local_path, "w", encoding="utf-8") as f:
                json.dump(merged_list, f, ensure_ascii=False, indent=2)
            print(f"✔ Backup local consolidado ({len(merged_list)} CNPJs salvos) em: {local_path}")
        except Exception as e:
            print(f"Erro ao salvar backup local: {e}")

    def update_enriched_leads_in_supabase(self, leads_to_update):
        """Atualiza os leads existentes no Supabase com os dados agregados da Receita"""
        if not leads_to_update:
            return
        print(f"\n🔄 Atualizando {len(leads_to_update)} leads existentes no Supabase com dados da Receita...")
        for lead in leads_to_update:
            lid = lead["id"]
            update_data = {
                "cnpj": lead.get("cnpj"),
                "cnae": lead.get("cnae"),
                "data_abertura": lead.get("data_abertura"),
                "crm_notes": lead.get("crm_notes")
            }
            try:
                payload = json.dumps(update_data).encode("utf-8")
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/rest/v1/leads?id=eq.{lid}",
                    headers={**HEADERS_SUPABASE, "Prefer": "return=minimal"},
                    data=payload,
                    method="PATCH"
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    pass
            except Exception as e:
                print(f"Aviso ao atualizar lead {lid}: {e}")

    def run_import(self, cnaes, limit_per_cnae=35, max_runtime_seconds=300):
        """Executa a importação completa respeitando limite de tempo e cota por minuto"""
        self.load_existing_leads()

        start_time = time.time()
        processed_cnpjs = []
        enriched_leads = []
        total_matched = 0
        total_new = 0

        target_mins = max_runtime_seconds / 60.0
        print("\n" + "=" * 70)
        print(f"⏱️ SESSÃO CONFIGURADA: {target_mins:.1f} MINUTOS DE USO CONTÍNUO DA API")
        print(f"🛡️ LIMITE ATIVO: 60 REQ/MINUTO (CADÊNCIA AUTOMÁTICA ~1.08s)")
        print(f"🎯 META: Enriquecer empresas do Segmento Alto Ticket de Franca-SP")
        print("=" * 70)

        for item in cnaes:
            elapsed = time.time() - start_time
            if elapsed >= max_runtime_seconds:
                print(f"\n⏱️ Limite de tempo de {target_mins:.1f} minutos atingido! Finalizando coleta...")
                break

            cnae_code = item["codigo"]
            cnae_nome = item["nome"]
            
            empresas = self.fetch_cnpj_list(cnae_code, limit=limit_per_cnae)
            time.sleep(1.05)
            
            for emp in empresas:
                elapsed = time.time() - start_time
                if elapsed >= max_runtime_seconds:
                    print(f"\n⏱️ Limite de tempo de {target_mins:.1f} minutos atingido! Finalizando processamento...")
                    break

                raw_cnpj = emp.get("cnpj")
                clean_c = clean_digits(raw_cnpj)
                if not clean_c:
                    continue

                # Evitar reprocessar na mesma sessão
                if any(p["cnpj"] == clean_c for p in processed_cnpjs):
                    continue

                # Proteção estrita do Rate Limit (60 req/min da API Fichário):
                if self.last_remaining <= 2:
                    wait_time = max(2.0, self.last_reset - time.time() + 1.0)
                    print(f"   ⏳ [RateLimit Watchdog] Quase no teto ({self.last_remaining} restantes). Aguardando {wait_time:.1f}s...")
                    time.sleep(wait_time)
                else:
                    time.sleep(1.08) # Cadência média de ~54 req/minuto (100% seguro)

                details = self.fetch_cnpj_details(clean_c) or {}

                # Exibição do tempo e taxa
                cur_elapsed = time.time() - start_time
                mins = int(cur_elapsed // 60)
                secs = int(cur_elapsed % 60)
                time_str = f"{mins:02d}:{secs:02d}"
                target_str = f"{int(target_mins):02d}:00"

                endereco = details.get("endereco") or {}
                logr = endereco.get("logradouro") or ""
                num = endereco.get("numero") or ""
                bairro = endereco.get("bairro") or ""
                cep = endereco.get("cep") or ""
                completo = f"{logr}, {num} - {bairro}, {self.cidade}-{self.uf}".strip(", -")

                socios = details.get("socios") or []
                estimativas = details.get("estimativas") or {}
                fat_info = estimativas.get("faturamento_anual") or {}
                func_info = estimativas.get("funcionarios") or {}

                razao_social = details.get("razao_social") or emp.get("razao_social") or ""
                nome_fantasia = details.get("nome_fantasia") or emp.get("nome_fantasia") or ""
                telefone = details.get("telefone") or emp.get("telefone") or ""
                email = details.get("email") or ""
                porte = details.get("porte") or emp.get("porte") or "Demais"
                data_abertura = details.get("data_abertura") or emp.get("data_abertura") or ""
                capital_str = str(details.get("capital_social") or emp.get("capital_social") or "0").replace(",", ".")

                try:
                    capital_num = float(re.sub(r"[^\d.]", "", capital_str))
                except:
                    capital_num = 0.0

                # 2. VERIFICA SE JÁ ESTÁ CADASTRADO NO SISTEMA PARA AGREGAR INFORMAÇÕES
                matched_lead, match_type = self.match_with_existing_lead(
                    clean_c, razao_social, nome_fantasia, telefone, logr
                )

                if matched_lead:
                    total_matched += 1
                    matched_id = matched_lead["id"]
                    print(f"   [{time_str}/{target_str}] [Cota: {self.last_remaining}/60] 🔗 [MATCH ({match_type})]: {razao_social} -> Lead '{matched_lead['name']}'")
                    
                    # Agregar informações ao lead existente
                    matched_lead["cnpj"] = format_cnpj(clean_c)
                    matched_lead["cnae"] = cnae_code
                    if data_abertura:
                        matched_lead["data_abertura"] = data_abertura

                    # Montar resumo de inteligência comercial
                    socios_nomes = [s.get("nome") for s in socios if s.get("nome")]
                    socios_str = ", ".join(socios_nomes[:3]) if socios_nomes else "Não listados"
                    fat_central = fat_info.get("estimativa_central", 0)
                    fat_str = f"R$ {fat_central:,.2f}" if fat_central else porte

                    nota_adicional = (
                        f"\n🏢 [Receita Federal/Fichário]: Porte: {porte} | "
                        f"Fat. Est.: {fat_str} | Sócios: {socios_str} | "
                        f"CNPJ: {format_cnpj(clean_c)} | CNAE: {cnae_code}"
                    )
                    
                    if nota_adicional not in (matched_lead.get("crm_notes") or ""):
                        matched_lead["crm_notes"] = ((matched_lead.get("crm_notes") or "") + nota_adicional).strip()

                    enriched_leads.append(matched_lead)
                else:
                    total_new += 1
                    matched_id = None
                    print(f"   [{time_str}/{target_str}] [Cota: {self.last_remaining}/60] ✨ [NOVO CNPJ]: {razao_social} ({nome_fantasia or 'Sem Fantasia'})")

                record = {
                    "cnpj": clean_c,
                    "cnpj_formatted": format_cnpj(clean_c),
                    "razao_social": razao_social,
                    "nome_fantasia": nome_fantasia or None,
                    "situacao": details.get("situacao") or "ATIVA",
                    "data_abertura": data_abertura if len(str(data_abertura)) == 10 else None,
                    "porte": porte,
                    "capital_social": capital_num,
                    "cnae_principal": cnae_code,
                    "cnae_descricao": cnae_nome,
                    "faixa_receita_estimada": emp.get("faixa_receita_estimada") or fat_info.get("base_legal") or "",
                    "faturamento_estimado_central": float(fat_info.get("estimativa_central") or 0),
                    "funcionarios_estimados": int(func_info.get("estimativa_central") or 0),
                    "logradouro": logr,
                    "numero": num,
                    "complemento": endereco.get("complemento") or None,
                    "bairro": bairro,
                    "cep": cep,
                    "municipio": self.cidade.upper(),
                    "uf": self.uf.upper(),
                    "endereco_completo": completo,
                    "telefone": telefone or None,
                    "email": email or None,
                    "socios": socios,
                    "simples_nacional": details.get("simples_nacional", {}).get("optante", False) if isinstance(details.get("simples_nacional"), dict) else False,
                    "natureza_juridica": details.get("natureza_juridica") or emp.get("natureza_juridica"),
                    "matched_lead_id": matched_id,
                    "match_type": match_type,
                    "is_ghost_suspect": False,
                    "ghost_reason": None,
                    "ghost_count_at_address": 1
                }
                processed_cnpjs.append(record)

        # 3. DETECÇÃO DE CNPJS FANTASMAS (CONCENTRAÇÃO NO MESMO LOCAL)
        ghost_alerts = self.detect_ghost_clusters(processed_cnpjs, threshold=3)

        # 4. SALVAMENTO E SINCRONIZAÇÃO
        self.save_cnpj_leads_to_supabase(processed_cnpjs)
        self.save_local_backup(processed_cnpjs)

        if enriched_leads:
            self.update_enriched_leads_in_supabase(enriched_leads)

        # 5. RELATÓRIO EXECUTIVO FINAL
        print("\n" + "=" * 70)
        print("📊 RELATÓRIO FINAL DA IMPORTAÇÃO E ANÁLISE DE CNPJS")
        print("=" * 70)
        print(f"Total de CNPJs processados:               {len(processed_cnpjs)}")
        print(f"CNPJs vinculados a Leads já existentes:   {total_matched} (Enriquecidos sem duplicar)")
        print(f"CNPJs novos catalogados:                  {total_new} (Prontos para prospecção)")
        print(f"Endereços suspeitos de CNPJs Fantasmas:   {len(ghost_alerts)}")
        
        if ghost_alerts:
            print("\n🚨 DETALHES DAS SUSPEITAS DE CNPJS FANTASMAS / ENDEREÇOS VIRTUAIS:")
            for k, info in ghost_alerts.items():
                print(f"  📍 Endereço: {info['address_display']}")
                print(f"     Quantidade de CNPJs no mesmo número: {info['count']}")
                print(f"     Empresas no local: {', '.join(info['companies'][:4])}")
                print("-" * 50)
        print("=" * 70)

def main():
    parser = argparse.ArgumentParser(description="Gerenciador de CNPJs da Receita Federal via Fichário")
    parser.add_argument("--cnae", type=str, help="Código de CNAE específico (ex: 4774-1/00 ou 5611-2/01)")
    parser.add_argument("--segmento", type=str, choices=["alto_ticket", "alimentacao", "todos"], default="alto_ticket",
                        help="Preset de segmentos com alto volume ou parcelamento")
    parser.add_argument("--limite", type=int, default=35, help="Quantidade máxima de empresas por CNAE")
    parser.add_argument("--tempo-minutos", type=float, default=5.0, help="Tempo total de execução em minutos utilizando o limite da API (padrão: 5)")
    parser.add_argument("--cidade", type=str, default="Franca", help="Nome da cidade")
    parser.add_argument("--uf", type=str, default="SP", help="Sigla do estado")

    args = parser.parse_args()

    cnaes_to_run = []
    if args.cnae:
        cnaes_to_run.append({"codigo": args.cnae, "nome": f"CNAE {args.cnae}"})
    elif args.segmento == "todos":
        for seg in CNAE_PRESETS.values():
            cnaes_to_run.extend(seg)
    else:
        cnaes_to_run = CNAE_PRESETS.get(args.segmento, [])

    max_runtime = int(args.tempo_minutos * 60)
    print(f"🚀 Iniciando extração e cruzamento de CNPJs para {args.cidade}/{args.uf}...")
    print(f"Segmento selecionado: {args.segmento} ({len(cnaes_to_run)} CNAEs configurados)")
    print(f"Duração programada: {args.tempo_minutos:.1f} minutos de coleta contínua")

    manager = FicharioManager(cidade=args.cidade, uf=args.uf)
    manager.run_import(cnaes_to_run, limit_per_cnae=args.limite, max_runtime_seconds=max_runtime)

if __name__ == "__main__":
    main()
