/**
 * Script de Enriquecimento e Integração de Novos CNPJs de Franca-SP
 * 
 * 1. Consulta detalhes oficiais (CNAE, Endereço, Telefones) na base da Receita Federal
 * 2. Georreferencia por bairros e coordenadas de Franca
 * 3. Categoriza em Giro Rápido (Adega, Bar, Restaurante, Padaria, Mercado de Bairro)
 * 4. Atualiza a planilha Excel completa com colunas de CNAE, Endereço e Contato
 * 5. Integra os novos registros ao mapa do Mapeador Urbano (default-places.json)
 * 
 * Execução: node scripts/enriquecer-e-integrar-cnpjs.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CONFIG = {
  inputFile: path.join(__dirname, '..', 'data', 'cache-cnpjs-coletados.json'),
  detailCacheFile: path.join(__dirname, '..', 'data', 'cache-cnpjs-detalhados.json'),
  defaultPlacesFile: path.join(__dirname, '..', 'data', 'default-places.json'),
  outputExcelFile: path.join(__dirname, '..', 'data', 'novos-cnpjs-franca-agosto-setembro-2026.xlsx'),
  concurrency: 3, // Conexões simultâneas controladas
  delayBetweenReqMs: 150
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Requisição com fallback entre MinhaReceita e BrasilAPI
function fetchCNPJDetails(cnpj) {
  return new Promise(async (resolve) => {
    // 1. MinhaReceita
    let data = await makeRequest('https://minhareceita.org/' + cnpj);
    if (data && data.cnpj) {
      return resolve(data);
    }

    // 2. Fallback BrasilAPI se MinhaReceita oscilar
    await delay(300);
    data = await makeRequest('https://brasilapi.com.br/api/cnpj/v1/' + cnpj);
    if (data && data.cnpj) {
      return resolve(data);
    }

    resolve(null);
  });
}

function makeRequest(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
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

function formatPhone(ddd, phone) {
  if (!phone) return '';
  const raw = `${ddd || ''}${phone}`.replace(/\D/g, '');
  if (raw.length === 11) {
    return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
  } else if (raw.length === 10) {
    return `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
  } else if (raw.length >= 8) {
    return `(16) ${raw.slice(0, 4)}-${raw.slice(4)}`;
  }
  return raw;
}

// Classificação de segmento comercial por CNAE e Palavras-chave
function classifySegment(cnaeCode, cnaeDesc, razaoSocial, nomeFantasia) {
  const code = String(cnaeCode || '');
  const text = `${cnaeDesc || ''} ${razaoSocial || ''} ${nomeFantasia || ''}`.toLowerCase();

  // 1. Adega / Distribuidora de Bebidas
  if (code.startsWith('4723') || /adega|bebida|chopp|cerveja|distribuidora de bebida|destilado|vinho/.test(text)) {
    return {
      commercialSegment: 'adega',
      category: 'alimentacao',
      subCategory: 'Adega / Bebidas',
      isHighTurnover: true
    };
  }

  // 2. Bar / Choperia / Boteco / Tabacaria
  if (code.startsWith('5611204') || code.startsWith('5611205') || /bar|boteco|pub|lounge|petiscaria|choperia|tabacaria|hookah/.test(text)) {
    return {
      commercialSegment: 'bar',
      category: 'alimentacao',
      subCategory: 'Bar / Choperia',
      isHighTurnover: true
    };
  }

  // 3. Restaurante / Lanchonete / Marmitaria / Hambúrguer / Pizza
  if (code.startsWith('5611') || code.startsWith('5620') || /restaurante|lanchonete|marmita|pizzaria|hamburguer|pastel|rotisseria|sorveteria|doceria|acai|açaí|gastronomia|comida|espeto|churrasco/.test(text)) {
    return {
      commercialSegment: 'restaurante',
      category: 'alimentacao',
      subCategory: 'Restaurante / Lanchonete',
      isHighTurnover: true
    };
  }

  // 4. Padaria / Confeitaria
  if (code.startsWith('1091') || code.startsWith('4721') || /padaria|panificadora|confeitaria|bolos|pães|paes/.test(text)) {
    return {
      commercialSegment: 'padaria',
      category: 'alimentacao',
      subCategory: 'Padaria / Confeitaria',
      isHighTurnover: true
    };
  }

  // 5. Mercado de Bairro / Mercearia / Hortifrúti / Açougue
  if (code.startsWith('4712') || code.startsWith('4724') || code.startsWith('4722') || code.startsWith('4729') ||
      /mercado|minimercado|mercearia|hortifruti|hortifrúti|sacolao|sacolão|acougue|açougue|peixaria|quitanda|armazem|armazém/.test(text)) {
    return {
      commercialSegment: 'mercado_bairro',
      category: 'alimentacao',
      subCategory: 'Mercado de Bairro / Açougue',
      isHighTurnover: true
    };
  }

  // 6. Outros Comércios Varejistas (Roupas, Calçados, Autopeças, Materiais, Farmácia)
  if (code.startsWith('47')) {
    return {
      commercialSegment: 'outro',
      category: 'comercio',
      subCategory: (cnaeDesc ? cnaeDesc.split('-')[0].trim() : 'Comércio Varejista'),
      isHighTurnover: false
    };
  }

  // 7. Serviços (Estética, Oficinas, Transportes, Clínicas, etc.)
  if (code.startsWith('45') || code.startsWith('49') || code.startsWith('96') || code.startsWith('62') || code.startsWith('70') || code.startsWith('86') || code.startsWith('82')) {
    return {
      commercialSegment: 'outro',
      category: 'servicos',
      subCategory: (cnaeDesc ? cnaeDesc.slice(0, 30).trim() : 'Serviços'),
      isHighTurnover: false
    };
  }

  // Padrão Geral
  return {
    commercialSegment: 'outro',
    category: 'outros',
    subCategory: (cnaeDesc ? cnaeDesc.slice(0, 30).trim() : 'Atividade Comercial'),
    isHighTurnover: false
  };
}

// Pseudo-random com seed para dispersão consistente no mesmo bairro
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
  
  let centerLat = -20.53861; // Centro de Franca
  let centerLng = -47.40083;

  // Busca bairro correspondente
  if (cleanBairro) {
    for (const [key, coords] of Object.entries(neighborhoodMap)) {
      if (cleanBairro.includes(key) || key.includes(cleanBairro)) {
        centerLat = coords.lat;
        centerLng = coords.lng;
        break;
      }
    }
  }

  // Aplica dispersão de ~50 a 150 metros para não sobrepor pinos exatamente no mesmo ponto
  const hashVal = pseudoHash(cnpj || 'franca');
  const latOffset = (((hashVal % 1000) / 1000) - 0.5) * 0.0035; // ~±180m
  const lngOffset = ((((hashVal >> 3) % 1000) / 1000) - 0.5) * 0.0035;

  return {
    lat: Number((centerLat + latOffset).toFixed(7)),
    lng: Number((centerLng + lngOffset).toFixed(7))
  };
}

async function main() {
  console.log('===========================================================');
  console.log('🚀 ENRIQUECIMENTO E INTEGRAÇÃO DE NOVOS CNPJs NO MAPA');
  console.log('===========================================================\n');

  if (!fs.existsSync(CONFIG.inputFile)) {
    console.error(`❌ Arquivo de cache ${CONFIG.inputFile} não encontrado!`);
    process.exit(1);
  }

  const baseList = JSON.parse(fs.readFileSync(CONFIG.inputFile, 'utf8'));
  console.log(`📋 Total de CNPJs a processar: ${baseList.length}`);

  // Carregar ou inicializar cache detalhado
  const detailCache = new Map();
  if (fs.existsSync(CONFIG.detailCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CONFIG.detailCacheFile, 'utf8'));
      cached.forEach(item => detailCache.set(item.cnpj, item));
      console.log(`📦 Cache de detalhes existente: ${detailCache.size} CNPJs já enriquecidos.`);
    } catch (e) {
      console.warn('⚠️ Falha ao ler cache existente de detalhes.');
    }
  }

  // Carregar bairros existentes do default-places.json para georreferenciamento
  const defaultPlaces = JSON.parse(fs.readFileSync(CONFIG.defaultPlacesFile, 'utf8'));
  const neighborhoodMap = {};
  defaultPlaces.forEach(p => {
    const match = p.address?.match(/-\s*([^,]+),\s*Franca/i);
    const b = match ? match[1].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null;
    if (b && p.lat && p.lng) {
      if (!neighborhoodMap[b]) {
        neighborhoodMap[b] = { lats: [], lngs: [] };
      }
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
  console.log(`📍 Mapa de ${Object.keys(resolvedNeighborhoodMap).length} bairros mapeados com coordenadas reais de Franca.\n`);

  // Lista dos que ainda faltam enriquecer
  const pending = baseList.filter(item => !detailCache.has(item.cnpj));
  console.log(`⏳ Faltam consultar: ${pending.length} CNPJs.`);

  if (pending.length > 0) {
    let completed = 0;
    const startTime = Date.now();

    // Processamento em fila paralela controlada (concurrency = 3)
    let index = 0;
    async function worker() {
      while (index < pending.length) {
        const item = pending[index++];
        try {
          const detail = await fetchCNPJDetails(item.cnpj);
          if (detail) {
            detailCache.set(item.cnpj, {
              ...item,
              ...detail,
              enriched: true
            });
          } else {
            // Se a API não respondeu, mantém os dados básicos conhecidos
            detailCache.set(item.cnpj, {
              ...item,
              enriched: false
            });
          }
        } catch (e) {
          detailCache.set(item.cnpj, {
            ...item,
            enriched: false
          });
        }

        completed++;
        if (completed % 25 === 0 || completed === pending.length) {
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);
          const percent = Math.round((completed / pending.length) * 100);
          process.stdout.write(`\r[${percent}%] ${completed}/${pending.length} consultados (${elapsedSec}s decorridos)...`);
          
          // Salva cache intermediário para segurança
          fs.writeFileSync(CONFIG.detailCacheFile, JSON.stringify(Array.from(detailCache.values()), null, 2));
        }

        await delay(CONFIG.delayBetweenReqMs);
      }
    }

    const workers = [];
    for (let w = 0; w < CONFIG.concurrency; w++) {
      workers.push(worker());
      await delay(100);
    }
    await Promise.all(workers);
    console.log('\n\n✅ Todas as consultas da Receita Federal concluídas com sucesso!');
  }

  // Salvar cache final de detalhes
  const allDetailed = Array.from(detailCache.values());
  fs.writeFileSync(CONFIG.detailCacheFile, JSON.stringify(allDetailed, null, 2));

  // Estatísticas de Segmentos
  const segmentCounts = {};
  let totalHighTurnover = 0;

  // 1. GERAR A PLANILHA EXCEL COMPLETA
  console.log('\n📊 Atualizando planilha Excel com CNAE, Endereço e Telefones...');
  const excelRows = allDetailed.map((c, idx) => {
    const cnaeCode = c.cnae_fiscal || c.cnae_fiscal_principal?.codigo || '';
    const cnaeDesc = c.cnae_fiscal_descricao || c.cnae_fiscal_principal?.descricao || '';
    const tel1 = formatPhone(c.ddd_telefone_1 ? c.ddd_telefone_1.slice(0, 2) : '', c.ddd_telefone_1 ? c.ddd_telefone_1.slice(2) : '');
    const tel2 = formatPhone(c.ddd_telefone_2 ? c.ddd_telefone_2.slice(0, 2) : '', c.ddd_telefone_2 ? c.ddd_telefone_2.slice(2) : '');
    const street = [c.logradouro, c.numero].filter(Boolean).join(', ');
    const address = [street, c.bairro, 'Franca - SP', c.cep].filter(Boolean).join(' - ');
    
    const classification = classifySegment(cnaeCode, cnaeDesc, c.razao_social, c.nome_fantasia);
    segmentCounts[classification.commercialSegment] = (segmentCounts[classification.commercialSegment] || 0) + 1;
    if (classification.isHighTurnover) totalHighTurnover++;

    const slugName = (c.razao_social || 'empresa').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const directLink = `https://casadosdados.com.br/solucao/cnpj/${slugName}-${c.cnpj}`;

    return {
      '#': idx + 1,
      'CNPJ': formatCNPJ(c.cnpj),
      'Razão Social': c.razao_social || '',
      'Nome Fantasia': c.nome_fantasia || '(Sem Nome Fantasia)',
      'Segmento Mapeador': classification.subCategory,
      'Giro Rápido?': classification.isHighTurnover ? 'SIM ⚡' : 'Não',
      'CNAE Principal': cnaeCode,
      'Descrição da Atividade (CNAE)': cnaeDesc,
      'Telefone 1': tel1,
      'Telefone 2': tel2,
      'Endereço': street || '(Não informado)',
      'Bairro': c.bairro || '',
      'CEP': c.cep || '',
      'Data de Abertura': formatDateBR(c.data_abertura || c.data_inicio_atividade),
      'Situação': c.situacao_cadastral ? (c.situacao_cadastral.situacao_atual || 'ATIVA') : (c.descricao_situacao_cadastral || 'ATIVA'),
      'Tipo / Porte': c.porte || c.tipo || 'ME / EPP',
      'Ficha Completa (Casa dos Dados)': directLink
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows);
  ws['!cols'] = [
    { wch: 6 },   // #
    { wch: 22 },  // CNPJ
    { wch: 45 },  // Razão Social
    { wch: 30 },  // Nome Fantasia
    { wch: 26 },  // Segmento Mapeador
    { wch: 14 },  // Giro Rapido?
    { wch: 16 },  // CNAE Principal
    { wch: 45 },  // Descrição da Atividade
    { wch: 18 },  // Tel 1
    { wch: 18 },  // Tel 2
    { wch: 35 },  // Endereço
    { wch: 25 },  // Bairro
    { wch: 12 },  // CEP
    { wch: 16 },  // Data
    { wch: 12 },  // Situação
    { wch: 18 },  // Tipo / Porte
    { wch: 60 }   // Link
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Novos CNPJs Enriquecidos');
  XLSX.writeFile(wb, CONFIG.outputExcelFile);
  console.log(`📁 Planilha Excel atualizada com sucesso em: ${CONFIG.outputExcelFile}`);

  // 2. CONVERTER PARA PONTOS DO MAPA (default-places.json)
  console.log('\n🗺️ Criando pontos georreferenciados para o Mapeador Urbano...');
  const newPlaces = allDetailed.map((c) => {
    const cnaeCode = c.cnae_fiscal || c.cnae_fiscal_principal?.codigo || '';
    const cnaeDesc = c.cnae_fiscal_descricao || c.cnae_fiscal_principal?.descricao || '';
    const classification = classifySegment(cnaeCode, cnaeDesc, c.razao_social, c.nome_fantasia);

    const street = [c.logradouro, c.numero].filter(Boolean).join(', ');
    const fullAddress = [street, c.bairro, 'Franca - SP', c.cep].filter(Boolean).join(' - ');

    const coords = getCoordsForNeighborhood(c.bairro, c.cnpj, resolvedNeighborhoodMap);

    const tel1 = formatPhone(c.ddd_telefone_1 ? c.ddd_telefone_1.slice(0, 2) : '', c.ddd_telefone_1 ? c.ddd_telefone_1.slice(2) : '');
    const telDigits = (c.ddd_telefone_1 || c.ddd_telefone_2 || '').replace(/\D/g, '');

    const displayName = c.nome_fantasia && c.nome_fantasia.length > 2 ? c.nome_fantasia : c.razao_social;
    const aberturaBR = formatDateBR(c.data_abertura || c.data_inicio_atividade);

    return {
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
      tags: [
        'Novo CNPJ',
        'Franca',
        c.bairro || 'Geral',
        classification.subCategory
      ],
      commercialSegment: classification.commercialSegment,
      isHighTurnover: classification.isHighTurnover,
      isChain: false,
      crmStatus: 'lead', // Inicia no funil "A Visitar"
      cnpj: formatCNPJ(c.cnpj),
      cnae: `${cnaeCode} - ${cnaeDesc}`,
      dataAbertura: aberturaBR
    };
  });

  // Salvar base independente apenas com os novos CNPJs
  const newPlacesOnlyFile = path.join(__dirname, '..', 'data', 'novos-cnpjs-places.json');
  fs.writeFileSync(newPlacesOnlyFile, JSON.stringify(newPlaces, null, 2));

  // Mesclar com os locais existentes sem duplicar
  const existingMap = new Map();
  defaultPlaces.forEach(p => existingMap.set(p.id, p));

  let addedCount = 0;
  newPlaces.forEach(np => {
    if (!existingMap.has(np.id)) {
      existingMap.set(np.id, np);
      addedCount++;
    }
  });

  const mergedPlaces = Array.from(existingMap.values());
  fs.writeFileSync(CONFIG.defaultPlacesFile, JSON.stringify(mergedPlaces, null, 2));

  console.log(`\n🎉 SUCESSO TOTAL!`);
  console.log(`- Locais anteriores: ${defaultPlaces.length}`);
  console.log(`- Novos CNPJs integrados ao mapa: ${addedCount}`);
  console.log(`- Total de locais no sistema agora: ${mergedPlaces.length}`);
  console.log(`- Estabelecimentos de Giro Rápido (Bares, Adegas, Restaurantes, Mercados): ${totalHighTurnover}`);
  console.log('\nDistribuição dos Novos CNPJs por Segmento:');
  console.table(segmentCounts);
}

main().catch(err => {
  console.error('❌ Erro inesperado no processo:', err);
  process.exit(1);
});
