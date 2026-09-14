/**
 * Exportador de Novos CNPJs de Franca-SP
 * Fonte: Casa dos Dados (Pesquisa Avançada)
 * Período: 01/08/2026 a 13/09/2026
 * 
 * Execução: node scripts/exportar-cnpjs-franca.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CONFIG = {
  municipio: 'FRANCA',
  uf: 'SP',
  dataInicio: '2026-08-01',
  dataFim: '2026-09-13',
  delayMs: 350, // Delay entre requisições para estabilidade
  outputFile: path.join(__dirname, '..', 'data', 'novos-cnpjs-franca-agosto-setembro-2026.xlsx'),
  cacheFile: path.join(__dirname, '..', 'data', 'cache-cnpjs-coletados.json')
};

function fetchSearch(payload) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.casadosdados.com.br',
      port: 443,
      path: '/v5/public/cnpj/pesquisa',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://casadosdados.com.br',
        'Referer': 'https://casadosdados.com.br/solucao/cnpj/pesquisa-avancada'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.cnpjs || []);
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve([]);
    });
    req.write(postData);
    req.end();
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Gera a lista de dias entre dataInicio e dataFim (formato YYYY-MM-DD)
function generateDateList(startStr, endStr) {
  const dates = [];
  let current = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// Formata CNPJ com máscara padrão: 00.000.000/0001-00
function formatCNPJ(cnpj) {
  if (!cnpj || cnpj.length !== 14) return cnpj || '';
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Formata Data DD/MM/YYYY
function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

async function main() {
  console.log('=====================================================');
  console.log('🚀 EXPORTADOR DE NOVOS CNPJs - FRANCA-SP');
  console.log(`📅 Período: ${formatDateBR(CONFIG.dataInicio)} até ${formatDateBR(CONFIG.dataFim)}`);
  console.log('=====================================================\n');

  const dates = generateDateList(CONFIG.dataInicio, CONFIG.dataFim);
  console.log(`Total de dias no intervalo: ${dates.length} dias.\n`);

  // Carregar cache se existir
  const collectedMap = new Map();
  if (fs.existsSync(CONFIG.cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CONFIG.cacheFile, 'utf8'));
      cached.forEach(c => collectedMap.set(c.cnpj, c));
      console.log(`📦 Cache carregado: ${collectedMap.size} empresas já coletadas anteriormente.`);
    } catch (e) {
      console.warn('Não foi possível ler cache prévio.');
    }
  }

  let totalRequests = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const dateBR = formatDateBR(date);
    const progress = Math.round(((i + 1) / dates.length) * 100);

    process.stdout.write(`[${progress}%] Dia ${dateBR} (${i + 1}/${dates.length})... `);

    let dayCount = 0;

    // 1. Não-MEI (LTDAs, Eirelis, Sociedades Comerciais)
    const p1 = {
      cnpj: [], cnpj_raiz: [], situacao_cadastral: ['ATIVA'], codigo_atividade_principal: [],
      codigo_natureza_juridica: [], incluir_atividade_secundaria: false, uf: [CONFIG.uf],
      municipio: [CONFIG.municipio], bairro: [], cep: [], ddd: [],
      data_abertura: { inicio: date, fim: date },
      capital_social: { minimo: 0, maximo: 0 },
      mei: { optante: false, excluir_optante: true },
      simples: { optante: false, excluir_optante: false },
      mais_filtros: { somente_matriz: false, somente_filial: false, com_email: false, com_telefone: true, somente_fixo: false, somente_celular: false },
      limite: 20
    };
    const r1 = await fetchSearch(p1);
    r1.forEach(c => {
      if (!collectedMap.has(c.cnpj)) {
        collectedMap.set(c.cnpj, { ...c, data_abertura: date, tipo: 'LTDA / Sociedade / Outro' });
        dayCount++;
      }
    });
    totalRequests++;
    await delay(CONFIG.delayMs);

    // 2. MEI com telefone fixo
    const p2 = {
      ...p1,
      mei: { optante: true, excluir_optante: false },
      mais_filtros: { ...p1.mais_filtros, somente_fixo: true, somente_celular: false }
    };
    const r2 = await fetchSearch(p2);
    r2.forEach(c => {
      if (!collectedMap.has(c.cnpj)) {
        collectedMap.set(c.cnpj, { ...c, data_abertura: date, tipo: 'MEI (Tel Fixo)' });
        dayCount++;
      }
    });
    totalRequests++;
    await delay(CONFIG.delayMs);

    // 3. MEI com celular
    const p3 = {
      ...p1,
      mei: { optante: true, excluir_optante: false },
      mais_filtros: { ...p1.mais_filtros, somente_fixo: false, somente_celular: true }
    };
    const r3 = await fetchSearch(p3);
    r3.forEach(c => {
      if (!collectedMap.has(c.cnpj)) {
        collectedMap.set(c.cnpj, { ...c, data_abertura: date, tipo: 'MEI (Celular)' });
        dayCount++;
      }
    });
    totalRequests++;
    await delay(CONFIG.delayMs);

    console.log(`+${dayCount} novas empresas (Total acumulado: ${collectedMap.size})`);

    // Salvar cache a cada 5 dias
    if ((i + 1) % 5 === 0 || i === dates.length - 1) {
      fs.writeFileSync(CONFIG.cacheFile, JSON.stringify(Array.from(collectedMap.values()), null, 2), 'utf8');
    }
  }

  console.log('\n=====================================================');
  console.log(`✅ COLETA CONCLUÍDA!`);
  console.log(`Total de empresas únicas extraídas em Franca-SP: ${collectedMap.size}`);
  console.log('=====================================================\n');

  // Gerar Planilha Excel Formatada
  console.log('📊 Gerando planilha Excel formatada...');
  const rows = Array.from(collectedMap.values()).map((c, idx) => {
    const slugName = (c.razao_social || 'empresa').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const directLink = `https://casadosdados.com.br/solucao/cnpj/${slugName}-${c.cnpj}`;

    return {
      '#': idx + 1,
      'CNPJ': formatCNPJ(c.cnpj),
      'CNPJ (Apenas Dígitos)': c.cnpj,
      'Razão Social': c.razao_social || '',
      'Nome Fantasia': c.nome_fantasia || '(Sem Nome Fantasia)',
      'Data de Abertura': formatDateBR(c.data_abertura),
      'Situação Cadastral': c.situacao_cadastral ? c.situacao_cadastral.situacao_atual : 'ATIVA',
      'Tipo / Porte': c.tipo || 'Geral',
      'Município': CONFIG.municipio,
      'UF': CONFIG.uf,
      'Ficha Completa (Casa dos Dados)': directLink
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Ajustar larguras das colunas
  ws['!cols'] = [
    { wch: 6 },   // #
    { wch: 22 },  // CNPJ
    { wch: 18 },  // Dígitos
    { wch: 45 },  // Razão Social
    { wch: 35 },  // Nome Fantasia
    { wch: 16 },  // Data
    { wch: 18 },  // Situação
    { wch: 22 },  // Tipo
    { wch: 14 },  // Município
    { wch: 6 },   // UF
    { wch: 70 }   // Link
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Novos CNPJs Franca');
  XLSX.writeFile(wb, CONFIG.outputFile);

  console.log(`🎉 Planilha gerada com sucesso em:`);
  console.log(`📁 ${CONFIG.outputFile}\n`);
}

main().catch(console.error);
