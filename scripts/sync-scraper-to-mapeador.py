#!/usr/bin/env python3
"""
Sincronizador Inteligente Google Maps Scraper Kit -> Mapeador Urbano & Supabase
Converte resultados (.csv ou .json) do scraper, classifica perfis comerciais para
maquininhas de cartão (Parcelados Alto Ticket vs. Giro Rápido Volume),
aplica DEDUPLICAÇÃO RIGOROSA para evitar qualquer lead duplicado e
sincroniza com default-places.json / default-places.js e o Supabase.
"""

import sys
import os
import json
import csv
import re
import math
import unicodedata

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DEFAULT_JSON = os.path.join(DATA_DIR, "default-places.json")
DEFAULT_JS = os.path.join(DATA_DIR, "default-places.js")

# Redes nacionais ou franquias gigantes para flag isChain
CHAIN_REGEX = re.compile(
    r'savegnago|tonin|atacad[aã]o|carrefour|p[aã]o de a[cç][uú]car|assai|assaí|dia%|tenda|ti[aã]ozinho|'
    r'big compra|serv[\s-]?bem|irm[aã]os patroc[ií]nio|sebasti[aã]o lopes|supermercado lider|mcdonald|'
    r'burger king|subway|habib|chilli beans|cacau show|c&a|renner|riachuelo|ortobom|drogasil|droga raia|'
    r'pague menos|drogão|ultrafarma|magalu|magazine luiza|casas bahia|ponto frio|leroy merlin',
    re.IGNORECASE
)

def normalize_text(text):
    if not text:
        return ""
    text = unicodedata.normalize('NFKD', str(text)).encode('ASCII', 'ignore').decode('utf-8')
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    # Remove termos genéricos de razão social
    text = re.sub(r'\b(ltda|me|epp|eireli|sa|s\/a|cia|meu|franca|sp)\b', '', text)
    return " ".join(text.split())

def calculate_distance_meters(lat1, lon1, lat2, lon2):
    R = 6371000  # Raio da Terra em metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def detect_commercial_segment(name, raw_cat, desc=''):
    full = f"{name} {raw_cat} {desc}".lower()
    is_chain = bool(CHAIN_REGEX.search(name or ''))
    
    # 0. ESTÉTICA AUTOMOTIVA & LAVA JATO (Prioritário sobre estética humana)
    if re.search(r'automotiv|veicular|lava[\s-]?jato|lava[\s-]?r[aá]pido|est[eé]tica automotiva|polimento|detalhamento automotivo', full):
        seg = 'lava_jato'

    # 1. PARCELADO DE ALTO VALOR AGREGADO (TICKET ALTO / MDR / ANTECIPAÇÃO)
    elif re.search(r'odonto|dentist|implante|ortodont|clareamento|protese dent', full):
        seg = 'odonto_estetica'
    elif re.search(r'est[eé]tica|harmoniza[cç][aã]o|botox|depila[cç][aã]o a laser|laser|cirurgia pl[aá]stica|dermatolog', full):
        seg = 'odonto_estetica'
    elif re.search(r'[oó]tica|[oó]culos|lente de contato|relojoaria|joalheria|joia|semijoia|alian[cç]a', full):
        seg = 'otica_joia'
    elif re.search(r'roupa|moda|boutique|confec[cç][aã]o|vestu[aá]rio|cal[cç]ado|sapato|tenis|lingerie|alfaiataria', full):
        seg = 'moda_calcados'
    elif re.search(r'm[oó]veis|planejado|colch[aã]o|colch[oõ]es|decora[cç][aã]o|marcenaria', full):
        seg = 'moveis_construcao'
    elif re.search(r'material para constru[cç][aã]o|tinta|ilumina[cç][aã]o|pisos|revestimento|hidr[aá]ulica|el[eé]trica', full):
        seg = 'moveis_construcao'
    elif re.search(r'oficina mec[aâ]nica|auto[\s-]?center|pneu|alinhamento|balanceamento|troca de [oó]leo|auto[\s-]?pe[cç]as|moto[\s-]?pe[cç]as|funilaria|freios', full):
        seg = 'auto_center'
    elif re.search(r'celular|smartphone|iphone|assist[eê]ncia t[eé]cnica|computador|inform[aá]tica|notebook', full):
        seg = 'celulares_tech'

    # 2. GIRO RÁPIDO & ALTO VOLUME DIÁRIO DE CARTÕES (DÉBITO / CRÉDITO À VISTA)
    elif re.search(r'a[cç]ougue|casa de carnes|boutique de carnes|carnes|frigor[ií]fico', full):
        seg = 'acougue_carnes'
    elif re.search(r'hortifruti|sacol[aã]o|varej[aã]o|frutas|verduras|legumes', full):
        seg = 'hortifruti_sacolao'
    elif re.search(r'veterin[aá]ri|hospital veterin[aá]ri|pet[\s-]?shop|casa de ra[cç][aã]o|banho e tosa', full):
        seg = 'pet_vet'
    elif re.search(r'sal[aã]o de beleza|cabeleireir|barbearia|barber|manicure|pedicure|sobrancelha|cabelo|studio de beleza', full):
        seg = 'beleza_estetica'
    elif re.search(r'farm[aá]cia|drogaria|manipula[cç][aã]o', full) and not is_chain:
        seg = 'farmacia_saude'
    elif re.search(r'lava[\s-]?jato|lava[\s-]?r[aá]pido|est[eé]tica automotiva|polimento', full):
        seg = 'lava_jato'

    # 3. ALIMENTAÇÃO & BEBIDAS (EXISTENTES)
    elif re.search(r'adega|bebida|distribuidora de bebida|dep[oó]sito de bebida', full):
        seg = 'adega'
    elif re.search(r'bar|boteco|pub|choperia|chopp|cervej|espet', full):
        seg = 'bar'
    elif re.search(r'padaria|panific|confeitaria|bolo|caf[eé]|p[aã]o', full):
        seg = 'padaria'
    elif re.search(r'supermercado|mini[\s-]?mercado|mercearia|emp[oó]rio|armaz[eé]m', full):
        seg = 'mercado_bairro'
    elif re.search(r'restaurante|pizz|lanche|lanchonete|hamburg|churrasc|pastel|comida|marmita|gastronomia|sushi|japones|a[cç]a[ií]|sorvete|rotisseria', full):
        seg = 'restaurante'
    else:
        seg = 'outro'

    # Classificação comercial para maquininhas
    is_high_ticket = seg in ('odonto_estetica', 'otica_joia', 'moda_calcados', 'auto_center', 'celulares_tech', 'moveis_construcao')
    is_high_turnover = seg in ('acougue_carnes', 'hortifruti_sacolao', 'pet_vet', 'beleza_estetica', 'farmacia_saude', 'lava_jato', 'adega', 'bar', 'padaria', 'mercado_bairro', 'restaurante')

    return seg, is_high_ticket, is_high_turnover, is_chain

def detect_category(raw_cat, seg):
    # Categorias do Mapeador Urbano: alimentacao, comercio, saude, servicos, lazer
    if seg in ('restaurante', 'bar', 'adega', 'padaria', 'mercado_bairro', 'acougue_carnes', 'hortifruti_sacolao'):
        return 'alimentacao'
    if seg in ('odonto_estetica', 'farmacia_saude'):
        return 'saude'
    if seg in ('otica_joia', 'moda_calcados', 'celulares_tech', 'moveis_construcao'):
        return 'comercio'
    if seg in ('auto_center', 'beleza_estetica', 'lava_jato'):
        return 'servicos'
    if seg == 'pet_vet':
        return 'saude' if 'veterin' in str(raw_cat).lower() else 'comercio'
    
    # Fallback por texto
    c = (raw_cat or '').lower()
    if re.search(r'restaurante|bar|adega|lanchonete|café|cafe|hamburg|pizz|padaria|comida|açougue|sorvete', c):
        return 'alimentacao'
    elif re.search(r'hospital|clínica|clinica|médic|saúde|dentista|laborat|farmacia|odonto', c):
        return 'saude'
    elif re.search(r'parque|praça|cinema|teatro|hotel|pousada|clube|turism|academia|fitness', c):
        return 'lazer'
    elif re.search(r'oficina|salão|estética|barbearia|lava jato|conserto|reparo', c):
        return 'servicos'
    return 'comercio'

def clean_whatsapp(phone):
    if not phone:
        return ''
    digits = re.sub(r'\D', '', str(phone))
    if len(digits) >= 10:
        return digits if digits.startswith('55') else '55' + digits
    return ''

def clean_phone_digits(phone):
    if not phone:
        return ''
    digits = re.sub(r'\D', '', str(phone))
    # Remove prefixo 55 se houver para comparar
    if digits.startswith('55') and len(digits) > 10:
        digits = digits[2:]
    return digits

def convert_row_to_place(row, idx):
    try:
        lat = float(row.get('latitude') or row.get('lat') or 0)
        lng = float(row.get('longitude') or row.get('lng') or row.get('lon') or 0)
    except (ValueError, TypeError):
        return None

    if lat == 0 or lng == 0:
        return None

    name = row.get('title') or row.get('name') or f"Local #{idx+1}"
    raw_cat = row.get('category') or row.get('categoryName') or 'Geral'
    
    address = row.get('address') or 'Endereço não informado'
    phone = row.get('phone') or ''
    whatsapp = clean_whatsapp(phone)
    
    rating = row.get('review_rating') or row.get('rating') or row.get('totalScore') or '5.0'
    try:
        rating = f"{float(rating):.1f}"
    except (ValueError, TypeError):
        rating = '5.0'
        
    reviews = row.get('review_count') or row.get('reviewsCount') or ''
    website = row.get('website') or ''
    emails = row.get('emails') or row.get('email') or ''
    insta = row.get('instagram') or ''
    photo = row.get('thumbnail') or row.get('imageUrl') or ''

    desc_parts = [raw_cat]
    if reviews:
        desc_parts.append(f"{reviews} avaliações")
    if website:
        desc_parts.append(f"Website: {website}")
    if emails:
        desc_parts.append(f"Email: {emails}")
    if insta:
        desc_parts.append(f"Instagram: {insta}")

    description = " • ".join(desc_parts)

    seg, is_high_ticket, is_high_turnover, is_chain = detect_commercial_segment(name, raw_cat, description)
    cat = detect_category(raw_cat, seg)

    tags = [raw_cat]
    if is_high_ticket:
        tags.extend(['Parcelado Alto Valor', 'Ticket Médio Elevado'])
    elif is_high_turnover:
        tags.extend(['Giro Rápido', 'Alto Volume de Cartões'])

    if emails:
        tags.append('Com Email')
    if insta:
        tags.append('Com Instagram')
    if whatsapp:
        tags.append('Com WhatsApp')

    place_id = row.get('place_id') or row.get('id') or f"{int(lat*10000)}_{int(lng*10000)}"

    crm_notes = ""
    if is_high_ticket:
        crm_notes += "[PERFIL COMERCIAL: PARCELADO DE ALTO VALOR / TAXAS & ANTECIPAÇÃO]\n"
    elif is_high_turnover:
        crm_notes += "[PERFIL COMERCIAL: GIRO RÁPIDO / ALTO VOLUME DÉBITO & CRÉDITO]\n"
    if emails:
        crm_notes += f"Email: {emails}\n"
    if website:
        crm_notes += f"Website: {website}\n"
    if insta:
        crm_notes += f"Instagram: {insta}\n"

    return {
        "id": f"gmap-{place_id}",
        "raw_place_id": place_id,
        "name": str(name).strip(),
        "category": cat,
        "subCategory": raw_cat,
        "address": str(address).strip(),
        "lat": lat,
        "lng": lng,
        "phone": str(phone).strip(),
        "whatsapp": whatsapp,
        "hours": row.get('hours') or '',
        "rating": rating,
        "photo": photo,
        "description": description,
        "cardMachine": "",
        "visited": False,
        "crmNotes": crm_notes.strip(),
        "tags": list(dict.fromkeys(tags)),  # tags únicas
        "commercialSegment": seg,
        "isHighTurnover": is_high_turnover or is_high_ticket,
        "isHighTicket": is_high_ticket,
        "isChain": is_chain,
        "crmStatus": "lead"
    }

def find_duplicate_index(new_place, existing_places, id_map, phone_map, coords_spatial_index):
    """
    Verificação multicritério para garantir ZERO duplicações:
    1. Mesma ID ou raw_place_id
    2. Mesmo telefone válido (mínimo 10 dígitos)
    3. Mesmo nome normalizado E proximidade geográfica (< 60 metros)
    """
    # 1. ID direto
    if new_place["id"] in id_map:
        return id_map[new_place["id"]]
    
    raw_pid = new_place.get("raw_place_id")
    if raw_pid and f"gmap-{raw_pid}" in id_map:
        return id_map[f"gmap-{raw_pid}"]

    # 2. Telefone / WhatsApp direto
    new_phone = clean_phone_digits(new_place.get("phone"))
    if new_phone and len(new_phone) >= 10:
        if new_phone in phone_map:
            return phone_map[new_phone]

    # 3. Nome similar + distância física < 60 metros
    norm_new_name = normalize_text(new_place["name"])
    if norm_new_name and len(norm_new_name) > 3:
        for idx, (lat, lng, norm_name) in enumerate(coords_spatial_index):
            dist = calculate_distance_meters(new_place["lat"], new_place["lng"], lat, lng)
            if dist <= 60:
                if norm_new_name == norm_name or norm_new_name in norm_name or norm_name in norm_new_name:
                    return idx

    return None

def main():
    if len(sys.argv) < 2:
        print("Uso: py sync-scraper-to-mapeador.py <arquivo_resultado.csv|arquivo_resultado.json> [--append]")
        sys.exit(1)

    input_file = sys.argv[1]
    append_mode = "--append" in sys.argv

    if not os.path.exists(input_file):
        print(f"Erro: Arquivo {input_file} não encontrado.")
        sys.exit(1)

    raw_rows = []
    if input_file.endswith(".json"):
        with open(input_file, "r", encoding="utf-8") as f:
            raw_rows = json.load(f)
    else:
        with open(input_file, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            raw_rows = list(reader)

    print(f"Lidos {len(raw_rows)} registros de {input_file}")

    new_places = []
    for i, r in enumerate(raw_rows):
        p = convert_row_to_place(r, i)
        if p:
            new_places.append(p)

    print(f"Convertidos {len(new_places)} locais válidos com geolocalização.")

    existing_places = []
    if append_mode and os.path.exists(DEFAULT_JSON):
        try:
            with open(DEFAULT_JSON, "r", encoding="utf-8") as f:
                existing_places = json.load(f)
        except Exception:
            existing_places = []

    print(f"Base existente possui {len(existing_places)} locais cadastrados.")

    # Constrói índices de busca rápida para deduplicação rigorosa
    id_map = {}
    phone_map = {}
    coords_spatial_index = []

    for idx, ep in enumerate(existing_places):
        id_map[ep["id"]] = idx
        phone = clean_phone_digits(ep.get("phone"))
        if phone and len(phone) >= 10:
            phone_map[phone] = idx
        lat = ep.get("lat") or 0
        lng = ep.get("lng") or 0
        norm_name = normalize_text(ep.get("name", ""))
        coords_spatial_index.append((lat, lng, norm_name))

    final_places = list(existing_places)
    added = 0
    updated = 0
    duplicates_prevented = 0

    for np in new_places:
        dup_idx = find_duplicate_index(np, final_places, id_map, phone_map, coords_spatial_index)
        
        if dup_idx is not None:
            # É uma duplicação: ATUALIZA/ENRIQUECE SEM DUPLICAR
            duplicates_prevented += 1
            current = final_places[dup_idx]
            # Mescla tags sem duplicar
            merged_tags = list(dict.fromkeys(current.get("tags", []) + np.get("tags", [])))
            # Mantém CRM Stage e histórico se já existia interação
            final_places[dup_idx] = {
                **current,
                "whatsapp": np.get("whatsapp") or current.get("whatsapp"),
                "phone": np.get("phone") or current.get("phone"),
                "photo": np.get("photo") or current.get("photo"),
                "tags": merged_tags,
                "isHighTicket": current.get("isHighTicket") or np.get("isHighTicket", False),
                "isHighTurnover": current.get("isHighTurnover") or np.get("isHighTurnover", False)
            }
            updated += 1
        else:
            # NOVO LEAD GENUÍNO
            new_idx = len(final_places)
            final_places.append(np)
            # Atualiza índices
            id_map[np["id"]] = new_idx
            p_clean = clean_phone_digits(np.get("phone"))
            if p_clean and len(p_clean) >= 10:
                phone_map[p_clean] = new_idx
            coords_spatial_index.append((np["lat"], np["lng"], normalize_text(np["name"])))
            added += 1

    print("\n" + "=" * 60)
    print("RELATÓRIO DE SINCRONIZAÇÃO & DEDUPLICAÇÃO:")
    print(f"  • Total antes da sincronização: {len(existing_places)}")
    print(f"  • Novos leads genuínos inseridos: +{added}")
    print(f"  • Duplicidades evitadas & dados enriquecidos: {duplicates_prevented}")
    print(f"  • Total geral na base: {len(final_places)}")
    print("=" * 60)

    # Salva default-places.json
    with open(DEFAULT_JSON, "w", encoding="utf-8") as f:
        json.dump(final_places, f, ensure_ascii=False, indent=2)

    # Salva default-places.js
    with open(DEFAULT_JS, "w", encoding="utf-8") as f:
        f.write("window.DEFAULT_PLACES_DATA = " + json.dumps(final_places, ensure_ascii=False) + ";\n")

    print(f"\n✓ Arquivos locais atualizados com sucesso:")
    print(f"  - {DEFAULT_JSON}")
    print(f"  - {DEFAULT_JS}")

    # Envio direto para o Banco de Dados Supabase
    upload_to_supabase(final_places)

    print("\nPronto! Base de leads 100% atualizada sem duplicatas.")

def upload_to_supabase(places):
    import urllib.request
    url = "https://ubnpeahxlffutiuopafm.supabase.co/rest/v1/leads"
    headers = {
        "apikey": "sb_publishable_G8l2tHVnRTNLJN6UFqigGQ_yAjCLvOi",
        "Authorization": "Bearer sb_publishable_G8l2tHVnRTNLJN6UFqigGQ_yAjCLvOi",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    rows = []
    for p in places:
        rows.append({
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "sub_category": p.get("subCategory", ""),
            "commercial_segment": p.get("commercialSegment", "outro"),
            "is_high_turnover": p.get("isHighTurnover", False),
            "is_chain": p.get("isChain", False),
            "address": p.get("address", ""),
            "lat": p["lat"],
            "lng": p["lng"],
            "phone": p.get("phone", ""),
            "whatsapp": p.get("whatsapp", ""),
            "hours": p.get("hours", ""),
            "rating": str(p.get("rating", "5.0")),
            "photo": p.get("photo", ""),
            "description": p.get("description", ""),
            "card_machine": p.get("cardMachine", ""),
            "crm_stage": p.get("crmStage") or p.get("crmStatus") or "lead",
            "crm_notes": p.get("crmNotes", ""),
            "tags": p.get("tags", []),
            "assigned_to": p.get("assignedTo", None),
            "assigned_supervisor_id": p.get("assignedSupervisorId", None)
        })

    print(f"\n▶ Sincronizando {len(rows)} leads com o Banco de Dados (Supabase)...")
    batch_size = 50
    success = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        data = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status in (200, 201):
                    success += len(chunk)
        except urllib.error.HTTPError as e:
            print(f"  ⚠ Erro no lote {i//batch_size + 1}: {e.code} - {e.read().decode('utf-8', 'ignore')}")
        except Exception as e:
            print(f"  ⚠ Erro no lote {i//batch_size + 1}: {e}")

    print(f"✓ {success}/{len(rows)} leads gravados com sucesso na nuvem do Supabase!")

if __name__ == "__main__":
    main()
