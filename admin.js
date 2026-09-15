/**
 * ADMIN DASHBOARD MASTER - LOGIC & ANALYTICS
 * CityMap Hub - Mapeador Urbano & CRM
 */

const AdminApp = {
  places: [],
  interactions: [],
  currentUser: null,

  async init() {
    // 1. Inicializar Supabase
    CloudSync.init();

    // 2. Auth Guard: Verificar se é Administrador Master
    await this.verifyAdminAccess();

    // 3. Carregar dados de Leads
    await this.loadData();

    // 4. Calcular e Renderizar Métricas
    this.renderKPIs();
    this.renderMarketShare();
    this.renderCommercialSegments();
    this.renderRecentLeadsTable();

    // 5. Carregar Feed de Auditoria do Supabase
    await this.loadAuditFeed();

    // 6. Configurar Event Listeners das Ferramentas Master
    this.setupEventListeners();
  },

  async verifyAdminAccess() {
    if (!CloudSync.client) {
      // Se nem o cliente foi inicializado, redireciona para login
      window.location.href = 'login.html';
      return;
    }

    try {
      const { data } = await CloudSync.client.auth.getSession();
      const user = data?.session?.user;

      if (!user) {
        alert('Acesso restrito. Faça login como administrador para acessar este painel.');
        window.location.href = 'login.html';
        return;
      }

      this.currentUser = user;

      // Verificar se é Admin
      const isAdmin = CloudSync.isAdmin ? CloudSync.isAdmin(user) : false;
      if (!isAdmin) {
        alert('Acesso negado: Este painel é exclusivo para o Administrador Master.');
        window.location.href = 'index.html';
        return;
      }

      // Atualizar tag de usuário na navbar
      const userEmailEl = document.getElementById('navUserEmail');
      if (userEmailEl) userEmailEl.textContent = user.email || 'Admin Master';

    } catch (e) {
      console.error('Erro na verificação de acesso:', e);
      window.location.href = 'login.html';
    }
  },

  async loadData() {
    const statusText = document.getElementById('cloudSyncStatusText');
    if (statusText) statusText.textContent = 'Carregando dados...';

    // 1. Tentar buscar da nuvem (Supabase)
    if (CloudSync.isConfigured && this.currentUser) {
      try {
        const cloudLeads = await CloudSync.fetchAllLeads();
        if (cloudLeads && cloudLeads.length > 0) {
          this.places = cloudLeads;
          if (statusText) statusText.textContent = `Nuvem Ativa (${cloudLeads.length} leads sincronizados)`;
          return;
        }
      } catch (err) {
        console.warn('Erro ao carregar dados do Supabase:', err);
      }
    }

    // 2. Fallback: LocalStorage
    const saved = localStorage.getItem('citymap_places_data');
    if (saved) {
      try {
        this.places = JSON.parse(saved);
        if (statusText) statusText.textContent = `Base Local (${this.places.length} leads)`;
        return;
      } catch (e) {
        console.warn('Erro ao ler localStorage:', e);
      }
    }

    // 3. Fallback: window.DEFAULT_PLACES_DATA
    if (window.DEFAULT_PLACES_DATA && Array.isArray(window.DEFAULT_PLACES_DATA)) {
      this.places = window.DEFAULT_PLACES_DATA;
      if (statusText) statusText.textContent = `Base Padrão (${this.places.length} leads)`;
    }
  },

  renderKPIs() {
    const total = this.places.length;
    let leadsCount = 0;
    let negotiatingCount = 0;
    let closedCount = 0;
    let followUpDueCount = 0;

    const todayStr = new Date().toISOString().split('T')[0];

    this.places.forEach(p => {
      const stage = p.crmStage || (p.visited ? 'negotiating' : 'lead');
      if (stage === 'lead') leadsCount++;
      else if (stage === 'negotiating') negotiatingCount++;
      else if (stage === 'closed') closedCount++;

      if (p.followUpDate) {
        if (p.followUpDate <= todayStr) {
          followUpDueCount++;
        }
      }
    });

    const conversionRate = total > 0 ? ((closedCount / (total - leadsCount || 1)) * 100).toFixed(1) : 0;

    // Atualizar elementos no DOM
    this.animateCounter('kpiTotalLeads', total);
    this.animateCounter('kpiPendingLeads', leadsCount);
    this.animateCounter('kpiNegotiatingLeads', negotiatingCount);
    this.animateCounter('kpiClosedLeads', closedCount);
    this.animateCounter('kpiFollowUpsDue', followUpDueCount);

    const conversionEl = document.getElementById('kpiConversionRate');
    if (conversionEl) conversionEl.textContent = `${conversionRate}% de conversão`;

    const subTotalEl = document.getElementById('kpiSubTotalText');
    if (subTotalEl) subTotalEl.textContent = `${total.toLocaleString('pt-BR')} empresas mapeadas`;
  },

  renderMarketShare() {
    const container = document.getElementById('marketShareList');
    if (!container) return;

    const counts = {};
    const machinesList = ['Stone', 'Cielo', 'Rede', 'PagBank', 'InfinitePay', 'Ton', 'Mercado Pago', 'Getnet', 'SafraPay', 'C6 Bank', 'Outra', 'Não Informado'];
    
    machinesList.forEach(m => counts[m] = 0);

    let informedTotal = 0;

    this.places.forEach(p => {
      const machine = p.cardMachine && p.cardMachine.trim() ? p.cardMachine.trim() : 'Não Informado';
      counts[machine] = (counts[machine] || 0) + 1;
      if (machine !== 'Não Informado') informedTotal++;
    });

    // Ordena do mais comum para o menos comum
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const colors = {
      'Stone': '#10b981',
      'Cielo': '#0284c7',
      'Rede': '#ea580c',
      'PagBank': '#eab308',
      'InfinitePay': '#6366f1',
      'Ton': '#22c55e',
      'Mercado Pago': '#06b6d4',
      'Getnet': '#e11d48',
      'SafraPay': '#d97706',
      'C6 Bank': '#475569',
      'Outra': '#8b5cf6',
      'Não Informado': '#64748b'
    };

    container.innerHTML = sorted.map(([name, count]) => {
      const percent = this.places.length > 0 ? ((count / this.places.length) * 100).toFixed(1) : 0;
      const barColor = colors[name] || '#f59e0b';

      return `
        <div class="market-item">
          <div class="market-item-top">
            <span class="market-item-name">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${barColor};"></span>
              ${name}
            </span>
            <span class="market-item-stats"><strong>${count}</strong> (${percent}%)</span>
          </div>
          <div class="market-progress-track">
            <div class="market-progress-fill" style="width: ${percent}%; background: ${barColor};"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCommercialSegments() {
    const container = document.getElementById('commercialSegmentsList');
    if (!container) return;

    const segments = {
      novo_cnpj: { name: 'Novos CNPJs Abertos', count: 0, color: '#38bdf8' },
      adega: { name: 'Adegas & Depósitos', count: 0, color: '#9333ea' },
      bar: { name: 'Bares & Choperias', count: 0, color: '#f59e0b' },
      restaurante: { name: 'Restaurantes & Lanches', count: 0, color: '#ef4444' },
      padaria: { name: 'Padarias & Confeitarias', count: 0, color: '#eab308' },
      mercado_bairro: { name: 'Mercados de Bairro', count: 0, color: '#10b981' },
      outro: { name: 'Outros Estabelecimentos', count: 0, color: '#64748b' }
    };

    this.places.forEach(p => {
      const seg = p.commercialSegment || 'outro';
      if (segments[seg]) segments[seg].count++;
      else segments.outro.count++;
    });

    const sorted = Object.values(segments).sort((a, b) => b.count - a.count);

    container.innerHTML = sorted.map(s => {
      const percent = this.places.length > 0 ? ((s.count / this.places.length) * 100).toFixed(1) : 0;
      return `
        <div class="market-item">
          <div class="market-item-top">
            <span class="market-item-name">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${s.color};"></span>
              ${s.name}
            </span>
            <span class="market-item-stats"><strong>${s.count}</strong> (${percent}%)</span>
          </div>
          <div class="market-progress-track">
            <div class="market-progress-fill" style="width: ${percent}%; background: ${s.color};"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderRecentLeadsTable(filterText = '') {
    const tbody = document.getElementById('recentLeadsTableBody');
    if (!tbody) return;

    let list = this.places;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      list = list.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.address && p.address.toLowerCase().includes(q)) ||
        (p.cnpj && p.cnpj.includes(q))
      );
    }

    // Limita aos primeiros 15 resultados
    const slice = list.slice(0, 15);

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:2rem;">Nenhum lead encontrado com esse termo.</td></tr>`;
      return;
    }

    const stageLabels = {
      lead: '<span style="color:#94a3b8;">A Visitar</span>',
      negotiating: '<span style="color:#f59e0b; font-weight:700;">Em Negociação</span>',
      closed: '<span style="color:#10b981; font-weight:700;">Fechado ✔</span>',
      rejected: '<span style="color:#f43f5e;">Sem Interesse</span>'
    };

    tbody.innerHTML = slice.map(p => `
      <tr>
        <td class="lead-name-cell">${p.name || 'Sem nome'}</td>
        <td><span class="lead-cnpj-badge">${p.cnpj || 'N/D'}</span></td>
        <td>${p.commercialSegment || 'Outro'}</td>
        <td>${p.cardMachine || '<span style="color:#64748b;">Não Informado</span>'}</td>
        <td>${stageLabels[p.crmStage] || stageLabels.lead}</td>
        <td>${p.phone || p.whatsapp || '<span style="color:#64748b;">—</span>'}</td>
      </tr>
    `).join('');
  },

  async loadAuditFeed() {
    const feedContainer = document.getElementById('auditFeedList');
    if (!feedContainer) return;

    if (!CloudSync.client || !CloudSync.isConfigured) {
      feedContainer.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem; padding:1rem;">Nuvem não configurada. Conecte ao Supabase para ver o histórico em tempo real.</div>`;
      return;
    }

    try {
      const { data, error } = await CloudSync.client
        .from('lead_interactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error || !data || data.length === 0) {
        feedContainer.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem; padding:1rem;">Nenhuma alteração registrada ainda. As atividades da equipe aparecerão aqui em tempo real!</div>`;
        return;
      }

      feedContainer.innerHTML = data.map(item => {
        const timeAgo = this.formatTimeAgo(new Date(item.created_at));
        const userShort = (item.user_email || 'Usuário').split('@')[0];

        return `
          <div class="audit-feed-item">
            <span class="audit-item-dot" style="background: #38bdf8;"></span>
            <div class="audit-item-content">
              <span class="audit-item-action">
                <strong class="audit-item-user">${userShort}</strong> ${item.action_type || 'atualizou um lead'}: <em>${item.details || ''}</em>
              </span>
              <span class="audit-item-time"><i class="ri-time-line"></i> ${timeAgo}</span>
            </div>
          </div>
        `;
      }).join('');

    } catch (e) {
      console.warn('Erro ao carregar auditoria:', e);
    }
  },

  setupEventListeners() {
    // Busca na tabela de leads
    const searchInput = document.getElementById('adminLeadSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.renderRecentLeadsTable(e.target.value);
      });
    }

    // Botão: Sincronizar Tudo na Nuvem (Bulk Upload)
    const syncAllBtn = document.getElementById('btnAdminSyncAll');
    if (syncAllBtn) {
      syncAllBtn.addEventListener('click', async () => {
        if (!confirm(`Deseja sincronizar todos os ${this.places.length} leads com o banco de dados na nuvem (Supabase)?`)) {
          return;
        }

        syncAllBtn.disabled = true;
        syncAllBtn.innerHTML = '<i class="ri-loader-4-line spinner"></i> Sincronizando...';

        try {
          await CloudSync.bulkUploadPlaces(this.places, (done, total) => {
            syncAllBtn.innerHTML = `<i class="ri-loader-4-line spinner"></i> ${done}/${total}...`;
          });
          alert(`✔ Sucesso! Todos os ${this.places.length} leads foram sincronizados na nuvem!`);
          this.loadAuditFeed();
        } catch (err) {
          alert('Erro na sincronização: ' + (err.message || err));
        } finally {
          syncAllBtn.disabled = false;
          syncAllBtn.innerHTML = '<i class="ri-cloud-upload-line"></i> Subir Base para Nuvem';
        }
      });
    }

    // Botão: Exportar Backup JSON
    const exportJsonBtn = document.getElementById('btnAdminExportJson');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        const jsonStr = JSON.stringify(this.places, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_leads_franca_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Botão: Exportar Relatório CSV (Excel)
    const exportCsvBtn = document.getElementById('btnAdminExportCsv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        this.exportToCSV();
      });
    }

    // Botão: Logout Admin
    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await CloudSync.logout();
        window.location.href = 'login.html';
      });
    }
  },

  exportToCSV() {
    const headers = ['ID', 'Nome', 'CNPJ', 'CNAE', 'Segmento Comercial', 'Maquininha Atual', 'Estágio Funil', 'Telefone', 'WhatsApp', 'Endereço', 'Data de Abertura', 'Retorno Agendado', 'Visitado'];
    
    const rows = this.places.map(p => [
      `"${p.id || ''}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${p.cnpj || ''}"`,
      `"${(p.cnae || '').replace(/"/g, '""')}"`,
      `"${p.commercialSegment || ''}"`,
      `"${p.cardMachine || 'Não Informado'}"`,
      `"${p.crmStage || 'lead'}"`,
      `"${p.phone || ''}"`,
      `"${p.whatsapp || ''}"`,
      `"${(p.address || '').replace(/"/g, '""')}"`,
      `"${p.dataAbertura || ''}"`,
      `"${p.followUpDate ? p.followUpDate + ' ' + (p.followUpTime || '') : ''}"`,
      `"${p.visited ? 'Sim' : 'Não'}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_leads_comerciais_franca_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = Number(target).toLocaleString('pt-BR');
  },

  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Agora mesmo';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Há ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Há ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Há ${days}d`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
