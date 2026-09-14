/**
 * Enriquecedor Contínuo de CNPJs de Franca-SP
 * 
 * Consulta em tempo real dados cadastrais completos (CNAE, Endereço, Bairro, Telefones)
 * usando rotação inteligente e resiliente de APIs com controle de taxa:
 * - CNPJa Open API
 * - CNPJ.ws Pública
 * - ReceitaWS
 * - MinhaReceita
 * 
 * Atualiza automaticamente o cache, o default-places.json e a planilha Excel.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cache-cnpjs-detalhados.json');
const PLACES_JSON = path.join(__dirname, '..', 'data', 'default-places.json');
const PLACES_JS = path.join(__dirname, '..', 'data', 'default-places.js');
const EXCEL_FILE = path.join(__dirname, '..', 'data', 'novos-cnpjs-franca-agosto-setembro-2026.xlsx');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...headers
      },
      timeout: 12000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve({ status: 200, data: JSON.parse(data) });
          } else {
            resolve({ status: res.statusCode, data: null });
          }
        } catch (e) {
          resolve({ status: res.statusCode, data: null });
        }
      });
    }).on('error', () => resolve({ status: 500, data: null }))
      .on('timeout', () => resolve({ status: 408, data: null }));
  });
}

// 1. Provedor CNPJa
async function fetchCnpja(cnpj) {
  const res = await httpGetJson('https://open.cnpja.com/office/' + cnpj);
  if (res.status === 200 && res.data && res.data.address) {
    const d = res.data;
    const phoneObj = (d.phones && d.phones[0]) ? d.phones[0] : null;
    const phoneObj2 = (d.phones && d.phones[1]) ? d.phones[1] : null;

    return {
      cnae_fiscal: d.mainActivity ? String(d.mainActivity.id) : '',
      cnae_fiscal_descricao: d.mainActivity ? d.mainActivity.text : '',
      logradouro: d.address.street || '',
      numero: d.address.number || '',
      bairro: d.address.district || '',
      cep: d.address.zip ? String(d.address.zip).replace(/\D/g, '') : '',
      municipio: d.address.city || 'FRANCA',
      uf: d.address.state || 'SP',
      ddd_telefone_1: phoneObj ? `${phoneObj.area || ''}${phoneObj.number || ''}` : '',
      ddd_telefone_2: phoneObj2 ? `${phoneObj2.area || ''}${phoneObj2.number || ''}` : '',
      nome_fantasia: d.alias && d.alias !== '.' ? d.alias : '',
      razao_social: d.company?.name || '',
      porte: d.company?.size?.text || 'Micro Empresa'
    };
  }
  return null;
}

// 2. Provedor CNPJ.ws
async function fetchCnpjWs(cnpj) {
  const res = await httpGetJson('https://publica.cnpj.ws/cnpj/' + cnpj);
  if (res.status === 200 && res.data && res.data.estabelecimento) {
    const est = res.data.estabelecimento;
    const act = est.atividade_principal || {};
    return {
      cnae_fiscal: act.id ? String(act.id) : '',
      cnae_fiscal_descricao: act.descricao || '',
      logradouro: est.logradouro || '',
      numero: est.numero || '',
      bairro: est.bairro || '',
      cep: est.cep ? String(est.cep).replace(/\D/g, '') : '',
      municipio: est.cidade?.nome || 'FRANCA',
      uf: est.estado?.sigla || 'SP',
      ddd_telefone_1: est.telefone1 ? `${est.ddd1 || ''}${est.telefone1}` : '',
      ddd_telefone_2: est.telefone2 ? `${est.ddd2 || ''}${est.telefone2}` : '',
      nome_fantasia: est.nome_fantasia || '',
      razao_social: res.data.razao_social || '',
      porte: res.data.porte?.descricao || 'Micro Empresa'
    };
  }
  return null;
}

// 3. Provedor ReceitaWS
async function fetchReceitaWs(cnpj) {
  const res = await httpGetJson('https://receitaws.com.br/v1/cnpj/' + cnpj);
  if (res.status === 200 && res.data && res.data.status === 'OK') {
    const d = res.data;
    const act = (d.atividade_principal && d.atividade_principal[0]) || {};
    const telParts = (d.telefone || '').split('/').map(t => t.trim().replace(/\D/g, ''));
    return {
      cnae_fiscal: act.code ? String(act.code).replace(/\D/g, '') : '',
      cnae_fiscal_descricao: act.text || '',
      logradouro: d.logradouro || '',
      numero: d.numero || '',
      bairro: d.bairro || '',
      cep: d.cep ? String(d.cep).replace(/\D/g, '') : '',
      municipio: d.municipio || 'FRANCA',
      uf: d.uf || 'SP',
      ddd_telefone_1: telParts[0] || '',
      ddd_telefone_2: telParts[1] || '',
      nome_fantasia: d.fantasia || '',
      razao_social: d.nome || '',
      porte: d.porte || 'Micro Empresa'
    };
  }
  return null;
}

function classifySegment(cnaeCode, cnaeDesc, razaoSocial, nomeFantasia) {
  const code = String(cnaeCode || '');
  const text = `${cnaeDesc || ''} ${razaoSocial || ''} ${nomeFantasia || ''}`.toLowerCase();

  // 1. Adega / Bebidas
  if (code.startsWith('4723') || /adega|bebida|chopp|cerveja|distribuidora de bebida|destilado|vinho/.test(text)) {
    return { commercialSegment: 'adega', category: 'alimentacao', subCategory: 'Adega / Bebidas', isHighTurnover: true };
  }
  // 2. Bar / Pub / Boteco
  if (code.startsWith('5611204') || code.startsWith('5611205') || /bar|boteco|pub|lounge|petiscaria|choperia|tabacaria|hookah/.test(text)) {
    return { commercialSegment: 'bar', category: 'alimentacao', subCategory: 'Bar / Choperia', isHighTurnover: true };
  }
  // 3. Restaurante / Lanchonete / Marmita / Lanches
  if (code.startsWith('5611') || code.startsWith('5620') || /restaurante|lanchonete|marmita|pizzaria|hamburguer|pastel|rotisseria|sorveteria|doceria|acai|açaí|gastronomia|comida|espeto|churrasco/.test(text)) {
    return { commercialSegment: 'restaurante', category: 'alimentacao', subCategory: 'Restaurante / Lanchonete', isHighTurnover: true };
  }
  // 4. Padaria / Confeitaria
  if (code.startsWith('1091') || code.startsWith('4721') || /padaria|panificadora|confeitaria|bolos|pães|paes/.test(text)) {
    return { commercialSegment: 'padaria', category: 'alimentacao', subCategory: 'Padaria / Confeitaria', isHighTurnover: true };
  }
  // 5. Mercado de Bairro / Hortifrúti / Açougue
  if (code.startsWith('4712') || code.startsWith('4724') || code.startsWith('4722') || code.startsWith('4729') ||
      /mercado|minimercado|mercearia|hortifruti|hortifrúti|sacolao|sacolão|acougue|açougue|peixaria|quitanda|armazem|armazém/.test(text)) {
    return { commercialSegment: 'mercado_bairro', category: 'alimentacao', subCategory: 'Mercado de Bairro / Açougue', isHighTurnover: true };
  }
  // 6. Outros Comércios Varejistas
  if (code.startsWith('47') || /comercio|loja|vestuario|calcado|calcados|moda|roupa|otica|papelaria|bazar|presentes|auto pecas/.test(text)) {
    return { commercialSegment: 'outro', category: 'comercio', subCategory: (cnaeDesc ? cnaeDesc.split('-')[0].trim().slice(0, 30) : 'Comércio Varejista'), isHighTurnover: false };
  }
  // 7. Serviços
  return { commercialSegment: 'outro', category: 'servicos', subCategory: (cnaeDesc ? cnaeDesc.slice(0, 30).trim() : 'Prestação de Serviços'), isHighTurnover: false };
}

function pseudoHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getCoordsForNeighborhood(bairroName, cnpj, neighborhoodMap) {
  const cleanBairro = (bairroName || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let centerLat = -20.53861;
  let centerLng = -47.40083;

  if (cleanBairro) {
    for (const [key, coords] of Object.entries(neighborhoodMap)) {
      if (cleanBairro.includes(key) || key.includes(cleanBairro)) {
        centerLat = coords.lat;
        centerLng = coords.lng;
        break;
      }
    }
  }

  const hashVal = pseudoHash(cnpj || 'franca');
  const latOffset = (((hashVal % 1000) / 1000) - 0.5) * 0.0035;
  const lngOffset = ((((hashVal >> 3) % 1000) / 1000) - 0.5) * 0.0035;

  return {
    lat: Number((centerLat + latOffset).toFixed(7)),
    lng: Number((centerLng + lngOffset).toFixed(7))
  };
}

function formatPhone(phone) {
  if (!phone) return '';
  const raw = String(phone).replace(/\D/g, '');
  if (raw.length === 11) return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
  if (raw.length === 10) return `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
  return raw;
}

function formatCNPJ(cnpj) {
  if (!cnpj || cnpj.length !== 14) return cnpj || '';
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

async function syncDatabases(allDetailed, neighborhoodMap) {
  // 1. Atualizar cache JSON
  fs.writeFileSync(CACHE_FILE, JSON.stringify(allDetailed, null, 2));

  // 2. Atualizar default-places.json
  const existingPlaces = JSON.parse(fs.readFileSync(PLACES_JSON, 'utf8'));
  const placesMap = new Map();
  existingPlaces.forEach(p => placesMap.set(p.id, p));

  allDetailed.forEach(c => {
    const cnaeCode = c.cnae_fiscal || '';
    const cnaeDesc = c.cnae_fiscal_descricao || '';
    const classification = classifySegment(cnaeCode, cnaeDesc, c.razao_social, c.nome_fantasia);
    const street = [c.logradouro, c.numero].filter(Boolean).join(', ');
    const fullAddress = [street, c.bairro, 'Franca - SP', c.cep].filter(Boolean).join(' - ');
    const coords = getCoordsForNeighborhood(c.bairro, c.cnpj, neighborhoodMap);
    const tel1 = formatPhone(c.ddd_telefone_1);
    const telDigits = (c.ddd_telefone_1 || c.ddd_telefone_2 || '').replace(/\D/g, '');
    const displayName = c.nome_fantasia && c.nome_fantasia.length > 2 ? c.nome_fantasia : c.razao_social;
    const aberturaBR = formatDateBR(c.data_abertura || c.data_inicio_atividade);

    const placeObj = {
      id: `cnpj-${c.cnpj}`,
      name: displayName,
      category: classification.category,
      subCategory: classification.subCategory,
      address: fullAddress || 'Franca - SP',
      lat: coords.lat,
      lng: coords.lng,
      phone: tel1 || '',
      whatsapp: telDigits.length >= 10 ? `55${telDigits}` : '',
      hours: `Recém Aberto (${aberturaBR})`,
      rating: '5.0',
      photo: '',
      description: `CNPJ: ${formatCNPJ(c.cnpj)} • Aberto em ${aberturaBR} • CNAE: ${cnaeCode} - ${cnaeDesc}`,
      cardMachine: '',
      visited: false,
      crmNotes: `Empresa recém aberta em Franca (${aberturaBR}). Ramo: ${cnaeDesc || classification.subCategory}`,
      tags: ['Novo CNPJ', 'Franca', c.bairro || 'Geral', classification.subCategory],
      commercialSegment: classification.commercialSegment,
      isHighTurnover: classification.isHighTurnover,
      isChain: false,
      crmStatus: 'lead',
      cnpj: formatCNPJ(c.cnpj),
      cnae: `${cnaeCode} - ${cnaeDesc}`,
      dataAbertura: aberturaBR
    };

    placesMap.set(placeObj.id, placeObj);
  });

  const merged = Array.from(placesMap.values());
  fs.writeFileSync(PLACES_JSON, JSON.stringify(merged, null, 2));
  fs.writeFileSync(PLACES_JS, 'window.DEFAULT_PLACES_DATA = ' + JSON.stringify(merged) + ';');

  // 3. Atualizar Planilha Excel
  const excelRows = allDetailed.map((c, idx) => {
    const cnaeCode = c.cnae_fiscal || '';
    const cnaeDesc = c.cnae_fiscal_descricao || '';
    const classification = classifySegment(cnaeCode, cnaeDesc, c.razao_social, c.nome_fantasia);
    const street = [c.logradouro, c.numero].filter(Boolean).join(', ');
    const slugName = (c.razao_social || 'empresa').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    return {
      '#': idx + 1,
      'CNPJ': formatCNPJ(c.cnpj),
      'Razão Social': c.razao_social || '',
      'Nome Fantasia': c.nome_fantasia || '(Sem Nome Fantasia)',
      'Segmento': classification.subCategory,
      'Giro Rápido?': classification.isHighTurnover ? 'SIM ⚡' : 'Não',
      'CNAE Principal': cnaeCode,
      'Descrição CNAE': cnaeDesc,
      'Telefone 1': formatPhone(c.ddd_telefone_1),
      'Telefone 2': formatPhone(c.ddd_telefone_2),
      'Endereço': street || '(Não informado)',
      'Bairro': c.bairro || '',
      'CEP': c.cep || '',
      'Data de Abertura': formatDateBR(c.data_abertura || c.data_inicio_atividade),
      'Situação': c.situacao_cadastral ? (c.situacao_cadastral.situacao_atual || 'ATIVA') : 'ATIVA',
      'Tipo / Porte': c.porte || c.tipo || 'ME / EPP',
      'Ficha (Casa dos Dados)': `https://casadosdados.com.br/solucao/cnpj/${slugName}-${c.cnpj}`
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Novos CNPJs Enriquecidos');
  XLSX.writeFile(wb, EXCEL_FILE);
}

async function main() {
  console.log('========================================================');
  console.log('⚡ ENRIQUECEDOR EM TEMPO REAL DE CNPJs (FRANCA-SP)');
  console.log('========================================================\n');

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const pending = cache.filter(c => !c.cnae_fiscal && !c.cnae_fiscal_principal);

  console.log(`Total de CNPJs no cache: ${cache.length}`);
  console.log(`Já enriquecidos com CNAE: ${cache.length - pending.length}`);
  console.log(`Pendentes de enriquecimento: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log('🎉 Todos os CNPJs já estão 100% enriquecidos!');
    return;
  }

  // Mapear bairros para coordenadas
  const defaultPlaces = JSON.parse(fs.readFileSync(PLACES_JSON, 'utf8'));
  const neighborhoodMap = {};
  defaultPlaces.forEach(p => {
    const match = p.address?.match(/-\s*([^,]+),\s*Franca/i);
    const b = match ? match[1].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null;
    if (b && p.lat && p.lng) {
      if (!neighborhoodMap[b]) neighborhoodMap[b] = { lats: [], lngs: [] };
      neighborhoodMap[b].lats.push(p.lat);
      neighborhoodMap[b].lngs.push(p.lng);
    }
  });
  const resolvedNeighborhoodMap = {};
  for (const [k, v] of Object.entries(neighborhoodMap)) {
    resolvedNeighborhoodMap[k] = {
      lat: v.lats.reduce((a, b) => a + b, 0) / v.lats.length,
      lng: v.lngs.reduce((a, b) => a + b, 0) / v.lngs.length
    };
  }

  let enrichedCount = 0;
  let lastSyncCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const cnpj = item.cnpj;
    let data = null;

    // Tentativa 1: CNPJa (Mais atualizado para empresas de agosto/setembro)
    data = await fetchCnpja(cnpj);
    if (!data) {
      await delay(1000);
      // Tentativa 2: CNPJ.ws
      data = await fetchCnpjWs(cnpj);
    }
    if (!data) {
      await delay(1000);
      // Tentativa 3: ReceitaWS
      data = await fetchReceitaWs(cnpj);
    }

    if (data && data.cnae_fiscal) {
      Object.assign(item, data, { enriched: true });
      enrichedCount++;
      const bairroStr = item.bairro ? `(${item.bairro})` : '';
      console.log(`[${i + 1}/${pending.length}] ✅ ${formatCNPJ(cnpj)}: ${item.cnae_fiscal} - ${item.cnae_fiscal_descricao} ${bairroStr}`);
    } else {
      console.log(`[${i + 1}/${pending.length}] ⏳ ${formatCNPJ(cnpj)}: Aguardando sincronização de espelho`);
    }

    // Sincronizar banco e arquivos a cada 10 registros enriquecidos
    if (enrichedCount > 0 && enrichedCount - lastSyncCount >= 10) {
      await syncDatabases(cache, resolvedNeighborhoodMap);
      lastSyncCount = enrichedCount;
      console.log(`💾 Base de dados sincronizada! (+${enrichedCount} CNPJs atualizados no mapa)\n`);
    }

    // Cadência controlada de ~5.5 segundos para respeitar o limite gratuito das APIs
    await delay(5500);
  }

  // Sincronização final
  await syncDatabases(cache, resolvedNeighborhoodMap);
  console.log(`\n🎉 Processo finalizado com sucesso! Total enriquecido nesta sessão: ${enrichedCount}`);
}

main().catch(console.error);
