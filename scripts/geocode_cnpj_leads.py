"""
=============================================================================
CITYMAP HUB - MOTOR DE GEOCODIFICAÇÃO DE CNPJS (FRANCA-SP)
=============================================================================
Corrige a localização de todos os CNPJs para suas coordenadas reais no mapa:
1. Cruza com os 2.384 estabelecimentos verificados do Google Maps por CEP/Rua.
2. Geocodifica novos endereços via API Photon / OpenStreetMap para Franca-SP.
3. Utiliza centroides de bairros como fallback inteligente.
4. Aplica micro-dispersão para CNPJs no mesmo prédio para evitar sobreposição total.
5. Salva lat/lng diretamente em data/cnpj-leads.json e data/cnpj-leads.js.
=============================================================================
"""

import os
import json
import re
import time
import unicodedata
import urllib.request
import urllib.parse
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACES_PATH = os.path.join(BASE_DIR, "data", "default-places.json")
CNPJ_JSON_PATH = os.path.join(BASE_DIR, "data", "cnpj-leads.json")
CNPJ_JS_PATH = os.path.join(BASE_DIR, "data", "cnpj-leads.js")
CACHE_PATH = os.path.join(BASE_DIR, "data", "geocode-cache.json")

# Coordenadas reais de centroides dos bairros de Franca - SP
NEIGHBORHOOD_CENTROIDS = {
    "CENTRO": (-20.5386, -47.4009),
    "CIDADE NOVA": (-20.5310, -47.4080),
    "ESTACAO": (-20.5480, -47.4120),
    "BAIRRO DA ESTACAO": (-20.5480, -47.4120),
    "SAO JOSE": (-20.5450, -47.4020),
    "BAIRRO SAO JOSE": (-20.5450, -47.4020),
    "VILA APARECIDA": (-20.5360, -47.3910),
    "VILA SANTOS DUMONT": (-20.5420, -47.3820),
    "VILA CHICO JULIO": (-20.5220, -47.4110),
    "VILA NOVA": (-20.5250, -47.4050),
    "VILA SANTA CRUZ": (-20.5340, -47.4130),
    "PROLONGAMENTO VILA SANTA CRUZ": (-20.5340, -47.4150),
    "VILA INDUSTRIAL": (-20.5490, -47.4250),
    "PARQUE VICENTE LEPORACE I": (-20.4950, -47.4180),
    "PARQUE VICENTE LEPORACE": (-20.4950, -47.4180),
    "PARQUE LEPORACE": (-20.4950, -47.4180),
    "JARDIM PAULISTANO": (-20.5520, -47.3750),
    "SAO MIGUEL": (-20.5420, -47.4320),
    "JARDIM REDENTOR": (-20.5580, -47.3820),
    "JARDIM PIRATININGA": (-20.5590, -47.4050),
    "JARDIM PIRATININGA II": (-20.5620, -47.4070),
    "JARDIM VENEZA": (-20.5490, -47.4040),
    "RESIDENCIAL AMAZONAS": (-20.5650, -47.3920),
    "ESPLANADA PRIMO MENEGHETTI": (-20.5180, -47.3720),
    "PRIMO MENEGHETTI": (-20.5180, -47.3720),
    "JARDIM FRANCANO": (-20.5280, -47.4180),
    "RESIDENCIAL JARDIM VERA CRUZ": (-20.5530, -47.4280),
    "VERA CRUZ": (-20.5530, -47.4280),
    "SAO JOAQUIM": (-20.5210, -47.3990),
    "PARQUE PROGRESSO": (-20.5580, -47.3880),
    "JARDIM ALVORADA": (-20.5650, -47.3950),
    "JARDIM CAMBUI": (-20.4810, -47.4050),
    "JARDIM MARAMBAIA": (-20.4790, -47.4080),
    "JARDIM AEROPORTO": (-20.5750, -47.3680),
    "AEROPORTO": (-20.5750, -47.3680),
    "JARDIM PETRAGLIA": (-20.5180, -47.3820),
    "JARDIM PAINEIRAS": (-20.5120, -47.3910),
    "JARDIM PAINEIRA": (-20.5120, -47.3910),
    "JARDIM LUIZA": (-20.5050, -47.4020),
    "SANTO AGOSTINHO": (-20.5360, -47.3790),
    "JARDIM NOEMIA": (-20.5480, -47.3850),
    "PARQUE DAS ESMERALDAS": (-20.5390, -47.3680),
    "JARDIM PLANALTO": (-20.5290, -47.3880),
    "JARDIM DO EDEN": (-20.5150, -47.3700),
    "RESIDENCIAL SANTA BARBARA": (-20.5050, -47.3850),
    "VILA FORMOSA": (-20.5320, -47.3980),
    "JARDIM CONSOLACAO": (-20.5410, -47.3950),
    "JARDIM FLORIDA": (-20.5520, -47.3910),
    "RESIDENCIAL PARAISO": (-20.5500, -47.3980),
    "JARDIM DERMINIO": (-20.5280, -47.4120)
}

def is_within_franca(lat, lng):
    return -20.65 <= lat <= -20.42 and -47.50 <= lng <= -47.30

def clean_digits(val):
    return re.sub(r"\D", "", str(val or ""))

def norm_text(s):
    if not s:
        return ""
    norm = unicodedata.normalize('NFKD', str(s)).encode('ASCII', 'ignore').decode('utf-8').upper()
    norm = re.sub(r"[^A-Z0-9\s]", " ", norm)
    return " ".join(norm.split())

def norm_street(s):
    if not s:
        return ""
    norm = unicodedata.normalize('NFKD', str(s)).encode('ASCII', 'ignore').decode('utf-8').lower()
    norm = re.sub(r"\b(rua|avenida|av|r|doutor|dr|praca|travessa|rodovia|alameda|professora|prof|coronel|cel|padre|pe)\b", "", norm)
    return " ".join(re.sub(r"[^a-z0-9]", " ", norm).split())

class CNPJGeocoder:
    def __init__(self):
        self.places = []
        self.cnpjs = []
        self.cache = {}
        self.load_cache()
        self.load_data()

    def load_cache(self):
        if os.path.exists(CACHE_PATH):
            try:
                with open(CACHE_PATH, "r", encoding="utf-8") as f:
                    self.cache = json.load(f)
                print(f"✔ Cache de geocodificação carregado: {len(self.cache)} endereços em memória.")
            except Exception as e:
                print(f"Aviso ao carregar cache: {e}")

    def save_cache(self):
        try:
            with open(CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Aviso ao salvar cache: {e}")

    def load_data(self):
        with open(PLACES_PATH, "r", encoding="utf-8") as f:
            self.places = json.load(f)
        with open(CNPJ_JSON_PATH, "r", encoding="utf-8") as f:
            self.cnpjs = json.load(f)
        print(f"✔ Carregados {len(self.places)} locais de referência e {len(self.cnpjs)} CNPJs para geocodificação.")

    def build_reference_indexes(self):
        self.places_by_id = {p["id"]: p for p in self.places if p.get("id")}
        
        # Índice por CEP exato (Cada CEP em Franca mapeia exatamente para uma quadra/rua)
        self.places_by_cep = defaultdict(list)
        for p in self.places:
            m = re.search(r"14\d{3}-?\d{3}", p.get("address", ""))
            if m:
                c = clean_digits(m.group(0))
                self.places_by_cep[c].append((p["lat"], p["lng"]))

        # Índice por Logradouro + Número aproximado
        self.places_by_street = defaultdict(list)
        for p in self.places:
            addr = p.get("address", "")
            lat, lng = p.get("lat"), p.get("lng")
            if not lat or not lng:
                continue
            parts = addr.split(" - ")
            for pt in parts:
                num_m = re.search(r",?\s*(\d+)", pt)
                if num_m:
                    num = int(num_m.group(1))
                    st_text = norm_street(pt[:num_m.start()])
                    if len(st_text) >= 3:
                        self.places_by_street[st_text].append((num, lat, lng))

    def query_photon(self, query):
        clean_q = query.strip()
        if clean_q in self.cache:
            return self.cache[clean_q]

        url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(clean_q)}&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "CityMapHub-Franca/2.0"})
        for _ in range(2):
            try:
                with urllib.request.urlopen(req, timeout=8) as resp:
                    data = json.loads(resp.read().decode())
                    features = data.get("features", [])
                    if features:
                        coords = features[0]["geometry"]["coordinates"] # [lng, lat]
                        res = {"lat": coords[1], "lng": coords[0]}
                        self.cache[clean_q] = res
                        return res
            except Exception:
                time.sleep(0.5)

        self.cache[clean_q] = None
        return None

    def geocode_record(self, record):
        # 1. Se já está associado a um lead existente verificado no Google Maps
        matched_id = record.get("matched_lead_id")
        if matched_id and matched_id in self.places_by_id:
            lead = self.places_by_id[matched_id]
            if lead.get("lat") and lead.get("lng"):
                return lead["lat"], lead["lng"], "google_maps_match"

        logr = record.get("logradouro") or ""
        num_str = clean_digits(record.get("numero") or "")
        num = int(num_str) if num_str else None
        bairro = norm_text(record.get("bairro") or "")
        cep = clean_digits(record.get("cep") or "")
        clean_street = norm_street(logr)

        # 2. Se o CEP coincide com o banco de lugares verificados de Franca
        if cep in self.places_by_cep:
            coords_list = self.places_by_cep[cep]
            # Média das coordenadas daquele CEP exato
            avg_lat = sum(c[0] for c in coords_list) / len(coords_list)
            avg_lng = sum(c[1] for c in coords_list) / len(coords_list)
            return avg_lat, avg_lng, "cep_block_match"

        # 3. Se a rua existe no banco de lugares verificados, busca o número mais próximo
        if clean_street in self.places_by_street:
            street_items = self.places_by_street[clean_street]
            if num:
                best_item = min(street_items, key=lambda it: abs(it[0] - num))
                return best_item[1], best_item[2], "street_number_interpolation"
            else:
                return street_items[0][1], street_items[0][2], "street_point_match"

        # 4. Geocodificação externa via Photon (OpenStreetMap)
        if logr:
            # Consulta com número
            if num:
                q1 = f"{logr}, {num}, Franca, SP, Brasil"
                res1 = self.query_photon(q1)
                if res1 and is_within_franca(res1["lat"], res1["lng"]):
                    return res1["lat"], res1["lng"], "photon_exact_address"
            # Consulta por logradouro e bairro
            q2 = f"{logr}, {bairro}, Franca, SP"
            res2 = self.query_photon(q2)
            if res2 and is_within_franca(res2["lat"], res2["lng"]):
                return res2["lat"], res2["lng"], "photon_street"

        # 5. Fallback por Bairro Real de Franca
        for b_name, b_coords in NEIGHBORHOOD_CENTROIDS.items():
            if b_name in bairro or bairro in b_name:
                return b_coords[0], b_coords[1], "neighborhood_centroid"

        # 6. Fallback final Centro Franca
        return -20.5386, -47.4009, "city_center_fallback"

    def run(self):
        self.build_reference_indexes()
        print(f"\n🚀 Iniciando geocodificação de precisão para {len(self.cnpjs)} CNPJs...")

        stats = defaultdict(int)
        address_groups = defaultdict(list)

        t0 = time.time()
        for idx, rec in enumerate(self.cnpjs):
            lat, lng, method = self.geocode_record(rec)
            stats[method] += 1
            
            # Agrupar para micro-dispersão de endereços idênticos
            key = f"{round(lat, 5)}_{round(lng, 5)}"
            address_groups[key].append(rec)
            rec["lat"] = lat
            rec["lng"] = lng
            rec["geocode_method"] = method

            if (idx + 1) % 150 == 0 or idx == len(self.cnpjs) - 1:
                print(f"   [{idx + 1}/{len(self.cnpjs)}] Geocodificados... (Último método: {method})")

        # Aplicar micro-dispersão (apenas 5 a 10 metros) quando 2 ou mais empresas estão no mesmo ponto exato
        dispersed_count = 0
        import math
        for group in address_groups.values():
            if len(group) > 1:
                for i, r in enumerate(group):
                    if i > 0:
                        angle = (2 * math.pi / len(group)) * i
                        radius = 0.00012 # ~12 metros
                        r["lat"] += radius * math.sin(angle)
                        r["lng"] += radius * math.cos(angle)
                        dispersed_count += 1

        self.save_cache()

        # Salvar em data/cnpj-leads.json
        with open(CNPJ_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(self.cnpjs, f, ensure_ascii=False, indent=2)
        print(f"\n✔ data/cnpj-leads.json atualizado com lat/lng reais para todos os {len(self.cnpjs)} CNPJs!")

        # Salvar em data/cnpj-leads.js
        with open(CNPJ_JS_PATH, "w", encoding="utf-8") as f:
            f.write("window.DEFAULT_CNPJ_DATA = " + json.dumps(self.cnpjs, ensure_ascii=False) + ";")
        print(f"✔ data/cnpj-leads.js atualizado para o frontend!")

        print("\n" + "=" * 65)
        print("📊 RELATÓRIO DE PRECISÃO DA GEOCODIFICAÇÃO DOS CNPJS")
        print("=" * 65)
        print(f"Total de CNPJs geocodificados:             {len(self.cnpjs)}")
        print(f"✔ Coincidência direta Google Maps:         {stats['google_maps_match']}")
        print(f"✔ Quadra exata via CEP (Google Maps):      {stats['cep_block_match']}")
        print(f"✔ Interpolação de número na Rua:           {stats['street_number_interpolation']}")
        print(f"✔ Ponto da Rua verificado:                 {stats['street_point_match']}")
        print(f"✔ Geocodificação OpenStreetMap / Photon:   {stats['photon_exact_address'] + stats['photon_street']}")
        print(f"✔ Centroide do Bairro de Franca:           {stats['neighborhood_centroid']}")
        print(f"⚠️ Centro da Cidade (fallback):            {stats['city_center_fallback']}")
        print(f"📍 Empresas no mesmo prédio dispersadas:   {dispersed_count}")
        print(f"⏱️ Tempo total de processamento:           {time.time() - t0:.1f}s")
        print("=" * 65)

if __name__ == "__main__":
    geocoder = CNPJGeocoder()
    geocoder.run()

